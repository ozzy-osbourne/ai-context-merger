import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FilterSettings } from '../types';
import { WorkspaceScanner } from './workspaceScanner';
import { GitService } from './gitService';
import { ContextTreeDataProvider, ContextTreeItem } from './contextTreeDataProvider';
import { PathUtils } from '../utils/pathUtils';

/**
 * Service managing selection operations across workspace, editor tabs, search results, and Git.
 */
export class SelectionService {
  constructor(
    private readonly selectedFiles: Set<string>,
    private readonly treeDataProvider: ContextTreeDataProvider
  ) {}

  /**
   * Resolves canonical real path of a directory safely to prevent recursive symlink loops.
   *
   * @param dirPath - Directory path.
   * @returns Canonical real path.
   */
  private static async getCanonicalPath(dirPath: string): Promise<string> {
    try {
      return await fs.promises.realpath(dirPath);
    } catch {
      return dirPath;
    }
  }

  /**
   * Recursively traverses a folder, adding non-filtered files to the selection set and caching counts.
   *
   * @param dirPath - Root directory path.
   * @param filters - Active exclusion filters.
   * @param selectedFiles - Selection set to mutate.
   * @param countMap - Optional map to store total file counts per folder.
   * @param visitedDirs - Set of visited directory real paths to prevent symlink loops.
   * @returns Total count of selectable files processed within directory.
   */
  public static async selectFolderRecursive(
    dirPath: string,
    filters: FilterSettings,
    selectedFiles: Set<string>,
    countMap?: Map<string, number>,
    visitedDirs: Set<string> = new Set<string>()
  ): Promise<number> {
    const normalizedDirPath = PathUtils.normalizePath(dirPath);
    const realDir = await this.getCanonicalPath(normalizedDirPath);

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
   * Toggles selection state for an individual tree item or entire directory subtree.
   *
   * @param item - Target context tree item.
   * @param newState - New checkbox state.
   * @param filters - Active filter settings.
   */
  public async toggleTreeItemSelection(
    item: ContextTreeItem,
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
          this.treeDataProvider.folderTotalCountMap
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
   * Inverts the selection state of a file when clicking on its tree item row.
   *
   * @param filePath - Normalized path of target file.
   * @param filters - Active filter settings.
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
   * Selects all non-filtered files across all workspace folders and updates folder count caches.
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
        this.treeDataProvider.folderTotalCountMap
      );
    }
    this.treeDataProvider.refresh();
  }

  /**
   * Selects all active file URIs currently opened across editor tab groups that reside within the active workspace.
   * Automatically expands ancestor directories and returns resolved file paths.
   *
   * @param filters - Active exclusion filters.
   * @returns Array of normalized absolute paths of selected files.
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
      const matchedFolder = workspaceFolders.find((f) =>
        PathUtils.isSubpath(fsPath, PathUtils.normalizePath(f.uri.fsPath))
      );

      if (!matchedFolder) {
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

      const rootPath = PathUtils.normalizePath(matchedFolder.uri.fsPath);
      const isFiltered = await WorkspaceScanner.shouldFilterItem(fsPath, false, filters, rootPath);

      if (!isFiltered) {
        if (!this.selectedFiles.has(fsPath)) {
          this.selectedFiles.add(fsPath);
          newlyAddedPaths.push(fsPath);
        }
      }
    }

    // Expand ancestor directories in TreeView
    this.treeDataProvider.setExpandedFolders(newlyAddedPaths);

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
    const workspaceFolders = vscode.workspace.workspaceFolders;

    this.selectedFiles.clear();
    const matchedModifiedPaths: string[] = [];

    for (const filePath of modifiedPaths) {
      const matchedFolder = workspaceFolders?.find((f) =>
        PathUtils.isSubpath(filePath, PathUtils.normalizePath(f.uri.fsPath))
      );
      const rootPath = matchedFolder ? PathUtils.normalizePath(matchedFolder.uri.fsPath) : undefined;
      const isFiltered = await WorkspaceScanner.shouldFilterItem(filePath, false, filters, rootPath);

      if (!isFiltered) {
        this.selectedFiles.add(filePath);
        matchedModifiedPaths.push(filePath);
      }
    }

    this.treeDataProvider.setExpandedFolders(matchedModifiedPaths);

    if (this.selectedFiles.size === 0) {
      vscode.window.showWarningMessage('В Git нет измененных файлов (или они скрыты активными фильтрами).');
    } else {
      vscode.window.showInformationMessage(`Выбрано файлов Git: ${this.selectedFiles.size}`);
    }
  }

  /**
   * Selects all files matching current search query across workspace.
   *
   * @param query - Active search query.
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

    this.treeDataProvider.refresh();
  }

  /**
   * Clears active selection set and refreshes tree.
   */
  public clearSelection(): void {
    this.selectedFiles.clear();
    this.treeDataProvider.refresh();
  }
}