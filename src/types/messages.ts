import {
  ContextStats,
  CustomPreset,
  DiagnosticsSettings,
  DiagnosticsSummary,
  FilterSettings,
  GitDiffSettings,
  OutputFormat,
  PromptSettings
} from './tree';

/**
 * Message payloads sent from the Webview frontend to the Extension backend.
 */
export type WebviewToExtensionMessage =
  | { type: 'selectAll' }
  | { type: 'selectFound'; query: string }
  | { type: 'selectOpenTabs' }
  | { type: 'clearSelection' }
  | { type: 'expandAll' }
  | { type: 'collapseAll' }
  | { type: 'copyContext' }
  | { type: 'exportFile' }
  | { type: 'previewContext' }
  | { type: 'selectModified' }
  | { type: 'updateFilters'; filters: FilterSettings }
  | { type: 'updatePrompt'; enabled: boolean; text: string }
  | { type: 'updateOutputFormat'; format: OutputFormat }
  | { type: 'addCustomPreset'; name: string; text: string }
  | { type: 'editCustomPreset'; id: string; name: string; text: string }
  | { type: 'deleteCustomPreset'; id: string }
  | { type: 'updateGitDiff'; settings: GitDiffSettings }
  | { type: 'updateDiagnostics'; settings: DiagnosticsSettings }
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
    diagnosticsSettings: DiagnosticsSettings;
    diagnosticsSummary: DiagnosticsSummary;
    customPresets: CustomPreset[];
    outputFormat: OutputFormat;
  }
  | {
    type: 'updateStats';
    stats: ContextStats;
  }
  | {
    type: 'updateDiagnosticsSummary';
    summary: DiagnosticsSummary;
  }
  | {
    type: 'updateCustomPresets';
    customPresets: CustomPreset[];
  }
  | {
    type: 'searchResults';
    count: number;
    query: string;
  }
  | {
    type: 'copySuccess';
  };