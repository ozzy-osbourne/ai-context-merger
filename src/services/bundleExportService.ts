import * as vscode from 'vscode';
import * as path from 'path';
import {
  DiagnosticsSettings,
  FilterSettings,
  GitDiffSettings,
  GitFileStatus,
  OutputFormat,
  PromptSettings
} from '../types';
import { BundleService } from './bundleService';
import { ErrorUtils } from '../utils/errorUtils';

/**
 * Service responsible for exporting context payloads to the clipboard, file system, or editor preview.
 * Integrates VS Code progress reporting and notifications.
 */
export class BundleExportService {
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
   * @param includeProjectStructure - Flag indicating if project structure is included.
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
    includeProjectStructure: boolean = true,
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
            cachedGitStatuses,
            includeProjectStructure
          );

          await vscode.env.clipboard.writeText(payload);

          if (onSuccess) {
            onSuccess();
          }

          const formatLabel = outputFormat.toUpperCase();
          vscode.window.showInformationMessage(`Скопирован контекст (${formatLabel}): ${selectedFiles.size} файлов!`);

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
          vscode.window.showErrorMessage(`Ошибка копирования в буфер обмена: ${ErrorUtils.extractErrorMessage(err)}`);
        }
      }
    );
  }

  /**
   * Prompts user for a save location and exports formatted bundle to disk using VS Code Workspace FS.
   */
  public static async exportContextToFile(
    selectedFiles: Set<string>,
    outputFormat: OutputFormat,
    promptSettings: PromptSettings,
    gitDiffSettings: GitDiffSettings,
    diagnosticsSettings: DiagnosticsSettings,
    filters: FilterSettings,
    cachedGitStatuses: Map<string, GitFileStatus>,
    includeProjectStructure: boolean = true
  ): Promise<void> {
    if (selectedFiles.size === 0) {
      vscode.window.showWarningMessage('Не выбрано ни одного файла для экспорта.');
      return;
    }

    const isXml = outputFormat === 'xml';
    const defaultFilename = isXml ? 'project-context.xml' : 'project-context.md';
    const workspaceFolders = vscode.workspace.workspaceFolders;

    const defaultUri = workspaceFolders && workspaceFolders.length > 0
      ? vscode.Uri.joinPath(workspaceFolders[0].uri, defaultFilename)
      : vscode.Uri.file(defaultFilename);

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
        cachedGitStatuses,
        includeProjectStructure
      );
      // Use VS Code workspace FS API to support WSL, Remote SSH, and Virtual File Systems
      await vscode.workspace.fs.writeFile(uri, Buffer.from(payload, 'utf-8'));
      vscode.window.showInformationMessage(`Файл сохранен: ${path.basename(uri.fsPath)}`);
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Ошибка сохранения файла: ${ErrorUtils.extractErrorMessage(err)}`);
    }
  }

  /**
   * Opens assembled context in an editor split beside current view, reusing preview document tab to prevent tab spam.
   */
  public static async previewContext(
    selectedFiles: Set<string>,
    outputFormat: OutputFormat,
    promptSettings: PromptSettings,
    gitDiffSettings: GitDiffSettings,
    diagnosticsSettings: DiagnosticsSettings,
    filters: FilterSettings,
    cachedGitStatuses: Map<string, GitFileStatus>,
    includeProjectStructure: boolean = true
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
        cachedGitStatuses,
        includeProjectStructure
      );

      const isXml = outputFormat === 'xml';
      const fileName = `AI-Context-Preview.${isXml ? 'xml' : 'md'}`;
      const previewUri = vscode.Uri.parse(`untitled:${fileName}`);

      try {
        const doc = await vscode.workspace.openTextDocument(previewUri);
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(doc.getText().length)
        );
        edit.replace(previewUri, fullRange, payload);
        await vscode.workspace.applyEdit(edit);
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
      } catch {
        const doc = await vscode.workspace.openTextDocument({
          content: payload,
          language: isXml ? 'xml' : 'markdown'
        });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
      }
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Ошибка предварительного просмотра: ${ErrorUtils.extractErrorMessage(err)}`);
    }
  }
}