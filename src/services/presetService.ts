import * as vscode from 'vscode';
import { CustomPreset, OutputFormat } from '../types';

/**
 * Storage key for custom user prompt presets in globalState.
 */
const CUSTOM_PRESETS_STORAGE_KEY = 'aiContextMerger.customPresets';

/**
 * Storage key for active output format in globalState.
 */
const OUTPUT_FORMAT_STORAGE_KEY = 'aiContextMerger.outputFormat';

/**
 * Service managing user presets and format persistence using VS Code extension globalState.
 */
export class PresetService {
  constructor(private readonly context: vscode.ExtensionContext) {
    this.context.globalState.setKeysForSync([CUSTOM_PRESETS_STORAGE_KEY, OUTPUT_FORMAT_STORAGE_KEY]);
  }

  /**
   * Retrieves stored custom prompt presets from globalState.
   */
  public getCustomPresets(): CustomPreset[] {
    return this.context.globalState.get<CustomPreset[]>(CUSTOM_PRESETS_STORAGE_KEY, []);
  }

  /**
   * Persists custom prompt presets into globalState.
   */
  public async saveCustomPresets(presets: CustomPreset[]): Promise<void> {
    await this.context.globalState.update(CUSTOM_PRESETS_STORAGE_KEY, presets);
  }

  /**
   * Retrieves stored output format from globalState.
   */
  public getOutputFormat(): OutputFormat {
    return this.context.globalState.get<OutputFormat>(OUTPUT_FORMAT_STORAGE_KEY, 'markdown');
  }

  /**
   * Persists chosen output format into globalState.
   */
  public async saveOutputFormat(format: OutputFormat): Promise<void> {
    await this.context.globalState.update(OUTPUT_FORMAT_STORAGE_KEY, format);
  }
}