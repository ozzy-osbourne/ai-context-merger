import * as vscode from 'vscode';
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
import { BundleExportService } from './bundleExportService';

/**
 * Service responsible for assembling context bundles into structured Markdown or XML text payloads.
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
   *
   * @param selectedFiles - Set of selected absolute file paths.
   * @param outputFormat - Selected output format ('markdown' or 'xml').
   * @param promptSettings - AI instruction configuration.
   * @param gitDiffSettings - Git diff settings.
   * @param diagnosticsSettings - Compiler/linter diagnostics settings.
   * @param filters - Active file exclusion filters.
   * @param cachedGitStatuses - Map of file paths to Git statuses.
   * @returns Assembled payload string ready for LLM consumption.
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
   * Delegates context clipboard copying to BundleExportService.
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
    return BundleExportService.copyContextToClipboard(
      selectedFiles,
      outputFormat,
      promptSettings,
      gitDiffSettings,
      diagnosticsSettings,
      filters,
      cachedGitStatuses,
      onSuccess
    );
  }

  /**
   * Delegates context disk export to BundleExportService.
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
    return BundleExportService.exportContextToFile(
      selectedFiles,
      outputFormat,
      promptSettings,
      gitDiffSettings,
      diagnosticsSettings,
      filters,
      cachedGitStatuses
    );
  }

  /**
   * Delegates context preview editor opening to BundleExportService.
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
    return BundleExportService.previewContext(
      selectedFiles,
      outputFormat,
      promptSettings,
      gitDiffSettings,
      diagnosticsSettings,
      filters,
      cachedGitStatuses
    );
  }
}