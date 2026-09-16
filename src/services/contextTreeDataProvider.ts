import * as vscode from 'vscode';
import * as path from 'path';
import { FilterSettings, GitFileStatus } from '../types';
import { WorkspaceScanner } from './workspaceScanner';
import { SelectionService } from './selectionService';
import { ContextTreeStateResolver } from './contextTreeStateResolver';
import { PathUtils } from '../utils/pathUtils';
import { I18nService } from '../i18n';

/**
 * Representation of an individual item within the project Context TreeView.
 */
export class ContextTreeItem extends vscode.TreeItem {
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
export class ContextTreeDataProvider implements vscode.TreeDataProvider<ContextTreeItem>, vscode.Disposable {
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

  constructor(
    private readonly selectedFiles: Set<string>,
    private filters: FilterSettings,
    private readonly onShowOnlySelectedChanged?: (value: boolean) => Promise<void>
  ) {
    this.selectionService = new SelectionService(selectedFiles, {
      refresh: () => this.refresh(),
      setExpandedFolders: (paths) => this.setExpandedFolders(paths),
      folderTotalCountMap: this.folderTotalCountMap,
      getGitStatuses: () => this.gitStatuses
    });
  }

  public setShowOnlySelected(value: boolean): void {
    this.showOnlySelected = value;
    vscode.commands.executeCommand('setContext', 'aiContextMerger.showOnlySelected', this.showOnlySelected);
  }

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

  public setGitStatuses(statuses: Map<string, GitFileStatus>): void {
    this.gitStatuses = statuses;
    this.folderTotalCountMap.clear();
    this.pendingCountPromises.clear();
    this.refresh();
  }

  public getSelectedCountInFolder(folderPath: string): number {
    return ContextTreeStateResolver.getSelectedCountInFolder(folderPath, this.selectedFiles);
  }

  public async getFolderTotalCount(folderPath: string): Promise<number> {
    return ContextTreeStateResolver.getFolderTotalCount(
      folderPath,
      this.filters,
      this.folderTotalCountMap,
      this.pendingCountPromises,
      this.gitStatuses
    );
  }

  public getMatchingFilesCount(): number {
    return this.matchingFilePaths.size;
  }

  public setFilters(filters: FilterSettings): void {
    this.filters = filters;
    this.folderTotalCountMap.clear();
    this.pendingCountPromises.clear();
    this.refresh();
  }

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

  public async reapplySearch(): Promise<void> {
    if (this.searchQuery) {
      await this.setSearchQuery(this.searchQuery);
    }
  }

  public async setSearchQuery(query: string, searchRoots?: string[]): Promise<void> {
    this.searchQuery = query.trim().toLowerCase();
    this.matchingFilePaths.clear();
    this.matchingFolderPaths.clear();

    if (this.searchQuery) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      let roots: string[] = [];

      if (searchRoots && searchRoots.length > 0) {
        roots = searchRoots;
      } else if (workspaceFolders && workspaceFolders.length > 0) {
        roots = workspaceFolders.map((f) => f.uri.fsPath);
      } else if (this.selectedFiles.size > 0) {
        const parentDirs = new Set<string>();
        for (const file of this.selectedFiles) {
          parentDirs.add(path.dirname(file));
        }
        roots = Array.from(parentDirs);
      }

      for (const rootPath of roots) {
        const root = PathUtils.normalizePath(rootPath);
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

        for (const [gitPath, status] of this.gitStatuses.entries()) {
          if (status === 'deleted' && PathUtils.isSubpath(gitPath, root)) {
            const fileName = path.basename(gitPath);
            if (!WorkspaceScanner.isFilteredByType(fileName, false, this.filters)) {
              if (fileName.toLowerCase().includes(this.searchQuery)) {
                const normGitPath = PathUtils.normalizePath(gitPath);
                this.matchingFilePaths.add(normGitPath);

                const ancestors = PathUtils.getAncestorPaths(normGitPath, root);
                for (const ancestor of ancestors) {
                  this.matchingFolderPaths.add(ancestor);
                }
              }
            }
          }
        }
      }
    }

    this.treeVersion++;
    this.refresh();
  }

  public expandLevel(): void {
    this.expansionLevel++;
    this.treeVersion++;
    this.refresh();
  }

  public collapseAll(): void {
    this.expansionLevel = 0;
    this.expandedFolderPaths.clear();
    this.treeVersion++;
    vscode.commands.executeCommand('workbench.actions.treeView.aiContextMergerTreeView.collapseAll');
    this.refresh();
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: ContextTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: ContextTreeItem): Promise<ContextTreeItem[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const t = I18nService.getTranslations();

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
          t.tree.emptySearchDescription(this.searchQuery)
        );
        emptyItem.label = t.tree.emptySearch;
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
          t.tree.nothingSelectedDescription
        );
        emptyItem.label = t.tree.nothingSelected;
        emptyItem.iconPath = new vscode.ThemeIcon('info');
        emptyItem.contextValue = 'emptyState';
        return [emptyItem];
      }

      const activeFolders = workspaceFolders.filter((folder) => {
        const folderPath = PathUtils.normalizePath(folder.uri.fsPath);
        if (this.showOnlySelected && this.getSelectedCountInFolder(folderPath) === 0) {
          return false;
        }
        if (this.searchQuery && !this.matchingFolderPaths.has(folderPath)) {
          return false;
        }
        return true;
      });

      if (activeFolders.length === 0 && (this.showOnlySelected || this.searchQuery)) {
        const emptyItem = new ContextTreeItem(
          vscode.Uri.parse('ai-context-merger:empty-combined'),
          false,
          undefined,
          vscode.TreeItemCollapsibleState.None,
          this.showOnlySelected && this.searchQuery
            ? t.tree.emptyCombinedDescription(this.searchQuery)
            : (this.searchQuery ? t.tree.emptySearchDescription(this.searchQuery) : t.tree.nothingSelectedDescription)
        );
        emptyItem.label = t.tree.emptySearch;
        emptyItem.iconPath = new vscode.ThemeIcon('search-stop');
        emptyItem.contextValue = 'emptyState';
        return [emptyItem];
      }

      const folderPromises = activeFolders.map(async (folder) => {
        const folderPath = PathUtils.normalizePath(folder.uri.fsPath);
        const { isChecked, description, isDisabled } = await ContextTreeStateResolver.resolveFolderState(
          folderPath,
          this.selectedFiles,
          this.filters,
          this.folderTotalCountMap,
          this.pendingCountPromises,
          this.gitStatuses
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

        if (isDisabled) {
          rootItem.contextValue = 'directory-disabled';
          rootItem.iconPath = new vscode.ThemeIcon(
            'folder',
            new vscode.ThemeColor('disabledForeground')
          );
        } else {
          rootItem.contextValue = isChecked ? 'directory-checked' : 'directory-unchecked';
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

  private async readDirectoryItems(dirPath: string): Promise<ContextTreeItem[]> {
    const normalizedDirPath = PathUtils.normalizePath(dirPath);

    const validEntries = await WorkspaceScanner.readValidDirectoryEntries(
      normalizedDirPath,
      this.filters
    );

    const filteredEntries = validEntries.filter(({ entry, fullPath }) => {
      const isDir = entry.isDirectory();

      if (this.showOnlySelected) {
        const isFileSelected = this.selectedFiles.has(fullPath) ||
          (process.platform === 'win32' && Array.from(this.selectedFiles).some((f) => PathUtils.arePathsEqual(f, fullPath)));

        const matchesSelected = isDir
          ? this.getSelectedCountInFolder(fullPath) > 0
          : isFileSelected;

        if (!matchesSelected) {
          return false;
        }
      }

      if (this.searchQuery) {
        const matchesSearch = isDir
          ? this.matchingFolderPaths.has(fullPath)
          : this.matchingFilePaths.has(fullPath);

        if (!matchesSearch) {
          return false;
        }
      }

      return true;
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
          this.pendingCountPromises,
          this.gitStatuses
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

        if (isDisabled) {
          folderItem.contextValue = 'directory-disabled';
          folderItem.iconPath = new vscode.ThemeIcon(
            'folder',
            new vscode.ThemeColor('disabledForeground')
          );
        } else {
          folderItem.contextValue = isChecked ? 'directory-checked' : 'directory-unchecked';
        }

        return folderItem;
      }

      const isChecked = this.selectedFiles.has(fullPath) ||
        (process.platform === 'win32' && Array.from(this.selectedFiles).some((f) => PathUtils.arePathsEqual(f, fullPath)));
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
        title: 'Toggle File',
        arguments: [fullPath]
      };

      return fileItem;
    });

    const treeItems = await Promise.all(itemPromises);

    for (const [gitPath, status] of this.gitStatuses.entries()) {
      const isDirectChild = PathUtils.arePathsEqual(
        path.dirname(gitPath),
        normalizedDirPath
      );

      if (status === 'deleted' && isDirectChild) {
        const isChecked = this.selectedFiles.has(gitPath) ||
          (process.platform === 'win32' && Array.from(this.selectedFiles).some((f) => PathUtils.arePathsEqual(f, gitPath)));

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
          title: 'Toggle File',
          arguments: [gitPath]
        };
        treeItems.push(deletedItem);
      }
    }

    return treeItems;
  }

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

  public async toggleFileByPath(filePath: string): Promise<void> {
    this.selectionService.toggleFileByPath(filePath, this.filters);
    this.refresh();
  }

  public dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}