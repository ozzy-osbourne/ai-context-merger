import * as vscode from 'vscode';
import { CustomPreset, FilterSettings, OutputFormat } from '../types';
import { I18nService } from '../i18n';

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
 * Result descriptor for preset mutation actions.
 */
export interface PresetOperationResult {
  readonly success: boolean;
  readonly warning?: string;
  readonly error?: string;
  readonly preset?: CustomPreset;
  readonly updatedPresets?: CustomPreset[];
}

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
   * Validates custom preset attributes.
   *
   * @param name - Raw preset name.
   * @param text - Raw preset prompt body.
   * @returns Validation outcome with trimmed values or warning/error.
   */
  public validatePreset(
    name: string,
    text: string
  ): { isValid: boolean; trimmedName: string; trimmedText: string; warning?: string } {
    const t = I18nService.getTranslations();

    if (typeof name !== 'string' || typeof text !== 'string') {
      return { isValid: false, trimmedName: '', trimmedText: '', warning: t.messages.presetNameAndTextRequired };
    }
    const trimmedName = name.trim();
    const trimmedText = text.trim();

    if (!trimmedName || !trimmedText) {
      return { isValid: false, trimmedName, trimmedText, warning: t.messages.presetNameAndTextRequired };
    }
    if (trimmedName.length > 32) {
      return { isValid: false, trimmedName, trimmedText, warning: t.messages.presetNameTooLong };
    }
    if (trimmedText.length > 10000) {
      return { isValid: false, trimmedName, trimmedText, warning: t.messages.presetTextTooLong };
    }

    return { isValid: true, trimmedName, trimmedText };
  }

  /**
   * Adds a new custom preset to persistent storage.
   *
   * @param name - Preset name.
   * @param text - Preset prompt text.
   * @returns Operation outcome.
   */
  public async addCustomPreset(name: string, text: string): Promise<PresetOperationResult> {
    const t = I18nService.getTranslations();
    const validation = this.validatePreset(name, text);
    if (!validation.isValid) {
      return { success: false, warning: validation.warning };
    }

    const currentPresets = this.getCustomPresets();
    if (currentPresets.length >= 50) {
      return { success: false, error: t.messages.presetLimitReached };
    }

    const newPreset: CustomPreset = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: validation.trimmedName,
      text: validation.trimmedText
    };

    currentPresets.push(newPreset);
    await this.saveCustomPresets(currentPresets);

    return { success: true, preset: newPreset, updatedPresets: currentPresets };
  }

  /**
   * Updates an existing custom preset in persistent storage.
   *
   * @param id - Unique identifier of preset.
   * @param name - Updated preset name.
   * @param text - Updated preset prompt body.
   * @returns Operation outcome.
   */
  public async editCustomPreset(id: string, name: string, text: string): Promise<PresetOperationResult> {
    const t = I18nService.getTranslations();
    if (typeof id !== 'string') {
      return { success: false, error: t.messages.presetInvalidId };
    }

    const validation = this.validatePreset(name, text);
    if (!validation.isValid) {
      return { success: false, warning: validation.warning };
    }

    const currentPresets = this.getCustomPresets();
    const targetIndex = currentPresets.findIndex((p) => p.id === id);

    if (targetIndex === -1) {
      return { success: false, error: t.messages.presetNotFound, updatedPresets: currentPresets };
    }

    currentPresets[targetIndex] = {
      ...currentPresets[targetIndex],
      name: validation.trimmedName,
      text: validation.trimmedText
    };

    await this.saveCustomPresets(currentPresets);

    return { success: true, preset: currentPresets[targetIndex], updatedPresets: currentPresets };
  }

  /**
   * Deletes an existing custom preset from persistent storage.
   *
   * @param id - Unique identifier of preset.
   * @returns Operation outcome with updated presets list.
   */
  public async deleteCustomPreset(id: string): Promise<PresetOperationResult> {
    const t = I18nService.getTranslations();
    if (typeof id !== 'string') {
      return { success: false, error: t.messages.presetInvalidId };
    }

    const currentPresets = this.getCustomPresets();
    const filteredPresets = currentPresets.filter((p) => p.id !== id);

    if (filteredPresets.length !== currentPresets.length) {
      await this.saveCustomPresets(filteredPresets);
    }

    return { success: true, updatedPresets: filteredPresets };
  }

  /**
   * Retrieves stored output format from globalState or VS Code user settings default.
   */
  public getOutputFormat(): OutputFormat {
    const configDefault = vscode.workspace.getConfiguration('aiContextMerger').get<OutputFormat>('defaultOutputFormat', 'markdown');
    return this.context.globalState.get<OutputFormat>(STORAGE_KEYS.OUTPUT_FORMAT, configDefault);
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
   * Retrieves globally synchronized token limit preference or VS Code user settings default.
   */
  public getTokenLimit(): string {
    const configDefault = vscode.workspace.getConfiguration('aiContextMerger').get<string>('defaultTokenLimit', '200000');
    return this.context.globalState.get<string>(STORAGE_KEYS.TOKEN_LIMIT, configDefault);
  }

  /**
   * Persists preferred context token limit into globalState with Settings Sync.
   */
  public async saveTokenLimit(limit: string): Promise<void> {
    await this.context.globalState.update(STORAGE_KEYS.TOKEN_LIMIT, limit);
  }
}