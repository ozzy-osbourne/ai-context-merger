import * as path from 'path';

/**
 * Utility class for cross-platform file path operations and comparisons.
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
   * @param to - Destination file path.
   * @returns POSIX-formatted relative path.
   */
  public static toPosixRelative(from: string, to: string): string {
    const normFrom = this.normalizePath(from);
    const normTo = this.normalizePath(to);
    return path.relative(normFrom, normTo).replace(/\\/g, '/');
  }
}