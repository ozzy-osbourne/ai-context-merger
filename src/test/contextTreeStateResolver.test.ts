import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { ContextTreeStateResolver } from '../services/contextTreeStateResolver';
import { ContextTreeDataProvider } from '../services/contextTreeDataProvider';
import { PathUtils } from '../utils/pathUtils';
import { FilterSettings, GitFileStatus } from '../types';
import { I18nService } from '../i18n';

suite('ContextTreeStateResolver & TreeView: State Resolution & Combined Search Tests', () => {
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

  test('Correctly formats plural forms for Russian locale using native Intl.PluralRules', () => {
    assert.strictEqual(I18nService.formatSelectedFilePlural(1, 'ru'), '1 файл выбран');
    assert.strictEqual(I18nService.formatSelectedFilePlural(2, 'ru'), '2 файла выбрано');
    assert.strictEqual(I18nService.formatSelectedFilePlural(4, 'ru'), '4 файла выбрано');
    assert.strictEqual(I18nService.formatSelectedFilePlural(5, 'ru'), '5 файлов выбрано');
    assert.strictEqual(I18nService.formatSelectedFilePlural(11, 'ru'), '11 файлов выбрано');
    assert.strictEqual(I18nService.formatSelectedFilePlural(21, 'ru'), '21 файл выбран');
    assert.strictEqual(I18nService.formatSelectedFilePlural(24, 'ru'), '24 файла выбрано');
  });

  test('Correctly formats plural forms for English locale using native Intl.PluralRules', () => {
    assert.strictEqual(I18nService.formatSelectedFilePlural(1, 'en'), '1 file selected');
    assert.strictEqual(I18nService.formatSelectedFilePlural(2, 'en'), '2 files selected');
    assert.strictEqual(I18nService.formatSelectedFilePlural(10, 'en'), '10 files selected');
  });

  test('Correctly formats plural forms for Chinese locale using native Intl.PluralRules', () => {
    assert.strictEqual(I18nService.formatSelectedFilePlural(1, 'zh-cn'), '已选择 1 个文件');
    assert.strictEqual(I18nService.formatSelectedFilePlural(5, 'zh-cn'), '已选择 5 个文件');
  });

  test('Calculates total folder count including Git deleted items', async () => {
    const fileA = path.join(tempDir, 'fileA.ts');
    const fileB = path.join(tempDir, 'fileB.ts');
    const deletedFile = path.join(tempDir, 'deletedInGit.ts');

    await fs.promises.writeFile(fileA, 'const a = 1;', 'utf-8');
    await fs.promises.writeFile(fileB, 'const b = 2;', 'utf-8');

    const gitStatuses = new Map<string, GitFileStatus>();
    gitStatuses.set(deletedFile, 'deleted');

    const countMap = new Map<string, number>();
    const pendingPromises = new Map<string, Promise<number>>();

    const totalCount = await ContextTreeStateResolver.getFolderTotalCount(
      tempDir,
      defaultFilters,
      countMap,
      pendingPromises,
      gitStatuses
    );

    assert.strictEqual(totalCount, 3, 'Folder total count must include tracked Git deleted files');

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
    assert.strictEqual(state.description?.startsWith('3/3'), true);
  });

  test('Filters entries harmoniously when both "showOnlySelected" and "searchQuery" are active', async () => {
    const subFolder = PathUtils.normalizePath(path.join(tempDir, 'combined_test_dir'));
    await fs.promises.mkdir(subFolder, { recursive: true });

    const appleFile = PathUtils.normalizePath(path.join(subFolder, 'apple.ts'));
    const bananaFile = PathUtils.normalizePath(path.join(subFolder, 'banana.ts'));
    const apricotFile = PathUtils.normalizePath(path.join(subFolder, 'apricot.ts'));

    await fs.promises.writeFile(appleFile, 'export const apple = 1;', 'utf-8');
    await fs.promises.writeFile(bananaFile, 'export const banana = 2;', 'utf-8');
    await fs.promises.writeFile(apricotFile, 'export const apricot = 3;', 'utf-8');

    const selectedFiles = new Set<string>([appleFile, bananaFile]);

    const provider = new ContextTreeDataProvider(selectedFiles, defaultFilters);
    provider.setShowOnlySelected(true);
    await provider.setSearchQuery('ap', [subFolder]);

    const directoryItem = (provider as unknown as {
      readDirectoryItems: (dirPath: string) => Promise<Array<{ uri: { fsPath: string } }>>;
    });
    const items = await directoryItem.readDirectoryItems(subFolder);

    assert.strictEqual(items.length, 1, 'Only one item must match both filters simultaneously');
    assert.strictEqual(path.basename(items[0].uri.fsPath), 'apple.ts');
  });
});