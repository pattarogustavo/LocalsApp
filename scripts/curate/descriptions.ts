export type DescriptionLang = "pt" | "en" | "es" | "fr" | "de" | "it";
export type Descriptions = Partial<Record<DescriptionLang, string>>;

const ALLOWED_LANGS: DescriptionLang[] = ["pt", "en", "es", "fr", "de", "it"];

/** Builds a `descriptions` record from the pt/en pair produced by the structuring step, dropping empty values. */
export function buildBaseDescriptions(pt: string | undefined, en: string | undefined): Descriptions {
  const result: Descriptions = {};
  if (pt?.trim()) result.pt = pt.trim();
  if (en?.trim()) result.en = en.trim();
  return result;
}

/**
 * Merges translated descriptions (es/fr/de/it) into an existing record,
 * without ever touching pt/en (those come only from the structuring step)
 * and ignoring any key outside the allowed language set.
 */
export function mergeTranslations(base: Descriptions, translations: Record<string, string | undefined>): Descriptions {
  const result: Descriptions = { ...base };
  for (const lang of ALLOWED_LANGS) {
    if (lang === "pt" || lang === "en") continue;
    const value = translations[lang];
    if (value?.trim()) result[lang] = value.trim();
  }
  return result;
}

export function isCompleteDescriptions(descriptions: Descriptions): boolean {
  return ALLOWED_LANGS.every((lang) => !!descriptions[lang]?.trim());
}
