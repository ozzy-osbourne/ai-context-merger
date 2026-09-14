import * as vscode from 'vscode';
import { CustomPreset, FilterSettings, OutputFormat } from '../types';

/**
 * Storage keys for globally synchronized user settings.
 */
const STORAGE_KEYS = {
  CUSTOM_PRESETS: 'aiContextMerger.customPresets',
  OUTPUT_FORMAT: 'aiContextMerger.outputFormat',
  FILTERS: 'aiContextMerger.filters',
  TOKEN_LIMIT: 'aiContextMerger.tokenLimit'
} as const;

/**
 * Default fallback exclusion filter settings.
 */
const DEFAULT_FILTERS: FilterSettings = {
  hideGitIgnored: true,
  hideSecrets: true,
  hideMinified: true,
  hideLockFiles: true,
  hideBinaryFiles: true
};

/**
 * Service managing user presets, filters, formats, and token limits with VS Code Settings Sync.
 */
export class PresetService {
  constructor(private readonly context: vscode.ExtensionContext) {
    // Register all cross-machine user preferences for VS Code Settings Sync
    this.context.globalState.setKeysForSync([
      STORAGE_KEYS.CUSTOM_PRESETS,
      STORAGE_KEYS.OUTPUT_FORMAT,
      STORAGE_KEYS.FILTERS,
      STORAGE_KEYS.TOKEN_LIMIT
    ]);
  }

  /**
   * Retrieves stored custom prompt presets from globalState.
   */
  public getCustomPresets(): CustomPreset[] {
    return this.context.globalState.get<CustomPreset[]>(STORAGE_KEYS.CUSTOM_PRESETS, []);
  }

  /**
   * Persists custom prompt presets into globalState.
   */
  public async saveCustomPresets(presets: CustomPreset[]): Promise<void> {
    await this.context.globalState.update(STORAGE_KEYS.CUSTOM_PRESETS, presets);
  }

  /**
   * Retrieves stored output format from globalState.
   */
  public getOutputFormat(): OutputFormat {
    return this.context.globalState.get<OutputFormat>(STORAGE_KEYS.OUTPUT_FORMAT, 'markdown');
  }

  /**
   * Persists chosen output format into globalState.
   */
  public async saveOutputFormat(format: OutputFormat): Promise<void> {
    await this.context.globalState.update(STORAGE_KEYS.OUTPUT_FORMAT, format);
  }

  /**
   * Retrieves globally synchronized filter settings.
   */
  public getFilters(): FilterSettings {
    return this.context.globalState.get<FilterSettings>(STORAGE_KEYS.FILTERS, DEFAULT_FILTERS);
  }

  /**
   * Persists exclusion filter settings into globalState with Settings Sync.
   */
  public async saveFilters(filters: FilterSettings): Promise<void> {
    await this.context.globalState.update(STORAGE_KEYS.FILTERS, filters);
  }

  /**
   * Retrieves globally synchronized token limit preference.
   */
  public getTokenLimit(): string {
    return this.context.globalState.get<string>(STORAGE_KEYS.TOKEN_LIMIT, '200000');
  }

  /**
   * Persists preferred context token limit into globalState with Settings Sync.
   */
  public async saveTokenLimit(limit: string): Promise<void> {
    await this.context.globalState.update(STORAGE_KEYS.TOKEN_LIMIT, limit);
  }
}