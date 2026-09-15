import * as assert from 'assert';
import * as vscode from 'vscode';
import { WatcherService } from '../services/watcherService';
import { FilterSettings } from '../types';

/**
 * Test suite for WatcherService event handling and unconditional ignore isolation.
 */
suite('WatcherService: Event Filtering & Ignore Isolation Tests', () => {
  const defaultFilters: FilterSettings = {
    hideGitIgnored: true,
    hideSecrets: true,
    hideMinified: true,
    hideLockFiles: true,
    hideBinaryFiles: true
  };

  test('Ignores file deletion events inside node_modules and .git folders', () => {
    const selectedFiles = new Set<string>();
    let refreshTriggered = false;

    const watcherService = new WatcherService(
      selectedFiles,
      () => defaultFilters,
      () => {
        refreshTriggered = true;
      },
      () => {}
    );

    try {
      // Simulate file deletion inside node_modules
      const nodeModulesDeletedUri = vscode.Uri.file('/workspace/node_modules/express/index.js');
      const processedNodeModules = watcherService.handleFileEvent(nodeModulesDeletedUri, true);
      assert.strictEqual(processedNodeModules, false, 'Deletion inside node_modules must be ignored');

      // Simulate file deletion inside .git
      const gitDeletedUri = vscode.Uri.file('/workspace/.git/objects/4b/825dc642cb6eb9a060e54bf8d69288fbee4904');
      const processedGit = watcherService.handleFileEvent(gitDeletedUri, true);
      assert.strictEqual(processedGit, false, 'Deletion inside .git must be ignored');

      // Ensure debounced refresh was not queued for system deletes
      assert.strictEqual(refreshTriggered, false, 'Debounced refresh must not be scheduled for ignored paths');

      // Verify normal project file deletion is accepted
      const validSourceDeletedUri = vscode.Uri.file('/workspace/src/app.ts');
      const processedSource = watcherService.handleFileEvent(validSourceDeletedUri, true);
      assert.strictEqual(processedSource, true, 'Deletion of project source file must be processed');
    } finally {
      watcherService.dispose();
    }
  });
});