import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ContextStats, GitDiffSettings, GitFileStatus, PromptSettings } from '../types';
import { MAX_CONTEXT_TOKENS, BINARY_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '../constants';
import { MarkdownBuilder } from './markdownBuilder';

/**
 * Service calculating character budgets, token estimates, and usage percentages.
 */
export class StatsCalculator {
  /**
   * Computes token metrics for the selected file context bundle.
   *
   * @param selectedFiles - Set of selected absolute file paths.
   * @param promptSettings - Optional AI instruction settings.
   * @param gitDiffSettings - Optional Git diff configuration settings.
   * @param gitDiffLength - Character length of the active Git diff payload.
   * @param gitStatuses - Optional map containing current Git file statuses.
   * @returns Aggregated statistics for the selection.
   */
  public static async calculateStats(
    selectedFiles: Set<string>,
    promptSettings?: PromptSettings,
    gitDiffSettings?: GitDiffSettings,
    gitDiffLength: number = 0,
    gitStatuses?: Map<string, GitFileStatus>
  ): Promise<ContextStats> {
    if (selectedFiles.size === 0) {
      return { count: 0, tokens: 0, percentage: 0 };
    }

    let totalChars = 0;
    const sortedFiles = Array.from(selectedFiles).sort();
    const workspaceFolders = vscode.workspace.workspaceFolders;

    // 1. AI instruction characters
    if (promptSettings && promptSettings.enabled) {
      const trimmedPrompt = promptSettings.text.trim();
      if (trimmedPrompt.length > 0) {
        totalChars += `## Instruction:\n${trimmedPrompt}`.length;
        totalChars += 6; // Delimiter: \n\n---\n\n
      }
    }

    // 2. ASCII structure characters with Git status decorations
    const relativePaths = sortedFiles.map((filePath) =>
      MarkdownBuilder.getRelativePath(filePath, workspaceFolders)
    );

    const asciiTree = MarkdownBuilder.generateAsciiTree(relativePaths, gitStatuses, sortedFiles);
    totalChars += asciiTree.length;
    totalChars += 6;

    // 3. Git Diff section characters
    if (gitDiffSettings?.includeGitDiff && gitDiffLength > 0) {
      totalChars += `## Git Diff:\n\`\`\`diff\n\n\`\`\``.length + gitDiffLength + 6;
    }

    // 4. File content lengths (omitted if Diff Only mode is active)
    if (!gitDiffSettings?.diffOnly) {
      const fileStatPromises = sortedFiles.map(async (filePath, index) => {
        const relPath = relativePaths[index];
        const fileName = path.basename(filePath);
        const ext = path.extname(filePath).toLowerCase();

        const headerLength = `## File path: ${relPath}\n## File name: ${fileName}\n## File content:\n`.length;
        let bodyLength = 0;

        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.isDirectory()) {
            bodyLength = 0;
          } else if (stat.size > MAX_FILE_SIZE_BYTES) {
            bodyLength = MarkdownBuilder.getSizeExceededPlaceholder(stat.size).length;
          } else if (BINARY_EXTENSIONS.has(ext)) {
            bodyLength = MarkdownBuilder.getBinaryPlaceholder(ext, stat.size).length;
          } else {
            const langTag = MarkdownBuilder.getLanguageTag(filePath);
            bodyLength = stat.size + langTag.length + 8;
          }
        } catch {
          bodyLength = 40; // Deleted or inaccessible file placeholder length
        }

        return headerLength + bodyLength + 6;
      });

      const fileLengths = await Promise.all(fileStatPromises);
      for (const len of fileLengths) {
        totalChars += len;
      }
    }

    const estimatedTokens = Math.ceil(totalChars / 4);
    const percentage = Math.min(100, Math.round((estimatedTokens / MAX_CONTEXT_TOKENS) * 100));

    return {
      count: selectedFiles.size,
      tokens: estimatedTokens,
      percentage
    };
  }
}