import * as vscode from 'vscode';
import { WebviewToExtensionMessage } from '../types';
import { ContextMergerControlsProvider } from '../sidebarProvider';
import { SelectionService } from './selectionService';
import { ContextTreeDataProvider, ContextTreeItem } from './contextTreeDataProvider';
import { PresetService } from './presetService';
import { WorkspaceScanner } from './workspaceScanner';
import { GitService } from './gitService';
import { PathUtils } from '../utils/pathUtils';

/**
 * Message dispatcher routing incoming webview events to corresponding domain services.
 */
export class WebviewMessageHandler {
  constructor(
    private readonly provider: ContextMergerControlsProvider,
    private readonly selectionService: SelectionService,
    private readonly presetService: PresetService,
    private readonly treeDataProvider: ContextTreeDataProvider,
    private readonly selectedFiles: Set<string>
  ) {}

  /**
   * Dispatches incoming message payloads from the Webview frontend.
   *
   * @param message - Typed message payload received via IPC.
   */
  public async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    if (!message || typeof message.type !== 'string') {
      return;
    }

    switch (message.type) {
      case 'selectAll': {
        await this.selectionService.selectAllFiles(this.provider.filters);
        await this.provider.persistSelectedFiles();
        await this.provider.updateStats();
        if (this.selectedFiles.size === 0) {
          vscode.window.showWarningMessage('Не найдено доступных файлов для выбора (или они скрыты активными фильтрами).');
        } else {
          vscode.window.showInformationMessage(`AI Context Merger: Выбрано файлов - ${this.selectedFiles.size}.`);
        }
        break;
      }

      case 'selectFound': {
        const countBefore = this.selectedFiles.size;
        await this.selectionService.selectFoundFiles(message.query, this.provider.filters);
        await this.provider.persistSelectedFiles();
        await this.provider.updateStats();

        const countAfter = this.selectedFiles.size;
        const newlyAdded = countAfter - countBefore;

        if (countAfter === 0) {
          vscode.window.showWarningMessage(`По запросу "${message.query}" не найдено подходящих файлов.`);
        } else {
          vscode.window.showInformationMessage(`AI Context Merger: Выбрано найденных файлов - ${newlyAdded} (всего: ${countAfter}).`);
        }
        break;
      }

      case 'selectOpenTabs': {
        const addedFiles = await this.selectionService.selectOpenTabs(this.provider.filters);
        await this.provider.persistSelectedFiles();
        await this.provider.updateStats();

        if (this.provider.treeView && addedFiles.length > 0) {
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
            await this.provider.treeView.reveal(targetItem, { select: true, focus: false, expand: true });
          } catch {
            // TreeView reveal gracefully falls back
          }
        }
        break;
      }

      case 'clearSelection':
        this.selectionService.clearSelection();
        await this.provider.persistSelectedFiles();
        await this.provider.updateStats();
        vscode.window.showInformationMessage('Выделение файлов снято.');
        break;

      case 'expandAll':
        this.treeDataProvider.expandLevel();
        break;

      case 'collapseAll':
        this.treeDataProvider.collapseAll();
        break;

      case 'copyContext':
        await this.provider.copyContextToClipboard();
        break;

      case 'exportFile':
        await this.provider.exportContextToFile();
        break;

      case 'previewContext':
        await this.provider.previewContext();
        break;

      case 'selectModified':
        await this.selectionService.selectModifiedGitFiles(this.provider.filters);
        await this.provider.persistSelectedFiles();
        await this.provider.updateStats();
        break;

      case 'updateOutputFormat':
        if (message.format === 'markdown' || message.format === 'xml') {
          this.provider.outputFormat = message.format;
          await this.presetService.saveOutputFormat(message.format);
          await this.provider.updateStats();
        }
        break;

      case 'updateTokenLimit':
        if (typeof message.limit === 'string') {
          this.provider.tokenLimit = message.limit;
          await this.presetService.saveTokenLimit(message.limit);
        }
        break;

      case 'updateFilters':
        if (message.filters && typeof message.filters === 'object') {
          this.provider.filters = {
            hideGitIgnored: Boolean(message.filters.hideGitIgnored),
            hideSecrets: Boolean(message.filters.hideSecrets),
            hideMinified: Boolean(message.filters.hideMinified),
            hideLockFiles: Boolean(message.filters.hideLockFiles),
            hideBinaryFiles: Boolean(message.filters.hideBinaryFiles)
          };

          await this.presetService.saveFilters(this.provider.filters);

          const gitStatuses = await GitService.getFileStatuses();
          let removedByFilter = 0;

          for (const filePath of Array.from(this.selectedFiles)) {
            const root = PathUtils.getWorkspaceRoot(filePath);
            const isDeleted = gitStatuses.get(filePath) === 'deleted';
            const isFiltered = await WorkspaceScanner.shouldFilterItem(
              filePath,
              false,
              this.provider.filters,
              root,
              isDeleted
            );

            if (isFiltered) {
              this.selectedFiles.delete(filePath);
              removedByFilter++;
            }
          }

          await this.provider.persistSelectedFiles();
          this.treeDataProvider.setFilters(this.provider.filters);
          await this.provider.updateStats();

          if (removedByFilter > 0) {
            vscode.window.showInformationMessage(
              `AI Context Merger: ${removedByFilter} файлов исключено из выборки в соответствии с новыми фильтрами.`
            );
          }
        }
        break;

      case 'updatePrompt':
        this.provider.promptSettings = {
          enabled: Boolean(message.enabled),
          text: typeof message.text === 'string' ? message.text : ''
        };
        await this.provider.context.workspaceState.update(
          ContextMergerControlsProvider.WORKSPACE_STORAGE_KEYS.PROMPT_SETTINGS,
          this.provider.promptSettings
        );
        await this.provider.updateStats();
        break;

      case 'addCustomPreset': {
        const res = await this.presetService.addCustomPreset(message.name, message.text);
        if (res.warning) {
          vscode.window.showWarningMessage(res.warning);
        } else if (res.error) {
          vscode.window.showErrorMessage(res.error);
        } else if (res.success && res.preset && res.updatedPresets) {
          this.provider.postWebviewMessage({
            type: 'updateCustomPresets',
            customPresets: res.updatedPresets
          });
          this.provider.postWebviewMessage({ type: 'presetOperationSuccess' });
          vscode.window.showInformationMessage(`Пресет "${res.preset.name}" сохранен!`);
        }
        break;
      }

      case 'editCustomPreset': {
        const res = await this.presetService.editCustomPreset(message.id, message.name, message.text);
        if (res.warning) {
          vscode.window.showWarningMessage(res.warning);
        } else if (res.error) {
          if (res.updatedPresets) {
            this.provider.postWebviewMessage({
              type: 'updateCustomPresets',
              customPresets: res.updatedPresets
            });
          }
          vscode.window.showErrorMessage(res.error);
        } else if (res.success && res.preset && res.updatedPresets) {
          this.provider.postWebviewMessage({
            type: 'updateCustomPresets',
            customPresets: res.updatedPresets
          });
          this.provider.postWebviewMessage({ type: 'presetOperationSuccess' });
          vscode.window.showInformationMessage(`Пресет "${res.preset.name}" обновлен!`);
        }
        break;
      }

      case 'deleteCustomPreset': {
        const res = await this.presetService.deleteCustomPreset(message.id);
        if (res.updatedPresets) {
          this.provider.postWebviewMessage({
            type: 'updateCustomPresets',
            customPresets: res.updatedPresets
          });
        }
        vscode.window.showInformationMessage('Пресет удалён.');
        break;
      }

      case 'updateProjectStructure':
        this.provider.includeProjectStructure = Boolean(message.includeProjectStructure);
        await this.provider.context.workspaceState.update(
          ContextMergerControlsProvider.WORKSPACE_STORAGE_KEYS.PROJECT_STRUCTURE,
          this.provider.includeProjectStructure
        );
        await this.provider.updateStats();
        break;

      case 'updateGitDiff':
        if (message.settings && typeof message.settings === 'object') {
          this.provider.gitDiffSettings = {
            includeGitDiff: Boolean(message.settings.includeGitDiff),
            diffOnly: Boolean(message.settings.diffOnly),
            unlimitedDiff: Boolean(message.settings.unlimitedDiff)
          };
          await this.provider.context.workspaceState.update(
            ContextMergerControlsProvider.WORKSPACE_STORAGE_KEYS.GIT_DIFF_SETTINGS,
            this.provider.gitDiffSettings
          );
          await this.provider.updateStats();
        }
        break;

      case 'updateDiagnostics':
        if (message.settings && typeof message.settings === 'object') {
          this.provider.diagnosticsSettings = {
            enabled: Boolean(message.settings.enabled),
            includeCompiler: Boolean(message.settings.includeCompiler),
            includeLinter: Boolean(message.settings.includeLinter)
          };
          await this.provider.context.workspaceState.update(
            ContextMergerControlsProvider.WORKSPACE_STORAGE_KEYS.DIAGNOSTICS_SETTINGS,
            this.provider.diagnosticsSettings
          );
          await this.provider.updateStats();
        }
        break;

      case 'updateSearch':
        await this.handleSearchInput(message.query);
        break;

      case 'refresh':
        await this.provider.forceRefresh();
        vscode.window.showInformationMessage('Данные рабочей области обновлены (выборка сохранена).');
        break;

      case 'requestInitialData':
        await this.provider.sendInitialData();
        break;
    }
  }

  /**
   * Processes search query updates and notifies the TreeView and Webview.
   *
   * @param query - Input search string.
   */
  private async handleSearchInput(query: string): Promise<void> {
    const trimmed = (query || '').trim();
    await this.treeDataProvider.setSearchQuery(trimmed);

    if (!trimmed) {
      if (this.provider.treeView) {
        this.provider.treeView.message = undefined;
      }
      this.provider.postWebviewMessage({ type: 'searchResults', count: 0, query: '' });
      return;
    }

    const count = this.treeDataProvider.getMatchingFilesCount();

    if (this.provider.treeView) {
      this.provider.treeView.message = count > 0 ? `Найдено файлов: ${count}` : undefined;
    }

    this.provider.postWebviewMessage({
      type: 'searchResults',
      count,
      query: trimmed
    });
  }
}