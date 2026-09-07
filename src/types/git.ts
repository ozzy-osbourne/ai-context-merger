import * as vscode from 'vscode';

/**
 * File status codes from the internal vscode.git extension API.
 */
export enum VscodeGitStatus {
    INDEX_MODIFIED = 0,
    INDEX_ADDED = 1,
    INDEX_DELETED = 2,
    INDEX_RENAMED = 3,
    INDEX_COPIED = 4,

    MODIFIED = 5,
    DELETED = 6,
    UNTRACKED = 7,
    IGNORED = 8,
    INTENT_TO_ADD = 9,
    INTENT_TO_RENAME = 10,
    TYPE_CHANGED = 11,

    ADDED_BY_US = 12,
    ADDED_BY_THEM = 13,
    DELETED_BY_US = 14,
    DELETED_BY_THEM = 15,
    BOTH_ADDED = 16,
    BOTH_DELETED = 17,
    BOTH_MODIFIED = 18
}

/**
 * Git change resource descriptor in the vscode.git API.
 */
export interface GitChange {
    readonly uri: vscode.Uri;
    readonly status: VscodeGitStatus;
}

/**
 * Repository state descriptor in the vscode.git API.
 */
export interface GitRepositoryState {
    readonly untrackedChanges: readonly GitChange[];
    readonly workingTreeChanges: readonly GitChange[];
    readonly indexChanges: readonly GitChange[];
    readonly onDidChange: vscode.Event<void>;
}

/**
 * Git repository instance interface.
 */
export interface GitRepository {
    readonly rootUri: vscode.Uri;
    readonly state: GitRepositoryState;
    checkIgnore(paths: string[]): Promise<Set<string>>;
}

/**
 * Vscode Git Extension API (version 1).
 */
export interface GitAPI {
    readonly repositories: readonly GitRepository[];
    readonly onDidOpenRepository: vscode.Event<GitRepository>;
}

/**
 * Exports of the official vscode.git extension.
 */
export interface GitExtensionExports {
    getAPI(version: 1): GitAPI;
}

/**
 * Internal Git status used for UI tree rendering.
 */
export type GitFileStatus = 'modified' | 'untracked' | 'none';