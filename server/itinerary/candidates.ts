/**
 * Candidate-pool preparation for REAL itinerary generation
 * (ai.generateItinerary / ai.generateFromScratch) — merges the curated
 * catalog (server/catalog.ts, previously wired ONLY into ai.suggestPlaces;
 * see docs/itinerary-audit.md section 1) with the already-fetched Google
 * Places pool, then ranks/caps the result using the existing deterministic
 * scoring module (./scoring.ts).
 *
 * Invariant preserved (non-negotiable product decision — see scoring.ts):
 * `filterExcludedCandidates` is the ONLY thing that drops a candidate
 * outright (a literal user "avoid" match). `rankCandidates` only reorders;
 * the safety cap only trims the END of that order. Subjective
 * interest/quality/popularity/editorial scoring NEVER silently excludes an
 * eligible place — it only decides position and, when the pool is larger
 * than the cap, which candidates are trimmed off the bottom.
 *
 * Catalog places never carry Google-sourced fields at rest (lat/lng,
 * rating, review count, opening hours — see the comment on
 * drizzle/schema.ts `curatedPlaces`), so they need a bounded Place Details
 * backfill before the model (or the validator) can use their coordinates —
 * `backfillCatalogGoogleData` does that for a capped subset of the final
 * ranked pool (after ranking, so the backfill budget is spent on the
 * candidates most likely to actually matter).
 */

import {
  findCatalogDestination,
  getApprovedCuratedPlaces,
  rankCuratedPlaces,
  pickCuratedDescription,
} from "../catalog";
import { fetchCuratedPlaceDetails } from "../google-places";
import { rankCandidates, filterExcludedCandidates, type ScorableCandidate } from "./scoring";

export interface GoogleSourcedCandidateInput {
  name: string;
  placeId: string;
  destinationName: string;
  rating?: number;
  userRatingsTotal: number;
  types: string[];
  hasPhoto: boolean;
  businessStatus?: string;
  lat?: number;
  lng?: number;
  priceLevel?: number;
  hoursText?: string;
}

export interface PoolCandidate extends ScorableCandidate {
  destinationName: string;
  hasPhoto: boolean;
  businessStatus?: string;
  lat?: number;
  lng?: number;
  hoursText?: string;
  source: "catalog" | "google";
  category?: string;
  curatedDescription?: string;
  tags?: string[];
  priceTier?: string;
  cuisine?: string;
  neighborhood?: string;
}

/** Curator confidence → 0-100 editorial-affinity score fed into scoring.ts's ranking tuple. Coarse but deterministic; never a hard filter either way. */
const CONFIDENCE_TO_EDITORIAL_PRIORITY: Record<string, number> = { high: 100, medium: 65, low: 35 };

/** App PlaceCategory → a representative Google `types` set, so a catalog place (no real Google types) can still participate in scoring.ts's interest matching (STYLE_TYPE_MAP). Approximate by design — catalog places don't have a real `types` array. */
const CATEGORY_SYNTHETIC_TYPES: Record<string, string[]> = {
  attraction: ["tourist_attraction"],
  restaurant: ["restaurant"],
  cafe: ["cafe"],
  museum: ["museum"],
  hidden_gem: ["tourist_attraction"],
  other: ["point_of_interest"],
  park: ["park"],
  beach: ["natural_feature", "beach"],
  market: ["market"],
  neighborhood: ["point_of_interest"],
};

async function fetchCatalogCandidatesForDestination(
  destinationName: string,
  country: string | undefined,
  lat: number | undefined,
  lng: number | undefined,
  language: string | undefined,
): Promise<PoolCandidate[]> {
  try {
    const dest = await findCatalogDestination(destinationName, country, lat, lng);
    if (!dest) return [];
    const approved = await getApprovedCuratedPlaces(dest.id);
    if (approved.length === 0) return [];
    return rankCuratedPlaces(approved).map((p) => ({
      name: p.aiName,
      placeId: p.googlePlaceId,
      destinationName,
      userRatingsTotal: 0,
      types: CATEGORY_SYNTHETIC_TYPES[p.category] ?? ["point_of_interest"],
      hasPhoto: false,
      source: "catalog" as const,
      editorialPriority: CONFIDENCE_TO_EDITORIAL_PRIORITY[p.confidence] ?? 50,
      category: p.category,
      curatedDescription: pickCuratedDescription(p, language),
      tags: p.tags ?? undefined,
      priceTier: p.priceTier ?? undefined,
      cuisine: p.cuisine ?? undefined,
      neighborhood: p.aiNeighborhood ?? undefined,
    }));
  } catch (err) {
    console.error(`[itinerary.candidates] catalog lookup failed for "${destinationName}":`, err);
    return [];
  }
}

/**
 * Backfills real lat/lng/opening-hours onto catalog-sourced candidates only
 * (Google-sourced ones already have lat/lng from Nearby Search) — bounded to
 * `limit` candidates and concurrency 6, mirroring the pattern already used
 * by catalog.ts/routers.ts for the same kind of enrichment. A failed/slow
 * lookup never removes the candidate, it's just left without those fields.
 */
async function backfillCatalogGoogleData(
  candidates: PoolCandidate[],
  limit: number,
  language: string | undefined,
): Promise<void> {
  const targets = candidates.filter((c) => c.source === "catalog").slice(0, limit);
  if (targets.length === 0) return;
  const concurrency = Math.min(6, targets.length);
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const c = targets[next++];
      try {
        const details = await fetchCuratedPlaceDetails(c.placeId, language);
        if (details.lat != null) c.lat = details.lat;
        if (details.lng != null) c.lng = details.lng;
        if (details.hours) c.hoursText = details.hours;
        if (details.imageUrl) c.hasPhoto = true;
      } catch {
        // leave this candidate without backfilled fields — never blocks the pool.
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

export interface PrepareCandidatePoolOptions {
  travelStyles?: string[];
  attractionsBudget?: string;
  restaurantsBudget?: string;
  avoidText?: string;
  language?: string;
  /** Names (lowercased) to exclude from the pool entirely — e.g. already user-selected places, kept out so they aren't offered twice. */
  excludeNamesLower?: Set<string>;
  /** Safety cap on the final pool size (prompt-size/cost bound) — applied AFTER ranking, never before. Default 180, matching the prior single-source cap. */
  safetyCap?: number;
  /** Max catalog candidates to backfill real Google data for. Default 60. */
  catalogBackfillLimit?: number;
}

export interface PrepareCandidatePoolResult {
  candidates: PoolCandidate[];
  /** How many candidates were hard-excluded by the user's avoid list (never by subjective scoring). */
  excludedCount: number;
  /** How many of the final (capped) pool came from the curated catalog. */
  catalogCount: number;
  /** Pool size before the safety cap was applied (for telemetry). */
  totalBeforeCap: number;
}

/**
 * Merges the curated catalog with an already-fetched real Google candidate
 * pool into ONE ranked, deduped, capped pool — the actual candidate-prep
 * step real itinerary generation (ai.generateItinerary/generateFromScratch)
 * now uses, instead of Google-only candidates ordered by raw review count.
 */
export async function prepareCandidatePool(
  googleCandidates: GoogleSourcedCandidateInput[],
  destinations: { name: string; country?: string; lat?: number; lng?: number }[],
  opts: PrepareCandidatePoolOptions,
): Promise<PrepareCandidatePoolResult> {
  const catalogByDestination = await Promise.all(
    destinations.map((d) => fetchCatalogCandidatesForDestination(d.name, d.country, d.lat, d.lng, opts.language)),
  );
  const catalogCandidates = catalogByDestination.flat();

  // Merge by placeId — exact match only, NEVER fuzzy name matching (a
  // stable-ID requirement, not a heuristic one): a placeId present in both
  // sources keeps the catalog's editorial fields but backfills objective
  // Google signals (rating/review count/types/lat-lng/etc.) the catalog
  // entry lacks at rest — explicit per-field precedence below, rather than
  // a blind object spread, since the catalog's own placeholder defaults
  // (e.g. userRatingsTotal: 0) must never shadow a real Google value.
  const byPlaceId = new Map<string, PoolCandidate>();
  for (const g of googleCandidates) {
    byPlaceId.set(g.placeId, { ...g, source: "google" });
  }
  for (const c of catalogCandidates) {
    const g = byPlaceId.get(c.placeId);
    byPlaceId.set(
      c.placeId,
      g
        ? {
            ...c, // editorial fields (category/curatedDescription/tags/priceTier/cuisine/neighborhood/editorialPriority) win
            rating: g.rating ?? c.rating,
            userRatingsTotal: g.userRatingsTotal, // Google's real review count always wins over the catalog's placeholder 0
            types: g.types.length > 0 ? g.types : c.types,
            hasPhoto: g.hasPhoto || c.hasPhoto,
            businessStatus: g.businessStatus,
            lat: g.lat ?? c.lat,
            lng: g.lng ?? c.lng,
            priceLevel: g.priceLevel ?? c.priceLevel,
            hoursText: g.hoursText ?? c.hoursText,
            source: "catalog" as const,
          }
        : c,
    );
  }

  const excludeNamesLower = opts.excludeNamesLower ?? new Set<string>();
  const deduped = Array.from(byPlaceId.values()).filter((c) => !excludeNamesLower.has(c.name.toLowerCase()));

  // Hard exclusion FIRST — the only thing allowed to drop a candidate.
  const { kept, excludedCount } = filterExcludedCandidates(deduped, opts.avoidText);

  // Reorder/truncate only — never a second filter.
  const ranked = rankCandidates(kept, {
    travelStyles: opts.travelStyles,
    attractionsBudget: opts.attractionsBudget,
    restaurantsBudget: opts.restaurantsBudget,
  });

  const totalBeforeCap = ranked.length;
  const safetyCap = opts.safetyCap ?? 180;
  const capped = ranked.slice(0, safetyCap).map((r) => r.candidate);

  await backfillCatalogGoogleData(capped, opts.catalogBackfillLimit ?? 60, opts.language);

  return {
    candidates: capped,
    excludedCount,
    catalogCount: capped.filter((c) => c.source === "catalog").length,
    totalBeforeCap,
  };
}
