import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { WorkspaceScanner } from '../services/workspaceScanner';
import { FilterSettings } from '../types';

/**
 * Test suite for Git change inspection, deleted file handling, and diff boundaries.
 */
suite('GitService & Review Mode: Diff Integrity & Untracked Synthesis Tests', () => {
  let tempDir: string;

  const defaultFilters: FilterSettings = {
    hideGitIgnored: false,
    hideSecrets: true,
    hideMinified: true,
    hideLockFiles: true,
    hideBinaryFiles: true
  };

  suiteSetup(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-context-git-test-'));
  });

  suiteTeardown(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  test('Allows Git deleted files through scanner when isGitDeleted flag is active', async () => {
    const deletedFilePath = path.join(tempDir, 'deleted_file.ts');
    // Ensure file does not physically exist on disk
    try {
      await fs.promises.unlink(deletedFilePath);
    } catch {
      // File does not exist
    }

    // Without flag, nonexistent file is filtered out
    const withoutFlag = await WorkspaceScanner.shouldFilterItem(deletedFilePath, false, defaultFilters, tempDir, false);
    assert.strictEqual(withoutFlag, true, 'Nonexistent file must be filtered out if isGitDeleted is false');

    // With flag, nonexistent file is recognized as tracked deletion and allowed through
    const withFlag = await WorkspaceScanner.shouldFilterItem(deletedFilePath, false, defaultFilters, tempDir, true);
    assert.strictEqual(withFlag, false, 'Git deleted file must not be filtered out when isGitDeleted is true');
  });
});