import * as vscode from 'vscode';
import * as path from 'path';
import { FilterSettings, GitExtensionExports, GitRepository } from '../types';
import { BINARY_EXTENSIONS, LOCK_FILE_NAMES, isSecretFile, isMinifiedOrSourceMap } from '../constants';
import { WorkspaceScanner } from './workspaceScanner';
import { PathUtils } from '../utils/pathUtils';

/**
 * Service managing non-blocking filesystem, Git, and diagnostics watchers with debounce mechanisms.
 * Guarantees race-condition-free event subscription lifecycle.
 */
export class WatcherService implements vscode.Disposable {
  private readonly watcherDisposables: vscode.Disposable[] = [];
  private debounceTimer?: NodeJS.Timeout;
  private diagnosticsDebounceTimer?: NodeJS.Timeout;
  private isDisposed: boolean = false;

  /**
   * Monotonic counter tracking watcher initialization cycles.
   * Prevents pending asynchronous Git extension promises from attaching orphaned listeners after re-init.
   */
  private watcherGeneration: number = 0;

  constructor(
    private readonly selectedFiles: Set<string>,
    private readonly getFilters: () => FilterSettings,
    private readonly onFilesystemChanged: () => void,
    private readonly onDiagnosticsChanged: () => void
  ) {
    this.initWatchers();
  }

  /**
   * Reinitializes all filesystem and Git watchers.
   */
  public reinitWatchers(): void {
    this.initWatchers();
  }

  /**
   * Sets up watchers for workspace files, git repositories, and diagnostic changes.
   */
  private initWatchers(): void {
    this.disposeWatchers();
    const generation = ++this.watcherGeneration;

    // 1. File system watcher
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.watcherDisposables.push(fileWatcher);

    const onFileEvent = (uri: vscode.Uri, isDelete: boolean = false) => {
      const fsPath = PathUtils.normalizePath(uri.fsPath);
      const rootPath = PathUtils.getWorkspaceRoot(fsPath);

      // Handle deleted file: remove immediately from active selection
      if (isDelete) {
        for (const file of Array.from(this.selectedFiles)) {
          if (file === fsPath || PathUtils.isSubpath(file, fsPath)) {
            this.selectedFiles.delete(file);
          }
        }
        this.triggerDebouncedRefresh();
        return;
      }

      // Ignore changes in unconditionally excluded folders (.git, node_modules, etc.)
      if (WorkspaceScanner.isIgnoredByPathSegments(fsPath, rootPath)) {
        return;
      }

      const fileName = path.basename(fsPath);
      const ext = path.extname(fileName).toLowerCase();
      const filters = this.getFilters();

      // Check if file event matches active exclusion filters
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

    // 2. Git extension watcher with generation check
    this.initGitWatcher(generation);

    // 3. Diagnostics watcher (debounced to 300ms)
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

  /**
   * Initializes built-in Git extension listeners with race-condition guards.
   *
   * @param generation - The generation token of the invoking initWatchers cycle.
   */
  private async initGitWatcher(generation: number): Promise<void> {
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

      if (this.isDisposed || generation !== this.watcherGeneration) {
        return;
      }

      const onRepoOpen = gitApi.onDidOpenRepository((repo: GitRepository) => {
        if (this.isDisposed || generation !== this.watcherGeneration) {
          return;
        }
        const disp = repo.state.onDidChange(() => this.triggerDebouncedRefresh());
        this.watcherDisposables.push(disp);
      });
      this.watcherDisposables.push(onRepoOpen);

      for (const repo of gitApi.repositories) {
        const disp = repo.state.onDidChange(() => this.triggerDebouncedRefresh());
        this.watcherDisposables.push(disp);
      }
    } catch {
      // Gracefully ignore git watcher failure if git extension is disabled
    }
  }

  /**
   * Schedules debounced refresh callback (300ms) to coalesce rapid file system events.
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

  /**
   * Disposes active watcher instances.
   */
  private disposeWatchers(): void {
    this.watcherDisposables.forEach((d) => {
      try {
        d.dispose();
      } catch {
        // Ignore individual disposal failure
      }
    });
    this.watcherDisposables.length = 0;
  }

  /**
   * Cleans up all timers and watcher disposables.
   */
  public dispose(): void {
    this.isDisposed = true;
    this.watcherGeneration++;
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