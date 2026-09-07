import { ContextStats, FileNode, FilterSettings } from './tree';

/**
 * Message payloads sent from the Webview frontend to the Extension backend.
 */
export type WebviewToExtensionMessage =
  | { type: 'toggleFile'; filePath: string; checked: boolean }
  | { type: 'toggleFolder'; folderPath: string; checked: boolean }
  | { type: 'toggleFilesBatch'; filePaths: string[]; checked: boolean }
  | { type: 'selectAll' }
  | { type: 'selectMultipleFiles'; filePaths: string[] }
  | { type: 'clearSelection' }
  | { type: 'copyContext' }
  | { type: 'exportFile' }
  | { type: 'previewContext' }
  | { type: 'selectModified' }
  | { type: 'updateFilters'; filters: FilterSettings }
  | { type: 'updatePrompt'; enabled: boolean; text: string }
  | { type: 'refresh' }
  | { type: 'requestInitialData' };

/**
 * Message payloads sent from the Extension backend to the Webview frontend.
 */
export type ExtensionToWebviewMessage =
  | {
    type: 'setData';
    tree: FileNode[];
    stats: ContextStats;
    selectedFiles: string[];
    filters: FilterSettings;
    smartGitExpand?: boolean;
    isInitialLoad?: boolean;
  }
  | {
    type: 'updateStats';
    stats: ContextStats;
    selectedFiles: string[];
  };