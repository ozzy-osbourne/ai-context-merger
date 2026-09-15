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
 * Test suite for ContextMenuService target file resolution and Git deleted files support.
 */
suite('ContextMenuService: Target Resolution & Git Deleted Files Tests', () => {
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

  test('Resolves tracked Git deleted file as a valid target despite physical absence from disk', async () => {
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
      assert.strictEqual(resolved.length, 1);
      assert.strictEqual(PathUtils.arePathsEqual(resolved[0], deletedFile), true);
    } finally {
      GitService.getFileStatuses = originalGetStatuses;
    }
  });

  test('Recursively includes tracked Git deleted files when adding folder to context', async () => {
    const subFolder = PathUtils.normalizePath(path.join(tempDir, 'folder_with_deletion'));
    await fs.promises.mkdir(subFolder, { recursive: true });

    const activeFile = PathUtils.normalizePath(path.join(subFolder, 'active.ts'));
    const deletedFile = PathUtils.normalizePath(path.join(subFolder, 'removed.ts'));

    await fs.promises.writeFile(activeFile, 'export const active = true;', 'utf-8');

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

      const resolved = await contextMenuService.resolveTargetFiles(vscode.Uri.file(subFolder));
      assert.strictEqual(resolved.length, 2, 'Must include both the active file and the tracked Git deleted file');
      assert.strictEqual(resolved.some((f) => PathUtils.arePathsEqual(f, activeFile)), true);
      assert.strictEqual(resolved.some((f) => PathUtils.arePathsEqual(f, deletedFile)), true);
    } finally {
      GitService.getFileStatuses = originalGetStatuses;
    }
  });
});