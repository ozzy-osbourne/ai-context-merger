import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { WorkspaceScanner } from '../services/workspaceScanner';
import { FilterSettings } from '../types';

/**
 * Test suite for directory traversal, path segment filtering, and symlink security.
 */
suite('WorkspaceScanner: Traversal, Filters & Symlink Security Tests', () => {
  let tempDir: string;

  const defaultFilters: FilterSettings = {
    hideGitIgnored: false,
    hideSecrets: true,
    hideMinified: true,
    hideLockFiles: true,
    hideBinaryFiles: true
  };

  suiteSetup(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-context-scanner-test-'));
  });

  suiteTeardown(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore directory cleanup error
    }
  });

  test('Unconditionally ignores node_modules, build artifacts, and VCS metadata', () => {
    const nodeModulesPath = '/workspace/my-app/node_modules/express/index.js';
    const gitInternalPath = '/workspace/my-app/.git/objects/abc';
    const buildDistPath = '/workspace/my-app/dist/bundle.js';
    const venvPath = '/workspace/my-app/.venv/lib/python3.10/site.py';

    assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments(nodeModulesPath), true);
    assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments(gitInternalPath), true);
    assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments(buildDistPath), true);
    assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments(venvPath), true);
  });

  test('Correctly identifies ignored root path segments on POSIX paths without workspace root', () => {
    const rootDistFile = '/dist/bundle.js';
    const rootNodeModules = '/node_modules/lodash/index.js';
    const validRootFile = '/src/index.ts';

    assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments(rootDistFile), true);
    assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments(rootNodeModules), true);
    assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments(validRootFile), false);
  });

  test('Permits valid project source files in workspace root and subdirectories', () => {
    assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments('/workspace/my-app/src/index.ts'), false);
    assert.strictEqual(WorkspaceScanner.isIgnoredByPathSegments('/workspace/my-app/package.json'), false);
  });

  test('Strictly forbids following symbolic links to prevent traversal and loops', async () => {
    const realFilePath = path.join(tempDir, 'original_target.ts');
    const symlinkPath = path.join(tempDir, 'symlinked_alias.ts');

    await fs.promises.writeFile(realFilePath, 'export const secret = "active";', 'utf-8');

    try {
      await fs.promises.symlink(realFilePath, symlinkPath);
    } catch {
      // Symlink privileges might be restricted on Windows without Developer Mode
      return;
    }

    const shouldFilter = await WorkspaceScanner.shouldFilterItem(symlinkPath, false, defaultFilters, tempDir);
    assert.strictEqual(shouldFilter, true, 'Symlinks must be rejected by shouldFilterItem');

    const entries = await WorkspaceScanner.readValidDirectoryEntries(tempDir, defaultFilters);
    const containsSymlink = entries.some((entry) => entry.fullPath === symlinkPath);
    assert.strictEqual(containsSymlink, false, 'readValidDirectoryEntries must never return symlinked entries');
  });
});