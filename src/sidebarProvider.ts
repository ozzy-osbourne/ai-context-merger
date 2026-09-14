import * as vscode from 'vscode';
import {
  CustomPreset,
  DiagnosticsSettings,
  DiagnosticsSummary,
  FilterSettings,
  GitDiffSettings,
  GitFileStatus,
  OutputFormat,
  PromptSettings,
  WebviewToExtensionMessage
} from './types';
import { GitService } from './services/gitService';
import { WorkspaceScanner } from './services/workspaceScanner';
import { StatsCalculator } from './services/statsCalculator';
import { ContextTreeDataProvider, ContextTreeItem } from './services/contextTreeDataProvider';
import { PresetService } from './services/presetService';
import { SelectionService } from './services/selectionService';
import { BundleService } from './services/bundleService';
import { WatcherService } from './services/watcherService';
import { DiagnosticsService } from './services/diagnosticsService';
import { getHtmlTemplate } from './ui/htmlTemplate';
import { PathUtils } from './utils/pathUtils';

/**
 * Storage keys for workspace-scoped preferences (specific to the current project/workspace).
 */
const WORKSPACE_STORAGE_KEYS = {
  PROMPT_SETTINGS: 'aiContextMerger.promptSettings',
  GIT_DIFF_SETTINGS: 'aiContextMerger.gitDiffSettings',
  DIAGNOSTICS_SETTINGS: 'aiContextMerger.diagnosticsSettings',
  SELECTED_FILES: 'aiContextMerger.selectedFiles'
} as const;

/**
 * Webview View Provider for AI Context Merger controls panel.
 * Coordinates user interface lifecycle, service delegations, state persistence, and IPC message routing.
 */
export class ContextMergerControlsProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'aiContextMergerControlsView';
  private _view?: vscode.WebviewView;

  public filters: FilterSettings;
  public promptSettings: PromptSettings;
  public gitDiffSettings: GitDiffSettings;
  public diagnosticsSettings: DiagnosticsSettings;
  public outputFormat: OutputFormat;
  public tokenLimit: string;

  private cachedGitStatuses: Map<string, GitFileStatus> = new Map<string, GitFileStatus>();
  private isDisposed: boolean = false;
  private treeView?: vscode.TreeView<ContextTreeItem>;

  private readonly presetService: PresetService;
  private readonly selectionService: SelectionService;
  private readonly watcherService: WatcherService;

  constructor(
    private readonly context: vscode.ExtensionContext,
    public readonly selectedFiles: Set<string>,
    private readonly treeDataProvider: ContextTreeDataProvider
  ) {
    this.presetService = new PresetService(context);
    this.selectionService = new SelectionService(selectedFiles, treeDataProvider);

    // 1. Restore global settings (synchronized via Settings Sync)
    this.outputFormat = this.presetService.getOutputFormat();
    this.filters = this.presetService.getFilters();
    this.tokenLimit = this.presetService.getTokenLimit();

    // 2. Restore workspace-scoped settings (current project session)
    this.promptSettings = this.context.workspaceState.get<PromptSettings>(
      WORKSPACE_STORAGE_KEYS.PROMPT_SETTINGS,
      { enabled: false, text: '' }
    );

    this.gitDiffSettings = this.context.workspaceState.get<GitDiffSettings>(
      WORKSPACE_STORAGE_KEYS.GIT_DIFF_SETTINGS,
      { includeGitDiff: false, diffOnly: false, unlimitedDiff: false }
    );

    this.diagnosticsSettings = this.context.workspaceState.get<DiagnosticsSettings>(
      WORKSPACE_STORAGE_KEYS.DIAGNOSTICS_SETTINGS,
      { enabled: false, includeCompiler: true, includeLinter: true }
    );

    // 3. Restore persisted selected files if empty
    if (this.selectedFiles.size === 0) {
      const savedFiles = this.context.workspaceState.get<string[]>(WORKSPACE_STORAGE_KEYS.SELECTED_FILES, []);
      for (const f of savedFiles) {
        this.selectedFiles.add(f);
      }
    }

    this.watcherService = new WatcherService(
      this.selectedFiles,
      () => this.filters,
      () => this.forceRefresh(),
      () => this.updateStats()
    );
  }

  public bindTreeView(treeView: vscode.TreeView<ContextTreeItem>): void {
    this.treeView = treeView;
  }

  public reinitWatchers(): void {
    this.watcherService.reinitWatchers();
  }

  public triggerDebouncedRefresh(): void {
    this.watcherService.triggerDebouncedRefresh();
  }

  public async forceRefresh(): Promise<void> {
    if (this.isDisposed) {
      return;
    }
    this.treeDataProvider.folderTotalCountMap.clear();
    this.cachedGitStatuses = await GitService.getFileStatuses();
    this.treeDataProvider.setGitStatuses(this.cachedGitStatuses);
    await this.updateStats();
  }

  public getDiagnosticsSummary(): DiagnosticsSummary {
    return DiagnosticsService.getDiagnosticsSummary(this.selectedFiles);
  }

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

  private async persistSelectedFiles(): Promise<void> {
    await this.context.workspaceState.update(
      WORKSPACE_STORAGE_KEYS.SELECTED_FILES,
      Array.from(this.selectedFiles)
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

    webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      if (!message || typeof message.type !== 'string') {
        return;
      }

      switch (message.type) {
        case 'selectAll':
          await this.selectionService.selectAllFiles(this.filters);
          await this.persistSelectedFiles();
          await this.updateStats();
          vscode.window.showInformationMessage(`AI Context Merger: Выбрано файлов - ${this.selectedFiles.size}.`);
          break;

        case 'selectFound':
          await this.selectionService.selectFoundFiles(message.query, this.filters);
          await this.persistSelectedFiles();
          await this.updateStats();
          vscode.window.showInformationMessage(`AI Context Merger: Выбрано найденных файлов - ${this.selectedFiles.size}.`);
          break;

        case 'selectOpenTabs': {
          const addedFiles = await this.selectionService.selectOpenTabs(this.filters);
          await this.persistSelectedFiles();
          await this.updateStats();

          // Smoothly scroll and reveal the active / first selected open tab in the TreeView
          if (this.treeView && addedFiles.length > 0) {
            const activeUri = vscode.window.activeTextEditor?.document?.uri;
            const activeFsPath = activeUri && activeUri.scheme === 'file'
              ? PathUtils.normalizePath(activeUri.fsPath)
              : undefined;

            const targetPath = activeFsPath && addedFiles.includes(activeFsPath)
              ? activeFsPath
              : addedFiles[0];

            try {
              const targetItem = new ContextTreeItem(
                vscode.Uri.file(targetPath),
                false,
                true,
                vscode.TreeItemCollapsibleState.None
              );
              await this.treeView.reveal(targetItem, { select: true, focus: false, expand: true });
            } catch {
              // TreeView reveal gracefully falls back
            }
          }
          break;
        }

        case 'clearSelection':
          this.selectionService.clearSelection();
          await this.persistSelectedFiles();
          await this.updateStats();
          vscode.window.showInformationMessage('Выделение файлов снято.');
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
          await this.selectionService.selectModifiedGitFiles(this.filters);
          await this.persistSelectedFiles();
          await this.updateStats();
          break;

        case 'updateOutputFormat':
          if (message.format === 'markdown' || message.format === 'xml') {
            this.outputFormat = message.format;
            await this.presetService.saveOutputFormat(message.format);
            await this.updateStats();
          }
          break;

        case 'updateTokenLimit':
          if (typeof message.limit === 'string') {
            this.tokenLimit = message.limit;
            await this.presetService.saveTokenLimit(message.limit);
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

            await this.presetService.saveFilters(this.filters);

            const workspaceFolders = vscode.workspace.workspaceFolders;
            for (const filePath of Array.from(this.selectedFiles)) {
              const matchedFolder = workspaceFolders?.find((f) =>
                PathUtils.isSubpath(filePath, PathUtils.normalizePath(f.uri.fsPath))
              );
              const root = matchedFolder ? PathUtils.normalizePath(matchedFolder.uri.fsPath) : undefined;
              const isFiltered = await WorkspaceScanner.shouldFilterItem(filePath, false, this.filters, root);
              if (isFiltered) {
                this.selectedFiles.delete(filePath);
              }
            }

            await this.persistSelectedFiles();
            this.treeDataProvider.setFilters(this.filters);
            await this.updateStats();
          }
          break;

        case 'updatePrompt':
          this.promptSettings = {
            enabled: Boolean(message.enabled),
            text: typeof message.text === 'string' ? message.text : ''
          };
          // Persist prompt draft into project workspaceState immediately
          await this.context.workspaceState.update(
            WORKSPACE_STORAGE_KEYS.PROMPT_SETTINGS,
            this.promptSettings
          );
          await this.updateStats();
          break;

        case 'addCustomPreset':
          await this.handleAddCustomPreset(message.name, message.text);
          break;

        case 'editCustomPreset':
          await this.handleEditCustomPreset(message.id, message.name, message.text);
          break;

        case 'deleteCustomPreset':
          await this.handleDeleteCustomPreset(message.id);
          break;

        case 'updateGitDiff':
          if (message.settings && typeof message.settings === 'object') {
            this.gitDiffSettings = {
              includeGitDiff: Boolean(message.settings.includeGitDiff),
              diffOnly: Boolean(message.settings.diffOnly),
              unlimitedDiff: Boolean(message.settings.unlimitedDiff)
            };
            await this.context.workspaceState.update(
              WORKSPACE_STORAGE_KEYS.GIT_DIFF_SETTINGS,
              this.gitDiffSettings
            );
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
            await this.context.workspaceState.update(
              WORKSPACE_STORAGE_KEYS.DIAGNOSTICS_SETTINGS,
              this.diagnosticsSettings
            );
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

  private async handleAddCustomPreset(name: string, text: string): Promise<void> {
    if (typeof name !== 'string' || typeof text !== 'string') {
      return;
    }
    const trimmedName = name.trim();
    const trimmedText = text.trim();

    if (!trimmedName || !trimmedText) {
      vscode.window.showWarningMessage('Название и текст пресета не могут быть пустыми.');
      return;
    }
    if (trimmedName.length > 32) {
      vscode.window.showWarningMessage('Название пресета не должно превышать 32 символа.');
      return;
    }
    if (trimmedText.length > 10000) {
      vscode.window.showWarningMessage('Текст пресета слишком длинный (максимум 10 000 символов).');
      return;
    }

    const currentPresets = this.presetService.getCustomPresets();
    if (currentPresets.length >= 50) {
      vscode.window.showErrorMessage('Достигнут лимит сохраненных пресетов (максимум 50).');
      return;
    }

    const newPreset: CustomPreset = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: trimmedName,
      text: trimmedText
    };
    currentPresets.push(newPreset);
    await this.presetService.saveCustomPresets(currentPresets);

    this._view?.webview.postMessage({
      type: 'updateCustomPresets',
      customPresets: currentPresets
    });
    vscode.window.showInformationMessage(`Пресет "${newPreset.name}" сохранен!`);
  }

  private async handleEditCustomPreset(id: string, name: string, text: string): Promise<void> {
    if (typeof id !== 'string' || typeof name !== 'string' || typeof text !== 'string') {
      return;
    }
    const trimmedName = name.trim();
    const trimmedText = text.trim();

    if (!trimmedName || !trimmedText) {
      vscode.window.showWarningMessage('Название и текст пресета не могут быть пустыми.');
      return;
    }
    if (trimmedName.length > 32) {
      vscode.window.showWarningMessage('Название пресета не должно превышать 32 символа.');
      return;
    }
    if (trimmedText.length > 10000) {
      vscode.window.showWarningMessage('Текст пресета слишком длинный (максимум 10 000 символов).');
      return;
    }

    const currentPresets = this.presetService.getCustomPresets();
    const targetIndex = currentPresets.findIndex((p) => p.id === id);
    if (targetIndex !== -1) {
      currentPresets[targetIndex] = {
        ...currentPresets[targetIndex],
        name: trimmedName,
        text: trimmedText
      };
      await this.presetService.saveCustomPresets(currentPresets);

      this._view?.webview.postMessage({
        type: 'updateCustomPresets',
        customPresets: currentPresets
      });
      vscode.window.showInformationMessage(`Пресет "${trimmedName}" обновлен!`);
    } else {
      this._view?.webview.postMessage({
        type: 'updateCustomPresets',
        customPresets: currentPresets
      });
      vscode.window.showErrorMessage('Пресет не найден или уже был удален.');
    }
  }

  private async handleDeleteCustomPreset(id: string): Promise<void> {
    if (typeof id !== 'string') {
      return;
    }
    const currentPresets = this.presetService.getCustomPresets();
    const filteredPresets = currentPresets.filter((p) => p.id !== id);
    if (filteredPresets.length !== currentPresets.length) {
      await this.presetService.saveCustomPresets(filteredPresets);
      vscode.window.showInformationMessage('Пресет удалён.');
    }

    this._view?.webview.postMessage({
      type: 'updateCustomPresets',
      customPresets: filteredPresets
    });
  }

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

    const diagnosticsPayload = BundleService.getDiagnosticsPayload(this.selectedFiles, this.diagnosticsSettings);

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

    const diagnosticsPayload = BundleService.getDiagnosticsPayload(this.selectedFiles, this.diagnosticsSettings);

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
      customPresets: this.presetService.getCustomPresets(),
      outputFormat: this.outputFormat,
      tokenLimit: this.tokenLimit
    });
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

  public clearSelection(): void {
    this.selectionService.clearSelection();
    this.persistSelectedFiles();
    this.updateStats();
  }

  public async copyContextToClipboard(): Promise<void> {
    await BundleService.copyContextToClipboard(
      this.selectedFiles,
      this.outputFormat,
      this.promptSettings,
      this.gitDiffSettings,
      this.diagnosticsSettings,
      this.filters,
      this.cachedGitStatuses,
      () => {
        this._view?.webview.postMessage({ type: 'copySuccess' });
      }
    );
  }

  public async exportContextToFile(): Promise<void> {
    await BundleService.exportContextToFile(
      this.selectedFiles,
      this.outputFormat,
      this.promptSettings,
      this.gitDiffSettings,
      this.diagnosticsSettings,
      this.filters,
      this.cachedGitStatuses
    );
  }

  public async previewContext(): Promise<void> {
    await BundleService.previewContext(
      this.selectedFiles,
      this.outputFormat,
      this.promptSettings,
      this.gitDiffSettings,
      this.diagnosticsSettings,
      this.filters,
      this.cachedGitStatuses
    );
  }

  public dispose(): void {
    this.isDisposed = true;
    this.watcherService.dispose();
  }
}