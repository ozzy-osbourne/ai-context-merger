import * as vscode from 'vscode';
import * as path from 'path';
import { GitFileStatus } from '../types';

export class GitService {
    private static cachedGitApi: any = null;

    /**
     * Получение и кэширование экземпляра API встроенного расширения Git
     */
    private static async getGitApi(): Promise<any | null> {
        if (this.cachedGitApi) {
            return this.cachedGitApi;
        }

        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension) {
                return null;
            }

            const gitExports = gitExtension.isActive
                ? gitExtension.exports
                : await gitExtension.activate();

            if (!gitExports) {
                return null;
            }

            this.cachedGitApi = gitExports.getAPI(1);
            return this.cachedGitApi;
        } catch {
            return null;
        }
    }

    /**
     * Высокопроизводительная проверка путей через .gitignore
     * Репозитории сопоставляются синхронно в памяти без лишних IPC-запросов к API
     * @param paths Массив абсолютных путей для проверки
     * @returns Множество путей, которые проигнорированы Git
     */
    public static async checkIgnoredPaths(paths: string[]): Promise<Set<string>> {
        const ignoredPaths = new Set<string>();
        if (paths.length === 0) {
            return ignoredPaths;
        }

        try {
            const gitApi = await this.getGitApi();
            if (!gitApi || !gitApi.repositories || gitApi.repositories.length === 0) {
                return ignoredPaths;
            }

            // Создаем быструю карту корней репозиториев для сопоставления путей в O(1)
            const repos = gitApi.repositories as any[];
            const repoMap = repos.map(repo => {
                const rootFsPath = path.normalize(repo.rootUri.fsPath);
                return {
                    repo,
                    rootPath: rootFsPath,
                    rootLower: process.platform === 'win32' ? rootFsPath.toLowerCase() : rootFsPath
                };
            });

            const repoPathsMap = new Map<any, string[]>();

            for (const itemPath of paths) {
                const normalizedPath = path.normalize(itemPath);
                const comparePath = process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;

                // Быстрый поиск соответствующего репозитория по префиксу пути в памяти
                const matched = repoMap.find(r => 
                    comparePath === r.rootLower || 
                    comparePath.startsWith(r.rootLower.endsWith(path.sep) ? r.rootLower : r.rootLower + path.sep)
                );

                if (matched && typeof matched.repo.checkIgnore === 'function') {
                    const group = repoPathsMap.get(matched.repo) || [];
                    group.push(normalizedPath);
                    repoPathsMap.set(matched.repo, group);
                }
            }

            // Параллельный запуск пакетной проверки для каждого задействованного репозитория
            const checkPromises = Array.from(repoPathsMap.entries()).map(async ([repo, repoPaths]) => {
                try {
                    const result: Set<string> = await repo.checkIgnore(repoPaths);
                    for (const item of result) {
                        ignoredPaths.add(path.normalize(item));
                    }
                } catch {}
            });

            await Promise.all(checkPromises);
        } catch (error) {
            console.warn('[AI Context Merger] Ошибка проверки правил .gitignore:', error);
        }

        return ignoredPaths;
    }

    /**
     * Получение карты статусов файлов во всех открытых репозиториях Git рабочей области
     */
    public static async getGitStatusMap(): Promise<Map<string, GitFileStatus>> {
        const statusMap = new Map<string, GitFileStatus>();
        try {
            const gitApi = await this.getGitApi();
            if (!gitApi || !gitApi.repositories || gitApi.repositories.length === 0) {
                return statusMap;
            }

            for (const repo of gitApi.repositories) {
                // 1. Неотслеживаемые новые файлы (Untracked)
                for (const change of repo.state.untrackedChanges) {
                    statusMap.set(path.normalize(change.uri.fsPath), 'untracked');
                }

                // 2. Изменения в рабочей директории (Working Tree)
                for (const change of repo.state.workingTreeChanges) {
                    const normPath = path.normalize(change.uri.fsPath);
                    const isUntracked = change.status === 7;
                    statusMap.set(normPath, isUntracked ? 'untracked' : 'modified');
                }

                // 3. Изменения в индексе (Staged Changes)
                for (const change of repo.state.indexChanges) {
                    const normPath = path.normalize(change.uri.fsPath);
                    const isAdded = change.status === 1;
                    if (!statusMap.has(normPath)) {
                        statusMap.set(normPath, isAdded ? 'untracked' : 'modified');
                    }
                }
            }
        } catch (error) {
            console.warn('[AI Context Merger] Ошибка получения статуса Git:', error);
        }
        return statusMap;
    }
}