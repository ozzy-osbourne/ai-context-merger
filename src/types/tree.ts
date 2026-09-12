/**
 * Supported context bundle output formats.
 */
export type OutputFormat = 'markdown' | 'xml';

/**
 * Active exclusion filter settings.
 */
export interface FilterSettings {
  hideGitIgnored: boolean;
  hideSecrets: boolean;
  hideMinified: boolean;
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
 * Custom user-defined prompt preset.
 */
export interface CustomPreset {
  id: string;
  name: string;
  text: string;
}

/**
 * Git diff generation configuration settings.
 */
export interface GitDiffSettings {
  includeGitDiff: boolean;
  diffOnly: boolean;
  unlimitedDiff: boolean;
}

/**
 * Compiler and linter diagnostics configuration settings.
 */
export interface DiagnosticsSettings {
  enabled: boolean;
  includeCompiler: boolean;
  includeLinter: boolean;
}

/**
 * Aggregated summary of compiler and linter diagnostics for selected files.
 */
export interface DiagnosticsSummary {
  compilerCount: number;
  linterCount: number;
}

/**
 * Context payload statistics and token estimates.
 */
export interface ContextStats {
  count: number;
  tokens: number;
  percentage: number;
}