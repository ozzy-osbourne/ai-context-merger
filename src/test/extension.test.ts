import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Root extension integration suite verifying lifecycle activation and command registration.
 */
suite('Extension Lifecycle Integration Tests', () => {
  suiteSetup(async () => {
    // Explicitly locate and activate the extension under test in the test runner environment
    const ext = vscode.extensions.all.find(
      (e) => e.packageJSON && e.packageJSON.name === 'ai-context-merger'
    );

    assert.ok(ext, 'Extension ai-context-merger must be present in the VS Code extensions registry');

    if (!ext.isActive) {
      await ext.activate();
    }
  });

  test('Registers primary context menu and tree commands in VS Code registry', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.strictEqual(commands.includes('aiContextMerger.addToContext'), true);
    assert.strictEqual(commands.includes('aiContextMerger.copyImmediately'), true);
  });
});