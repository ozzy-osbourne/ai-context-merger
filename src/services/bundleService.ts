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
import { GitService } from './gitService';
import { DiagnosticsService } from './diagnosticsService';
import { MarkdownBuilder } from './markdownBuilder';
import { XmlBuilder } from './xmlBuilder';

/**
 * Service responsible for assembling context bundles, clipboard copying, disk exporting, and previewing.
 */
export class BundleService {
  /**
   * Generates formatted compiler/linter diagnostics payload for selected files.
   *
   * @param selectedFiles - Set of selected absolute file paths.
   * @param settings - Diagnostics settings.
   * @returns Formatted diagnostics text or empty string if disabled/unselected.
   */
  public static getDiagnosticsPayload(
    selectedFiles: Set<string>,
    settings: DiagnosticsSettings
  ): string {
    if (
      !settings.enabled ||
      (!settings.includeCompiler && !settings.includeLinter) ||
      selectedFiles.size === 0
    ) {
      return '';
    }

    const items = DiagnosticsService.getDiagnosticsForFiles(
      selectedFiles,
      settings,
      vscode.workspace.workspaceFolders
    );

    return DiagnosticsService.formatDiagnosticsText(items);
  }

  /**
   * Assembles the complete context payload based on active settings and output format.
   */
  public static async buildContextPayload(
    selectedFiles: Set<string>,
    outputFormat: OutputFormat,
    promptSettings: PromptSettings,
    gitDiffSettings: GitDiffSettings,
    diagnosticsSettings: DiagnosticsSettings,
    filters: FilterSettings,
    cachedGitStatuses: Map<string, GitFileStatus>
  ): Promise<string> {
    let diffContent = '';
    if (gitDiffSettings.includeGitDiff) {
      diffContent = await GitService.getFilesDiff(
        Array.from(selectedFiles),
        gitDiffSettings.unlimitedDiff,
        filters
      );
    }

    const diagnosticsContent = this.getDiagnosticsPayload(selectedFiles, diagnosticsSettings);

    if (outputFormat === 'xml') {
      return await XmlBuilder.buildBundleXml(
        selectedFiles,
        promptSettings,
        gitDiffSettings,
        diffContent,
        cachedGitStatuses,
        diagnosticsSettings,
        diagnosticsContent
      );
    }

    return await MarkdownBuilder.buildBundleMarkdown(
      selectedFiles,
      promptSettings,
      gitDiffSettings,
      diffContent,
      cachedGitStatuses,
      diagnosticsSettings,
      diagnosticsContent
    );
  }

  /**
   * Assembles context bundle and writes it to the system clipboard.
   */
  public static async copyContextToClipboard(
    selectedFiles: Set<string>,
    outputFormat: OutputFormat,
    promptSettings: PromptSettings,
    gitDiffSettings: GitDiffSettings,
    diagnosticsSettings: DiagnosticsSettings,
    filters: FilterSettings,
    cachedGitStatuses: Map<string, GitFileStatus>,
    onSuccess?: () => void
  ): Promise<void> {
    if (selectedFiles.size === 0) {
      vscode.window.showWarningMessage('Не выбрано ни одного файла для копирования.');
      return;
    }

    try {
      const payload = await this.buildContextPayload(
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
    } catch (err: any) {
      vscode.window.showErrorMessage(`Ошибка копирования в буфер обмена: ${err?.message || err}`);
    }
  }

  /**
   * Prompts user for a save location and exports formatted bundle to file.
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
      const payload = await this.buildContextPayload(
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
    } catch (err: any) {
      vscode.window.showErrorMessage(`Ошибка сохранения файла: ${err?.message || err}`);
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
      const payload = await this.buildContextPayload(
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
    } catch (err: any) {
      vscode.window.showErrorMessage(`Ошибка предварительного просмотра: ${err?.message || err}`);
    }
  }
}