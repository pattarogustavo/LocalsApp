import type { GeoPoint } from "./distance";
import type { GoogleMatch } from "./google";
import { namesReasonablyMatch } from "./normalize";
import { pickVerifiedCandidate, localLanguageForCountry } from "./match-google";
import type { DiscardReasonCounts } from "./verify";
import type { ValidatedPlace, InvalidPlaceExample } from "./validate-place";

export interface ManualAddAcceptedMatch {
  name: string;
  googlePlaceId: string;
  googleName: string;
}

export interface ManualAddRejection {
  name: string;
  reason: string;
  googleName?: string;
}

export interface ManualMatchSummary {
  accepted: ManualAddAcceptedMatch[];
  rejected: ManualAddRejection[];
}

/**
 * Matches each manually-given name against Google, one at a time, using the
 * exact same verification as the main generate flow (place_id/types,
 * distance to center, businessStatus, name) and always allowing a
 * neighborhood/sublocality result — manually-picked icons (Covent Garden,
 * Notting Hill, ...) are themselves often neighborhoods. When `countryCode`
 * is given and the first (default-language) search finds no accepted
 * match, retries the search once in the destination country's local
 * language (e.g. "Torre de Belém" vs. Google's "Belém Tower") before giving
 * up — see scripts/curate/match-google.ts for the shared language mapping.
 */
export async function matchManualNames(
  names: string[],
  findMatches: (name: string, language?: string) => Promise<GoogleMatch[]>,
  center: GeoPoint,
  maxDistanceKm: number,
  discardCounts: DiscardReasonCounts,
  countryCode?: string,
): Promise<ManualMatchSummary> {
  const accepted: ManualAddAcceptedMatch[] = [];
  const rejected: ManualAddRejection[] = [];

  for (const name of names) {
    const candidates = await findMatches(name);
    let outcome = pickVerifiedCandidate([name], candidates, center, maxDistanceKm, true, discardCounts);

    if (!outcome.accepted && countryCode) {
      const retryCandidates = await findMatches(name, localLanguageForCountry(countryCode));
      outcome = pickVerifiedCandidate([name], retryCandidates, center, maxDistanceKm, true, discardCounts);
    }

    if (outcome.accepted) {
      accepted.push({ name, googlePlaceId: outcome.googlePlaceId, googleName: outcome.googleName });
    } else {
      rejected.push({ name, reason: outcome.reason, googleName: outcome.googleName });
    }
  }

  return { accepted, rejected };
}

export interface ManualAddFinalized {
  /** The name as originally given in --names, before Google verification or structuring. */
  requestedName: string;
  place: ValidatedPlace;
  googlePlaceId: string;
  googleName: string;
}

export interface ManualAddUnmatched {
  name: string;
  googlePlaceId: string;
  googleName: string;
  /** The real reason this name has no structured place: the structuring call's own validation error when found, otherwise a generic fallback. */
  reason: string;
}

export interface PairStructuredResult {
  finalized: ManualAddFinalized[];
  /** Google matches the structuring call never returned a place for — reported back as a rejection, with the real reason when known. */
  unmatched: ManualAddUnmatched[];
}

const UNMATCHED_FALLBACK_REASON = "estruturação não retornou este lugar";

/**
 * Pairs each AI-structured place back to the Google match it came from, by
 * name similarity (same threshold used for Google verification) — the
 * structuring call is asked to keep names unchanged, but is never trusted to
 * echo them back byte-for-byte or in order. Each Google match is used at
 * most once. A Google match left unpaired is cross-referenced against
 * `invalidExamples` (the structuring call's own per-item validation errors)
 * so its rejection reports the real cause (e.g. `category="district" não é
 * uma das: ...`) instead of a generic "no place returned" message.
 */
export function pairStructuredWithMatches(
  structured: ValidatedPlace[],
  matched: ManualAddAcceptedMatch[],
  invalidExamples: InvalidPlaceExample[] = [],
): PairStructuredResult {
  const remaining = [...matched];
  const finalized: ManualAddFinalized[] = [];

  for (const place of structured) {
    const idx = remaining.findIndex((m) => namesReasonablyMatch(m.name, place.name));
    if (idx === -1) continue;
    const [m] = remaining.splice(idx, 1);
    finalized.push({ requestedName: m.name, place, googlePlaceId: m.googlePlaceId, googleName: m.googleName });
  }

  const unmatched: ManualAddUnmatched[] = remaining.map((m) => {
    const invalid = invalidExamples.find((e) => namesReasonablyMatch(e.name, m.name));
    const reason = invalid ? `estruturação inválida: ${invalid.errors.join("; ")}` : UNMATCHED_FALLBACK_REASON;
    return { name: m.name, googlePlaceId: m.googlePlaceId, googleName: m.googleName, reason };
  });

  return { finalized, unmatched };
}

export interface ManualAddLogEntry {
  requestedName: string;
  category: string;
  tags: string[];
  priceTier?: string;
  descriptionPt: string;
}

/** "requested name — category=... tags=[...] priceTier=... descriptionPt="first 100 chars…"" for the pre-write confirmation list. */
export function formatManualAddedLine(entry: ManualAddLogEntry): string {
  const truncated = entry.descriptionPt.length > 100 ? `${entry.descriptionPt.slice(0, 100)}…` : entry.descriptionPt;
  return `"${entry.requestedName}" — category=${entry.category} tags=[${entry.tags.join(", ")}] priceTier=${entry.priceTier ?? "(nenhum)"} descriptionPt="${truncated}"`;
}
