import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ContextMenuService } from '../services/contextMenuService';
import { ContextTreeDataProvider } from '../services/contextTreeDataProvider';
import { ContextMergerControlsProvider } from '../sidebarProvider';
import { GitService } from '../services/gitService';
import { PathUtils } from '../utils/pathUtils';
import { FilterSettings, GitFileStatus } from '../types';

/**
 * Test suite for ContextMenuService target file resolution, Git deleted files handling, and fast hiding commands.
 */
suite('ContextMenuService: Target Resolution & Quick Hiding Tests', () => {
  let tempDir: string;

  const defaultFilters: FilterSettings = {
    hideGitIgnored: false,
    hideSecrets: true,
    hideMinified: true,
    hideLockFiles: true,
    hideBinaryFiles: true
  };

  suiteSetup(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-context-menu-test-'));
  });

  suiteTeardown(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  test('Resolves physical file as a valid target', async () => {
    const activeFile = PathUtils.normalizePath(path.join(tempDir, 'active_script.ts'));
    await fs.promises.writeFile(activeFile, 'export const ready = true;', 'utf-8');

    const selectedFiles = new Set<string>();
    const mockControlsProvider = {
      filters: defaultFilters
    } as unknown as ContextMergerControlsProvider;

    const mockTreeProvider = {
      folderTotalCountMap: new Map<string, number>()
    } as unknown as ContextTreeDataProvider;

    const contextMenuService = new ContextMenuService(
      selectedFiles,
      mockTreeProvider,
      mockControlsProvider
    );

    const resolved = await contextMenuService.resolveTargetFiles(vscode.Uri.file(activeFile));
    assert.strictEqual(resolved.length, 1);
    assert.strictEqual(PathUtils.arePathsEqual(resolved[0], activeFile), true);
  });

  test('Does not resolve non-existent or physically deleted file as target in UI context actions', async () => {
    const deletedFile = PathUtils.normalizePath(path.join(tempDir, 'file_deleted_in_git.ts'));
    try {
      await fs.promises.unlink(deletedFile);
    } catch {
      // File does not exist
    }

    const mockGitStatuses = new Map<string, GitFileStatus>();
    mockGitStatuses.set(deletedFile, 'deleted');

    const originalGetStatuses = GitService.getFileStatuses;
    GitService.getFileStatuses = async () => mockGitStatuses;

    try {
      const selectedFiles = new Set<string>();
      const mockControlsProvider = {
        filters: defaultFilters
      } as unknown as ContextMergerControlsProvider;

      const mockTreeProvider = {
        folderTotalCountMap: new Map<string, number>()
      } as unknown as ContextTreeDataProvider;

      const contextMenuService = new ContextMenuService(
        selectedFiles,
        mockTreeProvider,
        mockControlsProvider
      );

      const resolved = await contextMenuService.resolveTargetFiles(vscode.Uri.file(deletedFile));
      assert.strictEqual(resolved.length, 0, 'Physically deleted files must not be resolved via UI context menus');
    } finally {
      GitService.getFileStatuses = originalGetStatuses;
    }
  });
});