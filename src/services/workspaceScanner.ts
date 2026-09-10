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
 * Service for scanning workspace directories and managing hierarchical selections.
 */
export class WorkspaceScanner {
	/**
	 * Checks if a path belongs to unconditionally ignored system directories.
	 *
	 * @param fullPath - Absolute target path.
	 * @param workspaceRootPath - Optional workspace root path for relative segment extraction.
	 * @returns `true` if path contains an ignored segment.
	 */
	public static isIgnoredByPathSegments(fullPath: string, workspaceRootPath?: string): boolean {
		const normalized = PathUtils.normalizePath(fullPath);
		let relative = normalized;

		if (workspaceRootPath) {
			relative = path.relative(PathUtils.normalizePath(workspaceRootPath), normalized);
		}

		const segments = relative.split(path.sep);
		const startIndex = (!workspaceRootPath && path.isAbsolute(normalized)) ? 1 : 0;

		for (let i = startIndex; i < segments.length; i++) {
			const segment = segments[i];
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
	 * Evaluates all exclusion rules for a given file item.
	 *
	 * @param fullPath - Absolute path to item.
	 * @param isDirectory - Directory flag.
	 * @param filters - Active filter settings.
	 * @param workspaceRootPath - Optional workspace root directory.
	 * @returns `true` if item should be filtered out.
	 */
	public static shouldFilterItem(
		fullPath: string,
		isDirectory: boolean,
		filters: FilterSettings,
		workspaceRootPath?: string
	): boolean {
		const fileName = path.basename(fullPath);

		if (this.isIgnoredByPathSegments(fullPath, workspaceRootPath)) {
			return true;
		}

		return this.isFilteredByType(fileName, isDirectory, filters);
	}

	/**
	 * Reads a directory and filters out items matching system ignores, Git ignores, and active file filters.
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
			const stat = await fs.promises.stat(normalizedDirPath);
			if (!stat.isDirectory()) {
				return [];
			}

			const entries = await fs.promises.readdir(normalizedDirPath, { withFileTypes: true });
			const primaryFiltered = entries.filter((entry) => !ALWAYS_IGNORED.has(entry.name));

			const resolvedEntries: Array<{ entry: fs.Dirent; fullPath: string; isDir: boolean }> = [];

			for (const entry of primaryFiltered) {
				const fullPath = PathUtils.normalizePath(path.join(normalizedDirPath, entry.name));
				let isDir = entry.isDirectory();

				if (entry.isSymbolicLink()) {
					try {
						const targetStat = await fs.promises.stat(fullPath);
						isDir = targetStat.isDirectory();
					} catch {
						continue;
					}
				}

				let resolvedEntry = entry;
				if (entry.isSymbolicLink()) {
					resolvedEntry = Object.create(entry, {
						isDirectory: { value: () => isDir },
						isFile: { value: () => !isDir }
					});
				}

				resolvedEntries.push({ entry: resolvedEntry, fullPath, isDir });
			}

			let gitIgnoredPaths = new Set<string>();
			if (filters.hideGitIgnored) {
				const candidatePaths = resolvedEntries.map((e) => e.fullPath);
				gitIgnoredPaths = await GitService.checkIgnoredPaths(candidatePaths);
			}

			const validEntries: ScannedDirectoryEntry[] = [];
			for (const { entry, fullPath, isDir } of resolvedEntries) {
				if (filters.hideGitIgnored && gitIgnoredPaths.has(fullPath)) {
					continue;
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
	 * @param visitedDirs - Set of visited directory real paths to prevent symlink loops.
	 * @returns Total number of selectable files.
	 */
	public static async countSelectableFiles(
		dirPath: string,
		filters: FilterSettings,
		countMap?: Map<string, number>,
		visitedDirs: Set<string> = new Set<string>()
	): Promise<number> {
		const normalizedDirPath = PathUtils.normalizePath(dirPath);

		let realDir: string;
		try {
			realDir = await fs.promises.realpath(normalizedDirPath);
		} catch {
			realDir = normalizedDirPath;
		}

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
	 * Recursively selects all eligible files in directory and populates folder counts.
	 *
	 * @param dirPath - Root directory path.
	 * @param filters - Active filter settings.
	 * @param selectedFiles - Selection set to mutate.
	 * @param countMap - Optional map to store total file counts per folder.
	 * @param visitedDirs - Set of visited directory real paths to prevent symlink loops.
	 * @returns Total count of selectable files processed within directory.
	 */
	public static async selectFolderRecursive(
		dirPath: string,
		filters: FilterSettings,
		selectedFiles: Set<string>,
		countMap?: Map<string, number>,
		visitedDirs: Set<string> = new Set<string>()
	): Promise<number> {
		const normalizedDirPath = PathUtils.normalizePath(dirPath);

		let realDir: string;
		try {
			realDir = await fs.promises.realpath(normalizedDirPath);
		} catch {
			realDir = normalizedDirPath;
		}

		if (visitedDirs.has(realDir)) {
			return 0;
		}
		visitedDirs.add(realDir);

		let affectedCount = 0;

		const validEntries = await this.readValidDirectoryEntries(normalizedDirPath, filters);

		for (const { entry, fullPath } of validEntries) {
			if (entry.isDirectory()) {
				const childCount = await this.selectFolderRecursive(
					fullPath,
					filters,
					selectedFiles,
					countMap,
					visitedDirs
				);
				affectedCount += childCount;
			} else {
				affectedCount++;
				selectedFiles.add(fullPath);
			}
		}

		if (countMap) {
			countMap.set(normalizedDirPath, affectedCount);
		}

		return affectedCount;
	}

	/**
	 * Recursively searches for files matching a query substring while applying exclusion filters.
	 *
	 * @param dirPath - Root directory path to search.
	 * @param query - Substring to match against file name.
	 * @param filters - Active filter settings.
	 * @param visitedDirs - Set of visited directory real paths to prevent symlink loops.
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

		let realDir: string;
		try {
			realDir = await fs.promises.realpath(normalizedDirPath);
		} catch {
			realDir = normalizedDirPath;
		}

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