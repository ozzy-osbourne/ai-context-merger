import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Utility functions for cross-platform file path operations, glob matching, and resolution.
 */
export class PathUtils {
  /**
   * In-memory cache storing compiled regular expressions for wildcard glob patterns.
   * Eliminates expensive repetitive RegExp compilation during workspace scans.
   */
  private static readonly globRegexCache = new Map<string, RegExp>();

  /**
   * Maximum allowable cache size to prevent memory leaks from excessive dynamic patterns.
   */
  private static readonly MAX_GLOB_CACHE_SIZE = 1000;

  /**
   * Clears the compiled glob regular expression cache.
   */
  public static clearGlobCache(): void {
    this.globRegexCache.clear();
  }

  /**
   * Safely resolves the canonical real path of a directory to prevent symlink recursion.
   *
   * @param targetPath - File system path to resolve.
   * @returns Canonical real path or original path on failure.
   */
  public static async getCanonicalPath(targetPath: string): Promise<string> {
    try {
      return await fs.promises.realpath(targetPath);
    } catch {
      return targetPath;
    }
  }

  /**
   * Normalizes a file system path and standardizes Windows drive letter casing.
   *
   * @param targetPath - Raw file system path.
   * @returns Normalized path with uppercase drive letter on Windows.
   */
  public static normalizePath(targetPath: string): string {
    const normalized = path.normalize(targetPath);
    if (process.platform === 'win32') {
      return normalized.replace(/^[a-zA-Z]:/, (match) => match.toUpperCase());
    }
    return normalized;
  }

  /**
   * Compares two paths for equality taking platform case-sensitivity into account.
   *
   * @param path1 - First path to compare.
   * @param path2 - Second path to compare.
   * @returns True if both paths point to the same location.
   */
  public static arePathsEqual(path1: string, path2: string): boolean {
    const norm1 = this.normalizePath(path1);
    const norm2 = this.normalizePath(path2);
    if (process.platform === 'win32') {
      return norm1.toLowerCase() === norm2.toLowerCase();
    }
    return norm1 === norm2;
  }

  /**
   * Determines whether a candidate path is inside a parent directory.
   *
   * @param candidatePath - Path to test.
   * @param parentDirPath - Boundary parent directory path.
   * @returns True if candidatePath is equal to or within parentDirPath.
   */
  public static isSubpath(candidatePath: string, parentDirPath: string): boolean {
    const normalizedTarget = this.normalizePath(candidatePath);
    const normalizedParent = this.normalizePath(parentDirPath);

    const target = process.platform === 'win32' ? normalizedTarget.toLowerCase() : normalizedTarget;
    const parent = process.platform === 'win32' ? normalizedParent.toLowerCase() : normalizedParent;

    if (target === parent) {
      return true;
    }

    const parentPrefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
    return target.startsWith(parentPrefix);
  }

  /**
   * Converts a path to POSIX-compliant relative format (using `/` as separator).
   *
   * @param from - Source directory path.
   * @param to - Destination path.
   * @returns POSIX-formatted relative path.
   */
  public static toPosixRelative(from: string, to: string): string {
    const normFrom = this.normalizePath(from);
    const normTo = this.normalizePath(to);
    return path.relative(normFrom, normTo).replace(/\\/g, '/');
  }

  /**
   * Resolves the enclosing workspace folder root path for a given target path.
   * Prioritizes nested sub-workspace folders over parent folders by sorting roots by depth descending.
   *
   * @param targetPath - Absolute path to inspect.
   * @param workspaceFolders - Optional list of workspace folders (defaults to active folders).
   * @returns Normalized root folder path or undefined if outside workspace.
   */
  public static getWorkspaceRoot(
    targetPath: string,
    workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders
  ): string | undefined {
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return undefined;
    }
    const normTarget = this.normalizePath(targetPath);

    // Sort by path length descending to ensure nested sub-workspaces take precedence over parents
    const sortedFolders = [...workspaceFolders].sort((a, b) => {
      const pathA = this.normalizePath(a.uri.fsPath);
      const pathB = this.normalizePath(b.uri.fsPath);
      return pathB.length - pathA.length;
    });

    const matchedFolder = sortedFolders.find((folder) =>
      this.isSubpath(normTarget, this.normalizePath(folder.uri.fsPath))
    );
    return matchedFolder ? this.normalizePath(matchedFolder.uri.fsPath) : undefined;
  }

  /**
   * Retrieves all ancestor directory paths starting from parent up to rootPath.
   *
   * @param targetPath - Child file or directory path.
   * @param rootPath - Boundary workspace root directory.
   * @returns Array of normalized ancestor directory paths.
   */
  public static getAncestorPaths(targetPath: string, rootPath: string): string[] {
    const ancestors: string[] = [];
    const normTarget = this.normalizePath(targetPath);
    const normRoot = this.normalizePath(rootPath);

    let parent = path.dirname(normTarget);
    while (this.isSubpath(parent, normRoot)) {
      const normalizedParent = this.normalizePath(parent);
      ancestors.push(normalizedParent);
      if (this.arePathsEqual(normalizedParent, normRoot)) {
        break;
      }
      const nextParent = path.dirname(normalizedParent);
      if (this.arePathsEqual(nextParent, normalizedParent)) {
        break;
      }
      parent = nextParent;
    }

    return ancestors;
  }

  /**
   * Computes workspace-relative POSIX path with Multi-Root workspace support.
   * Prioritizes deepest matching root directory when nested workspace folders exist.
   *
   * @param filePath - Absolute path to the file.
   * @param workspaceFolders - Active workspace folders list.
   * @returns Relative path suitable for headers and references.
   */
  public static getRelativePath(
    filePath: string,
    workspaceFolders?: readonly vscode.WorkspaceFolder[]
  ): string {
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return path.basename(filePath);
    }

    const normFilePath = this.normalizePath(filePath);

    // Sort folders by length descending to match closest enclosing subfolder first
    const sortedFolders = [...workspaceFolders].sort((a, b) => {
      const pathA = this.normalizePath(a.uri.fsPath);
      const pathB = this.normalizePath(b.uri.fsPath);
      return pathB.length - pathA.length;
    });

    for (const folder of sortedFolders) {
      const folderPath = this.normalizePath(folder.uri.fsPath);

      if (this.isSubpath(normFilePath, folderPath)) {
        const rel = this.toPosixRelative(folderPath, normFilePath);
        return workspaceFolders.length > 1 ? `${folder.name}/${rel}` : rel;
      }
    }

    return path.basename(filePath);
  }

  /**
   * Converts a wildcard glob pattern into an optimized matching regular expression.
   * Distinguishes between root-anchored rules (starting with '/'), floating filename patterns
   * without slashes (e.g. `*.meta`, matching at any directory depth), and path-specific rules.
   * Employs internal memory caching to guarantee O(1) retrieval on repeated evaluations.
   *
   * @param pattern - Glob pattern string (e.g. `**\/*.meta`, `src/utils/**`, `node_modules`, `/index.ts`).
   * @returns Precompiled regular expression.
   */
  public static globToRegex(pattern: string): RegExp {
    const cached = this.globRegexCache.get(pattern);
    if (cached) {
      return cached;
    }

    let p = pattern.trim().replace(/\\/g, '/');

    if (!p.includes('/') && !p.includes('*') && !p.includes('?')) {
      const bareRegex = new RegExp(`(^|/)${escapeRegex(p)}(/|$)`, 'i');
      if (this.globRegexCache.size >= this.MAX_GLOB_CACHE_SIZE) {
        this.globRegexCache.clear();
      }
      this.globRegexCache.set(pattern, bareRegex);
      return bareRegex;
    }

    let matchesChildren = false;
    if (p.endsWith('/**')) {
      p = p.slice(0, -3);
      matchesChildren = true;
      if (!p.includes('/') && !p.includes('*') && !p.includes('?')) {
        const trailingRegex = new RegExp(`(^|/)${escapeRegex(p)}(/|$)`, 'i');
        if (this.globRegexCache.size >= this.MAX_GLOB_CACHE_SIZE) {
          this.globRegexCache.clear();
        }
        this.globRegexCache.set(pattern, trailingRegex);
        return trailingRegex;
      }
    } else if (p.endsWith('/')) {
      p = p.slice(0, -1);
      matchesChildren = true;
    }

    let regexStr = '^';
    let i = 0;

    if (p.startsWith('**/')) {
      regexStr += '(?:.*/)?';
      i = 3;
    } else if (p.startsWith('/')) {
      regexStr += '/';
      i = 1;
    } else if (!p.includes('/')) {
      // Floating pattern without slashes (e.g. *.meta) matches files at any level
      regexStr += '(?:.*/)?';
    }

    while (i < p.length) {
      const c = p[i];

      if (c === '*' && p[i + 1] === '*') {
        if (p[i + 2] === '/') {
          regexStr += '(?:.*/)?';
          i += 3;
        } else {
          regexStr += '.*';
          i += 2;
        }
      } else if (c === '*') {
        regexStr += '[^/]*';
        i++;
      } else if (c === '?') {
        regexStr += '[^/]';
        i++;
      } else if ('/.$+()[]{}^|\\'.includes(c)) {
        regexStr += `\\${c}`;
        i++;
      } else {
        regexStr += c;
        i++;
      }
    }

    if (matchesChildren) {
      regexStr += '(?:/.*)?$';
    } else {
      regexStr += '$';
    }

    const compiled = new RegExp(regexStr, 'i');

    if (this.globRegexCache.size >= this.MAX_GLOB_CACHE_SIZE) {
      this.globRegexCache.clear();
    }
    this.globRegexCache.set(pattern, compiled);

    return compiled;
  }

  /**
   * Checks whether a given path or filename matches a glob pattern using cached regular expressions.
   *
   * @param testPath - POSIX relative path or filename.
   * @param pattern - Glob pattern.
   * @returns True if path matches glob.
   */
  public static matchesGlob(testPath: string, pattern: string): boolean {
    const norm = testPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const regex = this.globToRegex(pattern);
    return regex.test(norm) || regex.test(`/${norm}`);
  }
}

/**
 * Escapes characters with special meaning in Regular Expressions.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}