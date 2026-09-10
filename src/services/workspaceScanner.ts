import * as path from 'path';
import * as fs from 'fs';
import { FilterSettings } from '../types';
import { ALWAYS_IGNORED, LOCK_FILE_NAMES, BINARY_EXTENSIONS } from '../constants';
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
		const relative = workspaceRootPath
			? path.relative(PathUtils.normalizePath(workspaceRootPath), normalized)
			: normalized;

		const segments = relative.split(path.sep);
		for (const segment of segments) {
			if (ALWAYS_IGNORED.has(segment)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Checks if a file matches active lockfile or binary exclusion filters.
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

			let gitIgnoredPaths = new Set<string>();
			if (filters.hideGitIgnored) {
				const candidatePaths = primaryFiltered.map((entry) =>
					PathUtils.normalizePath(path.join(normalizedDirPath, entry.name))
				);
				gitIgnoredPaths = await GitService.checkIgnoredPaths(candidatePaths);
			}

			const validEntries: ScannedDirectoryEntry[] = [];
			for (const entry of primaryFiltered) {
				const fullPath = PathUtils.normalizePath(path.join(normalizedDirPath, entry.name));

				if (filters.hideGitIgnored && gitIgnoredPaths.has(fullPath)) {
					continue;
				}

				if (this.isFilteredByType(entry.name, entry.isDirectory(), filters)) {
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
	 * @returns Total number of selectable files.
	 */
	public static async countSelectableFiles(
		dirPath: string,
		filters: FilterSettings,
		countMap?: Map<string, number>
	): Promise<number> {
		const normalizedDirPath = PathUtils.normalizePath(dirPath);

		if (countMap && countMap.has(normalizedDirPath)) {
			return countMap.get(normalizedDirPath)!;
		}

		let count = 0;
		const validEntries = await this.readValidDirectoryEntries(normalizedDirPath, filters);

		for (const { entry, fullPath } of validEntries) {
			if (entry.isDirectory()) {
				const childCount = await this.countSelectableFiles(fullPath, filters, countMap);
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
	 * @returns Total count of selectable files processed within directory.
	 */
	public static async selectFolderRecursive(
		dirPath: string,
		filters: FilterSettings,
		selectedFiles: Set<string>,
		countMap?: Map<string, number>
	): Promise<number> {
		const normalizedDirPath = PathUtils.normalizePath(dirPath);
		let affectedCount = 0;

		const validEntries = await this.readValidDirectoryEntries(normalizedDirPath, filters);

		for (const { entry, fullPath } of validEntries) {
			if (entry.isDirectory()) {
				const childCount = await this.selectFolderRecursive(
					fullPath,
					filters,
					selectedFiles,
					countMap
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
	 * @returns Array of matching file paths.
	 */
	public static async findMatchingFiles(
		dirPath: string,
		query: string,
		filters: FilterSettings
	): Promise<string[]> {
		const results: string[] = [];
		const normalizedDirPath = PathUtils.normalizePath(dirPath);
		const lowerQuery = query.toLowerCase();

		const validEntries = await this.readValidDirectoryEntries(normalizedDirPath, filters);

		for (const { entry, fullPath } of validEntries) {
			if (entry.isDirectory()) {
				const subResults = await this.findMatchingFiles(fullPath, query, filters);
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