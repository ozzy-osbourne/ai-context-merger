import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  CustomPreset,
  DiagnosticsSettings,
  DiagnosticsSummary,
  FilterSettings,
  GitDiffSettings,
  GitFileStatus,
  OutputFormat,
  PromptSettings,
  WebviewToExtensionMessage,
  GitExtensionExports,
  GitRepository
} from './types';
import { BINARY_EXTENSIONS, LOCK_FILE_NAMES, isSecretFile, isMinifiedOrSourceMap } from './constants';
import { GitService } from './services/gitService';
import { WorkspaceScanner } from './services/workspaceScanner';
import { StatsCalculator } from './services/statsCalculator';
import { MarkdownBuilder } from './services/markdownBuilder';
import { XmlBuilder } from './services/xmlBuilder';
import { ContextTreeDataProvider, ContextTreeItem } from './services/contextTreeDataProvider';
import { getHtmlTemplate } from './ui/htmlTemplate';
import { ContextUtils } from './utils/contextUtils';
import { PathUtils } from './utils/pathUtils';

/**
 * Storage key for custom user prompt presets in globalState.
 */
const CUSTOM_PRESETS_STORAGE_KEY = 'aiContextMerger.customPresets';

/**
 * Storage key for active output format in globalState.
 */
const OUTPUT_FORMAT_STORAGE_KEY = 'aiContextMerger.outputFormat';

/**
 * Webview View Provider for AI Context Merger controls panel.
 * Handles state synchronization, action commands, file watchers, open tabs selection, and diagnostics monitoring.
 */
export class ContextMergerControlsProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'aiContextMergerControlsView';
  private _view?: vscode.WebviewView;

  public filters: FilterSettings = {
    hideGitIgnored: true,
    hideSecrets: true,
    hideMinified: true,
    hideLockFiles: true,
    hideBinaryFiles: true
  };

  public promptSettings: PromptSettings = {
    enabled: false,
    text: ''
  };

  public gitDiffSettings: GitDiffSettings = {
    includeGitDiff: false,
    diffOnly: false,
    unlimitedDiff: false
  };

  public diagnosticsSettings: DiagnosticsSettings = {
    enabled: false,
    includeCompiler: true,
    includeLinter: true
  };

  public outputFormat: OutputFormat = 'markdown';

  private cachedGitStatuses: Map<string, GitFileStatus> = new Map<string, GitFileStatus>();

  private debounceTimer?: NodeJS.Timeout;
  private diagnosticsDebounceTimer?: NodeJS.Timeout;
  private readonly watcherDisposables: vscode.Disposable[] = [];
  private isDisposed: boolean = false;

  private treeView?: vscode.TreeView<ContextTreeItem>;

  /**
   * Creates an instance of ContextMergerControlsProvider.
   *
   * @param context - Extension context provided by VS Code.
   * @param selectedFiles - Shared set containing normalized paths of selected files.
   * @param treeDataProvider - Reference to the Context TreeDataProvider for refresh sync.
   */
  constructor(
    private readonly context: vscode.ExtensionContext,
    public readonly selectedFiles: Set<string>,
    private readonly treeDataProvider: ContextTreeDataProvider
  ) {
    this.context.globalState.setKeysForSync([CUSTOM_PRESETS_STORAGE_KEY, OUTPUT_FORMAT_STORAGE_KEY]);
    this.outputFormat = this.context.globalState.get<OutputFormat>(OUTPUT_FORMAT_STORAGE_KEY, 'markdown');
    this.initWatchers();
  }

  /**
   * Retrieves stored custom prompt presets from globalState.
   */
  private getCustomPresets(): CustomPreset[] {
    return this.context.globalState.get<CustomPreset[]>(CUSTOM_PRESETS_STORAGE_KEY, []);
  }

  /**
   * Persists custom prompt presets into globalState.
   */
  private async saveCustomPresets(presets: CustomPreset[]): Promise<void> {
    await this.context.globalState.update(CUSTOM_PRESETS_STORAGE_KEY, presets);
  }

  /**
   * Persists chosen output format into globalState.
   */
  private async saveOutputFormat(format: OutputFormat): Promise<void> {
    this.outputFormat = format;
    await this.context.globalState.update(OUTPUT_FORMAT_STORAGE_KEY, format);
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
   * Re-initializes file system and Git watchers.
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
        this.treeDataProvider.folderTotalCountMap.clear();
        this.triggerDebouncedRefresh();
        return;
      }

      if (WorkspaceScanner.isIgnoredByPathSegments(fsPath, rootPath)) {
        return;
      }

      const fileName = path.basename(fsPath);
      const ext = path.extname(fileName).toLowerCase();

      if (this.filters.hideSecrets && isSecretFile(fileName)) {
        return;
      }
      if (this.filters.hideMinified && isMinifiedOrSourceMap(fileName)) {
        return;
      }
      if (this.filters.hideBinaryFiles && BINARY_EXTENSIONS.has(ext)) {
        return;
      }
      if (this.filters.hideLockFiles && LOCK_FILE_NAMES.has(fileName)) {
        return;
      }

      this.treeDataProvider.folderTotalCountMap.clear();
      this.triggerDebouncedRefresh();
    };

    this.watcherDisposables.push(
      fileWatcher.onDidCreate((uri) => onFileEvent(uri, false)),
      fileWatcher.onDidChange((uri) => onFileEvent(uri, false)),
      fileWatcher.onDidDelete((uri) => onFileEvent(uri, true))
    );

    this.initGitWatcher();

    // Isolated diagnostics watcher: updates token metrics and problem counts without resetting folder caches or Git
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

        this.diagnosticsDebounceTimer = setTimeout(async () => {
          await this.updateStats();
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
   * Schedules a debounced tree, Git decoration, and statistics refresh without resetting user selections.
   */
  public triggerDebouncedRefresh(): void {
    if (this.isDisposed) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      await this.forceRefresh();
    }, 300);
  }

  /**
   * Performs an immediate workspace re-scan, synchronizing Git statuses, tree nodes, and diagnostics.
   */
  public async forceRefresh(): Promise<void> {
    if (this.isDisposed) {
      return;
    }
    this.treeDataProvider.folderTotalCountMap.clear();
    this.cachedGitStatuses = await GitService.getFileStatuses();
    this.treeDataProvider.setGitStatuses(this.cachedGitStatuses);
    await this.updateStats();
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

  /**
   * Calculates aggregated count of compiler issues and linter issues across currently selected files.
   *
   * @returns Diagnostics summary object with compiler and linter counters.
   */
  public getDiagnosticsSummary(): DiagnosticsSummary {
    let compilerCount = 0;
    let linterCount = 0;

    for (const filePath of this.selectedFiles) {
      try {
        const uri = vscode.Uri.file(filePath);
        const diags = vscode.languages.getDiagnostics(uri);
        for (const d of diags) {
          const cat = ContextUtils.classifyDiagnostic(d);
          if (cat === 'compiler') {
            compilerCount++;
          } else {
            linterCount++;
          }
        }
      } catch {
        // Ignore unreadable file URI
      }
    }

    return { compilerCount, linterCount };
  }

  /**
   * Transmits updated diagnostics summary to the Webview.
   */
  private sendDiagnosticsSummary(): void {
    if (!this._view) {
      return;
    }
    const summary = this.getDiagnosticsSummary();
    this._view.webview.postMessage({
      type: 'updateDiagnosticsSummary',
      summary
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
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
        case 'selectOpenTabs':
          await this.selectOpenTabs();
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
        case 'updateOutputFormat':
          if (message.format === 'markdown' || message.format === 'xml') {
            await this.saveOutputFormat(message.format);
            await this.updateStats();
          }
          break;
        case 'updateFilters':
          if (message.filters && typeof message.filters === 'object') {
            this.filters = {
              hideGitIgnored: Boolean(message.filters.hideGitIgnored),
              hideSecrets: Boolean(message.filters.hideSecrets),
              hideMinified: Boolean(message.filters.hideMinified),
              hideLockFiles: Boolean(message.filters.hideLockFiles),
              hideBinaryFiles: Boolean(message.filters.hideBinaryFiles)
            };

            const workspaceFolders = vscode.workspace.workspaceFolders;
            for (const filePath of Array.from(this.selectedFiles)) {
              const matchedFolder = workspaceFolders?.find((f) =>
                PathUtils.isSubpath(filePath, PathUtils.normalizePath(f.uri.fsPath))
              );
              const root = matchedFolder ? PathUtils.normalizePath(matchedFolder.uri.fsPath) : undefined;
              if (WorkspaceScanner.shouldFilterItem(filePath, false, this.filters, root)) {
                this.selectedFiles.delete(filePath);
              }
            }

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
        case 'addCustomPreset':
          if (typeof message.name === 'string' && typeof message.text === 'string') {
            const name = message.name.trim();
            const text = message.text.trim();

            if (!name || !text) {
              vscode.window.showWarningMessage('Название и текст пресета не могут быть пустыми.');
              break;
            }

            if (name.length > 32) {
              vscode.window.showWarningMessage('Название пресета не должно превышать 32 символа.');
              break;
            }

            if (text.length > 10000) {
              vscode.window.showWarningMessage('Текст пресета слишком длинный (максимум 10 000 символов).');
              break;
            }

            const currentPresets = this.getCustomPresets();
            if (currentPresets.length >= 50) {
              vscode.window.showErrorMessage('Достигнут лимит сохраненных пресетов (максимум 50).');
              break;
            }

            const newPreset: CustomPreset = {
              id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              name,
              text
            };
            currentPresets.push(newPreset);
            await this.saveCustomPresets(currentPresets);

            this._view?.webview.postMessage({
              type: 'updateCustomPresets',
              customPresets: currentPresets
            });
            vscode.window.showInformationMessage(`Пресет "${newPreset.name}" сохранен!`);
          }
          break;
        case 'editCustomPreset':
          if (
            typeof message.id === 'string' &&
            typeof message.name === 'string' &&
            typeof message.text === 'string'
          ) {
            const name = message.name.trim();
            const text = message.text.trim();

            if (!name || !text) {
              vscode.window.showWarningMessage('Название и текст пресета не могут быть пустыми.');
              break;
            }

            if (name.length > 32) {
              vscode.window.showWarningMessage('Название пресета не должно превышать 32 символа.');
              break;
            }

            if (text.length > 10000) {
              vscode.window.showWarningMessage('Текст пресета слишком длинный (максимум 10 000 символов).');
              break;
            }

            const currentPresets = this.getCustomPresets();
            const targetIndex = currentPresets.findIndex((p) => p.id === message.id);
            if (targetIndex !== -1) {
              currentPresets[targetIndex] = {
                ...currentPresets[targetIndex],
                name,
                text
              };
              await this.saveCustomPresets(currentPresets);

              this._view?.webview.postMessage({
                type: 'updateCustomPresets',
                customPresets: currentPresets
              });
              vscode.window.showInformationMessage(`Пресет "${name}" обновлен!`);
            } else {
              this._view?.webview.postMessage({
                type: 'updateCustomPresets',
                customPresets: currentPresets
              });
              vscode.window.showErrorMessage('Пресет не найден или уже был удален.');
            }
          }
          break;
        case 'deleteCustomPreset':
          if (typeof message.id === 'string') {
            const currentPresets = this.getCustomPresets();
            const filteredPresets = currentPresets.filter((p) => p.id !== message.id);
            if (filteredPresets.length !== currentPresets.length) {
              await this.saveCustomPresets(filteredPresets);
            }

            this._view?.webview.postMessage({
              type: 'updateCustomPresets',
              customPresets: filteredPresets
            });
          }
          break;
        case 'updateGitDiff':
          if (message.settings && typeof message.settings === 'object') {
            this.gitDiffSettings = {
              includeGitDiff: Boolean(message.settings.includeGitDiff),
              diffOnly: Boolean(message.settings.diffOnly),
              unlimitedDiff: Boolean(message.settings.unlimitedDiff)
            };
            await this.updateStats();
          }
          break;
        case 'updateDiagnostics':
          if (message.settings && typeof message.settings === 'object') {
            this.diagnosticsSettings = {
              enabled: Boolean(message.settings.enabled),
              includeCompiler: Boolean(message.settings.includeCompiler),
              includeLinter: Boolean(message.settings.includeLinter)
            };
            await this.updateStats();
          }
          break;
        case 'updateSearch':
          await this.handleSearchInput(message.query);
          break;
        case 'refresh':
          await this.forceRefresh();
          vscode.window.showInformationMessage('Данные рабочей области обновлены (выборка сохранена).');
          break;
        case 'requestInitialData':
          await this.sendInitialData();
          break;
      }
    });
  }

  /**
   * Generates formatted compiler/linter diagnostics payload for selected files.
   *
   * @returns Formatted diagnostics text or empty string if disabled/unselected.
   */
  private getDiagnosticsPayload(): string {
    if (
      !this.diagnosticsSettings.enabled ||
      (!this.diagnosticsSettings.includeCompiler && !this.diagnosticsSettings.includeLinter) ||
      this.selectedFiles.size === 0
    ) {
      return '';
    }

    const items = ContextUtils.getDiagnosticsForFiles(
      this.selectedFiles,
      this.diagnosticsSettings,
      vscode.workspace.workspaceFolders
    );

    return ContextUtils.formatDiagnosticsText(items);
  }

  private async buildContextPayload(): Promise<string> {
    let diffContent = '';
    if (this.gitDiffSettings.includeGitDiff) {
      diffContent = await GitService.getFilesDiff(
        Array.from(this.selectedFiles),
        this.gitDiffSettings.unlimitedDiff,
        this.filters
      );
    }

    const diagnosticsContent = this.getDiagnosticsPayload();

    if (this.outputFormat === 'xml') {
      return await XmlBuilder.buildBundleXml(
        this.selectedFiles,
        this.promptSettings,
        this.gitDiffSettings,
        diffContent,
        this.cachedGitStatuses,
        this.diagnosticsSettings,
        diagnosticsContent
      );
    }

    return await MarkdownBuilder.buildBundleMarkdown(
      this.selectedFiles,
      this.promptSettings,
      this.gitDiffSettings,
      diffContent,
      this.cachedGitStatuses,
      this.diagnosticsSettings,
      diagnosticsContent
    );
  }

  /**
   * Recalculates context statistics with Git diff length and posts updated payload to Webview.
   * Always synchronizes current diagnostics counts to keep controls reactive to tree selection changes.
   */
  public async updateStats(): Promise<void> {
    if (!this._view) {
      return;
    }

    let diffLength = 0;
    if (this.gitDiffSettings.includeGitDiff && this.selectedFiles.size > 0) {
      const diffContent = await GitService.getFilesDiff(
        Array.from(this.selectedFiles),
        this.gitDiffSettings.unlimitedDiff,
        this.filters
      );
      diffLength = diffContent.length;
    }

    const diagnosticsPayload = this.getDiagnosticsPayload();

    const stats = await StatsCalculator.calculateStats(
      this.selectedFiles,
      this.promptSettings,
      this.gitDiffSettings,
      diffLength,
      this.cachedGitStatuses,
      this.outputFormat,
      this.diagnosticsSettings,
      diagnosticsPayload.length
    );

    this._view.webview.postMessage({
      type: 'updateStats',
      stats
    });

    this.sendDiagnosticsSummary();
  }

  /**
   * Transmits initial state, active filters, format, and statistics to newly mounted Webview.
   */
  private async sendInitialData(): Promise<void> {
    if (!this._view) {
      return;
    }

    this.cachedGitStatuses = await GitService.getFileStatuses();
    this.treeDataProvider.setGitStatuses(this.cachedGitStatuses);

    let diffLength = 0;
    if (this.gitDiffSettings.includeGitDiff && this.selectedFiles.size > 0) {
      const diffContent = await GitService.getFilesDiff(
        Array.from(this.selectedFiles),
        this.gitDiffSettings.unlimitedDiff,
        this.filters
      );
      diffLength = diffContent.length;
    }

    const diagnosticsPayload = this.getDiagnosticsPayload();

    const stats = await StatsCalculator.calculateStats(
      this.selectedFiles,
      this.promptSettings,
      this.gitDiffSettings,
      diffLength,
      this.cachedGitStatuses,
      this.outputFormat,
      this.diagnosticsSettings,
      diagnosticsPayload.length
    );

    this._view.webview.postMessage({
      type: 'setData',
      stats,
      filters: this.filters,
      promptSettings: this.promptSettings,
      gitDiffSettings: this.gitDiffSettings,
      diagnosticsSettings: this.diagnosticsSettings,
      diagnosticsSummary: this.getDiagnosticsSummary(),
      customPresets: this.getCustomPresets(),
      outputFormat: this.outputFormat
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
   * Selects all active file URIs currently opened across editor tab groups that reside within the active workspace.
   */
  public async selectOpenTabs(): Promise<void> {
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

      // Discard external tabs located outside of workspace folders
      if (!matchedFolder) {
        continue;
      }

      // Verify physical presence on disk to skip ghost or deleted tabs
      try {
        const stat = await fs.promises.stat(fsPath);
        if (!stat.isFile()) {
          continue;
        }
      } catch {
        continue;
      }

      const rootPath = PathUtils.normalizePath(matchedFolder.uri.fsPath);

      if (!WorkspaceScanner.shouldFilterItem(fsPath, false, this.filters, rootPath)) {
        if (!this.selectedFiles.has(fsPath)) {
          this.selectedFiles.add(fsPath);
          addedCount++;
        }
      }
    }

    this.treeDataProvider.refresh();
    await this.updateStats();

    if (addedCount > 0) {
      vscode.window.showInformationMessage(`Выбрано файлов из открытых вкладок: ${addedCount}`);
    } else {
      vscode.window.showWarningMessage('В открытых вкладках не найдено доступных файлов проекта (или они скрыты фильтрами).');
    }
  }

  private async handleSearchInput(query: string): Promise<void> {
    const trimmed = (query || '').trim();
    await this.treeDataProvider.setSearchQuery(trimmed);

    if (!trimmed) {
      if (this.treeView) {
        this.treeView.message = undefined;
      }
      this._view?.webview.postMessage({ type: 'searchResults', count: 0, query: '' });
      return;
    }

    const count = this.treeDataProvider.getMatchingFilesCount();

    if (this.treeView) {
      this.treeView.message = count > 0 ? `Найдено файлов: ${count}` : undefined;
    }

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
   * Selects all modified, untracked, and deleted files identified by Git and expands parent folders.
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

    this.treeDataProvider.setGitExpandedFolders(matchedModifiedPaths);

    vscode.window.showInformationMessage(`Выбрано файлов Git: ${this.selectedFiles.size}`);
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
   * Assembles context bundle and writes it to the system clipboard.
   */
  public async copyContextToClipboard(): Promise<void> {
    if (this.selectedFiles.size === 0) {
      vscode.window.showWarningMessage('Не выбрано ни одного файла для копирования.');
      return;
    }

    try {
      const payload = await this.buildContextPayload();
      await vscode.env.clipboard.writeText(payload);
      this._view?.webview.postMessage({ type: 'copySuccess' });

      const formatLabel = this.outputFormat.toUpperCase();
      vscode.window.showInformationMessage(`Скопирован контекст (${formatLabel}): ${this.selectedFiles.size} файлов!`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Ошибка копирования в буфер обмена: ${err?.message || err}`);
    }
  }

  /**
   * Prompts user for a save location and exports formatted bundle to file.
   */
  public async exportContextToFile(): Promise<void> {
    if (this.selectedFiles.size === 0) {
      vscode.window.showWarningMessage('Не выбрано ни одного файла для экспорта.');
      return;
    }

    const isXml = this.outputFormat === 'xml';
    const defaultUri = vscode.Uri.file(isXml ? 'project-context.xml' : 'project-context.md');
    const filters: Record<string, string[]> = isXml
      ? { XML: ['xml'], 'All Files': ['*'] }
      : { Markdown: ['md'], 'All Files': ['*'] };

    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters
    });

    if (!uri) {
      return;
    }

    try {
      const payload = await this.buildContextPayload();
      await fs.promises.writeFile(uri.fsPath, payload, 'utf-8');
      vscode.window.showInformationMessage(`Файл сохранен: ${path.basename(uri.fsPath)}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Ошибка сохранения файла: ${err?.message || err}`);
    }
  }

  /**
   * Opens assembled context in an editor split beside current view with matching syntax highlighting.
   */
  public async previewContext(): Promise<void> {
    if (this.selectedFiles.size === 0) {
      vscode.window.showWarningMessage('Сначала выберите файлы для предпросмотра.');
      return;
    }

    try {
      const payload = await this.buildContextPayload();
      const doc = await vscode.workspace.openTextDocument({
        content: payload,
        language: this.outputFormat === 'xml' ? 'xml' : 'markdown'
      });
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Ошибка предварительного просмотра: ${err?.message || err}`);
    }
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
    if (this.diagnosticsDebounceTimer) {
      clearTimeout(this.diagnosticsDebounceTimer);
      this.diagnosticsDebounceTimer = undefined;
    }
    this.disposeWatchers();
  }
}