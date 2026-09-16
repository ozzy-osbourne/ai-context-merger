import * as vscode from 'vscode';
import { ConfiguredLanguage, LocaleKey, TranslationSchema } from './types';
import { enLocale } from './locales/en';
import { ruLocale } from './locales/ru';
import { zhCnLocale } from './locales/zh-cn';
import { esLocale } from './locales/es';
import { ptBrLocale } from './locales/pt-br';
import { jaLocale } from './locales/ja';
import { deLocale } from './locales/de';

const LOCALES: Record<LocaleKey, TranslationSchema> = {
  en: enLocale,
  ru: ruLocale,
  'zh-cn': zhCnLocale,
  es: esLocale,
  'pt-br': ptBrLocale,
  ja: jaLocale,
  de: deLocale
};

/**
 * Service managing runtime internationalization, locale determination, and pluralization.
 */
export class I18nService {
  /**
   * Resolves the active locale based on user settings and VS Code interface language.
   *
   * @returns Active LocaleKey ('en', 'ru', or 'zh-cn').
   */
  public static getActiveLocale(): LocaleKey {
    try {
      const config = vscode.workspace.getConfiguration('aiContextMerger');
      const configured = config.get<ConfiguredLanguage>('language', 'auto');

      if (configured && configured !== 'auto') {
        if (LOCALES[configured as LocaleKey]) {
          return configured as LocaleKey;
        }
      }
    } catch {
      // Ignore config read error in isolated environments
    }

    const vscodeLang = (vscode.env.language || '').toLowerCase();
    if (vscodeLang.startsWith('ru')) {
      return 'ru';
    }
    if (vscodeLang.startsWith('zh')) {
      return 'zh-cn';
    }
    if (vscodeLang.startsWith('es')) {
      return 'es';
    }
    if (vscodeLang.startsWith('pt')) {
      return 'pt-br';
    }
    if (vscodeLang.startsWith('ja')) {
      return 'ja';
    }
    if (vscodeLang.startsWith('de')) {
      return 'de';
    }
    return 'en';
  }

  /**
   * Retrieves the configured language option ('auto', 'en', 'ru', or 'zh-cn').
   */
  public static getConfiguredLanguage(): ConfiguredLanguage {
    try {
      const config = vscode.workspace.getConfiguration('aiContextMerger');
      return config.get<ConfiguredLanguage>('language', 'auto') || 'auto';
    } catch {
      return 'auto';
    }
  }

  /**
   * Retrieves translation dictionary for the active or specified locale.
   *
   * @param locale - Optional explicit locale override.
   * @returns TranslationSchema dictionary.
   */
  public static getTranslations(locale: LocaleKey = this.getActiveLocale()): TranslationSchema {
    return LOCALES[locale] || LOCALES.en;
  }

  /**
   * Formats a count using native Intl.PluralRules for accurate linguistic pluralization.
   *
   * @param count - Item count.
   * @param locale - Active locale key.
   * @returns Formatted localized string.
   */
  public static formatSelectedFilePlural(count: number, locale: LocaleKey = this.getActiveLocale()): string {
    const t = this.getTranslations(locale);
    const intlLocale = locale === 'zh-cn' ? 'zh-CN' : (locale === 'pt-br' ? 'pt-BR' : locale);
    const pr = new Intl.PluralRules(intlLocale);
    const rule = pr.select(count);

    const forms = t.tree.selectedPlural;
    let template = forms.other;

    if (rule === 'one' && forms.one) {
      template = forms.one;
    } else if (rule === 'few' && forms.few) {
      template = forms.few;
    } else if (rule === 'many' && forms.many) {
      template = forms.many;
    }

    return template.replace('{count}', String(count));
  }
}

export * from './types';