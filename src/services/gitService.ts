import * as vscode from 'vscode';
import * as fs from 'fs';
import { GitAPI, GitExtensionExports } from '../types';
import { PathUtils } from '../utils/pathUtils';

/**
 * Service providing integration with the built-in VS Code Git extension.
 */
export class GitService {
  private static cachedGitApi: GitAPI | null = null;

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
   * Collects all modified, untracked, and indexed file paths across active Git repositories asynchronously.
   *
   * @returns Array of normalized file paths with pending changes.
   */
  public static async getModifiedFilePaths(): Promise<string[]> {
    const modifiedSet = new Set<string>();

    try {
      const gitApi = await this.getGitApi();
      if (!gitApi || !gitApi.repositories || gitApi.repositories.length === 0) {
        return [];
      }

      for (const repo of gitApi.repositories) {
        const changes = [
          ...(repo.state.workingTreeChanges || []),
          ...(repo.state.untrackedChanges || []),
          ...(repo.state.indexChanges || [])
        ];

        for (const change of changes) {
          if (change && change.uri) {
            const fsPath = PathUtils.normalizePath(change.uri.fsPath);
            try {
              const stat = await fs.promises.stat(fsPath);
              if (!stat.isDirectory()) {
                modifiedSet.add(fsPath);
              }
            } catch {
              // Ignore missing or inaccessible file descriptors
            }
          }
        }
      }
    } catch {
      // Return collected paths on failure
    }

    return Array.from(modifiedSet);
  }
}