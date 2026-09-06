import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitFileStatus, VscodeGitStatus } from '../types';

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
     * Получение карты статусов файлов Git с игнорированием удаленных файлов
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
                    const normPath = path.normalize(change.uri.fsPath);
                    if (fs.existsSync(normPath)) {
                        statusMap.set(normPath, 'untracked');
                    }
                }

                // 2. Изменения в рабочей директории (Working Tree)
                for (const change of repo.state.workingTreeChanges) {
                    const normPath = path.normalize(change.uri.fsPath);
                    
                    // Игнорируем удаленные файлы любого типа (локальные, конфликты удаления)
                    const isDeleted = change.status === VscodeGitStatus.DELETED ||
                                      change.status === VscodeGitStatus.DELETED_BY_US ||
                                      change.status === VscodeGitStatus.DELETED_BY_THEM ||
                                      change.status === VscodeGitStatus.BOTH_DELETED;

                    if (isDeleted || !fs.existsSync(normPath)) {
                        continue;
                    }

                    const isUntracked = change.status === VscodeGitStatus.UNTRACKED;
                    statusMap.set(normPath, isUntracked ? 'untracked' : 'modified');
                }

                // 3. Изменения в индексе (Staged Changes)
                for (const change of repo.state.indexChanges) {
                    const normPath = path.normalize(change.uri.fsPath);

                    if (change.status === VscodeGitStatus.INDEX_DELETED || !fs.existsSync(normPath)) {
                        continue;
                    }

                    const isAdded = change.status === VscodeGitStatus.INDEX_ADDED;
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