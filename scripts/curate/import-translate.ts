/**
 * Fills in missing es/fr/de/it descriptions for curate:import, from en
 * (falling back to pt), in batches of IMPORT_TRANSLATE_CHUNK_SIZE — only for
 * places that will actually be written, and only for the languages a place
 * doesn't already have (a translation supplied in the import file itself is
 * never overwritten).
 */

import { chunkItems } from "./chunk";
import { translateBatch, type AiCallStats } from "./ai";
import type { TranslateBatchItem } from "./prompts";
import type { Descriptions } from "./descriptions";

export const IMPORT_TRANSLATE_CHUNK_SIZE = 15;

function needsTranslation(descriptions: Descriptions): boolean {
  return !descriptions.es || !descriptions.fr || !descriptions.de || !descriptions.it;
}

/** Fills only the es/fr/de/it fields `base` is missing; never overwrites one already present. */
export function fillMissingTranslations(base: Descriptions, translated: { es?: string; fr?: string; de?: string; it?: string }): Descriptions {
  const result: Descriptions = { ...base };
  for (const lang of ["es", "fr", "de", "it"] as const) {
    if (result[lang]) continue;
    const value = translated[lang];
    if (value?.trim()) result[lang] = value.trim();
  }
  return result;
}

export interface TranslatableItem {
  id: string;
  descriptions: Descriptions;
}

/**
 * Translates only the items missing at least one of es/fr/de/it, in chunks
 * of IMPORT_TRANSLATE_CHUNK_SIZE, and returns the merged descriptions per
 * item id (items that needed nothing, or that the model skipped, are
 * simply absent from the returned map).
 */
export async function translateMissingDescriptions(
  destinationNameEn: string,
  items: TranslatableItem[],
  stats: AiCallStats,
): Promise<Map<string, Descriptions>> {
  const result = new Map<string, Descriptions>();
  const needing = items.filter((item) => needsTranslation(item.descriptions));

  for (const chunk of chunkItems(needing, IMPORT_TRANSLATE_CHUNK_SIZE)) {
    const batchItems: TranslateBatchItem[] = chunk
      .map((item) => ({ id: item.id, en: item.descriptions.en ?? item.descriptions.pt ?? "" }))
      .filter((item) => item.en);
    if (batchItems.length === 0) continue;

    const { translations } = await translateBatch(destinationNameEn, batchItems, stats);
    const byId = new Map(translations.map((t) => [t.id, t]));
    for (const item of chunk) {
      const translated = byId.get(item.id);
      if (!translated) continue;
      result.set(item.id, fillMissingTranslations(item.descriptions, translated));
    }
  }

  return result;
}
