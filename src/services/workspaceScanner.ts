import * as path from 'path';
import * as fs from 'fs';
import { FileNode, FilterSettings, GitFileStatus } from '../types';
import { ALWAYS_IGNORED, LOCK_FILE_NAMES, BINARY_EXTENSIONS } from '../constants';

export class WorkspaceScanner {
    /**
     * Проверка, должен ли файл быть пропущен согласно активным фильтрам
     */
    public static shouldFilterItem(name: string, isDirectory: boolean, filters: FilterSettings): boolean {
        if (ALWAYS_IGNORED.has(name)) return true;

        if (!isDirectory) {
            const ext = path.extname(name).toLowerCase();
            if (filters.hideLockFiles && LOCK_FILE_NAMES.has(name)) {
                return true;
            }
            if (filters.hideBinaryFiles && BINARY_EXTENSIONS.has(ext)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Сканирование директории и построение файлового дерева
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
            hasModifiedChildren: false,
            children: []
        };

        try {
            const entries = await fs.promises.readdir(normalizedDirPath, { withFileTypes: true });

            const sortedEntries = entries
                .filter(entry => !this.shouldFilterItem(entry.name, entry.isDirectory(), filters))
                .sort((a, b) => {
                    if (a.isDirectory() === b.isDirectory()) {
                        return a.name.localeCompare(b.name);
                    }
                    return a.isDirectory() ? -1 : 1;
                });

            for (const entry of sortedEntries) {
                const fullPath = path.normalize(path.join(normalizedDirPath, entry.name));
                if (entry.isDirectory()) {
                    const childFolder = await this.scanDirectory(fullPath, gitStatusMap, filters);
                    if (childFolder.hasModifiedChildren || childFolder.gitStatus !== 'none') {
                        node.hasModifiedChildren = true;
                    }
                    node.children?.push(childFolder);
                } else {
                    const fileStatus = gitStatusMap.get(fullPath) || 'none';
                    if (fileStatus !== 'none') {
                        node.hasModifiedChildren = true;
                    }
                    node.children?.push({
                        name: entry.name,
                        path: fullPath,
                        isDirectory: false,
                        gitStatus: fileStatus
                    });
                }
            }
        } catch {}

        return node;
    }

    /**
     * Рекурсивное переключение состояния папки
     */
    public static async toggleFolderRecursive(
        dirPath: string,
        checked: boolean,
        filters: FilterSettings,
        selectedFiles: Set<string>
    ): Promise<void> {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (this.shouldFilterItem(entry.name, entry.isDirectory(), filters)) continue;

                const fullPath = path.normalize(path.join(dirPath, entry.name));
                if (entry.isDirectory()) {
                    await this.toggleFolderRecursive(fullPath, checked, filters, selectedFiles);
                } else {
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