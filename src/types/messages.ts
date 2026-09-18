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
import { ConfiguredLanguage, LocaleKey, TranslationSchema } from '../i18n/types';
import { PresetDefinition } from '../constants/presets';

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
  | { type: 'updateTokenLimit'; limit: string }
  | { type: 'updateLanguage'; language: ConfiguredLanguage }
  | { type: 'addCustomPreset'; name: string; text: string }
  | { type: 'editCustomPreset'; id: string; name: string; text: string }
  | { type: 'deleteCustomPreset'; id: string }
  | { type: 'updateProjectStructure'; includeProjectStructure: boolean }
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
    includeProjectStructure: boolean;
    gitDiffSettings: GitDiffSettings;
    diagnosticsSettings: DiagnosticsSettings;
    diagnosticsSummary: DiagnosticsSummary;
    customPresets: CustomPreset[];
    outputFormat: OutputFormat;
    tokenLimit: string;
    language: ConfiguredLanguage;
    activeLocale: LocaleKey;
    uiTranslations: TranslationSchema['ui'];
    standardPresets: PresetDefinition[];
  }
  | {
    type: 'updateTranslations';
    language: ConfiguredLanguage;
    activeLocale: LocaleKey;
    uiTranslations: TranslationSchema['ui'];
    standardPresets: PresetDefinition[];
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
    type: 'presetOperationSuccess';
  }
  | {
    type: 'searchResults';
    count: number;
    query: string;
  }
  | {
    type: 'copySuccess';
  }
  | {
    type: 'copyError';
  }
  | {
    type: 'previewSuccess';
  }
  | {
    type: 'previewError';
  };