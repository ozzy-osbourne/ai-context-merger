import * as path from 'path';
import * as fs from 'fs';
import { FilterSettings } from '../types';
import { ALWAYS_IGNORED, LOCK_FILE_NAMES, BINARY_EXTENSIONS, isSecretFile, isMinifiedOrSourceMap } from '../constants';
import { GitService } from './gitService';
import { PathUtils } from '../utils/pathUtils';

/**
 * Scanned directory entry containing the filesystem descriptor and its normalized path.
 */
export interface ScannedDirectoryEntry {
  readonly entry: fs.Dirent;
  readonly fullPath: string;
}

/**
 * Service for scanning workspace directories, checking exclusion rules, and calculating file metrics.
 */
export class WorkspaceScanner {
  /**
   * Checks if a path belongs to unconditionally ignored system directories.
   * Restricts segment evaluation to workspace boundaries when a root path is provided.
   * Accurately inspects all path segments across Windows, Linux, and macOS.
   *
   * @param fullPath - Absolute target path.
   * @param workspaceRootPath - Optional workspace root path for relative segment extraction.
   * @returns `true` if path contains an ignored segment.
   */
  public static isIgnoredByPathSegments(fullPath: string, workspaceRootPath?: string): boolean {
    const normalized = PathUtils.normalizePath(fullPath);
    let relative = normalized;

    if (workspaceRootPath) {
      const normRoot = PathUtils.normalizePath(workspaceRootPath);
      if (PathUtils.arePathsEqual(normalized, normRoot)) {
        return false;
      }
      if (PathUtils.isSubpath(normalized, normRoot)) {
        relative = path.relative(normRoot, normalized);
      }
    }

    const segments = relative.split(/[\\/]/).filter(Boolean);

    for (const segment of segments) {
      // Skip Windows drive letters (e.g. "C:")
      if (/^[a-zA-Z]:$/.test(segment)) {
        continue;
      }
      if (ALWAYS_IGNORED.has(segment)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if a file matches active exclusion filters (secrets, maps/minified, lockfiles, binaries).
   *
   * @param name - File or directory base name.
   * @param isDirectory - Directory flag.
   * @param filters - Active filter settings.
   * @returns `true` if item should be excluded.
   */
  public static isFilteredByType(name: string, isDirectory: boolean, filters: FilterSettings): boolean {
    if (isDirectory) {
      return false;
    }

    if (filters.hideSecrets && isSecretFile(name)) {
      return true;
    }

    if (filters.hideMinified && isMinifiedOrSourceMap(name)) {
      return true;
    }

    const ext = path.extname(name).toLowerCase();
    if (filters.hideLockFiles && LOCK_FILE_NAMES.has(name)) {
      return true;
    }
    if (filters.hideBinaryFiles && BINARY_EXTENSIONS.has(ext)) {
      return true;
    }
    return false;
  }

  /**
   * Evaluates all exclusion rules for a given file or directory item, including Git repository ignore rules.
   * Strictly forbids following symbolic links for security and isolation.
   * Bypasses lstat check when inspecting a known deleted Git file.
   *
   * @param fullPath - Absolute path to item.
   * @param isDirectory - Directory flag.
   * @param filters - Active filter settings.
   * @param workspaceRootPath - Optional workspace root directory.
   * @param isGitDeleted - Flag indicating that the file is physically absent because it was deleted in Git.
   * @returns `true` if item should be filtered out.
   */
  public static async shouldFilterItem(
    fullPath: string,
    isDirectory: boolean,
    filters: FilterSettings,
    workspaceRootPath?: string,
    isGitDeleted: boolean = false
  ): Promise<boolean> {
    if (!isGitDeleted) {
      try {
        const lstat = await fs.promises.lstat(fullPath);
        // Strictly forbid symbolic links to avoid directory traversal and symlink loops
        if (lstat.isSymbolicLink()) {
          return true;
        }
      } catch {
        return true;
      }
    }

    const fileName = path.basename(fullPath);

    if (this.isIgnoredByPathSegments(fullPath, workspaceRootPath)) {
      return true;
    }

    if (this.isFilteredByType(fileName, isDirectory, filters)) {
      return true;
    }

    if (!isGitDeleted && filters.hideGitIgnored) {
      const isIgnored = await GitService.isPathIgnored(fullPath, isDirectory);
      if (isIgnored) {
        return true;
      }
    }

    return false;
  }

  /**
   * Reads a directory and filters out items matching system ignores, Git ignores, active file filters,
   * and strictly rejects all symbolic links.
   *
   * @param dirPath - Absolute directory path to read.
   * @param filters - Active exclusion filters.
   * @returns Array of eligible directory entries with resolved paths.
   */
  public static async readValidDirectoryEntries(
    dirPath: string,
    filters: FilterSettings
  ): Promise<ScannedDirectoryEntry[]> {
    const normalizedDirPath = PathUtils.normalizePath(dirPath);

    try {
      const lstat = await fs.promises.lstat(normalizedDirPath);
      if (lstat.isSymbolicLink() || !lstat.isDirectory()) {
        return [];
      }

      const entries = await fs.promises.readdir(normalizedDirPath, { withFileTypes: true });
      // Filter out system ignores and strictly ignore all symbolic links
      const primaryFiltered = entries.filter((entry) => !ALWAYS_IGNORED.has(entry.name) && !entry.isSymbolicLink());

      const resolvedEntries: Array<{ entry: fs.Dirent; fullPath: string; isDir: boolean }> = primaryFiltered.map(
        (entry) => ({
          entry,
          fullPath: PathUtils.normalizePath(path.join(normalizedDirPath, entry.name)),
          isDir: entry.isDirectory()
        })
      );

      let gitIgnoredPaths = new Set<string>();
      if (filters.hideGitIgnored) {
        const candidatePaths = resolvedEntries.map((e) => (e.isDir ? `${e.fullPath}/` : e.fullPath));
        gitIgnoredPaths = await GitService.checkIgnoredPaths(candidatePaths);
      }

      const validEntries: ScannedDirectoryEntry[] = [];
      for (const { entry, fullPath, isDir } of resolvedEntries) {
        if (filters.hideGitIgnored) {
          if (gitIgnoredPaths.has(fullPath) || gitIgnoredPaths.has(`${fullPath}/`)) {
            continue;
          }
        }

        if (this.isFilteredByType(entry.name, isDir, filters)) {
          continue;
        }

        validEntries.push({ entry, fullPath });
      }

      return validEntries;
    } catch {
      return [];
    }
  }

  /**
   * Counts the total number of selectable files in a directory subtree and caches counts for folders.
   *
   * @param dirPath - Root directory path.
   * @param filters - Active filter settings.
   * @param countMap - Map cache to store counts for intermediate folders.
   * @param visitedDirs - Set of visited directory real paths to prevent recursion loops.
   * @returns Total number of selectable files.
   */
  public static async countSelectableFiles(
    dirPath: string,
    filters: FilterSettings,
    countMap?: Map<string, number>,
    visitedDirs: Set<string> = new Set<string>()
  ): Promise<number> {
    const normalizedDirPath = PathUtils.normalizePath(dirPath);
    const realDir = await PathUtils.getCanonicalPath(normalizedDirPath);

    if (visitedDirs.has(realDir)) {
      return 0;
    }
    visitedDirs.add(realDir);

    if (countMap && countMap.has(normalizedDirPath)) {
      return countMap.get(normalizedDirPath)!;
    }

    let count = 0;
    const validEntries = await this.readValidDirectoryEntries(normalizedDirPath, filters);

    for (const { entry, fullPath } of validEntries) {
      if (entry.isDirectory()) {
        const childCount = await this.countSelectableFiles(fullPath, filters, countMap, visitedDirs);
        count += childCount;
      } else {
        count++;
      }
    }

    if (countMap) {
      countMap.set(normalizedDirPath, count);
    }

    return count;
  }

  /**
   * Recursively searches for files matching a query substring while applying exclusion filters.
   *
   * @param dirPath - Root directory path to search.
   * @param query - Substring to match against file name.
   * @param filters - Active filter settings.
   * @param visitedDirs - Set of visited directory real paths to prevent recursion loops.
   * @returns Array of matching file paths.
   */
  public static async findMatchingFiles(
    dirPath: string,
    query: string,
    filters: FilterSettings,
    visitedDirs: Set<string> = new Set<string>()
  ): Promise<string[]> {
    const results: string[] = [];
    const normalizedDirPath = PathUtils.normalizePath(dirPath);
    const lowerQuery = query.toLowerCase();
    const realDir = await PathUtils.getCanonicalPath(normalizedDirPath);

    if (visitedDirs.has(realDir)) {
      return results;
    }
    visitedDirs.add(realDir);

    const validEntries = await this.readValidDirectoryEntries(normalizedDirPath, filters);

    for (const { entry, fullPath } of validEntries) {
      if (entry.isDirectory()) {
        const subResults = await this.findMatchingFiles(fullPath, query, filters, visitedDirs);
        results.push(...subResults);
      } else {
        if (entry.name.toLowerCase().includes(lowerQuery)) {
          results.push(fullPath);
        }
      }
    }

    return results;
  }
}