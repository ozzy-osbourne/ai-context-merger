import * as vscode from 'vscode';
import { DiagnosticsSettings, DiagnosticsSummary } from '../types';
import { PathUtils } from '../utils/pathUtils';

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
 * Service providing categorization, extraction, and formatting for compiler and linter diagnostics.
 */
export class DiagnosticsService {
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
   * Calculates aggregated count of compiler issues and linter issues across specified files.
   *
   * @param files - Set of file paths to inspect.
   * @returns Diagnostics summary object with compiler and linter counters.
   */
  public static getDiagnosticsSummary(files: Set<string>): DiagnosticsSummary {
    let compilerCount = 0;
    let linterCount = 0;

    for (const filePath of files) {
      try {
        const uri = vscode.Uri.file(filePath);
        const diags = vscode.languages.getDiagnostics(uri);
        for (const d of diags) {
          const cat = this.classifyDiagnostic(d);
          if (cat === 'compiler') {
            compilerCount++;
          } else {
            linterCount++;
          }
        }
      } catch {
        // Ignore unreadable file URI
      }
    }

    return { compilerCount, linterCount };
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
        const relativePath = PathUtils.getRelativePath(filePath, workspaceFolders);

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
}