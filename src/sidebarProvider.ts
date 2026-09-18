import * as vscode from 'vscode';
import {
  ContextStats,
  DiagnosticsSettings,
  DiagnosticsSummary,
  ExtensionToWebviewMessage,
  FilterSettings,
  GitDiffSettings,
  GitFileStatus,
  OutputFormat,
  PromptSettings,
  WebviewToExtensionMessage
} from './types';
import { GitService } from './services/gitService';
import { StatsCalculator } from './services/statsCalculator';
import { ContextTreeDataProvider, ContextTreeItem } from './services/contextTreeDataProvider';
import { PresetService } from './services/presetService';
import { SelectionService } from './services/selectionService';
import { BundleService } from './services/bundleService';
import { BundleExportService } from './services/bundleExportService';
import { WatcherService } from './services/watcherService';
import { DiagnosticsService } from './services/diagnosticsService';
import { WebviewMessageHandler } from './services/webviewMessageHandler';
import { getHtmlTemplate } from './ui/htmlTemplate';
import { I18nService, ConfiguredLanguage } from './i18n';
import { getStandardPresets } from './constants/presets';

export const WORKSPACE_STORAGE_KEYS = {
  PROMPT_SETTINGS: 'aiContextMerger.promptSettings',
  PROJECT_STRUCTURE: 'aiContextMerger.includeProjectStructure',
  GIT_DIFF_SETTINGS: 'aiContextMerger.gitDiffSettings',
  DIAGNOSTICS_SETTINGS: 'aiContextMerger.diagnosticsSettings',
  SELECTED_FILES: 'aiContextMerger.selectedFiles',
  SHOW_ONLY_SELECTED: 'aiContextMerger.showOnlySelected'
} as const;

/**
 * Webview View Provider for AI Context Merger controls panel.
 */
export class ContextMergerControlsProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'aiContextMergerControlsView';
  public static readonly WORKSPACE_STORAGE_KEYS = WORKSPACE_STORAGE_KEYS;

  private _view?: vscode.WebviewView;
  private messageListenerDisposable?: vscode.Disposable;
  private configChangeDisposable?: vscode.Disposable;

  public filters: FilterSettings;
  public promptSettings: PromptSettings;
  public includeProjectStructure: boolean;
  public gitDiffSettings: GitDiffSettings;
  public diagnosticsSettings: DiagnosticsSettings;
  public outputFormat: OutputFormat;
  public tokenLimit: string;

  private cachedGitStatuses: Map<string, GitFileStatus> = new Map<string, GitFileStatus>();
  private isDisposed: boolean = false;
  public treeView?: vscode.TreeView<ContextTreeItem>;

  private readonly presetService: PresetService;
  private readonly selectionService: SelectionService;
  private readonly watcherService: WatcherService;
  private readonly messageHandler: WebviewMessageHandler;

  constructor(
    public readonly context: vscode.ExtensionContext,
    public readonly selectedFiles: Set<string>,
    private readonly treeDataProvider: ContextTreeDataProvider
  ) {
    this.presetService = new PresetService(context);
    this.selectionService = new SelectionService(selectedFiles, treeDataProvider);

    this.outputFormat = this.presetService.getOutputFormat();
    this.filters = this.presetService.getFilters();
    this.tokenLimit = this.presetService.getTokenLimit();

    this.promptSettings = this.context.workspaceState.get<PromptSettings>(
      WORKSPACE_STORAGE_KEYS.PROMPT_SETTINGS,
      { enabled: false, text: '' }
    );

    this.includeProjectStructure = this.context.workspaceState.get<boolean>(
      WORKSPACE_STORAGE_KEYS.PROJECT_STRUCTURE,
      true
    );

    this.gitDiffSettings = this.context.workspaceState.get<GitDiffSettings>(
      WORKSPACE_STORAGE_KEYS.GIT_DIFF_SETTINGS,
      { includeGitDiff: false, diffOnly: false, unlimitedDiff: false }
    );

    this.diagnosticsSettings = this.context.workspaceState.get<DiagnosticsSettings>(
      WORKSPACE_STORAGE_KEYS.DIAGNOSTICS_SETTINGS,
      { enabled: false, includeCompiler: true, includeLinter: false }
    );

    this.messageHandler = new WebviewMessageHandler(
      this,
      this.selectionService,
      this.presetService,
      this.treeDataProvider,
      this.selectedFiles
    );

    this.watcherService = new WatcherService(
      this.selectedFiles,
      () => this.filters,
      () => this.forceRefresh(),
      () => this.updateStats()
    );

        // Single source of truth: listen to settings.json changes
    this.configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiContextMerger.language')) {
        this.notifyLanguageChanged();
      }
      if (
        e.affectsConfiguration('aiContextMerger.ignoredDirectoryPatterns') ||
        e.affectsConfiguration('aiContextMerger.lockFilePatterns') ||
        e.affectsConfiguration('aiContextMerger.binaryExtensions') ||
        e.affectsConfiguration('aiContextMerger.maxFileSizeMB') ||
        e.affectsConfiguration('aiContextMerger.maxDiffSizeKB') ||
        e.affectsConfiguration('aiContextMerger.defaultOutputFormat') ||
        e.affectsConfiguration('aiContextMerger.defaultTokenLimit')
      ) {
        this.forceRefresh();
      }
    });
  }

  public notifyLanguageChanged(): void {
    const activeLocale = I18nService.getActiveLocale();
    const currentLang = I18nService.getConfiguredLanguage();
    const translations = I18nService.getTranslations(activeLocale);
    const presets = getStandardPresets(activeLocale);

    this.treeDataProvider.refresh();

    this.postWebviewMessage({
      type: 'updateTranslations',
      language: currentLang,
      activeLocale,
      uiTranslations: translations.ui,
      standardPresets: presets
    });

    this.updateStats();
  }

  public async setLanguagePreference(newLanguage: ConfiguredLanguage): Promise<void> {
    await vscode.workspace.getConfiguration('aiContextMerger').update(
      'language',
      newLanguage,
      vscode.ConfigurationTarget.Global
    );
  }

  public bindTreeView(treeView: vscode.TreeView<ContextTreeItem>): void {
    this.treeView = treeView;
  }

  public reinitWatchers(): void {
    this.watcherService.reinitWatchers();
  }

  public async forceRefresh(): Promise<void> {
    if (this.isDisposed) {
      return;
    }
    this.treeDataProvider.folderTotalCountMap.clear();
    this.cachedGitStatuses = await GitService.getFileStatuses();
    this.treeDataProvider.setGitStatuses(this.cachedGitStatuses);
    await this.treeDataProvider.reapplySearch();
    await this.updateStats();
  }

  public getDiagnosticsSummary(): DiagnosticsSummary {
    return DiagnosticsService.getDiagnosticsSummary(this.selectedFiles);
  }

  public postWebviewMessage(message: ExtensionToWebviewMessage): void {
    this._view?.webview.postMessage(message);
  }

  private sendDiagnosticsSummary(): void {
    if (!this._view) {
      return;
    }
    const summary = this.getDiagnosticsSummary();
    this.postWebviewMessage({
      type: 'updateDiagnosticsSummary',
      summary
    });
  }

  public async persistSelectedFiles(): Promise<void> {
    await this.context.workspaceState.update(
      WORKSPACE_STORAGE_KEYS.SELECTED_FILES,
      Array.from(this.selectedFiles)
    );
  }

  private async computeContextStats(): Promise<ContextStats> {
    let diffLength = 0;
    if (this.gitDiffSettings.includeGitDiff && this.selectedFiles.size > 0) {
      const diffContent = await GitService.getFilesDiff(
        Array.from(this.selectedFiles),
        this.gitDiffSettings.unlimitedDiff,
        this.filters
      );
      diffLength = diffContent.length;
    }

    const diagnosticsPayload = BundleService.getDiagnosticsPayload(this.selectedFiles, this.diagnosticsSettings);

    return await StatsCalculator.calculateStats(
      this.selectedFiles,
      this.promptSettings,
      this.gitDiffSettings,
      diffLength,
      this.cachedGitStatuses,
      this.outputFormat,
      this.diagnosticsSettings,
      diagnosticsPayload.length,
      this.tokenLimit,
      this.includeProjectStructure
    );
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(__dirname)]
    };

    webviewView.webview.html = getHtmlTemplate(webviewView.webview);

    this.messageListenerDisposable?.dispose();
    this.messageListenerDisposable = webviewView.webview.onDidReceiveMessage(
      async (message: WebviewToExtensionMessage) => {
        await this.messageHandler.handleMessage(message);
      }
    );
  }

  public async updateStats(): Promise<void> {
    if (!this._view) {
      return;
    }

    const stats = await this.computeContextStats();

    this.postWebviewMessage({
      type: 'updateStats',
      stats
    });

    this.sendDiagnosticsSummary();
  }

  public async sendInitialData(): Promise<void> {
    if (!this._view) {
      return;
    }

    this.cachedGitStatuses = await GitService.getFileStatuses();
    this.treeDataProvider.setGitStatuses(this.cachedGitStatuses);

    const stats = await this.computeContextStats();
    const activeLocale = I18nService.getActiveLocale();
    const currentLang = I18nService.getConfiguredLanguage();
    const translations = I18nService.getTranslations(activeLocale);
    const standardPresets = getStandardPresets(activeLocale);

    this.postWebviewMessage({
      type: 'setData',
      stats,
      filters: this.filters,
      promptSettings: this.promptSettings,
      includeProjectStructure: this.includeProjectStructure,
      gitDiffSettings: this.gitDiffSettings,
      diagnosticsSettings: this.diagnosticsSettings,
      diagnosticsSummary: this.getDiagnosticsSummary(),
      customPresets: this.presetService.getCustomPresets(),
      outputFormat: this.outputFormat,
      tokenLimit: this.tokenLimit,
      language: currentLang,
      activeLocale,
      uiTranslations: translations.ui,
      standardPresets
    });
  }

  public async clearSelection(): Promise<void> {
    this.selectionService.clearSelection();
    await this.persistSelectedFiles();
    await this.updateStats();
  }

  public async copyContextToClipboard(): Promise<void> {
    await BundleExportService.copyContextToClipboard(
      this.selectedFiles,
      this.outputFormat,
      this.promptSettings,
      this.gitDiffSettings,
      this.diagnosticsSettings,
      this.filters,
      this.cachedGitStatuses,
      this.includeProjectStructure,
      () => {
        this.postWebviewMessage({ type: 'copySuccess' });
      },
      () => {
        this.postWebviewMessage({ type: 'copyError' });
      }
    );
  }

  public async exportContextToFile(): Promise<void> {
    await BundleExportService.exportContextToFile(
      this.selectedFiles,
      this.outputFormat,
      this.promptSettings,
      this.gitDiffSettings,
      this.diagnosticsSettings,
      this.filters,
      this.cachedGitStatuses,
      this.includeProjectStructure
    );
  }

    public async previewContext(): Promise<void> {
    await BundleExportService.previewContext(
      this.selectedFiles,
      this.outputFormat,
      this.promptSettings,
      this.gitDiffSettings,
      this.diagnosticsSettings,
      this.filters,
      this.cachedGitStatuses,
      this.includeProjectStructure,
      () => {
        this.postWebviewMessage({ type: 'previewSuccess' });
      },
      () => {
        this.postWebviewMessage({ type: 'previewError' });
      }
    );
  }

  public dispose(): void {
    this.isDisposed = true;
    this.messageListenerDisposable?.dispose();
    this.configChangeDisposable?.dispose();
    this.watcherService.dispose();
  }
}