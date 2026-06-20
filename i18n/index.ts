import { pt } from './pt';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';
import type { Translations } from './pt';

export type SupportedLanguage = 'pt' | 'en' | 'es' | 'fr' | 'de' | 'it';

const translations: Record<SupportedLanguage, Translations> = {
  pt,
  en,
  es,
  fr,
  it,
  // German falls back to English until translated
  de: en,
};

export function getTranslations(lang: string): Translations {
  const code = (lang?.slice(0, 2) ?? 'pt') as SupportedLanguage;
  return translations[code] ?? pt;
}

export type { Translations };
export { pt, en, es, fr, it };
