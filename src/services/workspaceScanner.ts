import * as path from 'path';
import * as fs from 'fs';
import { FileNode, FilterSettings, GitFileStatus } from '../types';
import { ALWAYS_IGNORED, LOCK_FILE_NAMES, BINARY_EXTENSIONS } from '../constants';
import { GitService } from './gitService';

export class WorkspaceScanner {
    /**
     * Безопасная проверка вхождения пути с учетом регистра Windows
     * @param targetPath Проверяемый путь к файлу или директории
     * @param parentDirPath Путь к родительской директории
     */
    public static isPathInside(targetPath: string, parentDirPath: string): boolean {
        const normalizedTarget = path.normalize(targetPath);
        const normalizedParent = path.normalize(parentDirPath);

        const target = process.platform === 'win32' ? normalizedTarget.toLowerCase() : normalizedTarget;
        const parent = process.platform === 'win32' ? normalizedParent.toLowerCase() : normalizedParent;

        if (target === parent) {
            return true;
        }

        const parentPrefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
        return target.startsWith(parentPrefix);
    }

    /**
     * Проверка, находится ли путь внутри всегда игнорируемых системных директорий
     * @param fullPath Абсолютный путь
     * @param workspaceRootPath Корень рабочей области
     */
    public static isIgnoredByPathSegments(fullPath: string, workspaceRootPath?: string): boolean {
        const normalized = path.normalize(fullPath);
        const relative = workspaceRootPath 
            ? path.relative(workspaceRootPath, normalized) 
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
     * Проверка фильтров lock-файлов и бинарников
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
     * Комплексная проверка элемента на исключение
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
     * Сканирование директории с защитой от циклических путей и глубокой вложенности
     * @param dirPath Путь к директории
     * @param gitStatusMap Карта статусов Git
     * @param filters Настройки фильтрации
     * @param maxDepth Максимальная безопасная глубина сканирования
     * @param currentDepth Текущий уровень вложенности
     * @param isCanceled Функция отмены операции
     */
    public static async scanDirectory(
        dirPath: string,
        gitStatusMap: Map<string, GitFileStatus>,
        filters: FilterSettings,
        maxDepth: number = 20,
        currentDepth: number = 0,
        isCanceled?: () => boolean
    ): Promise<FileNode> {
        const normalizedDirPath = path.normalize(dirPath);
        const name = path.basename(normalizedDirPath);
        const node: FileNode = {
            name,
            path: normalizedDirPath,
            isDirectory: true,
            gitStatus: 'none',
            gitFolderStatus: 'none',
            children: []
        };

        if (isCanceled && isCanceled()) {
            return node;
        }

        if (currentDepth >= maxDepth) {
            return node;
        }

        try {
            const stat = await fs.promises.stat(normalizedDirPath);
            if (!stat.isDirectory()) {
                return node;
            }

            const entries = await fs.promises.readdir(normalizedDirPath, { withFileTypes: true });
            if (isCanceled && isCanceled()) {
                return node;
            }

            // 1. Фильтрация системных папок
            const primaryFilteredEntries = entries.filter(entry => !ALWAYS_IGNORED.has(entry.name));

            // 2. Проверка правил .gitignore
            let gitIgnoredPaths = new Set<string>();
            if (filters.hideGitIgnored) {
                const candidatePaths = primaryFilteredEntries.map(e => path.normalize(path.join(normalizedDirPath, e.name)));
                gitIgnoredPaths = await GitService.checkIgnoredPaths(candidatePaths);
            }

            if (isCanceled && isCanceled()) {
                return node;
            }

            // 3. Фильтрация бинарников и lock-файлов
            const validEntries = primaryFilteredEntries.filter(entry => {
                const fullPath = path.normalize(path.join(normalizedDirPath, entry.name));
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
                if (isCanceled && isCanceled()) {
                    return node;
                }

                const fullPath = path.normalize(path.join(normalizedDirPath, entry.name));

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
        } catch {}

        return node;
    }

    /**
     * Рекурсивный выбор / снятие выбора файлов на диске
     */
    public static async toggleFolderRecursive(
        dirPath: string,
        checked: boolean,
        filters: FilterSettings,
        selectedFiles: Set<string>
    ): Promise<void> {
        const normalizedDirPath = path.normalize(dirPath);

        try {
            const stat = await fs.promises.stat(normalizedDirPath);
            if (!stat.isDirectory()) {
                return;
            }
        } catch {
            for (const file of Array.from(selectedFiles)) {
                if (this.isPathInside(file, normalizedDirPath)) {
                    selectedFiles.delete(file);
                }
            }
            return;
        }

        try {
            const entries = await fs.promises.readdir(normalizedDirPath, { withFileTypes: true });
            const primaryFilteredEntries = entries.filter(entry => !ALWAYS_IGNORED.has(entry.name));

            let gitIgnoredPaths = new Set<string>();
            if (filters.hideGitIgnored) {
                const candidatePaths = primaryFilteredEntries.map(e => path.normalize(path.join(normalizedDirPath, e.name)));
                gitIgnoredPaths = await GitService.checkIgnoredPaths(candidatePaths);
            }

            for (const entry of primaryFilteredEntries) {
                const fullPath = path.normalize(path.join(normalizedDirPath, entry.name));

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
        } catch {}
    }
}