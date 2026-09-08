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