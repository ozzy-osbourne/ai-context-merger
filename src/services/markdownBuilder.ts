import * as vscode from 'vscode';
import * as path from 'path';
import { LANGUAGE_MAP } from '../constants';
import { DiagnosticsSettings, GitDiffSettings, GitFileStatus, PromptSettings } from '../types';
import { ContextUtils } from '../utils/contextUtils';

/**
 * Service responsible for bundling selected source files into structured Markdown.
 */
export class MarkdownBuilder {
  /**
   * Resolves the Markdown syntax highlighting tag based on the file extension.
   *
   * @param filePath - Path to the file.
   * @returns Language identifier for code fences.
   */
  public static getLanguageTag(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return LANGUAGE_MAP[ext] || 'text';
  }

  /**
   * Computes a dynamic Markdown code fence sequence to prevent delimiter collisions.
   *
   * @param content - Text content to be wrapped in fences.
   * @returns Dynamic backtick fence string (e.g., "```" or "````").
   */
  private static getFenceSequence(content: string): string {
    const matches = content.match(/`{3,}/g);
    if (!matches) {
      return '```';
    }
    let maxLen = 2;
    for (const match of matches) {
      if (match.length > maxLen) {
        maxLen = match.length;
      }
    }
    return '`'.repeat(maxLen + 1);
  }

  /**
   * Builds the complete Markdown bundle containing instruction, ASCII tree, diffs, diagnostics, and file sections.
   *
   * @param selectedFiles - Set of absolute file paths to include.
   * @param promptSettings - Optional AI instruction configuration.
   * @param gitDiffSettings - Optional Git diff inclusion settings.
   * @param gitDiffContent - Raw Git diff payload string.
   * @param gitStatuses - Optional map containing current Git file statuses.
   * @param diagnosticsSettings - Optional compiler/linter diagnostics configuration.
   * @param diagnosticsContent - Formatted diagnostics string.
   * @returns Formatted Markdown string.
   */
  public static async buildBundleMarkdown(
    selectedFiles: Set<string>,
    promptSettings?: PromptSettings,
    gitDiffSettings?: GitDiffSettings,
    gitDiffContent?: string,
    gitStatuses?: Map<string, GitFileStatus>,
    diagnosticsSettings?: DiagnosticsSettings,
    diagnosticsContent?: string
  ): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const sortedFiles = Array.from(selectedFiles).sort();
    const relativePaths = sortedFiles.map((file) => ContextUtils.getRelativePath(file, workspaceFolders));

    const outputBlocks: string[] = [];

    if (promptSettings && promptSettings.enabled) {
      const trimmedPrompt = promptSettings.text.trim();
      if (trimmedPrompt.length > 0) {
        outputBlocks.push(`## Instruction:\n${trimmedPrompt}`);
      }
    }

    const asciiTree = ContextUtils.generateAsciiTree(relativePaths, gitStatuses, sortedFiles);
    outputBlocks.push(asciiTree);

    // Append Git Diff section if enabled
    if (gitDiffSettings?.includeGitDiff && gitDiffContent && gitDiffContent.trim().length > 0) {
      const fence = this.getFenceSequence(gitDiffContent);
      outputBlocks.push(`## Git Diff:\n${fence}diff\n${gitDiffContent.trim()}\n${fence}`);
    }

    if (diagnosticsSettings?.enabled && diagnosticsContent && diagnosticsContent.trim().length > 0) {
      outputBlocks.push(`## Problems & Diagnostics:\n${diagnosticsContent.trim()}`);
    }

    if (!gitDiffSettings?.diffOnly) {
      for (let i = 0; i < sortedFiles.length; i++) {
        const filePath = sortedFiles[i];
        const relativePath = relativePaths[i];
        const fileName = path.basename(filePath);
        const gitStatus = gitStatuses?.get(filePath);

        if (gitStatus === 'deleted') {
          outputBlocks.push(
            `## File path: ${relativePath}\n## File name: ${fileName}\n## File content:\n[Файл удален в Git]`
          );
          continue;
        }

        const readResult = await ContextUtils.safeReadFile(filePath);
        let contentBlock = '';

        if (readResult.placeholder) {
          contentBlock = readResult.placeholder;
        } else if (readResult.text !== undefined) {
          const langTag = this.getLanguageTag(filePath);
          const fence = this.getFenceSequence(readResult.text);
          contentBlock = `${fence}${langTag}\n${readResult.text}\n${fence}`;
        }

        const fileSection = `## File path: ${relativePath}\n## File name: ${fileName}\n## File content:\n${contentBlock}`;
        outputBlocks.push(fileSection);
      }
    }

    return outputBlocks.join('\n\n---\n\n');
  }
}