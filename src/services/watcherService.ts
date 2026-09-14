import * as vscode from 'vscode';
import * as path from 'path';
import { FilterSettings, GitExtensionExports, GitRepository } from '../types';
import { BINARY_EXTENSIONS, LOCK_FILE_NAMES, isSecretFile, isMinifiedOrSourceMap } from '../constants';
import { WorkspaceScanner } from './workspaceScanner';
import { PathUtils } from '../utils/pathUtils';

/**
 * Service managing non-blocking filesystem, Git, and diagnostics watchers with debounce mechanisms.
 */
export class WatcherService implements vscode.Disposable {
  private readonly watcherDisposables: vscode.Disposable[] = [];
  private debounceTimer?: NodeJS.Timeout;
  private diagnosticsDebounceTimer?: NodeJS.Timeout;
  private isDisposed: boolean = false;

  constructor(
    private readonly selectedFiles: Set<string>,
    private readonly getFilters: () => FilterSettings,
    private readonly onFilesystemChanged: () => void,
    private readonly onDiagnosticsChanged: () => void
  ) {
    this.initWatchers();
  }

  /**
   * Reinitializes all watchers.
   */
  public reinitWatchers(): void {
    this.initWatchers();
  }

  /**
   * Initializes non-blocking file system, Git, and compiler diagnostics watchers.
   */
  private initWatchers(): void {
    this.disposeWatchers();

    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.watcherDisposables.push(fileWatcher);

    const onFileEvent = (uri: vscode.Uri, isDelete: boolean = false) => {
      const fsPath = PathUtils.normalizePath(uri.fsPath);
      const workspaceFolders = vscode.workspace.workspaceFolders;
      const matchedFolder = workspaceFolders?.find((f) =>
        PathUtils.isSubpath(fsPath, PathUtils.normalizePath(f.uri.fsPath))
      );
      const rootPath = matchedFolder ? PathUtils.normalizePath(matchedFolder.uri.fsPath) : undefined;

      if (isDelete) {
        for (const file of Array.from(this.selectedFiles)) {
          if (file === fsPath || PathUtils.isSubpath(file, fsPath)) {
            this.selectedFiles.delete(file);
          }
        }
        this.triggerDebouncedRefresh();
        return;
      }

      if (WorkspaceScanner.isIgnoredByPathSegments(fsPath, rootPath)) {
        return;
      }

      const fileName = path.basename(fsPath);
      const ext = path.extname(fileName).toLowerCase();
      const filters = this.getFilters();

      if (filters.hideSecrets && isSecretFile(fileName)) {
        return;
      }
      if (filters.hideMinified && isMinifiedOrSourceMap(fileName)) {
        return;
      }
      if (filters.hideBinaryFiles && BINARY_EXTENSIONS.has(ext)) {
        return;
      }
      if (filters.hideLockFiles && LOCK_FILE_NAMES.has(fileName)) {
        return;
      }

      this.triggerDebouncedRefresh();
    };

    this.watcherDisposables.push(
      fileWatcher.onDidCreate((uri) => onFileEvent(uri, false)),
      fileWatcher.onDidChange((uri) => onFileEvent(uri, false)),
      fileWatcher.onDidDelete((uri) => onFileEvent(uri, true))
    );

    this.initGitWatcher();

    const diagnosticsWatcher = vscode.languages.onDidChangeDiagnostics((e) => {
      if (this.selectedFiles.size === 0) {
        return;
      }

      const hasAffectedFiles = e.uris.some((uri) =>
        this.selectedFiles.has(PathUtils.normalizePath(uri.fsPath))
      );

      if (hasAffectedFiles) {
        if (this.diagnosticsDebounceTimer) {
          clearTimeout(this.diagnosticsDebounceTimer);
        }

        this.diagnosticsDebounceTimer = setTimeout(() => {
          this.onDiagnosticsChanged();
        }, 300);
      }
    });
    this.watcherDisposables.push(diagnosticsWatcher);
  }

  private async initGitWatcher(): Promise<void> {
    try {
      const gitExtension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
      if (!gitExtension) {
        return;
      }

      const gitExports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
      const gitApi = gitExports?.getAPI?.(1);
      if (!gitApi) {
        return;
      }

      const onRepoOpen = gitApi.onDidOpenRepository((repo: GitRepository) => {
        const disp = repo.state.onDidChange(() => this.triggerDebouncedRefresh());
        this.watcherDisposables.push(disp);
      });
      this.watcherDisposables.push(onRepoOpen);

      for (const repo of gitApi.repositories) {
        const disp = repo.state.onDidChange(() => this.triggerDebouncedRefresh());
        this.watcherDisposables.push(disp);
      }
    } catch {
      // Ignore Git extension binding failure
    }
  }

  /**
   * Schedules debounced refresh callback.
   */
  public triggerDebouncedRefresh(): void {
    if (this.isDisposed) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.onFilesystemChanged();
    }, 300);
  }

  private disposeWatchers(): void {
    this.watcherDisposables.forEach((d) => {
      try {
        d.dispose();
      } catch {
        // Ignore disposable failure
      }
    });
    this.watcherDisposables.length = 0;
  }

  public dispose(): void {
    this.isDisposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.diagnosticsDebounceTimer) {
      clearTimeout(this.diagnosticsDebounceTimer);
      this.diagnosticsDebounceTimer = undefined;
    }
    this.disposeWatchers();
  }
}