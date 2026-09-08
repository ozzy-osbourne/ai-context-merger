import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BINARY_EXTENSIONS, LANGUAGE_MAP, MAX_FILE_SIZE_BYTES } from '../constants';
import { PromptSettings } from '../types';
import { PathUtils } from '../utils/pathUtils';

interface AsciiTreeNode {
  name: string;
  isDirectory: boolean;
  children: Map<string, AsciiTreeNode>;
}

/**
 * Service responsible for bundling selected source files into structured Markdown.
 */
export class MarkdownBuilder {
  /**
   * Magic byte headers of popular binary formats.
   */
  private static readonly BINARY_MAGIC_HEADERS: readonly number[][] = [
    // PDF (%PDF)
    [0x25, 0x50, 0x44, 0x46],
    // ZIP / JAR / DOCX / APK (PK\x03\x04)
    [0x50, 0x4b, 0x03, 0x04],
    // PNG (\x89PNG\r\n\x1a\n)
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    // JPEG (\xFF\xD8\xFF)
    [0xff, 0xd8, 0xff],
    // GIF87a & GIF89a (GIF8)
    [0x47, 0x49, 0x46, 0x38],
    // ELF Executable (\x7FELF)
    [0x7f, 0x45, 0x4c, 0x46],
    // Windows PE / DOS Executable (MZ)
    [0x4d, 0x5a],
    // WebAssembly (\0asm)
    [0x00, 0x61, 0x73, 0x6d],
    // Java Class File (CAFEBABE)
    [0xca, 0xfe, 0xba, 0xbe],
    // 7-Zip (7z\xBC\xAF\x27\x1C)
    [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
    // GZIP (\x1F\x8B)
    [0x1f, 0x8b],
    // RAR (Rar!\x1A\x07)
    [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07],
    // SQLite 3 format
    [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00]
  ];

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
   * Computes workspace-relative POSIX path with Multi-Root workspace support.
   *
   * @param filePath - Absolute path to the file.
   * @param workspaceFolders - Active workspace folders list.
   * @returns Relative path suitable for Markdown headers.
   */
  public static getRelativePath(
    filePath: string,
    workspaceFolders?: readonly vscode.WorkspaceFolder[]
  ): string {
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return path.basename(filePath);
    }

    const normFilePath = PathUtils.normalizePath(filePath);

    for (const folder of workspaceFolders) {
      const folderPath = PathUtils.normalizePath(folder.uri.fsPath);

      if (PathUtils.isSubpath(normFilePath, folderPath)) {
        const rel = PathUtils.toPosixRelative(folderPath, normFilePath);
        return workspaceFolders.length > 1 ? `${folder.name}/${rel}` : rel;
      }
    }

    return path.basename(filePath);
  }

  /**
   * Checks if buffer begins with known binary magic byte sequences.
   *
   * @param buffer - File content buffer.
   * @returns `true` if buffer matches any binary header signature.
   */
  private static hasBinaryMagicBytes(buffer: Buffer): boolean {
    if (buffer.length === 0) {
      return false;
    }

    for (const signature of this.BINARY_MAGIC_HEADERS) {
      if (buffer.length >= signature.length) {
        let matches = true;
        for (let i = 0; i < signature.length; i++) {
          if (buffer[i] !== signature[i]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Scans buffer for binary signatures and null bytes.
   *
   * @param buffer - File content buffer.
   * @returns `true` if the buffer contains binary data.
   */
  private static isBinaryBuffer(buffer: Buffer): boolean {
    if (this.hasBinaryMagicBytes(buffer)) {
      return true;
    }

    const checkLength = Math.min(buffer.length, 8000);
    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Safely reads and validates file content with binary and encoding heuristics.
   *
   * @param filePath - Target file path.
   * @returns Object containing either decoded text or an explanatory placeholder.
   */
  public static async safeReadFile(
    filePath: string
  ): Promise<{ text?: string; placeholder?: string }> {
    const ext = path.extname(filePath).toLowerCase();

    let stat: fs.Stats | undefined;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return {
        placeholder: '```text\n<Ошибка чтения: файл не найден или заблокирован>\n```'
      };
    }

    const sizeKb = (stat.size / 1024).toFixed(1);
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);

    if (stat.size > MAX_FILE_SIZE_BYTES) {
      return {
        placeholder: `[Файл превышает лимит размера 5 MB (${sizeMb} MB) — содержимое пропущено во избежание переполнения контекста ИИ]`
      };
    }

    if (BINARY_EXTENSIONS.has(ext)) {
      return {
        placeholder: `[Бинарный файл: ${ext.replace('.', '').toUpperCase()} (${sizeKb} KB) — содержимое пропущено для сохранения контекста]`
      };
    }

    let buffer: Buffer;
    try {
      buffer = await fs.promises.readFile(filePath);
    } catch (err) {
      return { placeholder: `\`\`\`text\n<Ошибка чтения файла: ${err}>\n\`\`\`` };
    }

    if (this.isBinaryBuffer(buffer)) {
      return {
        placeholder: `[Бинарный или скомпилированный файл: ${ext ? ext.replace('.', '').toUpperCase() : 'BINARY'} (${sizeKb} KB) — содержимое пропущено для сохранения контекста]`
      };
    }

    try {
      const strictDecoder = new TextDecoder('utf-8', { fatal: true });
      const text = strictDecoder.decode(buffer).trimEnd();
      return { text };
    } catch {
      const lenientDecoder = new TextDecoder('utf-8', { fatal: false });
      const text = lenientDecoder.decode(buffer).trimEnd();
      const replacementCount = (text.match(/\uFFFD/g) || []).length;

      if (replacementCount > 0 && replacementCount / Math.max(text.length, 1) > 0.05) {
        return {
          placeholder: `[Файл с нераспознанной или повреждённой кодировкой (не UTF-8, ${sizeKb} KB) — пропущен для предотвращения искажения контекста ИИ]`
        };
      }

      return { text };
    }
  }

  /**
   * Constructs a hierarchical tree model from POSIX-compliant relative paths.
   *
   * @param relativePaths - Array of workspace relative paths.
   * @returns Root node of the ASCII tree hierarchy.
   */
  private static buildAsciiTreeHierarchy(relativePaths: string[]): AsciiTreeNode {
    const root: AsciiTreeNode = {
      name: '',
      isDirectory: true,
      children: new Map()
    };

    for (const relPath of relativePaths) {
      const segments = relPath.split('/').filter(Boolean);
      let currentNode = root;

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const isDirectory = i < segments.length - 1;

        if (!currentNode.children.has(segment)) {
          currentNode.children.set(segment, {
            name: segment,
            isDirectory,
            children: new Map()
          });
        }
        currentNode = currentNode.children.get(segment)!;
      }
    }

    return root;
  }

  /**
   * Recursively renders ASCII branch lines for a hierarchy node.
   *
   * @param node - Current tree node.
   * @param prefix - Current line prefix indentation.
   * @returns Array of formatted ASCII lines.
   */
  private static renderAsciiTreeLines(node: AsciiTreeNode, prefix: string = ''): string[] {
    const lines: string[] = [];
    const entries = Array.from(node.children.values()).sort((a, b) => {
      if (a.isDirectory === b.isDirectory) {
        return a.name.localeCompare(b.name);
      }
      return a.isDirectory ? -1 : 1;
    });

    for (let i = 0; i < entries.length; i++) {
      const child = entries[i];
      const isLast = i === entries.length - 1;
      const branchSymbol = isLast ? '└── ' : '├── ';
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');

      const displayName = child.isDirectory ? `${child.name}/` : child.name;
      lines.push(`${prefix}${branchSymbol}${displayName}`);

      if (child.isDirectory && child.children.size > 0) {
        lines.push(...this.renderAsciiTreeLines(child, nextPrefix));
      }
    }

    return lines;
  }

  /**
   * Generates a plain-text ASCII representation of the project hierarchy.
   *
   * @param relativePaths - Array of POSIX-formatted relative file paths.
   * @returns Formatted ASCII tree string.
   */
  public static generateAsciiTree(relativePaths: string[]): string {
    const rootNode = this.buildAsciiTreeHierarchy(relativePaths);
    const lines = this.renderAsciiTreeLines(rootNode);
    return `Project Structure:\n${lines.join('\n')}`;
  }

  /**
   * Builds the complete Markdown bundle containing instruction, ASCII tree, and file sections.
   *
   * @param selectedFiles - Set of absolute file paths to include.
   * @param promptSettings - Optional AI instruction configuration.
   * @returns Formatted Markdown string.
   */
  public static async buildBundleMarkdown(
    selectedFiles: Set<string>,
    promptSettings?: PromptSettings
  ): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const sortedFiles = Array.from(selectedFiles).sort();
    const relativePaths = sortedFiles.map((file) => this.getRelativePath(file, workspaceFolders));

    const outputBlocks: string[] = [];

    if (promptSettings && promptSettings.enabled) {
      const trimmedPrompt = promptSettings.text.trim();
      if (trimmedPrompt.length > 0) {
        outputBlocks.push(`## Instruction:\n${trimmedPrompt}`);
      }
    }

    const asciiTree = this.generateAsciiTree(relativePaths);
    outputBlocks.push(asciiTree);

    for (let i = 0; i < sortedFiles.length; i++) {
      const filePath = sortedFiles[i];
      const relativePath = relativePaths[i];
      const fileName = path.basename(filePath);

      const readResult = await this.safeReadFile(filePath);
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

    return outputBlocks.join('\n\n---\n\n');
  }
}