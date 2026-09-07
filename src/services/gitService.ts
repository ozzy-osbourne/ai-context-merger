import * as vscode from 'vscode';
import * as fs from 'fs';
import {
  GitAPI,
  GitExtensionExports,
  GitFileStatus,
  GitRepository,
  VscodeGitStatus
} from '../types';
import { PathUtils } from '../utils/pathUtils';

/**
 * Service providing integration with the built-in VS Code Git extension.
 */
export class GitService {
  private static cachedGitApi: GitAPI | null = null;

  /**
   * Resolves and caches the API instance of the built-in vscode.git extension.
   *
   * @returns Git API v1 instance or `null` if the extension is unavailable.
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

      const repoMap = gitApi.repositories.map((repo) => {
        const rootFsPath = PathUtils.normalizePath(repo.rootUri.fsPath);
        return {
          repo,
          rootPath: rootFsPath
        };
      });

      const repoPathsMap = new Map<GitRepository, string[]>();

      for (const itemPath of paths) {
        const normalizedPath = PathUtils.normalizePath(itemPath);

        const matched = repoMap.find((r) => PathUtils.isSubpath(normalizedPath, r.rootPath));

        if (matched && typeof matched.repo.checkIgnore === 'function') {
          const group = repoPathsMap.get(matched.repo) || [];
          group.push(normalizedPath);
          repoPathsMap.set(matched.repo, group);
        }
      }

      const checkPromises = Array.from(repoPathsMap.entries()).map(async ([repo, repoPaths]) => {
        try {
          const result: Set<string> = await repo.checkIgnore(repoPaths);
          for (const item of result) {
            ignoredPaths.add(PathUtils.normalizePath(item));
          }
        } catch {
          // Ignore individual repository check failure
        }
      });

      await Promise.all(checkPromises);
    } catch {
      // Return empty set on overall failure
    }

    return ignoredPaths;
  }

  /**
   * Retrieves the current Git status map for active working tree and index changes.
   *
   * @returns Map of normalized file paths to their UI status ('modified' | 'untracked').
   */
  public static async getGitStatusMap(): Promise<Map<string, GitFileStatus>> {
    const statusMap = new Map<string, GitFileStatus>();

    try {
      const gitApi = await this.getGitApi();
      if (!gitApi || !gitApi.repositories || gitApi.repositories.length === 0) {
        return statusMap;
      }

      for (const repo of gitApi.repositories) {
        // 1. Untracked changes
        for (const change of repo.state.untrackedChanges) {
          const normPath = PathUtils.normalizePath(change.uri.fsPath);
          if (fs.existsSync(normPath)) {
            statusMap.set(normPath, 'untracked');
          }
        }

        // 2. Working tree modifications
        for (const change of repo.state.workingTreeChanges) {
          const normPath = PathUtils.normalizePath(change.uri.fsPath);

          const isDeleted =
            change.status === VscodeGitStatus.DELETED ||
            change.status === VscodeGitStatus.DELETED_BY_US ||
            change.status === VscodeGitStatus.DELETED_BY_THEM ||
            change.status === VscodeGitStatus.BOTH_DELETED;

          if (isDeleted || !fs.existsSync(normPath)) {
            continue;
          }

          const isUntracked = change.status === VscodeGitStatus.UNTRACKED;
          statusMap.set(normPath, isUntracked ? 'untracked' : 'modified');
        }

        // 3. Staged index changes
        for (const change of repo.state.indexChanges) {
          const normPath = PathUtils.normalizePath(change.uri.fsPath);

          if (change.status === VscodeGitStatus.INDEX_DELETED || !fs.existsSync(normPath)) {
            continue;
          }

          const isAdded = change.status === VscodeGitStatus.INDEX_ADDED;
          if (!statusMap.has(normPath)) {
            statusMap.set(normPath, isAdded ? 'untracked' : 'modified');
          }
        }
      }
    } catch {
      // Return collected statuses on error
    }

    return statusMap;
  }
}