import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { ContextTreeStateResolver } from '../services/contextTreeStateResolver';
import { FilterSettings, GitFileStatus } from '../types';

/**
 * Test suite for TreeView state resolution, pluralization labels, and Git deleted item counters.
 */
suite('ContextTreeStateResolver: Labels & Folder State Resolution Tests', () => {
  let tempDir: string;

  const defaultFilters: FilterSettings = {
    hideGitIgnored: false,
    hideSecrets: true,
    hideMinified: true,
    hideLockFiles: true,
    hideBinaryFiles: true
  };

  suiteSetup(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-context-tree-test-'));
  });

  suiteTeardown(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore directory cleanup error
    }
  });

  test('Correctly formats Russian plural forms for selected file counters', () => {
    assert.strictEqual(ContextTreeStateResolver.formatFilePlural(1), '1 файл выбран');
    assert.strictEqual(ContextTreeStateResolver.formatFilePlural(2), '2 файла выбрано');
    assert.strictEqual(ContextTreeStateResolver.formatFilePlural(4), '4 файла выбрано');
    assert.strictEqual(ContextTreeStateResolver.formatFilePlural(5), '5 файлов выбрано');
    assert.strictEqual(ContextTreeStateResolver.formatFilePlural(11), '11 файлов выбрано');
    assert.strictEqual(ContextTreeStateResolver.formatFilePlural(21), '21 файл выбран');
    assert.strictEqual(ContextTreeStateResolver.formatFilePlural(24), '24 файла выбрано');
  });

  test('Calculates total folder count including Git deleted items to prevent 6/5 anomalies', async () => {
    const fileA = path.join(tempDir, 'fileA.ts');
    const fileB = path.join(tempDir, 'fileB.ts');
    const deletedFile = path.join(tempDir, 'deletedInGit.ts');

    await fs.promises.writeFile(fileA, 'const a = 1;', 'utf-8');
    await fs.promises.writeFile(fileB, 'const b = 2;', 'utf-8');

    const gitStatuses = new Map<string, GitFileStatus>();
    gitStatuses.set(deletedFile, 'deleted');

    const countMap = new Map<string, number>();
    const pendingPromises = new Map<string, Promise<number>>();

    // Total must be 2 disk files + 1 git deleted file = 3
    const totalCount = await ContextTreeStateResolver.getFolderTotalCount(
      tempDir,
      defaultFilters,
      countMap,
      pendingPromises,
      gitStatuses
    );

    assert.strictEqual(totalCount, 3, 'Folder total count must include tracked Git deleted files');

    // Select all 3 files
    const selectedFiles = new Set<string>([fileA, fileB, deletedFile]);

    const state = await ContextTreeStateResolver.resolveFolderState(
      tempDir,
      selectedFiles,
      defaultFilters,
      countMap,
      pendingPromises,
      gitStatuses
    );

    assert.strictEqual(state.isChecked, true, 'All 3 files are selected, folder must be checked');
    assert.strictEqual(state.description, '3/3 (3 файла выбрано)', 'Description must render balanced 3/3 count');
  });
});