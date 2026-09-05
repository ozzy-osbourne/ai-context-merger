import * as vscode from 'vscode';
import * as path from 'path';
import { GitFileStatus } from '../types';

export class GitService {
    /**
     * Получение карты статусов файлов в системе контроля версий Git
     */
    public static async getGitStatusMap(): Promise<Map<string, GitFileStatus>> {
        const statusMap = new Map<string, GitFileStatus>();
        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension) {
                return statusMap;
            }

            // Если расширение Git еще не активировано, активируем его перед чтением exports
            const gitExports = gitExtension.isActive
                ? gitExtension.exports
                : await gitExtension.activate();

            if (!gitExports) {
                return statusMap;
            }

            const gitApi = gitExports.getAPI(1);
            if (!gitApi || gitApi.repositories.length === 0) {
                return statusMap;
            }

            const repo = gitApi.repositories[0];

            // 1. Неотслеживаемые новые файлы (Untracked)
            for (const change of repo.state.untrackedChanges) {
                statusMap.set(path.normalize(change.uri.fsPath), 'untracked');
            }

            // 2. Изменения в рабочей директории (Working Tree)
            for (const change of repo.state.workingTreeChanges) {
                const normPath = path.normalize(change.uri.fsPath);
                // Status 7 в VS Code Git API = UNTRACKED / INDEX_ADDED
                const isUntracked = change.status === 7;
                statusMap.set(normPath, isUntracked ? 'untracked' : 'modified');
            }

            // 3. Изменения в индексе (Staged Changes)
            for (const change of repo.state.indexChanges) {
                const normPath = path.normalize(change.uri.fsPath);
                // Status 1 в VS Code Git API = INDEX_ADDED
                const isAdded = change.status === 1;
                if (!statusMap.has(normPath)) {
                    statusMap.set(normPath, isAdded ? 'untracked' : 'modified');
                }
            }
        } catch (error) {
            console.warn('[AI Context Merger] Ошибка получения статуса Git:', error);
        }
        return statusMap;
    }
}