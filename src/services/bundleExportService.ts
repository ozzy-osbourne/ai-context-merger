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
import { I18nService } from '../i18n';

/**
 * Service responsible for exporting context payloads to the clipboard, file system, or editor preview.
 * Integrates VS Code progress reporting and localized notifications.
 */
export class BundleExportService {
  /**
   * Assembles context bundle with progress reporting and writes it to the system clipboard.
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
   * @param onError - Optional callback triggered if assembly or clipboard fails.
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
    const t = I18nService.getTranslations();

    if (selectedFiles.size === 0) {
      vscode.window.showWarningMessage(t.messages.noFilesSelectedCopy);
      if (onError) {
        onError();
      }
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t.messages.assemblingContext(selectedFiles.size),
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
          vscode.window.showInformationMessage(t.messages.contextCopied(formatLabel, selectedFiles.size));

          const placeholderMatches = payload.match(/\[(Read error|File exceeds size limit|Binary file|Binary or compiled file|File with unrecognized)/g);
          if (placeholderMatches && placeholderMatches.length > 0) {
            vscode.window.showWarningMessage(t.messages.placeholdersWarning(placeholderMatches.length));
          }
        } catch (err: unknown) {
          if (onError) {
            onError();
          }
          vscode.window.showErrorMessage(`${t.messages.copyError}: ${ErrorUtils.extractErrorMessage(err)}`);
        }
      }
    );
  }

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
    const t = I18nService.getTranslations();

    if (selectedFiles.size === 0) {
      vscode.window.showWarningMessage(t.messages.noFilesSelectedExport);
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
      await vscode.workspace.fs.writeFile(uri, Buffer.from(payload, 'utf-8'));
      vscode.window.showInformationMessage(t.messages.fileSaved(path.basename(uri.fsPath)));
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`${t.messages.fileSaveError}: ${ErrorUtils.extractErrorMessage(err)}`);
    }
  }

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
    const t = I18nService.getTranslations();

    if (selectedFiles.size === 0) {
      vscode.window.showWarningMessage(t.messages.noFilesSelectedPreview);
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
      vscode.window.showErrorMessage(`${t.messages.previewError}: ${ErrorUtils.extractErrorMessage(err)}`);
    }
  }
}