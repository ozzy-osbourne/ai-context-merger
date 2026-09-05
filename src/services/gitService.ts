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

            for (const change of repo.state.workingTreeChanges) {
                statusMap.set(path.normalize(change.uri.fsPath), 'modified');
            }
            for (const change of repo.state.untrackedChanges) {
                statusMap.set(path.normalize(change.uri.fsPath), 'untracked');
            }
            for (const change of repo.state.indexChanges) {
                const normPath = path.normalize(change.uri.fsPath);
                if (!statusMap.has(normPath)) {
                    statusMap.set(normPath, 'modified');
                }
            }
        } catch (error) {
            console.warn('[AI Context Merger] Ошибка получения статуса Git:', error);
        }
        return statusMap;
    }
}