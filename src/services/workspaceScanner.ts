import * as path from 'path';
import * as fs from 'fs';
import { FileNode, FilterSettings, GitFileStatus } from '../types';
import { ALWAYS_IGNORED, LOCK_FILE_NAMES, BINARY_EXTENSIONS } from '../constants';
import { GitService } from './gitService';

export class WorkspaceScanner {
    /**
     * Проверка фильтров третьего приоритета (Lock-файлы и бинарные файлы)
     * @param name Имя файла
     * @param isDirectory Флаг директории
     * @param filters Настройки фильтрации
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
     * Комплексная статическая проверка элемента (системные исключения + Lock-файлы + бинарники)
     * @param name Имя файла или папки
     * @param isDirectory Флаг директории
     * @param filters Настройки фильтрации
     */
    public static shouldFilterItem(name: string, isDirectory: boolean, filters: FilterSettings): boolean {
        if (ALWAYS_IGNORED.has(name)) {
            return true;
        }
        return this.isFilteredByType(name, isDirectory, filters);
    }

    /**
     * Сканирование директории с 3-уровневой иерархией фильтрации:
     * 1. ALWAYS_IGNORED (наивысший приоритет, мгновенный отсев)
     * 2. .gitignore (через VS Code Git API)
     * 3. Lock-файлы и бинарники (низший приоритет)
     * 
     * @param dirPath Абсолютный путь к сканируемой папке
     * @param gitStatusMap Карта статусов Git (Modified / Untracked)
     * @param filters Активные настройки фильтрации
     */
    public static async scanDirectory(
        dirPath: string,
        gitStatusMap: Map<string, GitFileStatus>,
        filters: FilterSettings
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

        try {
            // Проверяем доступность директории перед чтением
            const stat = await fs.promises.stat(normalizedDirPath);
            if (!stat.isDirectory()) {
                return node;
            }

            const entries = await fs.promises.readdir(normalizedDirPath, { withFileTypes: true });

            // 1. Первый приоритет: мгновенная отсечка системных папок и кэшей
            const primaryFilteredEntries = entries.filter(entry => !ALWAYS_IGNORED.has(entry.name));

            // 2. Второй приоритет: проверка .gitignore через Git API
            let gitIgnoredPaths = new Set<string>();
            if (filters.hideGitIgnored) {
                const candidatePaths = primaryFilteredEntries.map(e => path.normalize(path.join(normalizedDirPath, e.name)));
                gitIgnoredPaths = await GitService.checkIgnoredPaths(candidatePaths);
            }

            // 3. Третий приоритет: отсеивание по .gitignore, lock-файлам и бинарникам
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

            // Сортировка: сначала папки, затем файлы в алфавитном порядке
            const sortedEntries = validEntries.sort((a, b) => {
                if (a.isDirectory() === b.isDirectory()) {
                    return a.name.localeCompare(b.name);
                }
                return a.isDirectory() ? -1 : 1;
            });

            let hasUntracked = false;
            let hasModified = false;

            for (const entry of sortedEntries) {
                const fullPath = path.normalize(path.join(normalizedDirPath, entry.name));

                if (entry.isDirectory()) {
                    const childFolder = await this.scanDirectory(fullPath, gitStatusMap, filters);
                    
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

            // Определение индикатора папки (новые untracked файлы имеют приоритет цвета)
            if (hasUntracked) {
                node.gitFolderStatus = 'untracked';
            } else if (hasModified) {
                node.gitFolderStatus = 'modified';
            }
        } catch {}

        return node;
    }

    /**
     * Рекурсивный выбор / снятие выбора файлов с безопасной валидацией существования папки
     * @param dirPath Путь к целевой директории
     * @param checked Флаг выбора (true - выбрать, false - снять)
     * @param filters Настройки фильтрации
     * @param selectedFiles Текущее множество выбранных файлов
     */
    public static async toggleFolderRecursive(
        dirPath: string,
        checked: boolean,
        filters: FilterSettings,
        selectedFiles: Set<string>
    ): Promise<void> {
        const normalizedDirPath = path.normalize(dirPath);

        // ---------------------------------------------------------------------
        // Защита от удаленных папок:
        // Если папка не существует на диске, удаляем все вложенные пути из выборки
        // ---------------------------------------------------------------------
        try {
            const stat = await fs.promises.stat(normalizedDirPath);
            if (!stat.isDirectory()) {
                return;
            }
        } catch {
            const folderPrefix = normalizedDirPath.endsWith(path.sep)
                ? normalizedDirPath
                : normalizedDirPath + path.sep;

            for (const file of Array.from(selectedFiles)) {
                if (file === normalizedDirPath || file.startsWith(folderPrefix)) {
                    selectedFiles.delete(file);
                }
            }
            return;
        }

        try {
            const entries = await fs.promises.readdir(normalizedDirPath, { withFileTypes: true });

            // 1. Первый приоритет (системные исключения)
            const primaryFilteredEntries = entries.filter(entry => !ALWAYS_IGNORED.has(entry.name));

            // 2. Второй приоритет (.gitignore)
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
                    // 3. Третий приоритет (типы файлов)
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