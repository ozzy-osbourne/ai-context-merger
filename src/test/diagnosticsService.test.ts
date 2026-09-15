import * as assert from 'assert';
import * as vscode from 'vscode';
import { DiagnosticsService, DiagnosticItem } from '../services/diagnosticsService';
import { DiagnosticsSettings } from '../types';

/**
 * Test suite for diagnostic issue classification, severity filtering, selective options, and multiline formatting.
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

  test('Filters diagnostics selectively based on includeCompiler and includeLinter flags', () => {
    const testUri = vscode.Uri.file('/workspace/test_diagnostic_filter.ts');
    const diagCollection = vscode.languages.createDiagnosticCollection('test-filter');

    try {
      const compilerDiag = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1),
        'Syntax error in module',
        vscode.DiagnosticSeverity.Error
      );
      compilerDiag.source = 'tsc';

      const linterDiag = new vscode.Diagnostic(
        new vscode.Range(1, 0, 1, 1),
        'Trailing spaces detected',
        vscode.DiagnosticSeverity.Warning
      );
      linterDiag.source = 'eslint';

      diagCollection.set(testUri, [compilerDiag, linterDiag]);

      const selectedFiles = new Set<string>([testUri.fsPath]);

      // Case 1: Both compiler and linter enabled
      const settingsAll: DiagnosticsSettings = {
        enabled: true,
        includeCompiler: true,
        includeLinter: true
      };
      const itemsAll = DiagnosticsService.getDiagnosticsForFiles(selectedFiles, settingsAll);
      assert.strictEqual(itemsAll.length, 2);

      // Case 2: Only compiler enabled
      const settingsCompilerOnly: DiagnosticsSettings = {
        enabled: true,
        includeCompiler: true,
        includeLinter: false
      };
      const itemsCompilerOnly = DiagnosticsService.getDiagnosticsForFiles(selectedFiles, settingsCompilerOnly);
      assert.strictEqual(itemsCompilerOnly.length, 1);
      assert.strictEqual(itemsCompilerOnly[0].category, 'compiler');

      // Case 3: Only linter enabled
      const settingsLinterOnly: DiagnosticsSettings = {
        enabled: true,
        includeCompiler: false,
        includeLinter: true
      };
      const itemsLinterOnly = DiagnosticsService.getDiagnosticsForFiles(selectedFiles, settingsLinterOnly);
      assert.strictEqual(itemsLinterOnly.length, 1);
      assert.strictEqual(itemsLinterOnly[0].category, 'linter');

      // Case 4: Diagnostics master switch disabled
      const settingsDisabled: DiagnosticsSettings = {
        enabled: false,
        includeCompiler: true,
        includeLinter: true
      };
      const itemsDisabled = DiagnosticsService.getDiagnosticsForFiles(selectedFiles, settingsDisabled);
      assert.strictEqual(itemsDisabled.length, 0);
    } finally {
      diagCollection.clear();
      diagCollection.dispose();
    }
  });
});