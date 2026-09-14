import * as path from 'path';
import * as vscode from 'vscode';
import { DiagnosticsSettings, GitDiffSettings, GitFileStatus, PromptSettings } from '../types';
import { AsciiTreeService } from './asciiTreeService';
import { FileReaderService } from './fileReaderService';
import { XmlUtils } from '../utils/xmlUtils';
import { PathUtils } from '../utils/pathUtils';

/**
 * Service responsible for assembling selected source files, instructions, Git diffs,
 * diagnostics, and hierarchical project structure into a valid, standard XML document.
 * Adheres to Anthropic's XML prompting guidelines for Claude and standard XML parsers.
 */
export class XmlBuilder {
  /**
   * Builds the complete XML context bundle containing instruction, ASCII tree, diffs, diagnostics, and indexed documents.
   *
   * @param selectedFiles - Set of absolute file paths to include in the context.
   * @param promptSettings - Optional AI instruction configuration (system / task prompt).
   * @param gitDiffSettings - Optional Git diff inclusion settings.
   * @param gitDiffContent - Raw Git diff unified text payload.
   * @param gitStatuses - Optional map containing current Git statuses for visual decorations.
   * @param diagnosticsSettings - Optional compiler/linter diagnostics configuration.
   * @param diagnosticsContent - Pre-formatted diagnostics error and warning lines.
   * @returns Fully formatted and valid XML document string with declaration.
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

    // Initialize document with standard XML 1.0 prolog and root <context> tag
    const xmlSections: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<context>'
    ];

    // Section 1: Optional AI Task Instructions block (wrapped in CDATA to preserve formatting)
    if (promptSettings && promptSettings.enabled) {
      const trimmedPrompt = promptSettings.text.trim();
      if (trimmedPrompt.length > 0) {
        const sanitizedPrompt = XmlUtils.sanitizeXmlChars(trimmedPrompt);
        const safePrompt = XmlUtils.escapeCdata(sanitizedPrompt);
        xmlSections.push(`  <instructions>\n<![CDATA[\n${safePrompt}\n]]>\n  </instructions>`);
      }
    }

    // Section 2: ASCII Project Structure Tree (isolated in CDATA to protect branch symbols and brackets)
    const asciiTree = AsciiTreeService.generateAsciiTree(relativePaths, gitStatuses, sortedFiles);
    const sanitizedAsciiTree = XmlUtils.sanitizeXmlChars(asciiTree);
    const safeAsciiTree = XmlUtils.escapeCdata(sanitizedAsciiTree);
    xmlSections.push(`  <project_structure>\n<![CDATA[\n${safeAsciiTree}\n]]>\n  </project_structure>`);

    // Section 3: Optional Git Diff block (isolated in CDATA)
    if (gitDiffSettings?.includeGitDiff && gitDiffContent && gitDiffContent.trim().length > 0) {
      const sanitizedDiff = XmlUtils.sanitizeXmlChars(gitDiffContent.trim());
      const safeDiff = XmlUtils.escapeCdata(sanitizedDiff);
      xmlSections.push(`  <git_diff>\n<![CDATA[\n${safeDiff}\n]]>\n  </git_diff>`);
    }

    // Section 4: Optional Compiler and Linter Diagnostics
    if (diagnosticsSettings?.enabled && diagnosticsContent && diagnosticsContent.trim().length > 0) {
      const sanitizedDiag = XmlUtils.sanitizeXmlChars(diagnosticsContent.trim());
      const safeDiag = XmlUtils.escapeCdata(sanitizedDiag);
      xmlSections.push(`  <diagnostics>\n<![CDATA[\n${safeDiag}\n]]>\n  </diagnostics>`);
    }

    // Section 5: Documents Container (skipped entirely if "Diff Only" mode is active)
    if (!gitDiffSettings?.diffOnly && sortedFiles.length > 0) {
      xmlSections.push('  <documents>');

      for (let i = 0; i < sortedFiles.length; i++) {
        const filePath = sortedFiles[i];
        const relativePath = relativePaths[i];
        const fileName = path.basename(filePath);
        const gitStatus = gitStatuses?.get(filePath);
        const docIndex = i + 1;

        // Escape metadata fields for XML attribute/text safety
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

        // Handle deleted git files vs active files
        if (gitStatus === 'deleted') {
          docLines.push('      <document_content>[Файл удален в Git]</document_content>');
        } else {
          const readResult = await FileReaderService.safeReadFile(filePath);
          if (readResult.placeholder) {
            // Service placeholder (binary, oversized, unreadable) escaped as plain XML text
            const safePlaceholder = XmlUtils.escapeXml(readResult.placeholder);
            docLines.push(`      <document_content>${safePlaceholder}</document_content>`);
          } else if (readResult.text !== undefined) {
            // Source code wrapped safely inside CDATA
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

    // Close root <context> tag
    xmlSections.push('</context>');
    return xmlSections.join('\n\n');
  }
}