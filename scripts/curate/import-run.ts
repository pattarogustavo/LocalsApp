/**
 * Per-city orchestration for curate:import: resolving the destination,
 * validating/resolving/deduping its places. Kept free of direct DB/network
 * calls (everything that talks to Google or Postgres is injected) so it's
 * fully testable with fakes, the same way scripts/curate/manual-add.ts is.
 */

import type { GeoPoint } from "./distance";
import type { GoogleMatch } from "./google";
import type { DiscardReasonCounts } from "./verify";
import { resolvePlace } from "./match-google";
import { dedupeByPlaceId } from "./dedupe";
import { validateImportPlace } from "./import-validate";
import { inferCategoryFromGoogleTypes } from "./import-category";
import type { ResolvedCityDestination } from "./import-json";
import type { ImportRawPlace } from "./import-json";
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
 * Resolves an already-slug-identified destination (see
 * scripts/curate/import-json.ts resolveCityDestination, which runs first
 * and handles a missing/ambiguous slug) against destinations.ts and the
 * database: an existing entry wins outright and the given fields are
 * ignored; a brand-new slug keeps them as-is. Doesn't resolve a Google
 * place_id for a new destination — the caller does that once it has the
 * final nameEn/country, via the same center lookup it needs for place
 * matching anyway.
 */
export async function resolveDestinationForCity(
  destination: ResolvedCityDestination,
  findExistingSeed: (slug: string) => ExistingDestinationSeed | undefined,
  findExistingDbRow: (slug: string) => Promise<ExistingDestinationRow | undefined>,
  countryNameFor: (countryCode: string) => string,
): Promise<DestinationResolution> {
  const slug = destination.slug;

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
    nameEn: destination.nameEn,
    namePt: destination.namePt,
    country: destination.country,
    countryCode: destination.countryCode,
    tier: destination.tier,
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
  /** Every distinct name Google returned across every search attempt (default language, local-language retry, type retry) — so a false mismatch can be diagnosed in both languages when Google answered twice. */
  googleNames: string[];
}

export interface ImportInvalidInput {
  name: string;
  errors: string[];
}

export interface ImportCityPlanResult {
  resolved: ImportPlaceResolved[];
  rejected: ImportPlaceRejection[];
  invalidInput: ImportInvalidInput[];
  /** How many of `resolved` only matched thanks to the local-language retry. */
  languageRetryAccepted: number;
  /** How many of `resolved` only matched thanks to the type-biased Text Search retry. */
  typeRetryAccepted: number;
}

export interface PlanCityPlacesDeps {
  places: ImportRawPlace[];
  destinationName: string;
  countryCode: string;
  center: GeoPoint;
  maxDistanceKm: number;
  discardCounts: DiscardReasonCounts;
  /** findplacefromtext-style search: given every candidate name (place name + altNames) and an optional language override. */
  findByText: (names: string[], neighborhood: string | undefined, language: string | undefined) => Promise<GoogleMatch[]>;
  /** Text-Search-style search biased toward the destination center, with an optional Google `type` restriction. */
  findByTextSearch: (names: string[], type: string | undefined) => Promise<GoogleMatch[]>;
}

/**
 * Validates every place in a city block, matches it against Google via
 * resolvePlace (first search, then a local-language retry, then — only for
 * an address-shaped rejection — a type-biased Text Search retry), infers a
 * missing category from the matched candidate's Google types, and dedupes
 * the result by googlePlaceId. A place with no usable Google match or that
 * fails validation is reported separately instead of aborting the batch.
 */
export async function planCityPlaces(deps: PlanCityPlacesDeps): Promise<ImportCityPlanResult> {
  const rejected: ImportPlaceRejection[] = [];
  const invalidInput: ImportInvalidInput[] = [];
  const resolved: ImportPlaceResolved[] = [];
  let languageRetryAccepted = 0;
  let typeRetryAccepted = 0;

  for (const raw of deps.places) {
    const result = validateImportPlace(raw);
    if (!result.valid || !result.place) {
      const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "(sem nome)";
      invalidInput.push({ name, errors: result.errors });
      continue;
    }

    const place = result.place;
    const names = [place.name, ...place.altNames];

    const resolution = await resolvePlace({
      names,
      neighborhood: place.neighborhood,
      category: place.category,
      countryCode: deps.countryCode,
      center: deps.center,
      maxDistanceKm: deps.maxDistanceKm,
      // Always allow a neighborhood/sublocality match: an imported place can itself be one (a district, a market square, ...).
      allowNeighborhood: true,
      discardCounts: deps.discardCounts,
      findByText: (n, neighborhood, language) => deps.findByText(n, neighborhood, language),
      findByTextSearch: (n, type) => deps.findByTextSearch(n, type),
    });

    if (!resolution.outcome.accepted) {
      rejected.push({ name: place.name, reason: resolution.outcome.reason, googleNames: resolution.seenGoogleNames });
      continue;
    }

    if (resolution.usedLanguageRetry) languageRetryAccepted++;
    if (resolution.usedTypeRetry) typeRetryAccepted++;

    let category = place.category;
    if (!category) {
      category = (resolution.matchedCandidate ? inferCategoryFromGoogleTypes(resolution.matchedCandidate.types) : undefined) ?? "other";
    }

    resolved.push({
      requestedName: place.name,
      googlePlaceId: resolution.outcome.googlePlaceId,
      googleName: resolution.outcome.googleName,
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

  return { resolved: dedupeByPlaceId(resolved), rejected, invalidInput, languageRetryAccepted, typeRetryAccepted };
}
