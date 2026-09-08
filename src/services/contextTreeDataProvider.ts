import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FilterSettings } from '../types';
import { ALWAYS_IGNORED } from '../constants';
import { WorkspaceScanner } from './workspaceScanner';
import { GitService } from './gitService';
import { PathUtils } from '../utils/pathUtils';

/**
 * Representation of an individual item within the project Context TreeView.
 */
export class ContextTreeItem extends vscode.TreeItem {
  /**
   * Creates an instance of ContextTreeItem.
   *
   * @param uri - File system URI of the target item.
   * @param isDirectory - Flag indicating whether the item is a folder.
   * @param isChecked - Checkbox state (true = checked, false = unchecked, undefined = no checkbox).
   * @param collapsibleState - Explicit collapsible state.
   * @param descriptionText - Optional secondary description label displayed beside the item.
   * @param version - Monotonic version used exclusively for directories to allow programmatic expansion.
   */
  constructor(
    public readonly uri: vscode.Uri,
    public readonly isDirectory: boolean,
    public readonly isChecked: boolean | undefined,
    collapsibleState?: vscode.TreeItemCollapsibleState,
    descriptionText?: string,
    version?: number
  ) {
    super(
      uri,
      isDirectory
        ? (collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed)
        : vscode.TreeItemCollapsibleState.None
    );

    // Files have a strictly stable ID so selection and focus never jump.
    // Directories use a scoped version so VS Code honors collapsibleState changes upon button clicks.
    if (isDirectory && version !== undefined) {
      this.id = `${uri.fsPath}#v${version}`;
    } else {
      this.id = uri.fsPath;
    }

    if (isChecked !== undefined) {
      this.checkboxState = isChecked
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
    } else {
      this.checkboxState = undefined;
    }

    this.resourceUri = uri;
    this.contextValue = isDirectory ? 'directory' : 'file';

    if (descriptionText) {
      this.description = descriptionText;
    }
  }
}

/**
 * Tree data provider managing hierarchical project file representation for the native VS Code TreeView.
 */
export class ContextTreeDataProvider implements vscode.TreeDataProvider<ContextTreeItem> {
  /**
   * Internal event emitter triggering tree hierarchy updates.
   */
  private readonly _onDidChangeTreeData: vscode.EventEmitter<ContextTreeItem | undefined | void> =
    new vscode.EventEmitter<ContextTreeItem | undefined | void>();

  /**
   * Event raised when the underlying tree model changes.
   */
  public readonly onDidChangeTreeData: vscode.Event<ContextTreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  /**
   * Current case-insensitive substring search filter.
   */
  private searchQuery: string = '';

  /**
   * Current folder nesting depth limit for bulk expansion.
   */
  private expansionLevel: number = 1;

  /**
   * Monotonically increasing tree version to trigger folder expansion when user requests it.
   */
  private treeVersion: number = 0;

  /**
   * Set of normalized absolute paths of files matching the active search query.
   */
  private readonly matchingFilePaths: Set<string> = new Set<string>();

  /**
   * Set of normalized absolute paths of directories containing search matches.
   */
  private readonly matchingFolderPaths: Set<string> = new Set<string>();

  /**
   * Set of ancestor folder paths to auto-expand when Git modified files are selected.
   */
  private readonly gitExpandedFolderPaths: Set<string> = new Set<string>();

  /**
   * Cache mapping directory paths to their total selectable file counts.
   */
  public readonly folderTotalCountMap: Map<string, number> = new Map<string, number>();

  /**
   * Deduplication cache for in-flight directory scan promises to avoid concurrent disk crawl.
   */
  private readonly pendingCountPromises: Map<string, Promise<number>> = new Map<string, Promise<number>>();

  /**
   * Creates an instance of ContextTreeDataProvider.
   *
   * @param selectedFiles - Shared set containing normalized absolute paths of selected files.
   * @param filters - Active file exclusion filter settings.
   */
  constructor(
    private readonly selectedFiles: Set<string>,
    private filters: FilterSettings
  ) { }

  /**
   * Formats file quantity with correct Russian pluralization rules.
   *
   * @param count - Total number of selected files.
   * @returns Formatted string (e.g. "1 файл выбран", "3 файла выбрано", "5 файлов выбрано").
   */
  private formatFilePlural(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 19) {
      return `${count} файлов выбрано`;
    }
    if (mod10 === 1) {
      return `${count} файл выбран`;
    }
    if (mod10 >= 2 && mod10 <= 4) {
      return `${count} файла выбрано`;
    }
    return `${count} файлов выбрано`;
  }

  /**
   * Computes the depth of a folder relative to its workspace root.
   *
   * @param folderPath - Absolute folder path.
   * @returns Relative folder depth (root level = 0, first subfolder = 1, etc.).
   */
  private getFolderDepth(folderPath: string): number {
    const norm = PathUtils.normalizePath(folderPath);
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return 0;
    }

    for (const wf of workspaceFolders) {
      const root = PathUtils.normalizePath(wf.uri.fsPath);
      if (norm === root) {
        return 0;
      }
      if (PathUtils.isSubpath(norm, root)) {
        const rel = path.relative(root, norm);
        return rel.split(path.sep).length;
      }
    }
    return 0;
  }

  /**
   * Computes the number of currently selected files located inside target directory in memory.
   *
   * @param folderPath - Absolute directory path.
   * @returns Number of selected files contained within directory subtree.
   */
  public getSelectedCountInFolder(folderPath: string): number {
    const normFolder = PathUtils.normalizePath(folderPath);
    let count = 0;
    for (const file of this.selectedFiles) {
      if (PathUtils.isSubpath(file, normFolder)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Gets or calculates the total selectable file count in target directory with concurrent request deduplication.
   *
   * @param folderPath - Absolute directory path.
   * @returns Total selectable file count.
   */
  public async getFolderTotalCount(folderPath: string): Promise<number> {
    const norm = PathUtils.normalizePath(folderPath);
    if (this.folderTotalCountMap.has(norm)) {
      return this.folderTotalCountMap.get(norm)!;
    }

    if (this.pendingCountPromises.has(norm)) {
      return await this.pendingCountPromises.get(norm)!;
    }

    const countPromise = WorkspaceScanner.countSelectableFiles(
      norm,
      this.filters,
      this.folderTotalCountMap
    ).finally(() => {
      this.pendingCountPromises.delete(norm);
    });

    this.pendingCountPromises.set(norm, countPromise);
    return await countPromise;
  }

  /**
   * Returns the count of unique files matching the active search query.
   *
   * @returns Number of matched files.
   */
  public getMatchingFilesCount(): number {
    return this.matchingFilePaths.size;
  }

  /**
   * Updates active exclusion filters and refreshes the tree.
   *
   * @param filters - New filter settings.
   */
  public setFilters(filters: FilterSettings): void {
    this.filters = filters;
    this.folderTotalCountMap.clear();
    this.pendingCountPromises.clear();
    this.refresh();
  }

  /**
   * Expands all ancestor directory paths containing Git modified files and refreshes the view.
   *
   * @param filePaths - List of modified file paths.
   */
  public setGitExpandedFolders(filePaths: string[]): void {
    this.gitExpandedFolderPaths.clear();
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    for (const filePath of filePaths) {
      const normFilePath = PathUtils.normalizePath(filePath);
      let parent = path.dirname(normFilePath);

      for (const folder of workspaceFolders) {
        const root = PathUtils.normalizePath(folder.uri.fsPath);
        while (PathUtils.isSubpath(parent, root)) {
          this.gitExpandedFolderPaths.add(PathUtils.normalizePath(parent));
          if (parent === root) {
            break;
          }
          const nextParent = path.dirname(parent);
          if (nextParent === parent) {
            break;
          }
          parent = nextParent;
        }
      }
    }

    this.treeVersion++;
    this.refresh();
  }

  /**
   * Resolves parent item for an element (required for VS Code TreeView API contract).
   *
   * @param element - Current node.
   * @returns Parent tree item or undefined.
   */
  public getParent(element: ContextTreeItem): ContextTreeItem | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return undefined;
    }

    const normPath = PathUtils.normalizePath(element.uri.fsPath);
    for (const folder of workspaceFolders) {
      const root = PathUtils.normalizePath(folder.uri.fsPath);
      if (normPath === root) {
        return undefined;
      }
      if (PathUtils.isSubpath(normPath, root)) {
        const parentDir = path.dirname(normPath);
        return new ContextTreeItem(
          vscode.Uri.file(parentDir),
          true,
          undefined,
          vscode.TreeItemCollapsibleState.Expanded,
          undefined,
          this.treeVersion
        );
      }
    }
    return undefined;
  }

  /**
   * Sets current search filter query, pre-calculates matching hierarchies, and triggers view refresh.
   *
   * @param query - Search term.
   */
  public async setSearchQuery(query: string): Promise<void> {
    this.searchQuery = query.trim().toLowerCase();
    this.matchingFilePaths.clear();
    this.matchingFolderPaths.clear();

    if (this.searchQuery) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders) {
        for (const folder of workspaceFolders) {
          const matches = await WorkspaceScanner.findMatchingFiles(
            folder.uri.fsPath,
            this.searchQuery,
            this.filters
          );

          for (const match of matches) {
            const normMatch = PathUtils.normalizePath(match);
            this.matchingFilePaths.add(normMatch);

            let parent = path.dirname(normMatch);
            const root = PathUtils.normalizePath(folder.uri.fsPath);
            while (PathUtils.isSubpath(parent, root)) {
              this.matchingFolderPaths.add(PathUtils.normalizePath(parent));
              if (parent === root) {
                break;
              }
              const nextParent = path.dirname(parent);
              if (nextParent === parent) {
                break;
              }
              parent = nextParent;
            }
          }
        }
      }
    }

    this.treeVersion++;
    this.refresh();
  }

  /**
   * Increments expansion level and updates tree view items.
   */
  public expandLevel(): void {
    this.expansionLevel++;
    this.treeVersion++;
    this.refresh();
  }

  /**
   * Collapses all folder nodes in the TreeView and resets expansion depth.
   */
  public collapseAll(): void {
    this.expansionLevel = 0;
    this.gitExpandedFolderPaths.clear();
    this.treeVersion++;
    vscode.commands.executeCommand('workbench.actions.treeView.aiContextMergerTreeView.collapseAll');
    this.refresh();
  }

  /**
   * Emits tree data change event to refresh UI rendering.
   */
  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Resolves the visual tree item representation.
   *
   * @param element - The tree node item.
   * @returns Visual TreeItem descriptor.
   */
  public getTreeItem(element: ContextTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Resolves child items for a given directory node or workspace roots.
   *
   * @param element - Parent node, or undefined for root.
   * @returns Array of child context tree items.
   */
  public async getChildren(element?: ContextTreeItem): Promise<ContextTreeItem[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [];
    }

    if (!element) {
      const folderPromises = workspaceFolders.map(async (folder) => {
        const folderPath = PathUtils.normalizePath(folder.uri.fsPath);
        const selectedCount = this.getSelectedCountInFolder(folderPath);

        let isChecked: boolean = false;
        let description: string | undefined = undefined;

        if (selectedCount > 0) {
          const totalCount = await this.getFolderTotalCount(folderPath);
          const isAllSelected = totalCount > 0 && selectedCount >= totalCount;
          isChecked = isAllSelected;
          description = totalCount > 0
            ? `${selectedCount}/${totalCount} (${this.formatFilePlural(selectedCount)})`
            : this.formatFilePlural(selectedCount);
        }

        let collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        if (this.searchQuery && !this.matchingFolderPaths.has(folderPath)) {
          collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        }

        return new ContextTreeItem(
          folder.uri,
          true,
          isChecked,
          collapsibleState,
          description,
          this.treeVersion
        );
      });

      return await Promise.all(folderPromises);
    }

    if (element.isDirectory) {
      return this.readDirectoryItems(element.uri.fsPath);
    }

    return [];
  }

  /**
   * Reads directory entries from filesystem without deep scan, applying level-based expansion.
   *
   * @param dirPath - Directory path to read.
   * @returns List of child tree items.
   */
  private async readDirectoryItems(dirPath: string): Promise<ContextTreeItem[]> {
    const normalizedDirPath = PathUtils.normalizePath(dirPath);

    try {
      const entries = await fs.promises.readdir(normalizedDirPath, { withFileTypes: true });
      const primaryFiltered = entries.filter((e) => !ALWAYS_IGNORED.has(e.name));

      let gitIgnored = new Set<string>();
      if (this.filters.hideGitIgnored) {
        const candidatePaths = primaryFiltered.map((e) =>
          PathUtils.normalizePath(path.join(normalizedDirPath, e.name))
        );
        gitIgnored = await GitService.checkIgnoredPaths(candidatePaths);
      }

      const validEntries = primaryFiltered.filter((entry) => {
        const fullPath = PathUtils.normalizePath(path.join(normalizedDirPath, entry.name));
        if (this.filters.hideGitIgnored && gitIgnored.has(fullPath)) {
          return false;
        }
        if (WorkspaceScanner.isFilteredByType(entry.name, entry.isDirectory(), this.filters)) {
          return false;
        }

        if (this.searchQuery) {
          if (entry.isDirectory()) {
            return this.matchingFolderPaths.has(fullPath);
          }
          return this.matchingFilePaths.has(fullPath);
        }

        return true;
      });

      const sortedEntries = validEntries.sort((a, b) => {
        if (a.isDirectory() === b.isDirectory()) {
          return a.name.localeCompare(b.name);
        }
        return a.isDirectory() ? -1 : 1;
      });

      const itemPromises = sortedEntries.map(async (entry) => {
        const fullPath = PathUtils.normalizePath(path.join(normalizedDirPath, entry.name));

        if (entry.isDirectory()) {
          const selectedCount = this.getSelectedCountInFolder(fullPath);

          let isChecked: boolean = false;
          let description: string | undefined = undefined;

          if (selectedCount > 0) {
            const totalCount = await this.getFolderTotalCount(fullPath);
            const isAllSelected = totalCount > 0 && selectedCount >= totalCount;
            isChecked = isAllSelected;
            description = totalCount > 0
              ? `${selectedCount}/${totalCount} (${this.formatFilePlural(selectedCount)})`
              : this.formatFilePlural(selectedCount);
          }

          const depth = this.getFolderDepth(fullPath);
          let collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

          if (this.searchQuery && this.matchingFolderPaths.has(fullPath)) {
            collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
          } else if (this.gitExpandedFolderPaths.has(fullPath)) {
            collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
          } else if (depth <= this.expansionLevel) {
            collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
          }

          return new ContextTreeItem(
            vscode.Uri.file(fullPath),
            true,
            isChecked,
            collapsibleState,
            description,
            this.treeVersion
          );
        }

        const isChecked = this.selectedFiles.has(fullPath);
        const fileItem = new ContextTreeItem(
          vscode.Uri.file(fullPath),
          false,
          isChecked,
          vscode.TreeItemCollapsibleState.None
        );

        fileItem.command = {
          command: 'aiContextMerger.toggleFileByClick',
          title: 'Выбрать файл',
          arguments: [fullPath]
        };

        return fileItem;
      });

      return await Promise.all(itemPromises);
    } catch {
      return [];
    }
  }

  /**
   * Toggles selection state for an individual item or entire directory subtree.
   *
   * @param item - Target context tree item.
   * @param newState - New checkbox state.
   * @param refresh - Optional flag indicating whether to immediately trigger view refresh (default true).
   */
  public async toggleItemSelection(
    item: ContextTreeItem,
    newState: vscode.TreeItemCheckboxState,
    refresh: boolean = true
  ): Promise<void> {
    const isChecked = newState === vscode.TreeItemCheckboxState.Checked;
    const targetPath = PathUtils.normalizePath(item.uri.fsPath);

    if (item.isDirectory) {
      if (isChecked) {
        await WorkspaceScanner.selectFolderRecursive(
          targetPath,
          this.filters,
          this.selectedFiles,
          this.folderTotalCountMap
        );
      } else {
        for (const file of Array.from(this.selectedFiles)) {
          if (file === targetPath || PathUtils.isSubpath(file, targetPath)) {
            this.selectedFiles.delete(file);
          }
        }
      }
    } else {
      if (isChecked) {
        this.selectedFiles.add(targetPath);
      } else {
        this.selectedFiles.delete(targetPath);
      }
    }

    if (refresh) {
      this.refresh();
    }
  }

  /**
   * Inverts the file selection when clicking on the row.
   */
  public async toggleFileByPath(filePath: string): Promise<void> {
    const norm = PathUtils.normalizePath(filePath);
    if (this.selectedFiles.has(norm)) {
      this.selectedFiles.delete(norm);
    } else {
      this.selectedFiles.add(norm);
    }
    this.refresh();
  }
}