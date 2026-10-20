/**
 * Shared "no invented places" guard for AI-generated itinerary stops.
 *
 * Previously duplicated, with subtly different behavior, between
 * ai.generateItinerary and ai.generateFromScratch in server/routers.ts:
 * ai.generateFromScratch's inline version checked a stop's placeName only
 * against the user's explicitly SELECTED places, never against a resolved
 * must-see place — so a model-written stop for a must-see the user asked
 * for by name could get silently dropped as "hallucinated" whenever its
 * googlePlaceId didn't happen to match a pool candidate. Unifying on this
 * version fixes that (a correctness improvement, not a loosening) and
 * removes the duplication.
 *
 * A stop survives only if:
 * - there's no real candidate pool to check against at all (nothing to
 *   ground against — always allowed), OR
 * - its googlePlaceId matches a real candidate, OR
 * - its placeName matches (case-insensitively) a user-selected or
 *   resolved must-visit place.
 * Anything else means the model ignored the "don't invent" instruction, so
 * the stop is dropped rather than trusting an unverifiable place. A stop
 * that matched a real candidate gets its googlePlaceId/placeName/lat/lng
 * backfilled from that candidate, so downstream code never has to re-resolve
 * it and can't drift from the grounded name/coordinates.
 */

export interface GuardCandidate {
  placeId: string;
  name: string;
  lat?: number;
  lng?: number;
}

export interface FilterHallucinatedStopsOptions {
  candidatesByPlaceId: Map<string, GuardCandidate>;
  /** Lowercased names allowed even without a candidate match (user-selected places + resolved must-see). */
  allowedNamesLower: Set<string>;
  /** False when no real candidate pool was fetched at all — in that case nothing is grounded, so every named stop is kept as-is. */
  hasCandidatePool: boolean;
}

export interface FilterHallucinatedStopsResult<Day> {
  days: Day[];
  droppedCount: number;
}

export function filterHallucinatedStops<Day extends { stops?: any[] }>(
  days: Day[],
  opts: FilterHallucinatedStopsOptions,
): FilterHallucinatedStopsResult<Day> {
  let droppedCount = 0;

  const patchedDays = days.map((day) => {
    const stops = (day.stops || [])
      .map((stop: any) => {
        if (!stop.placeName) return null;
        if (!opts.hasCandidatePool) return stop;

        const candidate = stop.googlePlaceId ? opts.candidatesByPlaceId.get(stop.googlePlaceId) : undefined;
        const isAllowedByName = opts.allowedNamesLower.has(String(stop.placeName).toLowerCase());
        if (!candidate && !isAllowedByName) {
          droppedCount++;
          return null;
        }

        if (!candidate) return stop;
        return {
          ...stop,
          googlePlaceId: candidate.placeId,
          placeName: candidate.name,
          lat: candidate.lat ?? stop.lat,
          lng: candidate.lng ?? stop.lng,
        };
      })
      .filter(Boolean);
    return { ...day, stops };
  });

  return { days: patchedDays, droppedCount };
}
