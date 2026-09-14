import * as vscode from 'vscode';
import * as path from 'path';
import { FilterSettings, GitFileStatus } from '../types';
import { WorkspaceScanner } from './workspaceScanner';
import { SelectionService } from './selectionService';
import { ContextTreeStateResolver } from './contextTreeStateResolver';
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
  private readonly _onDidChangeTreeData: vscode.EventEmitter<ContextTreeItem | undefined | void> =
    new vscode.EventEmitter<ContextTreeItem | undefined | void>();

  public readonly onDidChangeTreeData: vscode.Event<ContextTreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  private searchQuery: string = '';
  private expansionLevel: number = 1;
  private treeVersion: number = 0;
  private showOnlySelected: boolean = false;

  private readonly matchingFilePaths: Set<string> = new Set<string>();
  private readonly matchingFolderPaths: Set<string> = new Set<string>();
  private readonly expandedFolderPaths: Set<string> = new Set<string>();

  public readonly folderTotalCountMap: Map<string, number> = new Map<string, number>();
  private readonly pendingCountPromises: Map<string, Promise<number>> = new Map<string, Promise<number>>();

  private gitStatuses: Map<string, GitFileStatus> = new Map<string, GitFileStatus>();
  private readonly selectionService: SelectionService;

  /**
   * Creates an instance of ContextTreeDataProvider.
   *
   * @param selectedFiles - Shared set containing normalized absolute paths of selected files.
   * @param filters - Active file exclusion filter settings.
   * @param onShowOnlySelectedChanged - Optional persistence callback.
   */
  constructor(
    private readonly selectedFiles: Set<string>,
    private filters: FilterSettings,
    private readonly onShowOnlySelectedChanged?: (value: boolean) => Promise<void>
  ) {
    this.selectionService = new SelectionService(selectedFiles, this);
  }

  /**
   * Sets initial or restored show-only-selected state without re-persisting.
   *
   * @param value - Boolean flag.
   */
  public setShowOnlySelected(value: boolean): void {
    this.showOnlySelected = value;
    vscode.commands.executeCommand('setContext', 'aiContextMerger.showOnlySelected', this.showOnlySelected);
  }

  /**
   * Toggles the filter mode to display exclusively selected files in the TreeView and persists state.
   *
   * @returns Updated state of the selected-only filter.
   */
  public async toggleShowOnlySelected(): Promise<boolean> {
    this.showOnlySelected = !this.showOnlySelected;
    vscode.commands.executeCommand('setContext', 'aiContextMerger.showOnlySelected', this.showOnlySelected);
    if (this.onShowOnlySelectedChanged) {
      await this.onShowOnlySelectedChanged(this.showOnlySelected);
    }
    this.treeVersion++;
    this.refresh();
    return this.showOnlySelected;
  }

  /**
   * Returns whether the TreeView is currently filtering to only show selected files.
   *
   * @returns `true` if only selected files are displayed.
   */
  public isShowOnlySelected(): boolean {
    return this.showOnlySelected;
  }

  /**
   * Assigns updated Git file change statuses and refreshes visual decorations.
   *
   * @param statuses - Map of file paths to Git statuses.
   */
  public setGitStatuses(statuses: Map<string, GitFileStatus>): void {
    this.gitStatuses = statuses;
    this.folderTotalCountMap.clear();
    this.pendingCountPromises.clear();
    this.refresh();
  }

  /**
   * Computes the number of currently selected files located inside target directory in memory.
   *
   * @param folderPath - Absolute directory path.
   * @returns Number of selected files contained within directory subtree.
   */
  public getSelectedCountInFolder(folderPath: string): number {
    return ContextTreeStateResolver.getSelectedCountInFolder(folderPath, this.selectedFiles);
  }

  /**
   * Gets or calculates the total selectable file count in target directory.
   *
   * @param folderPath - Absolute directory path.
   * @returns Total selectable file count.
   */
  public async getFolderTotalCount(folderPath: string): Promise<number> {
    return ContextTreeStateResolver.getFolderTotalCount(
      folderPath,
      this.filters,
      this.folderTotalCountMap,
      this.pendingCountPromises
    );
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
   * Expands all ancestor directory paths containing target files and refreshes the view.
   *
   * @param filePaths - List of target file paths.
   */
  public setExpandedFolders(filePaths: string[]): void {
    this.expandedFolderPaths.clear();
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    for (const filePath of filePaths) {
      for (const folder of workspaceFolders) {
        const root = PathUtils.normalizePath(folder.uri.fsPath);
        const ancestors = PathUtils.getAncestorPaths(filePath, root);
        for (const ancestor of ancestors) {
          this.expandedFolderPaths.add(ancestor);
        }
      }
    }

    this.treeVersion++;
    this.refresh();
  }

  /**
   * Resolves parent item for an element to allow treeView.reveal navigation.
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
          const root = PathUtils.normalizePath(folder.uri.fsPath);
          const matches = await WorkspaceScanner.findMatchingFiles(
            root,
            this.searchQuery,
            this.filters
          );

          for (const match of matches) {
            const normMatch = PathUtils.normalizePath(match);
            this.matchingFilePaths.add(normMatch);

            const ancestors = PathUtils.getAncestorPaths(normMatch, root);
            for (const ancestor of ancestors) {
              this.matchingFolderPaths.add(ancestor);
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
    this.expandedFolderPaths.clear();
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
      if (this.searchQuery && this.matchingFilePaths.size === 0) {
        const emptyItem = new ContextTreeItem(
          vscode.Uri.parse('ai-context-merger:empty-results'),
          false,
          undefined,
          vscode.TreeItemCollapsibleState.None,
          `по запросу "${this.searchQuery}"`
        );
        emptyItem.label = 'Ничего не найдено';
        emptyItem.iconPath = new vscode.ThemeIcon('search-stop');
        emptyItem.contextValue = 'emptyState';
        return [emptyItem];
      }

      if (this.showOnlySelected && this.selectedFiles.size === 0) {
        const emptyItem = new ContextTreeItem(
          vscode.Uri.parse('ai-context-merger:no-selected'),
          false,
          undefined,
          vscode.TreeItemCollapsibleState.None,
          'нет отмеченных файлов'
        );
        emptyItem.label = 'Ничего не выбрано';
        emptyItem.iconPath = new vscode.ThemeIcon('info');
        emptyItem.contextValue = 'emptyState';
        return [emptyItem];
      }

      const activeFolders = this.showOnlySelected
        ? workspaceFolders.filter((folder) => {
            const folderPath = PathUtils.normalizePath(folder.uri.fsPath);
            return this.getSelectedCountInFolder(folderPath) > 0;
          })
        : workspaceFolders;

      const folderPromises = activeFolders.map(async (folder) => {
        const folderPath = PathUtils.normalizePath(folder.uri.fsPath);
        const { isChecked, description, isDisabled } = await ContextTreeStateResolver.resolveFolderState(
          folderPath,
          this.selectedFiles,
          this.filters,
          this.folderTotalCountMap,
          this.pendingCountPromises
        );

        let collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        if (isDisabled) {
          collapsibleState = vscode.TreeItemCollapsibleState.None;
        } else if (this.searchQuery && !this.matchingFolderPaths.has(folderPath)) {
          collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        }

        const rootItem = new ContextTreeItem(
          folder.uri,
          true,
          isChecked,
          collapsibleState,
          description,
          this.treeVersion
        );

        rootItem.contextValue = isChecked ? 'directory-checked' : 'directory-unchecked';

        if (isDisabled) {
          rootItem.iconPath = new vscode.ThemeIcon(
            'folder',
            new vscode.ThemeColor('disabledForeground')
          );
        }

        return rootItem;
      });

      return await Promise.all(folderPromises);
    }

    if (element.isDirectory) {
      return this.readDirectoryItems(element.uri.fsPath);
    }

    return [];
  }

  /**
   * Reads directory entries from filesystem, merging deleted Git changes and appending status badges.
   *
   * @param dirPath - Directory path to read.
   * @returns List of child tree items.
   */
  private async readDirectoryItems(dirPath: string): Promise<ContextTreeItem[]> {
    const normalizedDirPath = PathUtils.normalizePath(dirPath);

    const validEntries = await WorkspaceScanner.readValidDirectoryEntries(
      normalizedDirPath,
      this.filters
    );

    const filteredEntries = validEntries.filter(({ entry, fullPath }) => {
      if (this.showOnlySelected) {
        if (entry.isDirectory()) {
          return this.getSelectedCountInFolder(fullPath) > 0;
        }
        return this.selectedFiles.has(fullPath);
      }

      if (!this.searchQuery) {
        return true;
      }
      if (entry.isDirectory()) {
        return this.matchingFolderPaths.has(fullPath);
      }
      return this.matchingFilePaths.has(fullPath);
    });

    const sortedEntries = filteredEntries.sort((a, b) => {
      const aIsDir = a.entry.isDirectory();
      const bIsDir = b.entry.isDirectory();
      if (aIsDir === bIsDir) {
        return a.entry.name.localeCompare(b.entry.name);
      }
      return aIsDir ? -1 : 1;
    });

    const itemPromises = sortedEntries.map(async ({ entry, fullPath }) => {
      if (entry.isDirectory()) {
        const { isChecked, description, isDisabled } = await ContextTreeStateResolver.resolveFolderState(
          fullPath,
          this.selectedFiles,
          this.filters,
          this.folderTotalCountMap,
          this.pendingCountPromises
        );
        const depth = ContextTreeStateResolver.getFolderDepth(fullPath);
        let collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

        if (isDisabled) {
          collapsibleState = vscode.TreeItemCollapsibleState.None;
        } else if (this.showOnlySelected) {
          collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        } else if (this.searchQuery && this.matchingFolderPaths.has(fullPath)) {
          collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        } else if (this.expandedFolderPaths.has(fullPath)) {
          collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        } else if (depth <= this.expansionLevel) {
          collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        }

        const folderItem = new ContextTreeItem(
          vscode.Uri.file(fullPath),
          true,
          isChecked,
          collapsibleState,
          description,
          this.treeVersion
        );

        folderItem.contextValue = isChecked ? 'directory-checked' : 'directory-unchecked';

        if (isDisabled) {
          folderItem.iconPath = new vscode.ThemeIcon(
            'folder',
            new vscode.ThemeColor('disabledForeground')
          );
        }

        return folderItem;
      }

      const isChecked = this.selectedFiles.has(fullPath);
      const gitStatus = this.gitStatuses.get(fullPath);

      let statusBadge: string | undefined;
      const isModified = gitStatus === 'modified' || gitStatus === 'untracked' || gitStatus === 'renamed';

      if (gitStatus === 'modified') {
        statusBadge = '[M]';
      } else if (gitStatus === 'untracked') {
        statusBadge = '[U]';
      } else if (gitStatus === 'renamed') {
        statusBadge = '[R]';
      }

      const fileItem = new ContextTreeItem(
        vscode.Uri.file(fullPath),
        false,
        isChecked,
        vscode.TreeItemCollapsibleState.None,
        statusBadge
      );

      let contextValue = isChecked ? 'file-checked' : 'file-unchecked';
      if (isModified) {
        contextValue += '-modified';
      }
      fileItem.contextValue = contextValue;

      fileItem.command = {
        command: 'aiContextMerger.toggleFileByClick',
        title: 'Выбрать файл',
        arguments: [fullPath]
      };

      return fileItem;
    });

    const treeItems = await Promise.all(itemPromises);

    // Merge deleted Git items located directly inside this directory
    for (const [gitPath, status] of this.gitStatuses.entries()) {
      const isDirectChild = PathUtils.arePathsEqual(
        path.dirname(gitPath),
        normalizedDirPath
      );

      if (status === 'deleted' && isDirectChild) {
        const isChecked = this.selectedFiles.has(gitPath);

        if (this.showOnlySelected && !isChecked) {
          continue;
        }

        const fileName = path.basename(gitPath);

        if (WorkspaceScanner.isFilteredByType(fileName, false, this.filters)) {
          continue;
        }

        if (this.searchQuery && !fileName.toLowerCase().includes(this.searchQuery)) {
          continue;
        }

        const deletedItem = new ContextTreeItem(
          vscode.Uri.file(gitPath),
          false,
          isChecked,
          vscode.TreeItemCollapsibleState.None,
          '[D]'
        );
        deletedItem.iconPath = new vscode.ThemeIcon('diff-removed');
        deletedItem.contextValue = isChecked ? 'file-checked-modified' : 'file-unchecked-modified';
        deletedItem.command = {
          command: 'aiContextMerger.toggleFileByClick',
          title: 'Выбрать файл',
          arguments: [gitPath]
        };
        treeItems.push(deletedItem);
      }
    }

    return treeItems;
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
    await this.selectionService.toggleTreeItemSelection(item, newState, this.filters);
    if (refresh) {
      this.refresh();
    }
  }

  /**
   * Inverts the selection state of a file when clicking on its tree item row.
   *
   * @param filePath - Normalized path of target file.
   */
  public async toggleFileByPath(filePath: string): Promise<void> {
    this.selectionService.toggleFileByPath(filePath, this.filters);
    this.refresh();
  }
}