import * as path from 'path';
import * as fs from 'fs';
import { FilterSettings } from '../types';
import { ALWAYS_IGNORED, LOCK_FILE_NAMES, BINARY_EXTENSIONS } from '../constants';
import { GitService } from './gitService';
import { PathUtils } from '../utils/pathUtils';

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
		let count = 0;

		try {
			const stat = await fs.promises.stat(normalizedDirPath);
			if (!stat.isDirectory()) {
				return 0;
			}

			const entries = await fs.promises.readdir(normalizedDirPath, { withFileTypes: true });
			const primaryFiltered = entries.filter((e) => !ALWAYS_IGNORED.has(e.name));

			let gitIgnoredPaths = new Set<string>();
			if (filters.hideGitIgnored) {
				const candidatePaths = primaryFiltered.map((e) =>
					PathUtils.normalizePath(path.join(normalizedDirPath, e.name))
				);
				gitIgnoredPaths = await GitService.checkIgnoredPaths(candidatePaths);
			}

			for (const entry of primaryFiltered) {
				const fullPath = PathUtils.normalizePath(path.join(normalizedDirPath, entry.name));

				if (filters.hideGitIgnored && gitIgnoredPaths.has(fullPath)) {
					continue;
				}

				if (entry.isDirectory()) {
					const childCount = await this.countSelectableFiles(fullPath, filters, countMap);
					count += childCount;
				} else {
					if (this.isFilteredByType(entry.name, false, filters)) {
						continue;
					}
					count++;
				}
			}

			if (countMap) {
				countMap.set(normalizedDirPath, count);
			}
		} catch {
			return 0;
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

		try {
			const stat = await fs.promises.stat(normalizedDirPath);
			if (!stat.isDirectory()) {
				return 0;
			}

			const entries = await fs.promises.readdir(normalizedDirPath, { withFileTypes: true });
			const primaryFilteredEntries = entries.filter((entry) => !ALWAYS_IGNORED.has(entry.name));

			let gitIgnoredPaths = new Set<string>();
			if (filters.hideGitIgnored) {
				const candidatePaths = primaryFilteredEntries.map((e) =>
					PathUtils.normalizePath(path.join(normalizedDirPath, e.name))
				);
				gitIgnoredPaths = await GitService.checkIgnoredPaths(candidatePaths);
			}

			for (const entry of primaryFilteredEntries) {
				const fullPath = PathUtils.normalizePath(path.join(normalizedDirPath, entry.name));

				if (filters.hideGitIgnored && gitIgnoredPaths.has(fullPath)) {
					continue;
				}

				if (entry.isDirectory()) {
					const childCount = await this.selectFolderRecursive(
						fullPath,
						filters,
						selectedFiles,
						countMap
					);
					affectedCount += childCount;
				} else {
					if (this.isFilteredByType(entry.name, false, filters)) {
						continue;
					}

					affectedCount++;
					selectedFiles.add(fullPath);
				}
			}

			if (countMap) {
				countMap.set(normalizedDirPath, affectedCount);
			}
		} catch {
			return 0;
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

		try {
			const entries = await fs.promises.readdir(normalizedDirPath, { withFileTypes: true });
			const primaryFiltered = entries.filter((e) => !ALWAYS_IGNORED.has(e.name));

			let gitIgnoredPaths = new Set<string>();
			if (filters.hideGitIgnored) {
				const candidatePaths = primaryFiltered.map((e) =>
					PathUtils.normalizePath(path.join(normalizedDirPath, e.name))
				);
				gitIgnoredPaths = await GitService.checkIgnoredPaths(candidatePaths);
			}

			for (const entry of primaryFiltered) {
				const fullPath = PathUtils.normalizePath(path.join(normalizedDirPath, entry.name));

				if (filters.hideGitIgnored && gitIgnoredPaths.has(fullPath)) {
					continue;
				}

				if (entry.isDirectory()) {
					const subResults = await this.findMatchingFiles(fullPath, query, filters);
					results.push(...subResults);
				} else {
					if (this.isFilteredByType(entry.name, false, filters)) {
						continue;
					}
					if (entry.name.toLowerCase().includes(lowerQuery)) {
						results.push(fullPath);
					}
				}
			}
		} catch {
			return [];
		}

		return results;
	}
}