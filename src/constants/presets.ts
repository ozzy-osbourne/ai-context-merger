import { I18nService, LocaleKey } from '../i18n';

/**
 * Standard preset key identifiers.
 */
export type PromptPresetKey =
  | 'bugs'
  | 'refactor'
  | 'tests'
  | 'docs'
  | 'fix'
  | 'prReview'
  | 'newFeature'
  | 'explain';

/**
 * Preset definition interface.
 */
export interface PresetDefinition {
  id: PromptPresetKey;
  title: string;
  chipLabel: string;
  text: string;
}

/**
 * Retrieves the localized list of standard AI prompt presets.
 *
 * @param locale - Optional locale override.
 * @returns Array of localized preset definitions.
 */
export function getStandardPresets(locale?: LocaleKey): PresetDefinition[] {
  const t = I18nService.getTranslations(locale);
  const ids: PromptPresetKey[] = [
    'bugs',
    'refactor',
    'tests',
    'docs',
    'fix',
    'prReview',
    'newFeature',
    'explain'
  ];

  return ids.map((id) => {
    const item = t.presets[id];
    return {
      id,
      title: item.title,
      chipLabel: item.chipLabel,
      text: item.text
    };
  });
}