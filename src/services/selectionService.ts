import * as vscode from 'vscode';
import * as fs from 'fs';
import { FilterSettings } from '../types';
import { WorkspaceScanner } from './workspaceScanner';
import { GitService } from './gitService';
import { ContextTreeDataProvider } from './contextTreeDataProvider';
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
      await WorkspaceScanner.selectFolderRecursive(
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
   *
   * @param filters - Active exclusion filters.
   */
  public async selectOpenTabs(filters: FilterSettings): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showWarningMessage('Рабочая область не открыта.');
      return;
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
    let addedCount = 0;

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

      if (!WorkspaceScanner.shouldFilterItem(fsPath, false, filters, rootPath)) {
        if (!this.selectedFiles.has(fsPath)) {
          this.selectedFiles.add(fsPath);
          addedCount++;
        }
      }
    }

    this.treeDataProvider.setGitExpandedFolders(Array.from(this.selectedFiles));

    if (addedCount > 0) {
      vscode.window.showInformationMessage(`Выбрано файлов из открытых вкладок: ${addedCount}`);
    } else {
      vscode.window.showWarningMessage('В открытых вкладках не найдено доступных файлов проекта (или они скрыты фильтрами).');
    }
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
      const isFiltered = WorkspaceScanner.shouldFilterItem(filePath, false, filters, rootPath);

      if (!isFiltered) {
        this.selectedFiles.add(filePath);
        matchedModifiedPaths.push(filePath);
      }
    }

    this.treeDataProvider.setGitExpandedFolders(matchedModifiedPaths);
    vscode.window.showInformationMessage(`Выбрано файлов Git: ${this.selectedFiles.size}`);
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