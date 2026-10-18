/**
 * Validation for curate:redescribe's rewritten pt/en pair, plus the
 * batch-wide "no two places share an opening sentence" rule. Kept separate
 * from scripts/curate/validate-place.ts since the shape and rules here
 * (length bounds, generic-template rejection, cross-item repetition) are
 * specific to rewriting an EXISTING description, not structuring a new one.
 */

import { isGenericPt, isGenericEn } from "./generic-description";

export const MIN_DESCRIPTION_LENGTH = 60;
export const MAX_DESCRIPTION_LENGTH = 320;

export interface RedescribeValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validates one rewritten pt/en pair in isolation (length, non-empty, no longer generic). Doesn't check cross-item repetition — see findBatchRepetitionIds. */
export function validateRedescribed(pt: string | undefined, en: string | undefined): RedescribeValidationResult {
  const errors: string[] = [];
  const ptTrimmed = pt?.trim() ?? "";
  const enTrimmed = en?.trim() ?? "";

  if (!ptTrimmed) errors.push("pt is missing or empty");
  else if (ptTrimmed.length < MIN_DESCRIPTION_LENGTH || ptTrimmed.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`pt length ${ptTrimmed.length} is outside [${MIN_DESCRIPTION_LENGTH}, ${MAX_DESCRIPTION_LENGTH}]`);
  } else if (isGenericPt(ptTrimmed)) {
    errors.push("pt still matches the generic template");
  }

  if (!enTrimmed) errors.push("en is missing or empty");
  else if (enTrimmed.length < MIN_DESCRIPTION_LENGTH || enTrimmed.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`en length ${enTrimmed.length} is outside [${MIN_DESCRIPTION_LENGTH}, ${MAX_DESCRIPTION_LENGTH}]`);
  } else if (isGenericEn(enTrimmed)) {
    errors.push("en still matches the generic template");
  }

  return { valid: errors.length === 0, errors };
}

/** The leading sentence of a description, normalized for comparison (lowercased, trimmed, punctuation-insensitive). */
export function firstSentence(text: string): string {
  const match = text.trim().match(/^[^.!?]*[.!?]?/);
  return (match?.[0] ?? text).trim().toLowerCase().replace(/[.!?]+$/, "");
}

export interface RepetitionCandidate {
  id: string;
  pt: string;
  en: string;
}

/**
 * Finds every id in the batch whose pt OR en opening sentence duplicates an
 * earlier item's — the first occurrence of a given opening sentence is kept,
 * later duplicates are flagged (order follows the input array, so this is
 * deterministic regardless of which one is "correct").
 */
export function findBatchRepetitionIds(items: RepetitionCandidate[]): Set<string> {
  const repeated = new Set<string>();
  const seenPt = new Set<string>();
  const seenEn = new Set<string>();

  for (const item of items) {
    const pt = firstSentence(item.pt);
    const en = firstSentence(item.en);
    let isRepeat = false;
    if (pt && seenPt.has(pt)) isRepeat = true;
    if (en && seenEn.has(en)) isRepeat = true;
    if (isRepeat) {
      repeated.add(item.id);
    } else {
      if (pt) seenPt.add(pt);
      if (en) seenEn.add(en);
    }
  }

  return repeated;
}
