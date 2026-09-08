import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  FilterSettings,
  PromptSettings,
  WebviewToExtensionMessage,
  GitExtensionExports,
  GitRepository
} from './types';
import { BINARY_EXTENSIONS, LOCK_FILE_NAMES } from './constants';
import { GitService } from './services/gitService';
import { WorkspaceScanner } from './services/workspaceScanner';
import { StatsCalculator } from './services/statsCalculator';
import { MarkdownBuilder } from './services/markdownBuilder';
import { ContextTreeDataProvider, ContextTreeItem } from './services/contextTreeDataProvider';
import { getHtmlTemplate } from './ui/htmlTemplate';
import { PathUtils } from './utils/pathUtils';

/**
 * Webview View Provider for AI Context Merger controls panel.
 * Handles state synchronization, action commands, file watchers, and prompt configuration.
 */
export class ContextMergerControlsProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'aiContextMergerControlsView';
  private _view?: vscode.WebviewView;

  public filters: FilterSettings = {
    hideGitIgnored: true,
    hideLockFiles: true,
    hideBinaryFiles: true
  };

  public promptSettings: PromptSettings = {
    enabled: false,
    text: ''
  };

  private debounceTimer?: NodeJS.Timeout;
  private readonly watcherDisposables: vscode.Disposable[] = [];
  private isDisposed: boolean = false;

  private treeView?: vscode.TreeView<ContextTreeItem>;

  /**
   * Creates an instance of ContextMergerControlsProvider.
   *
   * @param _extensionUri - The root URI of the extension.
   * @param selectedFiles - Shared set containing normalized paths of selected files.
   * @param treeDataProvider - Reference to the Context TreeDataProvider for refresh sync.
   */
  constructor(
    private readonly _extensionUri: vscode.Uri,
    public readonly selectedFiles: Set<string>,
    private readonly treeDataProvider: ContextTreeDataProvider
  ) {
    this.initWatchers();
  }

  /**
   * Binds the native TreeView instance to allow programmatic expansion (reveal).
   *
   * @param treeView - Native TreeView instance.
   */
  public bindTreeView(treeView: vscode.TreeView<ContextTreeItem>): void {
    this.treeView = treeView;
  }

  /**
   * Re-initializes file system and Git watchers (e.g. upon workspace folder changes).
   */
  public reinitWatchers(): void {
    this.initWatchers();
  }

  /**
   * Initializes non-blocking file system and Git watchers.
   */
  private initWatchers(): void {
    this.disposeWatchers();

    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.watcherDisposables.push(fileWatcher);

    const onFileEvent = (uri: vscode.Uri, isDelete: boolean = false) => {
      const fsPath = PathUtils.normalizePath(uri.fsPath);

      if (WorkspaceScanner.isIgnoredByPathSegments(fsPath)) {
        return;
      }

      const fileName = path.basename(fsPath);
      const ext = path.extname(fileName).toLowerCase();

      if (this.filters.hideBinaryFiles && BINARY_EXTENSIONS.has(ext)) {
        return;
      }
      if (this.filters.hideLockFiles && LOCK_FILE_NAMES.has(fileName)) {
        return;
      }

      this.treeDataProvider.folderTotalCountMap.clear();

      if (isDelete) {
        for (const file of Array.from(this.selectedFiles)) {
          if (file === fsPath || PathUtils.isSubpath(file, fsPath)) {
            this.selectedFiles.delete(file);
          }
        }
      }

      this.triggerDebouncedRefresh();
    };

    this.watcherDisposables.push(
      fileWatcher.onDidCreate((uri) => onFileEvent(uri, false)),
      fileWatcher.onDidChange((uri) => onFileEvent(uri, false)),
      fileWatcher.onDidDelete((uri) => onFileEvent(uri, true))
    );

    this.initGitWatcher();
  }

  /**
   * Subscribes to Git repository state change events to refresh diff indicators.
   */
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
   * Schedules a debounced tree and statistics refresh.
   */
  public triggerDebouncedRefresh(): void {
    if (this.isDisposed) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      this.treeDataProvider.refresh();
      await this.updateStats();
    }, 300);
  }

  /**
   * Disposes active file and Git watchers.
   */
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

  /**
   * Resolves Webview View instance and binds IPC message listeners.
   *
   * @param webviewView - Webview view instance.
   * @param _context - View resolve context.
   * @param _token - Cancellation token.
   */
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

    webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      if (!message || typeof message.type !== 'string') {
        return;
      }

      switch (message.type) {
        case 'selectAll':
          await this.selectAllFiles();
          break;
        case 'selectFound':
          await this.selectFoundFiles(message.query);
          break;
        case 'clearSelection':
          this.clearSelection();
          break;
        case 'expandAll':
          this.treeDataProvider.expandLevel();
          break;
        case 'collapseAll':
          this.treeDataProvider.collapseAll();
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
            this.treeDataProvider.setFilters(this.filters);
            await this.updateStats();
          }
          break;
        case 'updatePrompt':
          this.promptSettings = {
            enabled: Boolean(message.enabled),
            text: typeof message.text === 'string' ? message.text : ''
          };
          await this.updateStats();
          break;
        case 'updateSearch':
          await this.handleSearchInput(message.query);
          break;
        case 'refresh':
          this.treeDataProvider.refresh();
          await this.updateStats();
          break;
        case 'requestInitialData':
          await this.sendInitialData();
          break;
      }
    });
  }

  /**
   * Recalculates context statistics and posts updated payload to Webview.
   */
  public async updateStats(): Promise<void> {
    if (!this._view) {
      return;
    }
    const stats = await StatsCalculator.calculateStats(this.selectedFiles, this.promptSettings);
    this._view.webview.postMessage({
      type: 'updateStats',
      stats
    });
  }

  /**
   * Transmits initial state, active filters, and statistics to newly mounted Webview.
   */
  private async sendInitialData(): Promise<void> {
    if (!this._view) {
      return;
    }
    const stats = await StatsCalculator.calculateStats(this.selectedFiles, this.promptSettings);
    this._view.webview.postMessage({
      type: 'setData',
      stats,
      filters: this.filters,
      promptSettings: this.promptSettings
    });
  }

  /**
   * Selects all non-filtered files across all workspace folders and updates folder count caches.
   */
  public async selectAllFiles(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }

    this.selectedFiles.clear();
    for (const folder of workspaceFolders) {
      const rootPath = PathUtils.normalizePath(folder.uri.fsPath);
      await WorkspaceScanner.selectFolderRecursive(
        rootPath,
        this.filters,
        this.selectedFiles,
        this.treeDataProvider.folderTotalCountMap
      );
    }
    this.treeDataProvider.refresh();
    await this.updateStats();
  }

  /**
   * Handles user search query changes, updates tree filter, and calculates matching count.
   *
   * @param query - Search substring.
   */
  private async handleSearchInput(query: string): Promise<void> {
    const trimmed = (query || '').trim();
    await this.treeDataProvider.setSearchQuery(trimmed);

    if (!trimmed) {
      this._view?.webview.postMessage({ type: 'searchResults', count: 0, query: '' });
      return;
    }

    const count = this.treeDataProvider.getMatchingFilesCount();

    this._view?.webview.postMessage({
      type: 'searchResults',
      count,
      query: trimmed
    });
  }

  /**
   * Selects all files matching current search query across workspace.
   *
   * @param query - Active search query.
   */
  private async selectFoundFiles(query: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }

    for (const folder of workspaceFolders) {
      const matches = await WorkspaceScanner.findMatchingFiles(folder.uri.fsPath, query, this.filters);
      for (const file of matches) {
        this.selectedFiles.add(file);
      }
    }

    this.treeDataProvider.refresh();
    await this.updateStats();
  }

  /**
   * Selects all modified and untracked files identified by Git and expands parent folders.
   */
  public async selectModifiedGitFiles(): Promise<void> {
    const modifiedPaths = await GitService.getModifiedFilePaths();
    const workspaceFolders = vscode.workspace.workspaceFolders;

    this.selectedFiles.clear();
    const matchedModifiedPaths: string[] = [];

    for (const filePath of modifiedPaths) {
      const matchedFolder = workspaceFolders?.find((f) =>
        PathUtils.isSubpath(filePath, PathUtils.normalizePath(f.uri.fsPath))
      );
      const rootPath = matchedFolder ? PathUtils.normalizePath(matchedFolder.uri.fsPath) : undefined;
      const isFiltered = WorkspaceScanner.shouldFilterItem(filePath, false, this.filters, rootPath);

      if (!isFiltered) {
        this.selectedFiles.add(filePath);
        matchedModifiedPaths.push(filePath);
      }
    }

    // Instantly expands only the parent folders containing changed files
    this.treeDataProvider.setGitExpandedFolders(matchedModifiedPaths);

    vscode.window.showInformationMessage(`Выбрано файлов Git Diff: ${this.selectedFiles.size}`);
    await this.updateStats();
  }

  /**
   * Clears active selection set, refreshes tree, and updates statistics.
   */
  public clearSelection(): void {
    this.selectedFiles.clear();
    this.treeDataProvider.refresh();
    this.updateStats();
  }

  /**
   * Assembles Markdown context bundle and writes it to the system clipboard.
   */
  public async copyContextToClipboard(): Promise<void> {
    if (this.selectedFiles.size === 0) {
      vscode.window.showWarningMessage('Не выбрано ни одного файла для копирования.');
      return;
    }
    const markdown = await MarkdownBuilder.buildBundleMarkdown(this.selectedFiles, this.promptSettings);
    await vscode.env.clipboard.writeText(markdown);
    vscode.window.showInformationMessage(`Скопирован контекст: ${this.selectedFiles.size} файлов!`);
  }

  /**
   * Prompts user for a save location and exports formatted Markdown bundle to file.
   */
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

  /**
   * Opens assembled Markdown context in an editor split beside the current view.
   */
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

  /**
   * Disposes timer and watchers upon extension deactivation.
   */
  public dispose(): void {
    this.isDisposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.disposeWatchers();
  }
}