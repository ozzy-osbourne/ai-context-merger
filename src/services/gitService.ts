import * as vscode from 'vscode';
import * as fs from 'fs';
import { FilterSettings, GitAPI, GitChange, GitExtensionExports, GitFileStatus, GitRepository, GitStatus } from '../types';
import { WorkspaceScanner } from './workspaceScanner';
import { FileReaderService } from './fileReaderService';
import { PathUtils } from '../utils/pathUtils';

/**
 * Service providing integration with the built-in VS Code Git extension.
 * Supports single repositories, multi-root workspaces, and nested git submodules.
 */
export class GitService {
  private static cachedGitApi: GitAPI | null = null;

  /**
   * Maximum characters allowed for an individual file diff before truncation (100 KB).
   */
  public static readonly MAX_DIFF_BYTES = 100 * 1024;

  /**
   * Resolves and caches the API instance of the built-in vscode.git extension.
   *
   * @returns Git API instance or `null` if unavailable.
   */
  public static async getGitApi(): Promise<GitAPI | null> {
    if (this.cachedGitApi) {
      return this.cachedGitApi;
    }
    try {
      const gitExtension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
      if (!gitExtension) {
        return null;
      }
      const gitExports = gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate();

      if (!gitExports || typeof gitExports.getAPI !== 'function') {
        return null;
      }

      this.cachedGitApi = gitExports.getAPI(1);
      return this.cachedGitApi;
    } catch {
      return null;
    }
  }

  /**
   * Awaits Git extension repository initialization to eliminate startup race conditions.
   *
   * @param timeoutMs - Maximum wait time in milliseconds.
   * @returns Active Git API instance with available repositories.
   */
  public static async awaitGitRepositories(timeoutMs: number = 600): Promise<GitAPI | null> {
    const gitApi = await this.getGitApi();
    if (!gitApi) {
      return null;
    }

    if (gitApi.repositories.length > 0) {
      return gitApi;
    }

    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(gitApi);
        }
      }, timeoutMs);

      const disposable = gitApi.onDidOpenRepository(() => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          disposable.dispose();
          resolve(gitApi);
        }
      });
    });
  }

  /**
   * Returns active Git repositories sorted in descending order of their root path length.
   * This guarantees that nested repositories (such as Git submodules) take precedence over parent repositories.
   *
   * @param gitApi - Active Git API instance.
   * @returns Array of Git repositories ordered from deepest to shallowest root.
   */
  public static getSortedRepositories(gitApi: GitAPI): GitRepository[] {
    return [...gitApi.repositories].sort((a, b) => {
      const pathA = PathUtils.normalizePath(a.rootUri.fsPath);
      const pathB = PathUtils.normalizePath(b.rootUri.fsPath);
      return pathB.length - pathA.length;
    });
  }

  /**
   * Resolves the closest (deepest) enclosing Git repository for a given target path.
   *
   * @param gitApi - Active Git API instance.
   * @param targetPath - Normalized absolute file or folder path.
   * @returns Closest matching Git repository, or undefined if outside version control.
   */
  public static getRepositoryForPath(gitApi: GitAPI, targetPath: string): GitRepository | undefined {
    const normPath = PathUtils.normalizePath(targetPath);
    const sortedRepos = this.getSortedRepositories(gitApi);

    return sortedRepos.find((repo) => {
      const repoRoot = PathUtils.normalizePath(repo.rootUri.fsPath);
      return PathUtils.isSubpath(normPath, repoRoot);
    });
  }

  /**
   * Checks whether an individual path is ignored by its enclosing Git repository.
   * Ensures directories are checked with trailing slashes to conform to directory gitignore patterns.
   *
   * @param targetPath - Absolute path to test.
   * @param isDirectory - Flag indicating if path is a directory.
   * @returns `true` if path is ignored by Git.
   */
  public static async isPathIgnored(targetPath: string, isDirectory: boolean): Promise<boolean> {
    const normPath = PathUtils.normalizePath(targetPath);
    const checkPath = isDirectory && !normPath.endsWith('/') && !normPath.endsWith('\\')
      ? `${normPath}/`
      : normPath;

    const ignored = await this.checkIgnoredPaths([checkPath]);
    return ignored.has(normPath) || ignored.has(checkPath);
  }

  /**
   * Checks an array of absolute file paths against repository `.gitignore` rules.
   * Correctly routes paths exclusively to their respective nested repositories.
   *
   * @param paths - Absolute file paths to check.
   * @returns Set of normalized paths that are ignored by Git.
   */
  public static async checkIgnoredPaths(paths: string[]): Promise<Set<string>> {
    const ignoredPaths = new Set<string>();
    if (paths.length === 0) {
      return ignoredPaths;
    }

    try {
      const gitApi = await this.awaitGitRepositories();
      if (!gitApi || !gitApi.repositories || gitApi.repositories.length === 0) {
        return ignoredPaths;
      }

      const sortedRepos = this.getSortedRepositories(gitApi);
      const remainingPaths = new Set(paths.map((p) => PathUtils.normalizePath(p)));

      for (const repo of sortedRepos) {
        if (remainingPaths.size === 0) {
          break;
        }

        const repoRoot = PathUtils.normalizePath(repo.rootUri.fsPath);
        const repoPaths: string[] = [];

        for (const p of remainingPaths) {
          if (PathUtils.isSubpath(p, repoRoot)) {
            repoPaths.push(p);
          }
        }

        if (repoPaths.length > 0) {
          for (const p of repoPaths) {
            remainingPaths.delete(p);
          }

          if (typeof repo.checkIgnore === 'function') {
            try {
              const result: Set<string> = await repo.checkIgnore(repoPaths);
              for (const item of result) {
                const normalizedItem = PathUtils.normalizePath(item);
                ignoredPaths.add(normalizedItem);
                if (normalizedItem.endsWith('/') || normalizedItem.endsWith('\\')) {
                  ignoredPaths.add(normalizedItem.slice(0, -1));
                }
              }
            } catch {
              // Ignore check failure on individual repository
            }
          }
        }
      }
    } catch {
      // Return accumulated ignored paths on error
    }

    return ignoredPaths;
  }

  /**
   * Resolves the Git status of a change object using Git change status enum and non-blocking I/O.
   * Skips directory-level changes (such as submodule pointer commits in a parent repo).
   *
   * @param change - Target Git change descriptor.
   * @returns Resolved status or null if skipped.
   */
  private static async resolveChangeStatus(change: GitChange): Promise<{ path: string; status: GitFileStatus } | null> {
    if (!change || !change.uri) {
      return null;
    }

    const fsPath = PathUtils.normalizePath(change.uri.fsPath);
    const gitStatusCode = change.status;

    try {
      const stat = await fs.promises.stat(fsPath);
      if (stat.isDirectory()) {
        return null;
      }
    } catch {
      // File may be deleted
    }

    if (
      gitStatusCode === GitStatus.INDEX_RENAMED ||
      gitStatusCode === GitStatus.INTENT_TO_RENAME ||
      (change.originalUri && !PathUtils.arePathsEqual(change.originalUri.fsPath, change.uri.fsPath))
    ) {
      return { path: fsPath, status: 'renamed' };
    }

    if (gitStatusCode === GitStatus.DELETED || gitStatusCode === GitStatus.INDEX_DELETED) {
      return { path: fsPath, status: 'deleted' };
    }

    let fileExists = true;
    try {
      await fs.promises.access(fsPath, fs.constants.F_OK);
    } catch {
      fileExists = false;
    }

    return { path: fsPath, status: fileExists ? 'modified' : 'deleted' };
  }

  /**
   * Collects detailed Git status indicators for all changed, untracked, and deleted repository files across all repositories.
   *
   * @returns Map of normalized file paths to their Git file statuses.
   */
  public static async getFileStatuses(): Promise<Map<string, GitFileStatus>> {
    const statusMap = new Map<string, GitFileStatus>();

    try {
      const gitApi = await this.awaitGitRepositories();
      if (!gitApi || !gitApi.repositories || gitApi.repositories.length === 0) {
        return statusMap;
      }

      for (const repo of gitApi.repositories) {
        const workingChanges = repo.state.workingTreeChanges || [];
        const indexChanges = repo.state.indexChanges || [];
        const untrackedChanges = repo.state.untrackedChanges || [];

        const changePromises = [...workingChanges, ...indexChanges].map((change) =>
          this.resolveChangeStatus(change)
        );

        const resolvedChanges = await Promise.all(changePromises);
        for (const item of resolvedChanges) {
          if (item) {
            statusMap.set(item.path, item.status);
          }
        }

        for (const change of untrackedChanges) {
          if (change && change.uri) {
            const fsPath = PathUtils.normalizePath(change.uri.fsPath);
            try {
              const stat = await fs.promises.stat(fsPath);
              if (!stat.isDirectory()) {
                statusMap.set(fsPath, 'untracked');
              }
            } catch {
              // Skip if inaccessible
            }
          }
        }
      }
    } catch {
      // Return accumulated statuses on error
    }

    return statusMap;
  }

  /**
   * Collects all modified, untracked, and indexed file paths across active Git repositories asynchronously.
   *
   * @returns Array of normalized file paths with pending changes.
   */
  public static async getModifiedFilePaths(): Promise<string[]> {
    const statuses = await this.getFileStatuses();
    return Array.from(statuses.keys());
  }

  /**
   * Synthesizes a valid Git unified diff representation for untracked newly created files using safe decoding.
   * Truncation limits are applied centrally in getFilesDiff to prevent double slicing and duplicate banners.
   *
   * @param relPath - POSIX relative path of the file to the repository root.
   * @param absPath - Normalized absolute path to file on disk.
   * @returns Formatted unified diff string, or empty string on binary/unreadable file.
   */
  public static async synthesizeUntrackedDiff(
    relPath: string,
    absPath: string
  ): Promise<string> {
    try {
      const readResult = await FileReaderService.safeReadFile(absPath);
      if (!readResult.text || readResult.placeholder) {
        return '';
      }

      const lines = readResult.text.split(/\r?\n/);

      return [
        `diff --git a/${relPath} b/${relPath}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${relPath}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((l) => `+${l}`)
      ].join('\n');
    } catch {
      return '';
    }
  }

  /**
   * Collects unified Git diffs for selected file paths with truncation limits and untracked file support.
   * Properly routes files to their corresponding closest repository root.
   *
   * @param filePaths - Array of selected absolute file paths.
   * @param unlimitedDiff - Flag indicating whether to bypass the size truncation limit.
   * @param filters - Active exclusion filters to discard non-source artifacts.
   * @returns Combined unified Git diff string.
   */
  public static async getFilesDiff(
    filePaths: string[],
    unlimitedDiff: boolean,
    filters: FilterSettings
  ): Promise<string> {
    if (filePaths.length === 0) {
      return '';
    }

    const gitApi = await this.awaitGitRepositories();
    if (!gitApi || !gitApi.repositories || gitApi.repositories.length === 0) {
      return '';
    }

    const statuses = await this.getFileStatuses();
    const diffBlocks: string[] = [];

    for (const filePath of filePaths) {
      const normPath = PathUtils.normalizePath(filePath);
      const matchedRepo = this.getRepositoryForPath(gitApi, normPath);

      if (!matchedRepo) {
        continue;
      }

      const repoRoot = PathUtils.normalizePath(matchedRepo.rootUri.fsPath);
      const status = statuses.get(normPath);
      const isDeleted = status === 'deleted';

      // Pass isDeleted = true to prevent lstat from filtering out deleted files
      const isFiltered = await WorkspaceScanner.shouldFilterItem(normPath, false, filters, repoRoot, isDeleted);
      if (isFiltered) {
        continue;
      }

      const relPath = PathUtils.toPosixRelative(repoRoot, normPath);
      let rawDiff = '';

      if (status === 'untracked') {
        rawDiff = await this.synthesizeUntrackedDiff(relPath, normPath);
      } else {
        try {
          // diffWithHEAD outputs the complete diff of HEAD vs working tree (both staged and unstaged)
          if (typeof matchedRepo.diffWithHEAD === 'function') {
            rawDiff = (await matchedRepo.diffWithHEAD(relPath)) || '';
          }

          // Fallback to diffIndexWithHEAD only if diffWithHEAD is unavailable or empty
          if (!rawDiff && typeof matchedRepo.diffIndexWithHEAD === 'function') {
            rawDiff = (await matchedRepo.diffIndexWithHEAD(relPath)) || '';
          }
        } catch {
          // Ignore retrieval failure on individual path
        }
      }

      if (!rawDiff || rawDiff.trim().length === 0) {
        continue;
      }

      if (!unlimitedDiff && rawDiff.length > this.MAX_DIFF_BYTES) {
        const truncated = rawDiff.slice(0, this.MAX_DIFF_BYTES);
        rawDiff = `${truncated}\n\n... [Diff превышает лимит 100 KB и был обрезан. Включите «Безлимитный Diff» для полного вывода] ...`;
      }

      diffBlocks.push(rawDiff.trim());
    }

    return diffBlocks.join('\n\n');
  }
}