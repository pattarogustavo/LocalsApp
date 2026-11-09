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
  address?: string;
}

export interface FilterHallucinatedStopsOptions {
  candidatesByPlaceId: Map<string, GuardCandidate>;
  /** Lowercased names allowed even without a candidate match (user-selected places + resolved must-see). */
  allowedNamesLower: Set<string>;
  /**
   * Real lat/lng/address for the same allowed-by-name places, keyed by the
   * same lowercased name — lets a stop that only matched by name (no
   * googlePlaceId candidate, e.g. a user-selected place or a resolved
   * must-see) still get backfilled with real coordinates/address instead of
   * whatever the model guessed.
   */
  realDataByNameLower?: Map<string, GuardCandidate>;
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

        const nameLower = String(stop.placeName).toLowerCase();
        const candidate = stop.googlePlaceId ? opts.candidatesByPlaceId.get(stop.googlePlaceId) : undefined;
        const isAllowedByName = opts.allowedNamesLower.has(nameLower);
        if (!candidate && !isAllowedByName) {
          droppedCount++;
          return null;
        }

        if (candidate) {
          return {
            ...stop,
            googlePlaceId: candidate.placeId,
            placeName: candidate.name,
            lat: candidate.lat ?? stop.lat,
            lng: candidate.lng ?? stop.lng,
            address: candidate.address ?? stop.address,
          };
        }

        // No googlePlaceId candidate, but matched by name (user-selected
        // place or resolved must-see) — backfill real lat/lng/address for
        // that place too, instead of trusting whatever the model returned
        // (which the output schema allows to be null).
        const realData = opts.realDataByNameLower?.get(nameLower);
        if (!realData) return stop;
        return {
          ...stop,
          lat: realData.lat ?? stop.lat,
          lng: realData.lng ?? stop.lng,
          address: realData.address ?? stop.address,
        };
      })
      .filter(Boolean);
    return { ...day, stops };
  });

  return { days: patchedDays, droppedCount };
}
