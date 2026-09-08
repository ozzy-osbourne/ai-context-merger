import { ContextStats, FilterSettings, GitDiffSettings, PromptSettings } from './tree';

/**
 * Message payloads sent from the Webview frontend to the Extension backend.
 */
export type WebviewToExtensionMessage =
  | { type: 'selectAll' }
  | { type: 'selectFound'; query: string }
  | { type: 'clearSelection' }
  | { type: 'expandAll' }
  | { type: 'collapseAll' }
  | { type: 'copyContext' }
  | { type: 'exportFile' }
  | { type: 'previewContext' }
  | { type: 'selectModified' }
  | { type: 'updateFilters'; filters: FilterSettings }
  | { type: 'updatePrompt'; enabled: boolean; text: string }
  | { type: 'updateGitDiff'; settings: GitDiffSettings }
  | { type: 'updateSearch'; query: string }
  | { type: 'refresh' }
  | { type: 'requestInitialData' };

/**
 * Message payloads sent from the Extension backend to the Webview frontend.
 */
export type ExtensionToWebviewMessage =
  | {
    type: 'setData';
    stats: ContextStats;
    filters: FilterSettings;
    promptSettings: PromptSettings;
    gitDiffSettings: GitDiffSettings;
  }
  | {
    type: 'updateStats';
    stats: ContextStats;
  }
  | {
    type: 'searchResults';
    count: number;
    query: string;
  };