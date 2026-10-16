import type { GeoPoint } from "./distance";
import type { GoogleMatch } from "./google";
import { namesReasonablyMatch } from "./normalize";
import { pickVerifiedCandidate } from "./match-google";
import type { DiscardReasonCounts } from "./verify";
import type { ValidatedPlace } from "./validate-place";

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
 * Notting Hill, ...) are themselves often neighborhoods.
 */
export async function matchManualNames(
  names: string[],
  findMatches: (name: string) => Promise<GoogleMatch[]>,
  center: GeoPoint,
  maxDistanceKm: number,
  discardCounts: DiscardReasonCounts,
): Promise<ManualMatchSummary> {
  const accepted: ManualAddAcceptedMatch[] = [];
  const rejected: ManualAddRejection[] = [];

  for (const name of names) {
    const candidates = await findMatches(name);
    const outcome = pickVerifiedCandidate(name, candidates, center, maxDistanceKm, true, discardCounts);
    if (outcome.accepted) {
      accepted.push({ name, googlePlaceId: outcome.googlePlaceId, googleName: outcome.googleName });
    } else {
      rejected.push({ name, reason: outcome.reason, googleName: outcome.googleName });
    }
  }

  return { accepted, rejected };
}

export interface ManualAddFinalized {
  place: ValidatedPlace;
  googlePlaceId: string;
  googleName: string;
}

export interface PairStructuredResult {
  finalized: ManualAddFinalized[];
  /** Google matches the structuring call never returned a place for — reported back as a rejection. */
  unmatched: ManualAddAcceptedMatch[];
}

/**
 * Pairs each AI-structured place back to the Google match it came from, by
 * name similarity (same threshold used for Google verification) — the
 * structuring call is asked to keep names unchanged, but is never trusted to
 * echo them back byte-for-byte or in order. Each Google match is used at
 * most once.
 */
export function pairStructuredWithMatches(structured: ValidatedPlace[], matched: ManualAddAcceptedMatch[]): PairStructuredResult {
  const remaining = [...matched];
  const finalized: ManualAddFinalized[] = [];

  for (const place of structured) {
    const idx = remaining.findIndex((m) => namesReasonablyMatch(m.name, place.name));
    if (idx === -1) continue;
    const [m] = remaining.splice(idx, 1);
    finalized.push({ place, googlePlaceId: m.googlePlaceId, googleName: m.googleName });
  }

  return { finalized, unmatched: remaining };
}
