import * as vscode from 'vscode';

/**
 * Git change status flags from the built-in VS Code Git extension.
 */
export enum GitStatus {
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
  TYPE_CHANGED = 11
}

/**
 * Descriptor of a file change in the VS Code Git extension.
 */
export interface GitChange {
  /**
   * Resource URI of the changed file.
   */
  readonly uri: vscode.Uri;

  /**
   * Resource URI of original file before change.
   */
  readonly originalUri?: vscode.Uri;

  /**
   * Git change status flag number.
   */
  readonly status?: number;
}

/**
 * Recognized Git status classification for project files.
 */
export type GitFileStatus = 'modified' | 'untracked' | 'deleted' | 'renamed';

/**
 * State representation of a Git repository within VS Code.
 */
export interface GitRepositoryState {
  /**
   * Working tree changes pending staging or commit.
   */
  readonly workingTreeChanges: readonly GitChange[];

  /**
   * Untracked files that are not yet tracked by Git.
   */
  readonly untrackedChanges: readonly GitChange[];

  /**
   * Staged changes in the index ready for commit.
   */
  readonly indexChanges: readonly GitChange[];

  /**
   * Event that fires when the repository state changes.
   */
  readonly onDidChange: vscode.Event<void>;
}

/**
 * VS Code Git repository representation.
 */
export interface GitRepository {
  /**
   * Root directory URI of the Git repository.
   */
  readonly rootUri: vscode.Uri;

  /**
   * Current repository state.
   */
  readonly state: GitRepositoryState;

  /**
   * Checks file paths against repository .gitignore rules.
   *
   * @param paths - Array of absolute file paths to check.
   * @returns Set of paths that are ignored.
   */
  checkIgnore(paths: string[]): Promise<Set<string>>;

  /**
   * Obtains the unified diff between working tree and HEAD for the target path.
   *
   * @param path - Relative or absolute path of the file.
   * @returns Formatted unified diff string.
   */
  diffWithHEAD(path?: string): Promise<string>;

  /**
   * Obtains the unified diff between staged index and HEAD for the target path.
   *
   * @param path - Relative or absolute path of the file.
   * @returns Formatted unified diff string.
   */
  diffIndexWithHEAD(path?: string): Promise<string>;
}

/**
 * API version 1 exported by the official vscode.git extension.
 */
export interface GitAPI {
  /**
   * Currently opened Git repositories in the workspace.
   */
  readonly repositories: readonly GitRepository[];

  /**
   * Event fired when a new Git repository is detected/opened.
   */
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
}

/**
 * Export signature of the built-in vscode.git extension.
 */
export interface GitExtensionExports {
  /**
   * Resolves the Git API instance for the specified API version.
   *
   * @param version - Requested API version number.
   */
  getAPI(version: 1): GitAPI;
}