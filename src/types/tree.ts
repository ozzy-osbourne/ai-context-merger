import { GitFileStatus } from './git';

/**
 * Структура узла файлового дерева для рендеринга в Webview
 */
export interface FileNode {
    name: string;
    path: string;
    isDirectory: boolean;
    gitStatus: GitFileStatus;
    gitFolderStatus?: GitFileStatus;
    children?: FileNode[];
}

/**
 * Настройки активных фильтров отображения
 */
export interface FilterSettings {
    hideGitIgnored: boolean;
    hideLockFiles: boolean;
    hideBinaryFiles: boolean;
}

/**
 * Настройки пользовательской инструкции для ИИ
 */
export interface PromptSettings {
    enabled: boolean;
    text: string;
}

/**
 * Статистика выбранного контекста
 */
export interface ContextStats {
    count: number;
    tokens: number;
    percentage: number;
}