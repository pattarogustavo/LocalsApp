/**
 * Name normalization/similarity used to sanity-check that a Google Places
 * result actually matches the place name the AI proposed, before accepting
 * it as a verified candidate.
 */

const DIACRITICS_PATTERN = /[̀-ͯ]/g;

/** Lowercases, strips diacritics/punctuation, collapses whitespace. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(DIACRITICS_PATTERN, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordTokens(name: string): Set<string> {
  return new Set(normalizeName(name).split(" ").filter(Boolean));
}

/**
 * Jaccard similarity between the word sets of two names (0..1), with a
 * substring-containment shortcut: if one normalized name fully contains the
 * other (e.g. "Louvre" vs. "Louvre Museum"), treat it as a strong match.
 */
export function nameSimilarity(a: string, b: string): number {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  if (normA.includes(normB) || normB.includes(normA)) return 0.9;

  const tokensA = wordTokens(a);
  const tokensB = wordTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Default threshold above which two names are considered "a reasonable match". */
export const NAME_MATCH_THRESHOLD = 0.34;

export function namesReasonablyMatch(a: string, b: string, threshold = NAME_MATCH_THRESHOLD): boolean {
  return nameSimilarity(a, b) >= threshold;
}
