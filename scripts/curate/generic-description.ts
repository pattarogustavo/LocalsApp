/**
 * Detects the generic, templated descriptions produced by an earlier model
 * version during the 6-city import — e.g. pt: "Conheça X e descubra seus
 * arquitetura e história. Reserve um tempo para explorar a região de Y sem
 * pressa." / en: "Visit X and discover its architecture and history. Allow
 * time to explore the surrounding Y area at an easy pace." A description
 * matches only if it BOTH starts with one of the opening verbs AND contains
 * one of the template's telltale phrases — either alone is too common in
 * genuinely original text.
 */

const PT_START = /^(Conheça|Descubra|Visite|Explore)\b/i;
const PT_CONTAINS = /(Reserve um tempo|sem pressa|descubra seus|e descubra)/i;

const EN_START = /^(Visit|Discover|Explore)\b/i;
const EN_CONTAINS = /(Allow time|at an easy pace|and discover its)/i;

export function isGenericPt(text: string): boolean {
  const t = text.trim();
  return PT_START.test(t) && PT_CONTAINS.test(t);
}

export function isGenericEn(text: string): boolean {
  const t = text.trim();
  return EN_START.test(t) && EN_CONTAINS.test(t);
}

/** True if either the pt or the en description matches the generic template. */
export function isGenericDescriptions(descriptions: { pt?: string | null; en?: string | null }): boolean {
  return (!!descriptions.pt && isGenericPt(descriptions.pt)) || (!!descriptions.en && isGenericEn(descriptions.en));
}
