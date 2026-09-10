import * as vscode from 'vscode';
import * as fs from 'fs';
import { FilterSettings, GitAPI, GitChange, GitExtensionExports, GitFileStatus, GitRepository, GitStatus } from '../types';
import { WorkspaceScanner } from './workspaceScanner';
import { PathUtils } from '../utils/pathUtils';

/**
 * Service providing integration with the built-in VS Code Git extension.
 */
export class GitService {
  private static cachedGitApi: GitAPI | null = null;

  /**
   * Maximum characters allowed for an individual file diff before truncation (100 KB).
   */
  private static readonly MAX_DIFF_BYTES = 100 * 1024;

  /**
   * Resolves and caches the API instance of the built-in vscode.git extension.
   *
   * @returns Git API instance or `null` if unavailable.
   */
  private static async getGitApi(): Promise<GitAPI | null> {
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
   * Checks an array of absolute file paths against repository `.gitignore` rules.
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
      const gitApi = await this.getGitApi();
      if (!gitApi || !gitApi.repositories || gitApi.repositories.length === 0) {
        return ignoredPaths;
      }

      for (const repo of gitApi.repositories) {
        const repoRoot = PathUtils.normalizePath(repo.rootUri.fsPath);
        const repoPaths = paths.filter((p) => PathUtils.isSubpath(p, repoRoot));
        if (repoPaths.length > 0 && typeof repo.checkIgnore === 'function') {
          try {
            const result: Set<string> = await repo.checkIgnore(repoPaths);
            for (const item of result) {
              ignoredPaths.add(PathUtils.normalizePath(item));
            }
          } catch {
            // Ignore check failure on individual repo
          }
        }
      }
    } catch {
      // Return empty set on overall check error
    }

    return ignoredPaths;
  }

  /**
   * Resolves the Git status of a change object using Git change status enum and non-blocking I/O.
   *
   * @param change - Target Git change descriptor.
   * @returns Resolved status or undefined if skipped.
   */
  private static async resolveChangeStatus(change: GitChange): Promise<{ path: string; status: GitFileStatus } | null> {
    if (!change || !change.uri) {
      return null;
    }

    const fsPath = PathUtils.normalizePath(change.uri.fsPath);
    const gitStatusCode = change.status;

    // Check for renamed status via Git status code or original URI difference
    if (
      gitStatusCode === GitStatus.INDEX_RENAMED ||
      gitStatusCode === GitStatus.INTENT_TO_RENAME ||
      (change.originalUri && !PathUtils.arePathsEqual(change.originalUri.fsPath, change.uri.fsPath))
    ) {
      return { path: fsPath, status: 'renamed' };
    }

    // Check deleted flag via Git API enum status
    if (gitStatusCode === GitStatus.DELETED || gitStatusCode === GitStatus.INDEX_DELETED) {
      return { path: fsPath, status: 'deleted' };
    }

    // Non-blocking file existence check
    let fileExists = true;
    try {
      await fs.promises.access(fsPath, fs.constants.F_OK);
    } catch {
      fileExists = false;
    }

    return { path: fsPath, status: fileExists ? 'modified' : 'deleted' };
  }

  /**
   * Collects detailed Git status indicators for all changed, untracked, and deleted repository files.
   *
   * @returns Map of normalized file paths to their Git file statuses.
   */
  public static async getFileStatuses(): Promise<Map<string, GitFileStatus>> {
    const statusMap = new Map<string, GitFileStatus>();

    try {
      const gitApi = await this.getGitApi();
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
            statusMap.set(fsPath, 'untracked');
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
   * Synthesizes a valid Git unified diff representation for untracked newly created files.
   *
   * @param relPath - POSIX relative path of the file.
   * @param absPath - Normalized absolute path to file on disk.
   * @returns Formatted unified diff string, or empty string on binary/unreadable file.
   */
  private static async synthesizeUntrackedDiff(relPath: string, absPath: string): Promise<string> {
    try {
      const stat = await fs.promises.stat(absPath);
      if (stat.isDirectory() || stat.size > this.MAX_DIFF_BYTES) {
        return '';
      }
      const buffer = await fs.promises.readFile(absPath);
      // Skip binary inspection if null byte present in first 8000 bytes
      const checkLength = Math.min(buffer.length, 8000);
      for (let i = 0; i < checkLength; i++) {
        if (buffer[i] === 0) {
          return '';
        }
      }

      const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      const lines = text.split(/\r?\n/);

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

    const gitApi = await this.getGitApi();
    if (!gitApi || !gitApi.repositories || gitApi.repositories.length === 0) {
      return '';
    }

    const statuses = await this.getFileStatuses();
    const diffBlocks: string[] = [];

    for (const filePath of filePaths) {
      const normPath = PathUtils.normalizePath(filePath);

      let matchedRepo: GitRepository | undefined;
      for (const repo of gitApi.repositories) {
        const repoRoot = PathUtils.normalizePath(repo.rootUri.fsPath);
        if (PathUtils.isSubpath(normPath, repoRoot)) {
          matchedRepo = repo;
          break;
        }
      }

      if (!matchedRepo) {
        continue;
      }

      const repoRoot = PathUtils.normalizePath(matchedRepo.rootUri.fsPath);
      const isFiltered = WorkspaceScanner.shouldFilterItem(normPath, false, filters, repoRoot);
      if (isFiltered) {
        continue;
      }

      const relPath = PathUtils.toPosixRelative(repoRoot, normPath);
      const status = statuses.get(normPath);

      let rawDiff = '';

      if (status === 'untracked') {
        rawDiff = await this.synthesizeUntrackedDiff(relPath, normPath);
      } else {
        try {
          // diffWithHEAD produces diff against working tree + staged index
          let headDiff = '';
          if (typeof matchedRepo.diffWithHEAD === 'function') {
            headDiff = (await matchedRepo.diffWithHEAD(relPath)) || '';
          }

          let indexDiff = '';
          if (typeof matchedRepo.diffIndexWithHEAD === 'function') {
            indexDiff = (await matchedRepo.diffIndexWithHEAD(relPath)) || '';
          }

          if (headDiff.trim().length > 0) {
            rawDiff = headDiff;
            // If staged diff has unique content not captured by working tree diff, append it
            if (indexDiff.trim().length > 0 && !headDiff.includes(indexDiff.trim())) {
              rawDiff = `${indexDiff}\n\n${headDiff}`;
            }
          } else if (indexDiff.trim().length > 0) {
            rawDiff = indexDiff;
          }
        } catch {
          // Ignore retrieval failure on individual path
        }
      }

      if (!rawDiff || rawDiff.trim().length === 0) {
        continue;
      }

      // Check size threshold
      if (!unlimitedDiff && rawDiff.length > this.MAX_DIFF_BYTES) {
        const truncated = rawDiff.slice(0, this.MAX_DIFF_BYTES);
        rawDiff = `${truncated}\n\n... [Diff превышает лимит 100 KB и был обрезан. Включите «Безлимитный Diff» для полного вывода] ...`;
      }

      diffBlocks.push(rawDiff.trim());
    }

    return diffBlocks.join('\n\n');
  }
}