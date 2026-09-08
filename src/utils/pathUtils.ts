import * as path from 'path';

/**
 * Utility class for cross-platform file path operations, comparisons, and hierarchy traversal.
 */
export class PathUtils {
  /**
   * Normalizes a file system path and standardizes Windows drive letter casing.
   *
   * @param targetPath - The raw file system path.
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
   * @returns `true` if both paths point to the same location.
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
   * Determines whether a target path is equal to or located inside a parent directory.
   * Handles case-insensitive comparison on Windows.
   *
   * @param candidatePath - The path to test.
   * @param parentDirPath - The parent directory path.
   * @returns `true` if candidatePath is equal to or within parentDirPath.
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
   * @returns POSIX-formatted relative path.
   */
  public static toPosixRelative(from: string, to: string): string {
    const normFrom = this.normalizePath(from);
    const normTo = this.normalizePath(to);
    return path.relative(normFrom, normTo).replace(/\\/g, '/');
  }

  /**
   * Retrieves all ancestor directory paths starting from the parent of targetPath up to and including rootPath.
   *
   * @param targetPath - The child file or directory path.
   * @param rootPath - The boundary workspace root directory.
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
}