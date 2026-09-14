import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  DiagnosticsSettings,
  FilterSettings,
  GitDiffSettings,
  GitFileStatus,
  OutputFormat,
  PromptSettings
} from '../types';
import { BundleService } from './bundleService';

/**
 * Service responsible for exporting context payloads to the clipboard, file system, or editor preview.
 * Integrates VS Code progress reporting and notifications.
 */
export class BundleExportService {
  /**
   * Helper safely extracting a human-readable message from an unknown error.
   *
   * @param err - Unknown caught error.
   * @returns String error representation.
   */
  private static extractErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /**
   * Assembles context bundle with progress reporting and writes it to the system clipboard.
   * Notifies user if some files were replaced by error/binary placeholders.
   *
   * @param selectedFiles - Set of selected absolute file paths.
   * @param outputFormat - Current output format ('markdown' or 'xml').
   * @param promptSettings - AI instruction configuration.
   * @param gitDiffSettings - Git diff settings.
   * @param diagnosticsSettings - Compiler/linter diagnostics settings.
   * @param filters - Active file exclusion filters.
   * @param cachedGitStatuses - Map of file paths to Git statuses.
   * @param onSuccess - Optional callback triggered upon successful copy.
   * @param onError - Optional callback triggered if assembly or clipboard fails (used to reset Webview button).
   */
  public static async copyContextToClipboard(
    selectedFiles: Set<string>,
    outputFormat: OutputFormat,
    promptSettings: PromptSettings,
    gitDiffSettings: GitDiffSettings,
    diagnosticsSettings: DiagnosticsSettings,
    filters: FilterSettings,
    cachedGitStatuses: Map<string, GitFileStatus>,
    onSuccess?: () => void,
    onError?: () => void
  ): Promise<void> {
    if (selectedFiles.size === 0) {
      vscode.window.showWarningMessage('Не выбрано ни одного файла для копирования.');
      if (onError) {
        onError();
      }
      return;
    }

    // Display native non-blocking progress notification in bottom-right corner of VS Code
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `AI Context Merger: сборка контекста (${selectedFiles.size} файлов)...`,
        cancellable: false
      },
      async () => {
        try {
          const payload = await BundleService.buildContextPayload(
            selectedFiles,
            outputFormat,
            promptSettings,
            gitDiffSettings,
            diagnosticsSettings,
            filters,
            cachedGitStatuses
          );

          await vscode.env.clipboard.writeText(payload);

          if (onSuccess) {
            onSuccess();
          }

          const formatLabel = outputFormat.toUpperCase();
          vscode.window.showInformationMessage(`Скопирован контекст (${formatLabel}): ${selectedFiles.size} файлов!`);

          // Inspect payload for unreadable file placeholders to warn user
          const placeholderMatches = payload.match(/\[(Ошибка чтения|Файл превышает лимит|Файл с нераспознанной)/g);
          if (placeholderMatches && placeholderMatches.length > 0) {
            vscode.window.showWarningMessage(
              `Внимание: в ${placeholderMatches.length} файлах содержимое было заменено служебными заглушками.`
            );
          }
        } catch (err: unknown) {
          if (onError) {
            onError();
          }
          vscode.window.showErrorMessage(`Ошибка копирования в буфер обмена: ${this.extractErrorMessage(err)}`);
        }
      }
    );
  }

  /**
   * Prompts user for a save location and exports formatted bundle to disk.
   */
  public static async exportContextToFile(
    selectedFiles: Set<string>,
    outputFormat: OutputFormat,
    promptSettings: PromptSettings,
    gitDiffSettings: GitDiffSettings,
    diagnosticsSettings: DiagnosticsSettings,
    filters: FilterSettings,
    cachedGitStatuses: Map<string, GitFileStatus>
  ): Promise<void> {
    if (selectedFiles.size === 0) {
      vscode.window.showWarningMessage('Не выбрано ни одного файла для экспорта.');
      return;
    }

    const isXml = outputFormat === 'xml';
    const defaultUri = vscode.Uri.file(isXml ? 'project-context.xml' : 'project-context.md');
    const dialogFilters: Record<string, string[]> = isXml
      ? { XML: ['xml'], 'All Files': ['*'] }
      : { Markdown: ['md'], 'All Files': ['*'] };

    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: dialogFilters
    });

    if (!uri) {
      return;
    }

    try {
      const payload = await BundleService.buildContextPayload(
        selectedFiles,
        outputFormat,
        promptSettings,
        gitDiffSettings,
        diagnosticsSettings,
        filters,
        cachedGitStatuses
      );
      await fs.promises.writeFile(uri.fsPath, payload, 'utf-8');
      vscode.window.showInformationMessage(`Файл сохранен: ${path.basename(uri.fsPath)}`);
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Ошибка сохранения файла: ${this.extractErrorMessage(err)}`);
    }
  }

  /**
   * Opens assembled context in an editor split beside current view with matching syntax highlighting.
   */
  public static async previewContext(
    selectedFiles: Set<string>,
    outputFormat: OutputFormat,
    promptSettings: PromptSettings,
    gitDiffSettings: GitDiffSettings,
    diagnosticsSettings: DiagnosticsSettings,
    filters: FilterSettings,
    cachedGitStatuses: Map<string, GitFileStatus>
  ): Promise<void> {
    if (selectedFiles.size === 0) {
      vscode.window.showWarningMessage('Сначала выберите файлы для предпросмотра.');
      return;
    }

    try {
      const payload = await BundleService.buildContextPayload(
        selectedFiles,
        outputFormat,
        promptSettings,
        gitDiffSettings,
        diagnosticsSettings,
        filters,
        cachedGitStatuses
      );
      const doc = await vscode.workspace.openTextDocument({
        content: payload,
        language: outputFormat === 'xml' ? 'xml' : 'markdown'
      });
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Ошибка предварительного просмотра: ${this.extractErrorMessage(err)}`);
    }
  }
}