import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FilterSettings } from '../types';
import { WorkspaceScanner } from './workspaceScanner';
import { GitService } from './gitService';
import { PathUtils } from '../utils/pathUtils';

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
}

/**
 * Tree item representation interface expected by SelectionService.
 * Uses index access on vscode.TreeItem['checkboxState'] to maintain 100% type compatibility
 * with all recent versions of @types/vscode without build errors.
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
  /**
   * Creates an instance of SelectionService.
   *
   * @param selectedFiles - Shared mutable Set storing normalized paths of selected files.
   * @param handler - Decoupled callback interface for TreeView refreshes and expansions.
   */
  constructor(
    private readonly selectedFiles: Set<string>,
    private readonly handler: SelectionChangeHandler
  ) {}

  /**
   * Recursively traverses a directory, adding non-filtered files to the selection set.
   * Uses realpath checking to strictly prevent symlink recursion loops.
   *
   * @param dirPath - Root directory path to traverse.
   * @param filters - Active file exclusion filters.
   * @param selectedFiles - Target set of selected files to mutate.
   * @param countMap - Optional map caching total file counts per folder.
   * @param visitedDirs - Set of canonical paths visited during current recursion to guard loops.
   * @returns Total count of selectable files found in the directory subtree.
   */
  public static async selectFolderRecursive(
    dirPath: string,
    filters: FilterSettings,
    selectedFiles: Set<string>,
    countMap?: Map<string, number>,
    visitedDirs: Set<string> = new Set<string>()
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
          visitedDirs
        );
        affectedCount += childCount;
      } else {
        affectedCount++;
        selectedFiles.add(fullPath);
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
        await SelectionService.selectFolderRecursive(
          targetPath,
          filters,
          this.selectedFiles,
          this.handler.folderTotalCountMap
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
   *
   * @param filePath - Path of clicked file.
   * @param filters - Active exclusion filters.
   */
  public toggleFileByPath(filePath: string, filters: FilterSettings): void {
    if (!filePath || filePath.startsWith('ai-context-merger:')) {
      return;
    }
    const norm = PathUtils.normalizePath(filePath);

    if (this.selectedFiles.has(norm)) {
      this.selectedFiles.delete(norm);
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
    for (const folder of workspaceFolders) {
      const rootPath = PathUtils.normalizePath(folder.uri.fsPath);
      await SelectionService.selectFolderRecursive(
        rootPath,
        filters,
        this.selectedFiles,
        this.handler.folderTotalCountMap
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
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showWarningMessage('Рабочая область не открыта.');
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
    }

    if (newlyAddedPaths.length > 0) {
      vscode.window.showInformationMessage(`Выбрано файлов из открытых вкладок: ${newlyAddedPaths.length}`);
    } else {
      vscode.window.showWarningMessage('В открытых вкладках не найдено доступных файлов проекта (или они скрыты фильтрами).');
    }

    return newlyAddedPaths;
  }

  /**
   * Selects all modified, untracked, and deleted files identified by Git and expands parent folders.
   *
   * @param filters - Active exclusion filters.
   */
  public async selectModifiedGitFiles(filters: FilterSettings): Promise<void> {
    const modifiedPaths = await GitService.getModifiedFilePaths();

    this.selectedFiles.clear();
    const matchedModifiedPaths: string[] = [];

    for (const filePath of modifiedPaths) {
      const rootPath = PathUtils.getWorkspaceRoot(filePath);
      const isFiltered = await WorkspaceScanner.shouldFilterItem(filePath, false, filters, rootPath);

      if (!isFiltered) {
        this.selectedFiles.add(filePath);
        matchedModifiedPaths.push(filePath);
      }
    }

    if (this.handler.setExpandedFolders) {
      this.handler.setExpandedFolders(matchedModifiedPaths);
    }

    if (this.selectedFiles.size === 0) {
      vscode.window.showWarningMessage('В Git нет измененных файлов (или они скрыты активными фильтрами).');
    } else {
      vscode.window.showInformationMessage(`Выбрано файлов Git: ${this.selectedFiles.size}`);
    }
  }

  /**
   * Selects all files matching current search query across workspace.
   *
   * @param query - Search term.
   * @param filters - Active exclusion filters.
   */
  public async selectFoundFiles(query: string, filters: FilterSettings): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    for (const folder of workspaceFolders) {
      const matches = await WorkspaceScanner.findMatchingFiles(folder.uri.fsPath, query, filters);
      for (const file of matches) {
        this.selectedFiles.add(file);
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