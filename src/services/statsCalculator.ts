import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  ContextStats,
  DiagnosticsSettings,
  GitDiffSettings,
  GitFileStatus,
  OutputFormat,
  PromptSettings
} from '../types';
import { MAX_CONTEXT_TOKENS, BINARY_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '../constants';
import { AsciiTreeService } from './asciiTreeService';
import { FileReaderService } from './fileReaderService';
import { MarkdownBuilder } from './markdownBuilder';
import { PathUtils } from '../utils/pathUtils';

/**
 * Service calculating character budgets, token estimates, and usage percentages.
 * Provides real-time metrics for LLM context limits across Markdown and XML payloads.
 */
export class StatsCalculator {
  /**
   * Computes token metrics for the selected file context bundle based on output format, diffs, and diagnostics.
   *
   * @param selectedFiles - Set of selected absolute file paths.
   * @param promptSettings - Optional AI instruction configuration.
   * @param gitDiffSettings - Optional Git diff inclusion settings.
   * @param gitDiffLength - Character length of the active Git diff payload.
   * @param gitStatuses - Optional map containing current Git file statuses.
   * @param outputFormat - Current output format ('markdown' or 'xml').
   * @param diagnosticsSettings - Optional compiler/linter diagnostics configuration.
   * @param diagnosticsLength - Character length of formatted diagnostics.
   * @param tokenLimit - User-configured token limit threshold (e.g. 32000, 200000, 1000000).
   * @returns Aggregated statistics: file count, estimated tokens, and budget usage percentage.
   */
  public static async calculateStats(
    selectedFiles: Set<string>,
    promptSettings?: PromptSettings,
    gitDiffSettings?: GitDiffSettings,
    gitDiffLength: number = 0,
    gitStatuses?: Map<string, GitFileStatus>,
    outputFormat: OutputFormat = 'markdown',
    diagnosticsSettings?: DiagnosticsSettings,
    diagnosticsLength: number = 0,
    tokenLimit?: number | string
  ): Promise<ContextStats> {
    // Return zeros immediately when no files are selected
    if (selectedFiles.size === 0) {
      return { count: 0, tokens: 0, percentage: 0 };
    }

    let totalChars = 0;
    const sortedFiles = Array.from(selectedFiles).sort();
    const workspaceFolders = vscode.workspace.workspaceFolders;

    const relativePaths = sortedFiles.map((filePath) =>
      PathUtils.getRelativePath(filePath, workspaceFolders)
    );
    const asciiTree = AsciiTreeService.generateAsciiTree(relativePaths, gitStatuses, sortedFiles);

    // =========================================================================
    // Format Branch A: XML Payload Character Estimation
    // =========================================================================
    if (outputFormat === 'xml') {
      // Base XML declaration and root tags: <?xml version="1.0" encoding="UTF-8"?>\n<context>\n\n</context>
      totalChars += '<?xml version="1.0" encoding="UTF-8"?>\n<context>\n\n</context>'.length;

      // 1. Task Instructions
      if (promptSettings && promptSettings.enabled) {
        const trimmedPrompt = promptSettings.text.trim();
        if (trimmedPrompt.length > 0) {
          totalChars += `  <instructions>\n<![CDATA[\n${trimmedPrompt}\n]]>\n  </instructions>\n\n`.length;
        }
      }

      // 2. ASCII Project Structure
      totalChars += `  <project_structure>\n<![CDATA[\n${asciiTree}\n]]>\n  </project_structure>\n\n`.length;

      // 3. Git Diff section
      if (gitDiffSettings?.includeGitDiff && gitDiffLength > 0) {
        totalChars += `  <git_diff>\n<![CDATA[\n\n]]>\n  </git_diff>\n\n`.length + gitDiffLength;
      }

      // 4. Diagnostics section
      if (diagnosticsSettings?.enabled && diagnosticsLength > 0) {
        totalChars += `  <diagnostics>\n<![CDATA[\n\n]]>\n  </diagnostics>\n\n`.length + diagnosticsLength;
      }

      // 5. Documents container and file entries
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
              bodyLength = FileReaderService.getSizeExceededPlaceholder(stat.size).length;
            } else if (BINARY_EXTENSIONS.has(ext)) {
              bodyLength = FileReaderService.getBinaryPlaceholder(ext, stat.size).length;
            } else {
              bodyLength = stat.size;
            }
          } catch {
            bodyLength = 30;
          }

          return docHeader.length + bodyLength + docFooter.length;
        });

        const fileLengths = await Promise.all(fileStatPromises);
        for (const len of fileLengths) {
          totalChars += len;
        }
      }
    } else {
      // =========================================================================
      // Format Branch B: Markdown Payload Character Estimation
      // =========================================================================

      // 1. Task Instructions
      if (promptSettings && promptSettings.enabled) {
        const trimmedPrompt = promptSettings.text.trim();
        if (trimmedPrompt.length > 0) {
          totalChars += `## Instruction:\n${trimmedPrompt}`.length + 6; // Delimiter: \n\n---\n\n
        }
      }

      // 2. ASCII Project Structure
      totalChars += asciiTree.length + 6;

      // 3. Git Diff section
      if (gitDiffSettings?.includeGitDiff && gitDiffLength > 0) {
        totalChars += `## Git Diff:\n\`\`\`diff\n\n\`\`\``.length + gitDiffLength + 6;
      }

      // 4. Diagnostics section
      if (diagnosticsSettings?.enabled && diagnosticsLength > 0) {
        totalChars += `## Problems & Diagnostics:\n`.length + diagnosticsLength + 6;
      }

      // 5. File sections
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
              bodyLength = FileReaderService.getSizeExceededPlaceholder(stat.size).length;
            } else if (BINARY_EXTENSIONS.has(ext)) {
              bodyLength = FileReaderService.getBinaryPlaceholder(ext, stat.size).length;
            } else {
              const langTag = MarkdownBuilder.getLanguageTag(filePath);
              bodyLength = stat.size + langTag.length + 8;
            }
          } catch {
            bodyLength = 40;
          }

          return headerLength + bodyLength + 6;
        });

        const fileLengths = await Promise.all(fileStatPromises);
        for (const len of fileLengths) {
          totalChars += len;
        }
      }
    }

    // Parse active max budget threshold
    const maxBudget = tokenLimit
      ? (typeof tokenLimit === 'string' ? parseInt(tokenLimit, 10) || MAX_CONTEXT_TOKENS : tokenLimit)
      : MAX_CONTEXT_TOKENS;

    // Standard LLM heuristic: ~4 characters per token
    const estimatedTokens = Math.ceil(totalChars / 4);
    const percentage = Math.min(100, Math.round((estimatedTokens / maxBudget) * 100));

    return {
      count: selectedFiles.size,
      tokens: estimatedTokens,
      percentage
    };
  }
}