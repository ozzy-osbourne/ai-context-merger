import * as assert from 'assert';
import * as vscode from 'vscode';
import { DiagnosticsService, DiagnosticItem } from '../services/diagnosticsService';

/**
 * Test suite for diagnostic issue classification, severity filtering, and multiline formatting.
 */
suite('DiagnosticsService: Classification, Severities & Formatting Tests', () => {
  test('Correctly classifies compiler sources', () => {
    const diagTs = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      'Type error',
      vscode.DiagnosticSeverity.Error
    );
    diagTs.source = 'typescript';
    assert.strictEqual(DiagnosticsService.classifyDiagnostic(diagTs), 'compiler');

    const diagRust = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      'Mismatched types',
      vscode.DiagnosticSeverity.Error
    );
    diagRust.source = 'rustc';
    assert.strictEqual(DiagnosticsService.classifyDiagnostic(diagRust), 'compiler');
  });

  test('Correctly classifies linter sources', () => {
    const diagEslint = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      'Missing semicolon',
      vscode.DiagnosticSeverity.Warning
    );
    diagEslint.source = 'eslint';
    assert.strictEqual(DiagnosticsService.classifyDiagnostic(diagEslint), 'linter');

    const diagRuff = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      'Unused import',
      vscode.DiagnosticSeverity.Warning
    );
    diagRuff.source = 'ruff';
    assert.strictEqual(DiagnosticsService.classifyDiagnostic(diagRuff), 'linter');
  });

  test('Formats multiline error messages with indented paragraphs to preserve Markdown lists', () => {
    const items: DiagnosticItem[] = [
      {
        filePath: '/workspace/src/app.ts',
        relativePath: 'src/app.ts',
        line: 12,
        character: 5,
        category: 'compiler',
        severity: 'error',
        source: 'tsc',
        code: 2322,
        message: 'Type "string" is not assignable to type "number".\nDetailed explanation line 2.'
      }
    ];

    const formatted = DiagnosticsService.formatDiagnosticsText(items);
    assert.strictEqual(formatted.includes('src/app.ts:12:5 - [tsc] Compiler Error:'), true);
    assert.strictEqual(formatted.includes('\n    Detailed explanation line 2. (2322)'), true);
  });
});