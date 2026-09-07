import { GitFileStatus } from './git';

/**
 * Tree node representation for Webview hierarchy rendering.
 */
export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  gitStatus: GitFileStatus;
  gitFolderStatus?: GitFileStatus;
  children?: FileNode[];
  isLoaded?: boolean;
}

/**
 * Active exclusion filter settings.
 */
export interface FilterSettings {
  hideGitIgnored: boolean;
  hideLockFiles: boolean;
  hideBinaryFiles: boolean;
}

/**
 * AI instruction prompt settings.
 */
export interface PromptSettings {
  enabled: boolean;
  text: string;
}

/**
 * Context payload statistics and token estimates.
 */
export interface ContextStats {
  count: number;
  tokens: number;
  percentage: number;
}