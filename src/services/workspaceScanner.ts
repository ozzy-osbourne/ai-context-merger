import * as path from 'path';
import * as fs from 'fs';
import { FileNode, FilterSettings, GitFileStatus } from '../types';
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
	 * @param workspaceRootPath - Workspace root path for relative segment extraction.
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
	 * @param workspaceRootPath - Workspace root directory.
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
	 * Recursively scans directory and builds hierarchical file nodes.
	 *
	 * @param dirPath - Directory path to scan.
	 * @param gitStatusMap - Map of active Git statuses.
	 * @param filters - Active filter settings.
	 * @param maxDepth - Maximum recursion depth limit.
	 * @param currentDepth - Current recursion depth.
	 * @param isCanceled - Optional cancellation probe function.
	 * @returns Root file node of scanned hierarchy.
	 */
	public static async scanDirectory(
		dirPath: string,
		gitStatusMap: Map<string, GitFileStatus>,
		filters: FilterSettings,
		maxDepth: number = 20,
		currentDepth: number = 0,
		isCanceled?: () => boolean
	): Promise<FileNode> {
		const normalizedDirPath = PathUtils.normalizePath(dirPath);
		const name = path.basename(normalizedDirPath);
		const node: FileNode = {
			name,
			path: normalizedDirPath,
			isDirectory: true,
			gitStatus: 'none',
			gitFolderStatus: 'none',
			children: []
		};

		if (isCanceled?.() || currentDepth >= maxDepth) {
			return node;
		}

		try {
			const stat = await fs.promises.stat(normalizedDirPath);
			if (!stat.isDirectory()) {
				return node;
			}

			const entries = await fs.promises.readdir(normalizedDirPath, { withFileTypes: true });
			if (isCanceled?.()) {
				return node;
			}

			// 1. Primary system exclusions
			const primaryFilteredEntries = entries.filter((entry) => !ALWAYS_IGNORED.has(entry.name));

			// 2. .gitignore checks
			let gitIgnoredPaths = new Set<string>();
			if (filters.hideGitIgnored) {
				const candidatePaths = primaryFilteredEntries.map((e) =>
					PathUtils.normalizePath(path.join(normalizedDirPath, e.name))
				);
				gitIgnoredPaths = await GitService.checkIgnoredPaths(candidatePaths);
			}

			if (isCanceled?.()) {
				return node;
			}

			// 3. Lockfile and binary filtering
			const validEntries = primaryFilteredEntries.filter((entry) => {
				const fullPath = PathUtils.normalizePath(path.join(normalizedDirPath, entry.name));
				if (filters.hideGitIgnored && gitIgnoredPaths.has(fullPath)) {
					return false;
				}
				if (this.isFilteredByType(entry.name, entry.isDirectory(), filters)) {
					return false;
				}
				return true;
			});

			const sortedEntries = validEntries.sort((a, b) => {
				if (a.isDirectory() === b.isDirectory()) {
					return a.name.localeCompare(b.name);
				}
				return a.isDirectory() ? -1 : 1;
			});

			let hasUntracked = false;
			let hasModified = false;

			for (const entry of sortedEntries) {
				if (isCanceled?.()) {
					return node;
				}

				const fullPath = PathUtils.normalizePath(path.join(normalizedDirPath, entry.name));

				if (entry.isDirectory()) {
					const childFolder = await this.scanDirectory(
						fullPath,
						gitStatusMap,
						filters,
						maxDepth,
						currentDepth + 1,
						isCanceled
					);

					if (childFolder.gitFolderStatus === 'untracked') {
						hasUntracked = true;
					}
					if (childFolder.gitFolderStatus === 'modified') {
						hasModified = true;
					}

					node.children?.push(childFolder);
				} else {
					const fileStatus = gitStatusMap.get(fullPath) || 'none';
					if (fileStatus === 'untracked') {
						hasUntracked = true;
					}
					if (fileStatus === 'modified') {
						hasModified = true;
					}

					node.children?.push({
						name: entry.name,
						path: fullPath,
						isDirectory: false,
						gitStatus: fileStatus
					});
				}
			}

			if (hasUntracked) {
				node.gitFolderStatus = 'untracked';
			} else if (hasModified) {
				node.gitFolderStatus = 'modified';
			}
		} catch {
			// Return current node on FS read failure
		}

		return node;
	}

	/**
	 * Recursively updates selection state for all eligible files in directory.
	 *
	 * @param dirPath - Root directory path.
	 * @param checked - Selected state.
	 * @param filters - Active filter settings.
	 * @param selectedFiles - Target selection set to mutate.
	 */
	public static async toggleFolderRecursive(
		dirPath: string,
		checked: boolean,
		filters: FilterSettings,
		selectedFiles: Set<string>
	): Promise<void> {
		const normalizedDirPath = PathUtils.normalizePath(dirPath);

		try {
			const stat = await fs.promises.stat(normalizedDirPath);
			if (!stat.isDirectory()) {
				return;
			}
		} catch {
			for (const file of Array.from(selectedFiles)) {
				if (PathUtils.isSubpath(file, normalizedDirPath)) {
					selectedFiles.delete(file);
				}
			}
			return;
		}

		try {
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
					await this.toggleFolderRecursive(fullPath, checked, filters, selectedFiles);
				} else {
					if (this.isFilteredByType(entry.name, false, filters)) {
						continue;
					}

					if (checked) {
						selectedFiles.add(fullPath);
					} else {
						selectedFiles.delete(fullPath);
					}
				}
			}
		} catch {
			// Ignore subtree recursion error
		}
	}
}