import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ContextStats, GitDiffSettings, GitFileStatus, OutputFormat, PromptSettings } from '../types';
import { MAX_CONTEXT_TOKENS, BINARY_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '../constants';
import { ContextUtils } from '../utils/contextUtils';
import { MarkdownBuilder } from './markdownBuilder';

/**
 * Service calculating character budgets, token estimates, and usage percentages.
 */
export class StatsCalculator {
  /**
   * Computes token metrics for the selected file context bundle based on chosen output format.
   *
   * @param selectedFiles - Set of selected absolute file paths.
   * @param promptSettings - Optional AI instruction settings.
   * @param gitDiffSettings - Optional Git diff configuration settings.
   * @param gitDiffLength - Character length of the active Git diff payload.
   * @param gitStatuses - Optional map containing current Git file statuses.
   * @param outputFormat - Current output format ('markdown' or 'xml').
   * @returns Aggregated statistics for the selection.
   */
  public static async calculateStats(
    selectedFiles: Set<string>,
    promptSettings?: PromptSettings,
    gitDiffSettings?: GitDiffSettings,
    gitDiffLength: number = 0,
    gitStatuses?: Map<string, GitFileStatus>,
    outputFormat: OutputFormat = 'markdown'
  ): Promise<ContextStats> {
    if (selectedFiles.size === 0) {
      return { count: 0, tokens: 0, percentage: 0 };
    }

    let totalChars = 0;
    const sortedFiles = Array.from(selectedFiles).sort();
    const workspaceFolders = vscode.workspace.workspaceFolders;

    const relativePaths = sortedFiles.map((filePath) =>
      ContextUtils.getRelativePath(filePath, workspaceFolders)
    );
    const asciiTree = ContextUtils.generateAsciiTree(relativePaths, gitStatuses, sortedFiles);

    if (outputFormat === 'xml') {
      // Root context tags: <context>\n\n</context>
      totalChars += 22;

      // 1. Instruction
      if (promptSettings && promptSettings.enabled) {
        const trimmedPrompt = promptSettings.text.trim();
        if (trimmedPrompt.length > 0) {
          totalChars += `  <instructions>\n<![CDATA[\n${trimmedPrompt}\n]]>\n  </instructions>\n\n`.length;
        }
      }

      // 2. Structure
      totalChars += `  <project_structure>\n${asciiTree}\n  </project_structure>\n\n`.length;

      // 3. Git Diff
      if (gitDiffSettings?.includeGitDiff && gitDiffLength > 0) {
        totalChars += `  <git_diff>\n<![CDATA[\n\n]]>\n  </git_diff>\n\n`.length + gitDiffLength;
      }

      // 4. Documents
      if (!gitDiffSettings?.diffOnly) {
        totalChars += '  <documents>\n  </documents>\n\n'.length;

        const fileStatPromises = sortedFiles.map(async (filePath, index) => {
          const relPath = relativePaths[index];
          const fileName = path.basename(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const gitStatus = gitStatuses?.get(filePath);

          if (gitStatus === 'deleted') {
            return (
              `    <document index="${index + 1}">\n` +
              `      <source>${relPath}</source>\n` +
              `      <file_name>${fileName}</file_name>\n` +
              `      <git_status>deleted</git_status>\n` +
              `      <document_content>[Файл удален в Git]</document_content>\n` +
              `    </document>\n`
            ).length;
          }

          let docHeader = `    <document index="${index + 1}">\n      <source>${relPath}</source>\n      <file_name>${fileName}</file_name>\n`;
          if (gitStatus) {
            docHeader += `      <git_status>${gitStatus}</git_status>\n`;
          }
          docHeader += '      <document_content><![CDATA[';
          const docFooter = ']]></document_content>\n    </document>\n';

          let bodyLength = 0;
          try {
            const stat = await fs.promises.stat(filePath);
            if (stat.isDirectory()) {
              bodyLength = 0;
            } else if (stat.size > MAX_FILE_SIZE_BYTES) {
              bodyLength = ContextUtils.getSizeExceededPlaceholder(stat.size).length;
            } else if (BINARY_EXTENSIONS.has(ext)) {
              bodyLength = ContextUtils.getBinaryPlaceholder(ext, stat.size).length;
            } else {
              bodyLength = stat.size;
            }
          } catch {
            bodyLength = 30; // Inaccessible placeholder
          }

          return docHeader.length + bodyLength + docFooter.length;
        });

        const fileLengths = await Promise.all(fileStatPromises);
        for (const len of fileLengths) {
          totalChars += len;
        }
      }
    } else {
      // 1. AI instruction characters (Markdown)
      if (promptSettings && promptSettings.enabled) {
        const trimmedPrompt = promptSettings.text.trim();
        if (trimmedPrompt.length > 0) {
          totalChars += `## Instruction:\n${trimmedPrompt}`.length;
          totalChars += 6; // Delimiter: \n\n---\n\n
        }
      }

      // 2. ASCII structure characters with Git status decorations
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
              bodyLength = ContextUtils.getSizeExceededPlaceholder(stat.size).length;
            } else if (BINARY_EXTENSIONS.has(ext)) {
              bodyLength = ContextUtils.getBinaryPlaceholder(ext, stat.size).length;
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