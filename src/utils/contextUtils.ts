import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BINARY_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '../constants';
import { DiagnosticsSettings, GitFileStatus } from '../types';
import { PathUtils } from '../utils/pathUtils';

interface AsciiTreeNode {
  name: string;
  isDirectory: boolean;
  status?: string;
  children: Map<string, AsciiTreeNode>;
}

/**
 * Result descriptor for safe file reading operations.
 */
export interface SafeFileReadResult {
  text?: string;
  placeholder?: string;
}

/**
 * Normalized diagnostic issue descriptor for context generation.
 */
export interface DiagnosticItem {
  filePath: string;
  relativePath: string;
  line: number;
  character: number;
  category: 'compiler' | 'linter';
  severity: 'error' | 'warning';
  source?: string;
  code?: string | number;
  message: string;
}

/**
 * Shared utility service providing file content extraction, placeholder generation, ASCII tree modeling, and diagnostics formatting.
 */
export class ContextUtils {
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
   * Known linter tool signature identifiers.
   */
  private static readonly LINTER_SOURCE_REGEX =
    /^(eslint|biome|stylelint|ruff|flake8|clippy|rubocop|pylint|prettier|cspell|shellcheck|standard|standardjs|markdownlint|yamllint|tflint|sonarlint|deno-lint)$/i;

  /**
   * Known compiler and type checker tool signature identifiers.
   */
  private static readonly COMPILER_SOURCE_REGEX =
    /^(ts|typescript|tsc|rustc|clang|gcc|cpp|csharp|dotnet|javac|pylance|pyright|mypy|go|vbs|swift|dart|php)$/i;
    
  /**
   * Generates a placeholder string for files exceeding the maximum allowable size limit.
   *
   * @param sizeInBytes - File size in bytes.
   * @returns Formatted placeholder message.
   */
  public static getSizeExceededPlaceholder(sizeInBytes: number): string {
    const sizeMb = (sizeInBytes / (1024 * 1024)).toFixed(2);
    return `[Файл превышает лимит размера 5 MB (${sizeMb} MB) - содержимое пропущено во избежание переполнения контекста ИИ]`;
  }

  /**
   * Generates a placeholder string for binary and compiled media files.
   *
   * @param ext - File extension.
   * @param sizeInBytes - File size in bytes.
   * @param isCompiled - Flag indicating if detected via buffer inspection.
   * @returns Formatted placeholder message.
   */
  public static getBinaryPlaceholder(ext: string, sizeInBytes: number, isCompiled: boolean = false): string {
    const sizeKb = (sizeInBytes / 1024).toFixed(1);
    const label = ext ? ext.replace('.', '').toUpperCase() : 'BINARY';
    const prefix = isCompiled ? 'Бинарный или скомпилированный файл' : 'Бинарный файл';
    return `[${prefix}: ${label} (${sizeKb} KB) - содержимое пропущено для сохранения контекста]`;
  }

  /**
   * Generates a placeholder string for files with unrecognized or corrupted encoding.
   *
   * @param sizeInBytes - File size in bytes.
   * @returns Formatted placeholder message.
   */
  public static getInvalidEncodingPlaceholder(sizeInBytes: number): string {
    const sizeKb = (sizeInBytes / 1024).toFixed(1);
    return `[Файл с нераспознанной или повреждённой кодировкой (не UTF-8, ${sizeKb} KB) - пропущен для предотвращения искажения контекста ИИ]`;
  }

  /**
   * Computes workspace-relative POSIX path with Multi-Root workspace support.
   *
   * @param filePath - Absolute path to the file.
   * @param workspaceFolders - Active workspace folders list.
   * @returns Relative path suitable for headers and references.
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
  public static async safeReadFile(filePath: string): Promise<SafeFileReadResult> {
    const ext = path.extname(filePath).toLowerCase();

    let stat: fs.Stats | undefined;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return {
        placeholder: '[Ошибка чтения: файл не найден или недоступен]'
      };
    }

    if (stat.size > MAX_FILE_SIZE_BYTES) {
      return {
        placeholder: this.getSizeExceededPlaceholder(stat.size)
      };
    }

    if (BINARY_EXTENSIONS.has(ext)) {
      return {
        placeholder: this.getBinaryPlaceholder(ext, stat.size)
      };
    }

    let buffer: Buffer;
    try {
      buffer = await fs.promises.readFile(filePath);
    } catch (err) {
      return { placeholder: `[Ошибка чтения файла: ${err}]` };
    }

    if (this.isBinaryBuffer(buffer)) {
      return {
        placeholder: this.getBinaryPlaceholder(ext, stat.size, true)
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
          placeholder: this.getInvalidEncodingPlaceholder(stat.size)
        };
      }

      return { text };
    }
  }

  /**
   * Safely escapes string content for inclusion inside an XML CDATA block by splitting any closing tokens.
   *
   * @param content - Raw text content.
   * @returns Escaped text safe for CDATA wrapping.
   */
  public static escapeCdata(content: string): string {
    return content.replace(/\]\]>/g, ']]]]><![CDATA[>');
  }

  /**
   * Escapes reserved XML characters in attribute and element text contents.
   *
   * @param unsafe - Raw text string.
   * @returns XML-safe escaped string.
   */
    public static escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }

  /**
   * Removes control characters that are strictly illegal in XML 1.0 documents.
   *
   * @param text - Raw input string.
   * @returns Sanitized string safe for XML parsing.
   */
  public static sanitizeXmlChars(text: string): string {
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
   * Distinguishes whether a diagnostic originates from a compiler/type-checker or a code linter.
   *
   * @param diag - VS Code diagnostic issue.
   * @returns 'compiler' or 'linter' category.
   */
  public static classifyDiagnostic(diag: vscode.Diagnostic): 'compiler' | 'linter' {
    const source = diag.source?.trim() || '';

    if (this.LINTER_SOURCE_REGEX.test(source)) {
      return 'linter';
    }
    if (this.COMPILER_SOURCE_REGEX.test(source)) {
      return 'compiler';
    }
    if (/lint/i.test(source)) {
      return 'linter';
    }

    return diag.severity === vscode.DiagnosticSeverity.Error ? 'compiler' : 'linter';
  }

  /**
   * Collects compiler and linter diagnostics for selected files matching active suboption filters.
   *
   * @param selectedFiles - Set of selected absolute file paths.
   * @param settings - Diagnostics settings specifying compiler and linter inclusion.
   * @param workspaceFolders - Active workspace folders list.
   * @returns Array of sorted diagnostic items.
   */
  public static getDiagnosticsForFiles(
    selectedFiles: Set<string>,
    settings: DiagnosticsSettings,
    workspaceFolders?: readonly vscode.WorkspaceFolder[]
  ): DiagnosticItem[] {
    if (!settings.enabled || (!settings.includeCompiler && !settings.includeLinter)) {
      return [];
    }

    const items: DiagnosticItem[] = [];

    for (const filePath of selectedFiles) {
      try {
        const uri = vscode.Uri.file(filePath);
        const diags = vscode.languages.getDiagnostics(uri);
        const relativePath = this.getRelativePath(filePath, workspaceFolders);

        for (const diag of diags) {
          const category = this.classifyDiagnostic(diag);

          if (category === 'compiler' && !settings.includeCompiler) {
            continue;
          }
          if (category === 'linter' && !settings.includeLinter) {
            continue;
          }

          const severity: 'error' | 'warning' =
            diag.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning';

          const rawCode =
            diag.code && typeof diag.code === 'object' ? diag.code.value : (diag.code ?? undefined);

          items.push({
            filePath,
            relativePath,
            line: diag.range.start.line + 1,
            character: diag.range.start.character + 1,
            category,
            severity,
            source: diag.source,
            code: rawCode,
            message: diag.message
          });
        }
      } catch {
        // Skip unresolvable file URI
      }
    }

    return items.sort((a, b) => {
      const fileCmp = a.relativePath.localeCompare(b.relativePath);
      if (fileCmp !== 0) {
        return fileCmp;
      }
      if (a.line !== b.line) {
        return a.line - b.line;
      }
      return a.character - b.character;
    });
  }

  /**
   * Formats diagnostic items into a unified textual list for Markdown and XML payloads.
   * Normalizes multiline compiler messages with indented paragraphs to preserve Markdown list structure.
   *
   * @param items - List of collected diagnostic issues.
   * @returns Formatted diagnostics text string.
   */
  public static formatDiagnosticsText(items: DiagnosticItem[]): string {
    if (items.length === 0) {
      return '';
    }

    return items
      .map((item) => {
        const cat = item.category === 'compiler' ? 'Compiler' : 'Linter';
        const sev = item.severity === 'error' ? 'Error' : 'Warning';
        const src = item.source ? `[${item.source}] ` : '';
        const code = item.code !== undefined ? ` (${item.code})` : '';
        const formattedMessage = item.message.replace(/\r?\n/g, '\n    ');
        return `- ${item.relativePath}:${item.line}:${item.character} - ${src}${cat} ${sev}: ${formattedMessage}${code}`;
      })
      .join('\n');
  }

  private static buildAsciiTreeHierarchy(
    items: Array<{ relativePath: string; status?: string }>
  ): AsciiTreeNode {
    const root: AsciiTreeNode = {
      name: '',
      isDirectory: true,
      children: new Map()
    };

    for (const item of items) {
      const segments = item.relativePath.split('/').filter(Boolean);
      let currentNode = root;

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const isDirectory = i < segments.length - 1;

        if (!currentNode.children.has(segment)) {
          currentNode.children.set(segment, {
            name: segment,
            isDirectory,
            status: !isDirectory ? item.status : undefined,
            children: new Map()
          });
        }
        currentNode = currentNode.children.get(segment)!;
      }
    }

    return root;
  }

  /**
   * Recursively renders ASCII branch lines for a hierarchy node including Git markers.
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

      const badge = child.status ? ` [${child.status}]` : '';
      const displayName = child.isDirectory ? `${child.name}/` : `${child.name}${badge}`;
      lines.push(`${prefix}${branchSymbol}${displayName}`);

      if (child.isDirectory && child.children.size > 0) {
        lines.push(...this.renderAsciiTreeLines(child, nextPrefix));
      }
    }

    return lines;
  }

  /**
   * Generates a plain-text ASCII representation of the project hierarchy with optional Git decorations.
   *
   * @param relativePaths - Array of POSIX-formatted relative file paths.
   * @param statusMap - Optional map of file paths to Git statuses.
   * @param absolutePaths - Optional array of corresponding absolute paths for status resolution.
   * @returns Formatted ASCII tree string.
   */
  public static generateAsciiTree(
    relativePaths: string[],
    statusMap?: Map<string, GitFileStatus>,
    absolutePaths?: string[]
  ): string {
    const items = relativePaths.map((relPath, index) => {
      const absPath = absolutePaths ? absolutePaths[index] : undefined;
      let statusBadge: string | undefined;

      if (absPath && statusMap) {
        const status = statusMap.get(absPath);
        if (status === 'modified') {
          statusBadge = 'M';
        } else if (status === 'untracked') {
          statusBadge = 'U';
        } else if (status === 'deleted') {
          statusBadge = 'D';
        } else if (status === 'renamed') {
          statusBadge = 'R';
        }
      }

      return { relativePath: relPath, status: statusBadge };
    });

    const rootNode = this.buildAsciiTreeHierarchy(items);
    const lines = this.renderAsciiTreeLines(rootNode);
    return `Project Structure:\n${lines.join('\n')}`;
  }
}