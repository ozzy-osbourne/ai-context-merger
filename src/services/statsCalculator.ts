import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ContextStats, PromptSettings } from '../types';
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
   * @returns Aggregated statistics for the selection.
   */
  public static async calculateStats(
    selectedFiles: Set<string>,
    promptSettings?: PromptSettings
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

    // 2. ASCII structure characters
    const relativePaths = sortedFiles.map((filePath) =>
      MarkdownBuilder.getRelativePath(filePath, workspaceFolders)
    );

    const asciiTree = MarkdownBuilder.generateAsciiTree(relativePaths);
    totalChars += asciiTree.length;
    totalChars += 6;

    // 3. File content lengths
    const fileStatPromises = sortedFiles.map(async (filePath, index) => {
      const relPath = relativePaths[index];
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const isBinary = BINARY_EXTENSIONS.has(ext);

      const headerLength = `## File path: ${relPath}\n## File name: ${fileName}\n## File content:\n`.length;
      let bodyLength = 0;

      if (isBinary) {
        try {
          const stat = await fs.promises.stat(filePath);
          const sizeKb = (stat.size / 1024).toFixed(1);
          const placeholder = `[Бинарный файл: ${ext.replace('.', '').toUpperCase()} (${sizeKb} KB) — содержимое пропущено для сохранения контекста]`;
          bodyLength = placeholder.length;
        } catch {
          bodyLength = `[Бинарный файл: ${ext} — пропущен]`.length;
        }
      } else {
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.size > MAX_FILE_SIZE_BYTES) {
            const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
            const placeholder = `[Файл превышает лимит размера 5 MB (${sizeMb} MB) — содержимое пропущено во избежание переполнения контекста ИИ]`;
            bodyLength = placeholder.length;
          } else {
            const langTag = MarkdownBuilder.getLanguageTag(filePath);
            bodyLength = stat.size + langTag.length + 8;
          }
        } catch {
          bodyLength = 50;
        }
      }

      return headerLength + bodyLength + 6;
    });

    const fileLengths = await Promise.all(fileStatPromises);
    for (const len of fileLengths) {
      totalChars += len;
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