import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { WorkspaceScanner } from '../services/workspaceScanner';
import { GitService } from '../services/gitService';
import { FilterSettings } from '../types';

/**
 * Test suite for Git change inspection, deleted file handling, and untracked diff synthesis.
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
    try {
      await fs.promises.unlink(deletedFilePath);
    } catch {
      // File does not exist
    }

    const withoutFlag = await WorkspaceScanner.shouldFilterItem(deletedFilePath, false, defaultFilters, tempDir, false);
    assert.strictEqual(withoutFlag, true, 'Nonexistent file must be filtered out if isGitDeleted is false');

    const withFlag = await WorkspaceScanner.shouldFilterItem(deletedFilePath, false, defaultFilters, tempDir, true);
    assert.strictEqual(withFlag, false, 'Git deleted file must not be filtered out when isGitDeleted is true');
  });

  test('Synthesizes valid unified diff format for newly created untracked files', async () => {
    const untrackedFilePath = path.join(tempDir, 'new_untracked_service.ts');
    await fs.promises.writeFile(untrackedFilePath, 'const alpha = 100;\nconst beta = 200;\n', 'utf-8');

    const diff = await GitService.synthesizeUntrackedDiff('src/new_untracked_service.ts', untrackedFilePath);

    assert.strictEqual(diff.includes('diff --git a/src/new_untracked_service.ts b/src/new_untracked_service.ts'), true);
    assert.strictEqual(diff.includes('new file mode 100644'), true);
    assert.strictEqual(diff.includes('--- /dev/null'), true);
    assert.strictEqual(diff.includes('+++ b/src/new_untracked_service.ts'), true);
    assert.strictEqual(diff.includes('+const alpha = 100;'), true);
    assert.strictEqual(diff.includes('+const beta = 200;'), true);
  });

  test('Returns empty diff string when attempting to synthesize diff for binary files', async () => {
    const binaryFilePath = path.join(tempDir, 'artifact.png');
    // Write PNG signature magic bytes
    await fs.promises.writeFile(binaryFilePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const diff = await GitService.synthesizeUntrackedDiff('artifact.png', binaryFilePath);
    assert.strictEqual(diff, '', 'Binary file diff synthesis must safely yield empty string');
  });
});