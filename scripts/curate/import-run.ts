/**
 * Per-city orchestration for curate:import: resolving the destination,
 * validating/resolving/deduping its places. Kept free of direct DB/network
 * calls (everything that talks to Google or Postgres is injected) so it's
 * fully testable with fakes, the same way scripts/curate/manual-add.ts is.
 */

import type { GeoPoint } from "./distance";
import type { GoogleMatch } from "./google";
import type { DiscardReasonCounts } from "./verify";
import { pickVerifiedCandidate } from "./match-google";
import { dedupeByPlaceId } from "./dedupe";
import { validateImportPlace } from "./import-validate";
import { inferCategoryFromGoogleTypes } from "./import-category";
import type { ImportCityBlock } from "./import-json";
import type { Descriptions } from "./descriptions";

// ─── destination resolution ─────────────────────────────────────────────────

export interface ExistingDestinationSeed {
  nameEn: string;
  namePt: string;
  countryCode: string;
  tier: string;
}

export interface ExistingDestinationRow {
  nameEn: string;
  namePt: string;
  country: string;
  countryCode: string;
  tier: string;
  googlePlaceId: string | null;
}

export interface DestinationResolution {
  slug: string;
  nameEn: string;
  namePt: string;
  country: string;
  countryCode: string;
  tier: string;
  googlePlaceId?: string;
  /** True only when neither destinations.ts nor the database already had this slug. */
  isNew: boolean;
}

/**
 * Resolves a city block's destination by slug: an existing entry (in
 * destinations.ts or the database) wins outright and the block's own
 * destination fields are ignored; a brand-new slug keeps the block's own
 * fields as-is. Doesn't resolve a Google place_id for a new destination —
 * the caller does that once it has the final nameEn/country, via the same
 * center lookup it needs for place matching anyway.
 */
export async function resolveDestinationForCity(
  block: ImportCityBlock,
  findExistingSeed: (slug: string) => ExistingDestinationSeed | undefined,
  findExistingDbRow: (slug: string) => Promise<ExistingDestinationRow | undefined>,
  countryNameFor: (countryCode: string) => string,
): Promise<DestinationResolution> {
  const slug = block.destination.slug;

  const seed = findExistingSeed(slug);
  if (seed) {
    return {
      slug,
      nameEn: seed.nameEn,
      namePt: seed.namePt,
      country: countryNameFor(seed.countryCode),
      countryCode: seed.countryCode,
      tier: seed.tier,
      isNew: false,
    };
  }

  const dbRow = await findExistingDbRow(slug);
  if (dbRow) {
    return {
      slug,
      nameEn: dbRow.nameEn,
      namePt: dbRow.namePt,
      country: dbRow.country,
      countryCode: dbRow.countryCode,
      tier: dbRow.tier,
      googlePlaceId: dbRow.googlePlaceId ?? undefined,
      isNew: false,
    };
  }

  return {
    slug,
    nameEn: block.destination.nameEn,
    namePt: block.destination.namePt,
    country: block.destination.country,
    countryCode: block.destination.countryCode,
    tier: block.destination.tier,
    isNew: true,
  };
}

// ─── place planning (validate + Google-match + dedupe) ──────────────────────

export interface ImportPlaceResolved {
  /** The name as given in the import file, before Google verification. */
  requestedName: string;
  googlePlaceId: string;
  googleName: string;
  category: string;
  neighborhood?: string;
  tags: string[];
  priceTier?: string;
  meals?: string[];
  cuisine?: string;
  confidence: string;
  descriptions: Descriptions;
}

export interface ImportPlaceRejection {
  name: string;
  reason: string;
  googleName?: string;
}

export interface ImportInvalidInput {
  name: string;
  errors: string[];
}

export interface ImportCityPlanResult {
  resolved: ImportPlaceResolved[];
  rejected: ImportPlaceRejection[];
  invalidInput: ImportInvalidInput[];
}

/**
 * Validates every place in a city block, matches it against Google (trying
 * each candidate in turn via the same pickVerifiedCandidate rules as
 * curate:add/curate:generate — see scripts/curate/match-google.ts), infers
 * a missing category from Google's types, and dedupes the result by
 * googlePlaceId. A place with no usable Google match or that fails
 * validation is reported separately instead of aborting the batch.
 */
export async function planCityPlaces(
  block: ImportCityBlock,
  findMatches: (name: string, neighborhood: string | undefined) => Promise<GoogleMatch[]>,
  center: GeoPoint,
  maxDistanceKm: number,
  discardCounts: DiscardReasonCounts,
): Promise<ImportCityPlanResult> {
  const rejected: ImportPlaceRejection[] = [];
  const invalidInput: ImportInvalidInput[] = [];
  const resolved: ImportPlaceResolved[] = [];

  for (const raw of block.places) {
    const result = validateImportPlace(raw);
    if (!result.valid || !result.place) {
      const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "(sem nome)";
      invalidInput.push({ name, errors: result.errors });
      continue;
    }

    const place = result.place;
    const candidates = await findMatches(place.name, place.neighborhood);
    // Always allow a neighborhood/sublocality match: an imported place can itself be one (a district, a market square, ...).
    const outcome = pickVerifiedCandidate(place.name, candidates, center, maxDistanceKm, true, discardCounts);
    if (!outcome.accepted) {
      rejected.push({ name: place.name, reason: outcome.reason, googleName: outcome.googleName });
      continue;
    }

    let category = place.category;
    if (!category) {
      const matchedCandidate = candidates.find((c) => c.placeId === outcome.googlePlaceId);
      category = (matchedCandidate ? inferCategoryFromGoogleTypes(matchedCandidate.types) : undefined) ?? "other";
    }

    resolved.push({
      requestedName: place.name,
      googlePlaceId: outcome.googlePlaceId,
      googleName: outcome.googleName,
      category,
      neighborhood: place.neighborhood,
      tags: place.tags,
      priceTier: place.priceTier,
      meals: place.meals,
      cuisine: place.cuisine,
      confidence: place.confidence,
      descriptions: place.descriptions,
    });
  }

  return { resolved: dedupeByPlaceId(resolved), rejected, invalidInput };
}
