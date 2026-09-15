import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { PathUtils } from '../utils/pathUtils';

/**
 * Test suite for cross-platform path resolution and Multi-Root workspace handling.
 */
suite('PathUtils: Cross-Platform & Multi-Root Workspace Tests', () => {
  test('Correctly prefixes folder name when multiple workspace roots exist', () => {
    const mockWorkspaces: vscode.WorkspaceFolder[] = [
      {
        uri: vscode.Uri.file('/workspaces/frontend'),
        name: 'frontend',
        index: 0
      },
      {
        uri: vscode.Uri.file('/workspaces/backend'),
        name: 'backend',
        index: 1
      }
    ];

    const frontFile = '/workspaces/frontend/src/App.tsx';
    const backFile = '/workspaces/backend/src/server.ts';

    const relFront = PathUtils.getRelativePath(frontFile, mockWorkspaces);
    const relBack = PathUtils.getRelativePath(backFile, mockWorkspaces);

    assert.strictEqual(relFront, 'frontend/src/App.tsx');
    assert.strictEqual(relBack, 'backend/src/server.ts');
  });

  test('Prioritizes nested sub-workspace folder over parent root in Multi-root workspace', () => {
    const mockWorkspaces: vscode.WorkspaceFolder[] = [
      {
        uri: vscode.Uri.file('/workspaces/monorepo'),
        name: 'monorepo',
        index: 0
      },
      {
        uri: vscode.Uri.file('/workspaces/monorepo/packages/client'),
        name: 'client',
        index: 1
      }
    ];

    const targetFile = '/workspaces/monorepo/packages/client/src/App.tsx';
    const resolvedRoot = PathUtils.getWorkspaceRoot(targetFile, mockWorkspaces);
    const relativePath = PathUtils.getRelativePath(targetFile, mockWorkspaces);

    assert.strictEqual(
      resolvedRoot,
      PathUtils.normalizePath('/workspaces/monorepo/packages/client'),
      'Nested folder must take precedence over parent folder'
    );
    assert.strictEqual(
      relativePath,
      'client/src/App.tsx',
      'Relative path must be formed with nested workspace name prefix'
    );
  });

  test('Cross-drive subpath check on Windows (C:\\ vs D:\\) does not throw or mismatch', () => {
    const pathDriveC = 'C:\\Projects\\App\\index.ts';
    const pathDriveD = 'D:\\Projects\\App\\index.ts';
    const rootDriveC = 'C:\\Projects\\App';

    assert.strictEqual(PathUtils.isSubpath(pathDriveC, rootDriveC), true);
    assert.strictEqual(PathUtils.isSubpath(pathDriveD, rootDriveC), false);
  });

  test('Converts paths to POSIX standard relative format using forward slashes', () => {
    const from = path.resolve('project', 'root');
    const to = path.resolve('project', 'root', 'src', 'components', 'App.tsx');
    const relativePosix = PathUtils.toPosixRelative(from, to);

    assert.strictEqual(relativePosix, 'src/components/App.tsx');
    assert.strictEqual(relativePosix.includes('\\'), false);
  });

  test('Calculates complete hierarchy of ancestor folders up to workspace root', () => {
    const root = path.resolve('workspace');
    const deepTarget = path.resolve('workspace', 'src', 'modules', 'auth', 'auth.service.ts');
    const ancestors = PathUtils.getAncestorPaths(deepTarget, root);

    const expectedModuleFolder = PathUtils.normalizePath(path.resolve('workspace', 'src', 'modules', 'auth'));
    assert.strictEqual(ancestors.includes(expectedModuleFolder), true);
  });
});