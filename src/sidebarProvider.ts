import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  FilterSettings,
  PromptSettings,
  FileNode,
  WebviewToExtensionMessage,
  GitExtensionExports
} from './types';
import { GitService } from './services/gitService';
import { WorkspaceScanner } from './services/workspaceScanner';
import { StatsCalculator } from './services/statsCalculator';
import { MarkdownBuilder } from './services/markdownBuilder';
import { getHtmlTemplate } from './ui/htmlTemplate';
import { PathUtils } from './utils/pathUtils';

/**
 * Webview View Provider for AI Context Merger sidebar panel.
 * Handles state synchronization, file system watchers, and user commands.
 */
export class ContextMergerSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aiContextMergerView';
  private _view?: vscode.WebviewView;
  private _isDisposed: boolean = false;

  public selectedFiles: Set<string> = new Set<string>();

  private filters: FilterSettings = {
    hideGitIgnored: true,
    hideLockFiles: true,
    hideBinaryFiles: true
  };

  private promptSettings: PromptSettings = {
    enabled: false,
    text: ''
  };

  private debounceTimer?: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];
  private watcherDisposables: vscode.Disposable[] = [];

  private refreshGeneration: number = 0;
  private gitWatcherGeneration: number = 0;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this.initAutoWatchers();

    vscode.workspace.onDidChangeWorkspaceFolders(
      () => {
        this.initAutoWatchers();
        this.triggerDebouncedRefresh();
      },
      this,
      this.disposables
    );
  }

  private disposeWatchers(): void {
    this.watcherDisposables.forEach((d) => {
      try {
        d.dispose();
      } catch {
        // Ignore disposable failure
      }
    });
    this.watcherDisposables = [];
  }

  /**
   * Determines whether a file system watcher event should be ignored.
   */
  private async shouldIgnoreWatcherUri(uri: vscode.Uri): Promise<boolean> {
    const fsPath = PathUtils.normalizePath(uri.fsPath);
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const matchedFolder = workspaceFolders?.find((f) =>
      PathUtils.isSubpath(fsPath, PathUtils.normalizePath(f.uri.fsPath))
    );
    const rootPath = matchedFolder ? PathUtils.normalizePath(matchedFolder.uri.fsPath) : undefined;

    if (WorkspaceScanner.isIgnoredByPathSegments(fsPath, rootPath)) {
      return true;
    }

    const fileName = path.basename(fsPath);
    const isDir = fs.existsSync(fsPath) ? fs.statSync(fsPath).isDirectory() : false;

    if (WorkspaceScanner.isFilteredByType(fileName, isDir, this.filters)) {
      return true;
    }

    if (this.filters.hideGitIgnored) {
      const ignored = await GitService.checkIgnoredPaths([fsPath]);
      if (ignored.has(fsPath)) {
        return true;
      }
    }

    return false;
  }

  private initAutoWatchers(): void {
    this.disposeWatchers();

    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.watcherDisposables.push(fileWatcher);

    this.watcherDisposables.push(
      fileWatcher.onDidCreate(async (uri) => {
        if (!(await this.shouldIgnoreWatcherUri(uri))) {
          this.triggerDebouncedRefresh();
        }
      }),
      fileWatcher.onDidChange(async (uri) => {
        if (!(await this.shouldIgnoreWatcherUri(uri))) {
          this.triggerDebouncedRefresh();
        }
      }),
      fileWatcher.onDidDelete(async (uri) => {
        const deletedPath = PathUtils.normalizePath(uri.fsPath);

        for (const file of Array.from(this.selectedFiles)) {
          if (PathUtils.isSubpath(file, deletedPath)) {
            this.selectedFiles.delete(file);
          }
        }

        if (!(await this.shouldIgnoreWatcherUri(uri))) {
          this.triggerDebouncedRefresh();
        }
      })
    );

    this.initGitWatcher();
  }

  private async initGitWatcher(): Promise<void> {
    const currentGeneration = ++this.gitWatcherGeneration;

    try {
      const gitExtension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
      if (!gitExtension) {
        return;
      }

      const gitExports = gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate();

      if (this._isDisposed || this.gitWatcherGeneration !== currentGeneration) {
        return;
      }

      const gitApi = gitExports?.getAPI(1);
      if (!gitApi || this._isDisposed || this.gitWatcherGeneration !== currentGeneration) {
        return;
      }

      const onDidOpenRepoDisposable = gitApi.onDidOpenRepository((repo) => {
        const repoChangeDisposable = repo.state.onDidChange(() => this.triggerDebouncedRefresh());
        this.watcherDisposables.push(repoChangeDisposable);
      });
      this.watcherDisposables.push(onDidOpenRepoDisposable);

      gitApi.repositories.forEach((repo) => {
        const repoChangeDisposable = repo.state.onDidChange(() => this.triggerDebouncedRefresh());
        this.watcherDisposables.push(repoChangeDisposable);
      });
    } catch {
      // Fail silently if Git extension API is inaccessible
    }
  }

  public triggerDebouncedRefresh(): void {
    if (this._isDisposed) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.refresh();
    }, 300);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = getHtmlTemplate(webviewView.webview);

    webviewView.onDidDispose(
      () => {
        this._view = undefined;
      },
      null,
      this.disposables
    );

    webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      if (!message || typeof message.type !== 'string') {
        return;
      }

      switch (message.type) {
        case 'toggleFile':
          this.handleFileToggle(message.filePath, message.checked);
          break;
        case 'toggleFolder':
          await this.handleFolderToggle(message.folderPath, message.checked);
          break;
        case 'toggleFilesBatch':
          if (Array.isArray(message.filePaths)) {
            for (const filePath of message.filePaths) {
              const norm = PathUtils.normalizePath(filePath);
              if (message.checked) {
                this.selectedFiles.add(norm);
              } else {
                this.selectedFiles.delete(norm);
              }
            }
            await this.updateStatsOnly();
          }
          break;
        case 'selectAll':
          await this.selectAllFiles();
          break;
        case 'selectMultipleFiles':
          if (Array.isArray(message.filePaths)) {
            this.selectedFiles.clear();
            for (const filePath of message.filePaths) {
              this.selectedFiles.add(PathUtils.normalizePath(filePath));
            }
            await this.updateStatsOnly();
          }
          break;
        case 'clearSelection':
          this.clearSelection();
          break;
        case 'copyContext':
          await this.copyContextToClipboard();
          break;
        case 'exportFile':
          await this.exportContextToFile();
          break;
        case 'previewContext':
          await this.previewContext();
          break;
        case 'selectModified':
          await this.selectModifiedGitFiles();
          break;
        case 'updateFilters':
          if (message.filters && typeof message.filters === 'object') {
            this.filters = {
              hideGitIgnored: Boolean(message.filters.hideGitIgnored),
              hideLockFiles: Boolean(message.filters.hideLockFiles),
              hideBinaryFiles: Boolean(message.filters.hideBinaryFiles)
            };
            await this.refresh();
          }
          break;
        case 'updatePrompt':
          this.promptSettings = {
            enabled: Boolean(message.enabled),
            text: typeof message.text === 'string' ? message.text : ''
          };
          await this.updateStatsOnly();
          break;
        case 'refresh':
          await this.refresh();
          break;
        case 'requestInitialData':
          await this.refresh(false, true);
          break;
      }
    });
  }

  public async selectAllFiles(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }

    this.selectedFiles.clear();
    for (const folder of workspaceFolders) {
      const rootPath = PathUtils.normalizePath(folder.uri.fsPath);
      await WorkspaceScanner.toggleFolderRecursive(rootPath, true, this.filters, this.selectedFiles);
    }
    await this.updateStatsOnly();
  }

  public async selectModifiedGitFiles(): Promise<void> {
    const gitStatuses = await GitService.getGitStatusMap();
    const workspaceFolders = vscode.workspace.workspaceFolders;

    this.selectedFiles.clear();

    for (const [filePath, status] of gitStatuses.entries()) {
      if (status === 'modified' || status === 'untracked') {
        const matchedFolder = workspaceFolders?.find((f) =>
          PathUtils.isSubpath(filePath, PathUtils.normalizePath(f.uri.fsPath))
        );

        const rootPath = matchedFolder ? PathUtils.normalizePath(matchedFolder.uri.fsPath) : undefined;
        const isFiltered = WorkspaceScanner.shouldFilterItem(filePath, false, this.filters, rootPath);

        if (!isFiltered) {
          this.selectedFiles.add(filePath);
        }
      }
    }

    vscode.window.showInformationMessage(`Выбрано файлов Git Diff: ${this.selectedFiles.size}`);
    await this.refresh(true, false);
  }

  /**
   * Refreshes workspace tree hierarchy and posts updated payload to Webview.
   *
   * @param smartGitExpand - Automatically expand folders with modified Git files.
   * @param isInitialLoad - Indicates initial sidebar load.
   */
  public async refresh(smartGitExpand: boolean = false, isInitialLoad: boolean = false): Promise<void> {
    if (!this._view || this._isDisposed) {
      return;
    }

    const currentGeneration = ++this.refreshGeneration;
    const isCanceled = () => this._isDisposed || this.refreshGeneration !== currentGeneration;

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.selectedFiles.clear();
      this._view.webview.postMessage({
        type: 'setData',
        tree: [],
        stats: { count: 0, tokens: 0, percentage: 0 },
        selectedFiles: [],
        filters: this.filters,
        smartGitExpand,
        isInitialLoad
      });
      return;
    }

    const gitStatusMap = await GitService.getGitStatusMap();
    if (isCanceled()) {
      return;
    }

    const treeNodes: FileNode[] = [];

    for (const folder of workspaceFolders) {
      if (isCanceled()) {
        return;
      }

      const rootPath = PathUtils.normalizePath(folder.uri.fsPath);
      if (fs.existsSync(rootPath)) {
        const folderTree = await WorkspaceScanner.scanDirectory(
          rootPath,
          gitStatusMap,
          this.filters,
          20,
          0,
          isCanceled
        );
        treeNodes.push(folderTree);
      }
    }

    if (isCanceled()) {
      return;
    }

    for (const file of Array.from(this.selectedFiles)) {
      if (!fs.existsSync(file)) {
        this.selectedFiles.delete(file);
      }
    }

    const stats = await StatsCalculator.calculateStats(this.selectedFiles, this.promptSettings);
    if (isCanceled()) {
      return;
    }

    this._view.webview.postMessage({
      type: 'setData',
      tree: treeNodes,
      stats,
      selectedFiles: Array.from(this.selectedFiles),
      filters: this.filters,
      smartGitExpand,
      isInitialLoad
    });
  }

  public clearSelection(): void {
    this.selectedFiles.clear();
    this.updateStatsOnly();
  }

  private handleFileToggle(filePath: string, checked: boolean): void {
    const normalized = PathUtils.normalizePath(filePath);
    if (checked) {
      this.selectedFiles.add(normalized);
    } else {
      this.selectedFiles.delete(normalized);
    }
    this.updateStatsOnly();
  }

  private async handleFolderToggle(folderPath: string, checked: boolean): Promise<void> {
    const normalized = PathUtils.normalizePath(folderPath);
    await WorkspaceScanner.toggleFolderRecursive(normalized, checked, this.filters, this.selectedFiles);
    await this.updateStatsOnly();
  }

  private async updateStatsOnly(): Promise<void> {
    if (!this._view || this._isDisposed) {
      return;
    }
    const stats = await StatsCalculator.calculateStats(this.selectedFiles, this.promptSettings);
    this._view.webview.postMessage({
      type: 'updateStats',
      stats,
      selectedFiles: Array.from(this.selectedFiles)
    });
  }

  public async copyContextToClipboard(): Promise<void> {
    if (this.selectedFiles.size === 0) {
      vscode.window.showWarningMessage('Не выбрано ни одного файла для копирования.');
      return;
    }
    const markdown = await MarkdownBuilder.buildBundleMarkdown(this.selectedFiles, this.promptSettings);
    await vscode.env.clipboard.writeText(markdown);
    vscode.window.showInformationMessage(`Скопирован контекст: ${this.selectedFiles.size} файлов!`);
  }

  public async exportContextToFile(): Promise<void> {
    if (this.selectedFiles.size === 0) {
      vscode.window.showWarningMessage('Не выбрано ни одного файла для экспорта.');
      return;
    }

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('project-context.md'),
      filters: { Markdown: ['md'], 'All Files': ['*'] }
    });

    if (!uri) {
      return;
    }

    const markdown = await MarkdownBuilder.buildBundleMarkdown(this.selectedFiles, this.promptSettings);
    await fs.promises.writeFile(uri.fsPath, markdown, 'utf-8');
    vscode.window.showInformationMessage(`Файл сохранен: ${path.basename(uri.fsPath)}`);
  }

  public async previewContext(): Promise<void> {
    if (this.selectedFiles.size === 0) {
      vscode.window.showWarningMessage('Сначала выберите файлы для предпросмотра.');
      return;
    }
    const markdown = await MarkdownBuilder.buildBundleMarkdown(this.selectedFiles, this.promptSettings);
    const doc = await vscode.workspace.openTextDocument({
      content: markdown,
      language: 'markdown'
    });
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
  }

  public dispose(): void {
    this._isDisposed = true;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    this.disposeWatchers();
    this.disposables.forEach((d) => {
      try {
        d.dispose();
      } catch {
        // Ignore disposable cleanup failure
      }
    });
    this.disposables.length = 0;
  }
}