import * as vscode from 'vscode';
import * as path from 'path';
import { DiagnosticsSettings, GitDiffSettings, GitFileStatus, PromptSettings } from '../types';
import { AsciiTreeService } from './asciiTreeService';
import { FileReaderService } from './fileReaderService';
import { XmlUtils } from '../utils/xmlUtils';
import { PathUtils } from '../utils/pathUtils';

/**
 * Service responsible for bundling selected source files and metadata into structured XML for Claude and other LLMs.
 */
export class XmlBuilder {
  /**
   * Builds the complete XML context bundle containing instruction, ASCII tree, diffs, diagnostics, and indexed documents.
   *
   * @param selectedFiles - Set of absolute file paths to include.
   * @param promptSettings - Optional AI instruction configuration.
   * @param gitDiffSettings - Optional Git diff inclusion settings.
   * @param gitDiffContent - Raw Git diff payload string.
   * @param gitStatuses - Optional map containing current Git file statuses.
   * @param diagnosticsSettings - Optional diagnostics configuration.
   * @param diagnosticsContent - Formatted diagnostics string.
   * @returns Formatted XML document string.
   */
  public static async buildBundleXml(
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
    const relativePaths = sortedFiles.map((file) => PathUtils.getRelativePath(file, workspaceFolders));

    const xmlSections: string[] = ['<context>'];

    // 1. Optional Instructions block
    if (promptSettings && promptSettings.enabled) {
      const trimmedPrompt = promptSettings.text.trim();
      if (trimmedPrompt.length > 0) {
        const sanitizedPrompt = XmlUtils.sanitizeXmlChars(trimmedPrompt);
        const safePrompt = XmlUtils.escapeCdata(sanitizedPrompt);
        xmlSections.push(`  <instructions>\n<![CDATA[\n${safePrompt}\n]]>\n  </instructions>`);
      }
    }

    // 2. Project structure tree (isolated in CDATA to protect paths containing XML special chars)
    const asciiTree = AsciiTreeService.generateAsciiTree(relativePaths, gitStatuses, sortedFiles);
    const sanitizedAsciiTree = XmlUtils.sanitizeXmlChars(asciiTree);
    const safeAsciiTree = XmlUtils.escapeCdata(sanitizedAsciiTree);
    xmlSections.push(`  <project_structure>\n<![CDATA[\n${safeAsciiTree}\n]]>\n  </project_structure>`);

    // 3. Optional Git Diff section
    if (gitDiffSettings?.includeGitDiff && gitDiffContent && gitDiffContent.trim().length > 0) {
      const sanitizedDiff = XmlUtils.sanitizeXmlChars(gitDiffContent.trim());
      const safeDiff = XmlUtils.escapeCdata(sanitizedDiff);
      xmlSections.push(`  <git_diff>\n<![CDATA[\n${safeDiff}\n]]>\n  </git_diff>`);
    }

    // 4. Optional Diagnostics section
    if (diagnosticsSettings?.enabled && diagnosticsContent && diagnosticsContent.trim().length > 0) {
      const sanitizedDiag = XmlUtils.sanitizeXmlChars(diagnosticsContent.trim());
      const safeDiag = XmlUtils.escapeCdata(sanitizedDiag);
      xmlSections.push(`  <diagnostics>\n<![CDATA[\n${safeDiag}\n]]>\n  </diagnostics>`);
    }

    // 5. Documents container (skipped in Diff Only mode)
    if (!gitDiffSettings?.diffOnly && sortedFiles.length > 0) {
      xmlSections.push('  <documents>');

      for (let i = 0; i < sortedFiles.length; i++) {
        const filePath = sortedFiles[i];
        const relativePath = relativePaths[i];
        const fileName = path.basename(filePath);
        const gitStatus = gitStatuses?.get(filePath);
        const docIndex = i + 1;

        const safeRelPath = XmlUtils.escapeXml(relativePath);
        const safeFileName = XmlUtils.escapeXml(fileName);

        const docLines: string[] = [
          `    <document index="${docIndex}">`,
          `      <source>${safeRelPath}</source>`,
          `      <file_name>${safeFileName}</file_name>`
        ];

        if (gitStatus) {
          docLines.push(`      <git_status>${XmlUtils.escapeXml(gitStatus)}</git_status>`);
        }

        if (gitStatus === 'deleted') {
          docLines.push('      <document_content>[Файл удален в Git]</document_content>');
        } else {
          const readResult = await FileReaderService.safeReadFile(filePath);
          if (readResult.placeholder) {
            const safePlaceholder = XmlUtils.escapeXml(readResult.placeholder);
            docLines.push(`      <document_content>${safePlaceholder}</document_content>`);
          } else if (readResult.text !== undefined) {
            const sanitizedText = XmlUtils.sanitizeXmlChars(readResult.text);
            const safeContent = XmlUtils.escapeCdata(sanitizedText);
            docLines.push(`      <document_content><![CDATA[${safeContent}]]></document_content>`);
          }
        }

        docLines.push('    </document>');
        xmlSections.push(docLines.join('\n'));
      }

      xmlSections.push('  </documents>');
    }

    xmlSections.push('</context>');
    return xmlSections.join('\n\n');
  }
}