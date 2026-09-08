import * as vscode from 'vscode';

/**
 * Descriptor of a file change in the VS Code Git extension.
 */
export interface GitChange {
  /**
   * Resource URI of the changed file.
   */
  readonly uri: vscode.Uri;
}

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