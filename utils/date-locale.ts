/**
 * App language code → BCP-47 locale for `Intl`/`Date` formatting. Shared so
 * every screen that formats a date (weekday/month names, etc.) respects the
 * app's current language instead of the device's default locale or a
 * hardcoded one.
 */
const DATE_LOCALE_MAP: Record<string, string> = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
};

export function toDateLocale(lang?: string): string {
  const code = lang?.slice(0, 2).toLowerCase();
  return (code && DATE_LOCALE_MAP[code]) || 'pt-BR';
}
