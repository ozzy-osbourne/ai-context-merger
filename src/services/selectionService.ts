import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FilterSettings, GitFileStatus } from '../types';
import { WorkspaceScanner } from './workspaceScanner';
import { GitService } from './gitService';
import { PathUtils } from '../utils/pathUtils';
import { I18nService } from '../i18n';

/**
 * Interface decoupling tree provider actions from the concrete ContextTreeDataProvider class.
 * Eliminates circular dependency between SelectionService and TreeView.
 */
export interface SelectionChangeHandler {
  /**
   * Triggers visual refresh of the TreeView.
   */
  refresh(): void;

  /**
   * Expands ancestor folder nodes in the TreeView for target file paths.
   *
   * @param filePaths - Target file paths whose parents should expand.
   */
  setExpandedFolders?(filePaths: string[]): void;

  /**
   * Shared cache of total selectable file counts per folder.
   */
  readonly folderTotalCountMap?: Map<string, number>;

  /**
   * Optional provider for active Git file statuses.
   */
  readonly getGitStatuses?: () => Map<string, GitFileStatus>;
}

/**
 * Tree item representation interface expected by SelectionService.
 */
export interface SelectableTreeItem {
  readonly uri: vscode.Uri;
  readonly isDirectory: boolean;
  readonly contextValue?: string;
  readonly checkboxState?: vscode.TreeItem['checkboxState'];
}

/**
 * Service managing file selection state across editor tabs, workspace searches, and Git changes.
 */
export class SelectionService {
  constructor(
    private readonly selectedFiles: Set<string>,
    private readonly handler: SelectionChangeHandler
  ) {}

  public static async selectFolderRecursive(
    dirPath: string,
    filters: FilterSettings,
    selectedFiles: Set<string>,
    countMap?: Map<string, number>,
    visitedDirs: Set<string> = new Set<string>(),
    gitStatuses?: Map<string, GitFileStatus>
  ): Promise<number> {
    const normalizedDirPath = PathUtils.normalizePath(dirPath);
    const realDir = await PathUtils.getCanonicalPath(normalizedDirPath);

    if (visitedDirs.has(realDir)) {
      return 0;
    }
    visitedDirs.add(realDir);

    let affectedCount = 0;
    const validEntries = await WorkspaceScanner.readValidDirectoryEntries(normalizedDirPath, filters);

    for (const { entry, fullPath } of validEntries) {
      if (entry.isDirectory()) {
        const childCount = await this.selectFolderRecursive(
          fullPath,
          filters,
          selectedFiles,
          countMap,
          visitedDirs,
          gitStatuses
        );
        affectedCount += childCount;
      } else {
        affectedCount++;
        selectedFiles.add(fullPath);
      }
    }

    if (gitStatuses) {
      for (const [gitPath, status] of gitStatuses.entries()) {
        if (status === 'deleted' && PathUtils.isSubpath(gitPath, normalizedDirPath)) {
          const fileName = path.basename(gitPath);
          if (!WorkspaceScanner.isFilteredByType(fileName, false, filters)) {
            if (!selectedFiles.has(gitPath)) {
              selectedFiles.add(gitPath);
              affectedCount++;
            }
          }
        }
      }
    }

    if (countMap) {
      countMap.set(normalizedDirPath, affectedCount);
    }

    return affectedCount;
  }

  /**
   * Toggles selection state for an individual tree item or directory subtree.
   *
   * @param item - Target tree item clicked by user.
   * @param newState - New checkbox state (Checked or Unchecked).
   * @param filters - Active exclusion filters.
   */
  public async toggleTreeItemSelection(
    item: SelectableTreeItem,
    newState: vscode.TreeItemCheckboxState,
    filters: FilterSettings
  ): Promise<void> {
    if (item.contextValue === 'emptyState' || item.checkboxState === undefined) {
      return;
    }

    const isChecked = newState === vscode.TreeItemCheckboxState.Checked;
    const targetPath = PathUtils.normalizePath(item.uri.fsPath);

    if (item.isDirectory) {
      if (isChecked) {
        const gitStatuses = this.handler.getGitStatuses ? this.handler.getGitStatuses() : undefined;
        await SelectionService.selectFolderRecursive(
          targetPath,
          filters,
          this.selectedFiles,
          this.handler.folderTotalCountMap,
          new Set<string>(),
          gitStatuses
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
        const fileName = path.basename(targetPath);
        if (!WorkspaceScanner.isFilteredByType(fileName, false, filters)) {
          this.selectedFiles.add(targetPath);
        }
      } else {
        this.selectedFiles.delete(targetPath);
      }
    }
  }

    /**
   * Inverts selection state for a file by path when clicked directly in the tree row.
   * Handles Windows case-insensitivity seamlessly to prevent ghost duplicates in selection.
   *
   * @param filePath - Path of clicked file.
   * @param filters - Active exclusion filters.
   */
  public toggleFileByPath(filePath: string, filters: FilterSettings): void {
    if (!filePath || filePath.startsWith('ai-context-merger:')) {
      return;
    }
    const norm = PathUtils.normalizePath(filePath);

    let existingKey: string | undefined = norm;
    if (!this.selectedFiles.has(norm) && process.platform === 'win32') {
      existingKey = Array.from(this.selectedFiles).find((f) => PathUtils.arePathsEqual(f, norm));
    }

    if (existingKey && this.selectedFiles.has(existingKey)) {
      this.selectedFiles.delete(existingKey);
    } else {
      const fileName = path.basename(norm);
      if (!WorkspaceScanner.isFilteredByType(fileName, false, filters)) {
        this.selectedFiles.add(norm);
      }
    }
  }

  /**
   * Selects all non-filtered files across all workspace folders.
   *
   * @param filters - Active exclusion filters.
   */
  public async selectAllFiles(filters: FilterSettings): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }

    this.selectedFiles.clear();
    const gitStatuses = this.handler.getGitStatuses ? this.handler.getGitStatuses() : undefined;

    for (const folder of workspaceFolders) {
      const rootPath = PathUtils.normalizePath(folder.uri.fsPath);
      await SelectionService.selectFolderRecursive(
        rootPath,
        filters,
        this.selectedFiles,
        this.handler.folderTotalCountMap,
        new Set<string>(),
        gitStatuses
      );
    }
    this.handler.refresh();
  }

  /**
   * Selects all files currently opened in editor tab groups that reside within the active workspace.
   * Automatically expands ancestor directories in the TreeView.
   *
   * @param filters - Active exclusion filters.
   * @returns Array of selected file paths.
   */
  public async selectOpenTabs(filters: FilterSettings): Promise<string[]> {
    const t = I18nService.getTranslations();
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showWarningMessage(t.messages.workspaceNotOpened);
      return [];
    }

    const openUris: vscode.Uri[] = [];

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input && typeof tab.input === 'object') {
          if ('uri' in tab.input && (tab.input as { uri: unknown }).uri instanceof vscode.Uri) {
            const uri = (tab.input as { uri: vscode.Uri }).uri;
            if (uri.scheme === 'file') {
              openUris.push(uri);
            }
          }
          if ('modified' in tab.input && (tab.input as { modified: unknown }).modified instanceof vscode.Uri) {
            const uri = (tab.input as { modified: vscode.Uri }).modified;
            if (uri.scheme === 'file') {
              openUris.push(uri);
            }
          }
        }
      }
    }

    this.selectedFiles.clear();
    const newlyAddedPaths: string[] = [];

    for (const uri of openUris) {
      const fsPath = PathUtils.normalizePath(uri.fsPath);
      const rootPath = PathUtils.getWorkspaceRoot(fsPath, workspaceFolders);

      if (!rootPath) {
        continue;
      }

      try {
        const stat = await fs.promises.stat(fsPath);
        if (!stat.isFile()) {
          continue;
        }
      } catch {
        continue;
      }

      const isFiltered = await WorkspaceScanner.shouldFilterItem(fsPath, false, filters, rootPath);

      if (!isFiltered) {
        if (!this.selectedFiles.has(fsPath)) {
          this.selectedFiles.add(fsPath);
          newlyAddedPaths.push(fsPath);
        }
      }
    }

    if (this.handler.setExpandedFolders) {
      this.handler.setExpandedFolders(newlyAddedPaths);
    } else {
      this.handler.refresh();
    }

    if (newlyAddedPaths.length > 0) {
      vscode.window.showInformationMessage(t.messages.openTabsSelected(newlyAddedPaths.length));
    } else {
      vscode.window.showWarningMessage(t.messages.noAvailableFilesInOpenTabs);
    }

    return newlyAddedPaths;
  }

  /**
   * Selects all modified, untracked, and deleted files identified by Git and expands parent folders.
   * Obtains repository statuses in a single unified Git call to maximize performance.
   *
   * @param filters - Active exclusion filters.
   */
  public async selectModifiedGitFiles(filters: FilterSettings): Promise<void> {
    const t = I18nService.getTranslations();
    const statuses = await GitService.getFileStatuses();
    const modifiedPaths = Array.from(statuses.keys());

    this.selectedFiles.clear();
    const matchedModifiedPaths: string[] = [];

    for (const filePath of modifiedPaths) {
      const isDeleted = statuses.get(filePath) === 'deleted';
      const rootPath = PathUtils.getWorkspaceRoot(filePath);
      const isFiltered = await WorkspaceScanner.shouldFilterItem(filePath, false, filters, rootPath, isDeleted);

      if (!isFiltered) {
        this.selectedFiles.add(filePath);
        matchedModifiedPaths.push(filePath);
      }
    }

    if (this.handler.setExpandedFolders) {
      this.handler.setExpandedFolders(matchedModifiedPaths);
    } else {
      this.handler.refresh();
    }

    if (this.selectedFiles.size === 0) {
      vscode.window.showWarningMessage(t.messages.noModifiedGitFiles);
    } else {
      vscode.window.showInformationMessage(t.messages.modifiedGitFilesSelected(this.selectedFiles.size));
    }
  }

  public async selectFoundFiles(query: string, filters: FilterSettings): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    const lowerQuery = query.trim().toLowerCase();
    if (!lowerQuery) {
      return;
    }

    const gitStatuses = this.handler.getGitStatuses
      ? this.handler.getGitStatuses()
      : await GitService.getFileStatuses();

    for (const folder of workspaceFolders) {
      const root = PathUtils.normalizePath(folder.uri.fsPath);
      const matches = await WorkspaceScanner.findMatchingFiles(root, lowerQuery, filters);
      for (const file of matches) {
        this.selectedFiles.add(PathUtils.normalizePath(file));
      }

      if (gitStatuses) {
        for (const [gitPath, status] of gitStatuses.entries()) {
          if (status === 'deleted' && PathUtils.isSubpath(gitPath, root)) {
            const fileName = path.basename(gitPath);
            if (!WorkspaceScanner.isFilteredByType(fileName, false, filters)) {
              if (fileName.toLowerCase().includes(lowerQuery)) {
                this.selectedFiles.add(PathUtils.normalizePath(gitPath));
              }
            }
          }
        }
      }
    }

    this.handler.refresh();
  }

  /**
   * Clears selection set and refreshes TreeView.
   */
  public clearSelection(): void {
    this.selectedFiles.clear();
    this.handler.refresh();
  }
}