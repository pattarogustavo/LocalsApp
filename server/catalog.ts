/**
 * Curated-catalog lookup layer for ai.suggestPlaces (server/routers.ts).
 *
 * Matches a requested destination against curatedDestinations, and — on a
 * match — serves its curatedPlaces (our own editorial content only) instead
 * of running the AI/Google fallback flow. Only `googlePlaceId` ever leaves
 * this module as Google-sourced data; address/hours/phone/photo are fetched
 * live per place_id by `fetchDetailsForTopCandidates` / the `catalogDetails`
 * tRPC procedure, never stored.
 *
 * Deliberately does NOT import from ./routers (which imports this module),
 * to avoid a circular import — Google Place Details/photo helpers live in
 * ./google-places instead.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { curatedDestinations, curatedPlaces, catalogRequests, type CuratedDestination, type CuratedPlace } from "../drizzle/schema";
import { LruTtlCache } from "./cache";
import { GOOGLE_PLACES_KEY, resolvePlaceIdViaTextSearch, fetchCuratedPlaceDetails } from "./google-places";
import { normalizeName } from "../scripts/curate/normalize";

/** Kill switch for the whole catalog layer. Enabled unless explicitly set to "false". */
export const CATALOG_ENABLED = process.env.CATALOG_ENABLED !== "false";

const DESTINATION_PLACE_ID_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const APPROVED_PLACES_CACHE_TTL_MS = 1000 * 60 * 10; // 10 minutes
export const GOOGLE_DETAILS_CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

const destinationPlaceIdCache = new LruTtlCache<string | null>(500);
const approvedPlacesCache = new LruTtlCache<CuratedPlace[]>(200);
const googleDetailsCache = new LruTtlCache<GoogleDetails | null>(2000);

/** Full country name (English), mirrored from scripts/data/destinations.ts's COUNTRY_NAMES. */
const COUNTRY_NAMES_EN: Record<string, string> = {
  GB: "United Kingdom", FR: "France", TR: "Turkey", IT: "Italy", ES: "Spain",
  NL: "Netherlands", PT: "Portugal", AT: "Austria", CZ: "Czech Republic",
  DE: "Germany", GR: "Greece", IE: "Ireland", HU: "Hungary", CH: "Switzerland",
  AE: "United Arab Emirates", SA: "Saudi Arabia", EG: "Egypt", MA: "Morocco",
  ZA: "South Africa", QA: "Qatar", US: "United States", CA: "Canada",
  MX: "Mexico", DO: "Dominican Republic", PR: "Puerto Rico", BR: "Brazil",
  AR: "Argentina", TH: "Thailand", HK: "Hong Kong", MO: "Macau", JP: "Japan",
  SG: "Singapore",
};

/** Same set of countries, in Portuguese — so a destination's country matches regardless of the app's display language. */
const COUNTRY_NAMES_PT: Record<string, string> = {
  GB: "Reino Unido", FR: "França", TR: "Turquia", IT: "Itália", ES: "Espanha",
  NL: "Holanda", PT: "Portugal", AT: "Áustria", CZ: "República Tcheca",
  DE: "Alemanha", GR: "Grécia", IE: "Irlanda", HU: "Hungria", CH: "Suíça",
  AE: "Emirados Árabes Unidos", SA: "Arábia Saudita", EG: "Egito", MA: "Marrocos",
  ZA: "África do Sul", QA: "Catar", US: "Estados Unidos", CA: "Canadá",
  MX: "México", DO: "República Dominicana", PR: "Porto Rico", BR: "Brasil",
  AR: "Argentina", TH: "Tailândia", HK: "Hong Kong", MO: "Macau", JP: "Japão",
  SG: "Singapura",
};

/** normalize() from scripts/curate/normalize.ts: lowercases, strips diacritics/punctuation, collapses whitespace. */
export const normalizeDestinationName = normalizeName;

function countryMatches(inputCountry: string | undefined, dest: CuratedDestination): boolean {
  if (!inputCountry || !inputCountry.trim()) return true;
  const normInput = normalizeDestinationName(inputCountry);
  if (!normInput) return true;
  if (normInput === dest.countryCode.toLowerCase()) return true;
  const enName = normalizeDestinationName(COUNTRY_NAMES_EN[dest.countryCode] || dest.country);
  const ptName = COUNTRY_NAMES_PT[dest.countryCode] ? normalizeDestinationName(COUNTRY_NAMES_PT[dest.countryCode]) : "";
  return normInput === enName || (!!ptName && normInput === ptName);
}

/**
 * Resolves `destinationName`(+`country`) to a Google Places place_id via
 * Text Search, cached for 7 days — used only as a fallback matcher when
 * name/country comparison against curatedDestinations finds nothing.
 */
async function resolveDestinationPlaceId(destinationName: string, country?: string): Promise<string | null> {
  const cacheKey = normalizeDestinationName(`${destinationName}|${country || ""}`);
  const cached = destinationPlaceIdCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const query = country ? `${destinationName}, ${country}` : destinationName;
  const placeId = await resolvePlaceIdViaTextSearch(query);
  destinationPlaceIdCache.set(cacheKey, placeId, DESTINATION_PLACE_ID_CACHE_TTL_MS);
  return placeId;
}

/**
 * Matches a requested destination against the active curated catalog.
 * 1. Normalize + compare destinationName against nameEn/namePt, and (if
 *    `country` was given) against the destination's country.
 * 2. If no name match, and a Google key is configured, resolve the
 *    requested destination's own place_id (text search, 7-day cache) and
 *    compare it to curatedDestinations.googlePlaceId.
 * Returns null (→ fallback flow) when nothing matches, the catalog is
 * disabled, or the DB is unavailable.
 */
export async function findCatalogDestination(
  destinationName: string,
  country?: string,
  lat?: number,
  lng?: number,
): Promise<CuratedDestination | null> {
  if (!CATALOG_ENABLED) return null;
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(curatedDestinations).where(eq(curatedDestinations.status, "active"));
  if (rows.length === 0) return null;

  const normRequested = normalizeDestinationName(destinationName);
  const byName = rows.find((row) =>
    (normalizeDestinationName(row.nameEn) === normRequested || normalizeDestinationName(row.namePt) === normRequested)
    && countryMatches(country, row)
  );
  if (byName) return byName;

  if (!GOOGLE_PLACES_KEY) return null;
  const placeId = await resolveDestinationPlaceId(destinationName, country);
  if (!placeId) return null;
  return rows.find((row) => row.googlePlaceId === placeId) ?? null;
}

/** Approved curated places for a destination, cached in-memory for 10 minutes. */
export async function getApprovedCuratedPlaces(destinationId: number): Promise<CuratedPlace[]> {
  const cacheKey = String(destinationId);
  const cached = approvedPlacesCache.get(cacheKey);
  if (cached) return cached;

  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(curatedPlaces)
    .where(and(eq(curatedPlaces.destinationId, destinationId), eq(curatedPlaces.status, "approved")));
  approvedPlacesCache.set(cacheKey, rows, APPROVED_PLACES_CACHE_TTL_MS);
  return rows;
}

const CONFIDENCE_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Orders curated places by: affinity with the requested categories (if
 * any) first, then confidence (high > medium > low), then curator rank.
 */
export function rankCuratedPlaces(places: CuratedPlace[], categories?: string[]): CuratedPlace[] {
  const wanted = categories && categories.length > 0 ? new Set(categories) : null;
  return [...places].sort((a, b) => {
    if (wanted) {
      const aMiss = wanted.has(a.category) ? 0 : 1;
      const bMiss = wanted.has(b.category) ? 0 : 1;
      if (aMiss !== bMiss) return aMiss - bMiss;
    }
    const confDiff = (CONFIDENCE_ORDER[a.confidence] ?? 1) - (CONFIDENCE_ORDER[b.confidence] ?? 1);
    if (confDiff !== 0) return confDiff;
    return a.rank - b.rank;
  });
}

/**
 * Backwards-compatibility mapping for app versions that predate the
 * park/beach/market/neighborhood categories (categoriesV2 input flag unset
 * or false): park/beach collapse into attraction, market into other,
 * neighborhood into hidden_gem.
 */
const CATEGORY_V1_FALLBACK: Record<string, string> = {
  park: "attraction",
  beach: "attraction",
  market: "other",
  neighborhood: "hidden_gem",
};

export function toCompatCategory(category: string, categoriesV2: boolean | undefined): string {
  if (categoriesV2) return category;
  return CATEGORY_V1_FALLBACK[category] || category;
}

type SupportedLanguage = "pt" | "en" | "es" | "fr" | "de" | "it";

/** Picks descriptions[language], falling back to English then Portuguese. */
export function pickCuratedDescription(place: CuratedPlace, language?: string): string {
  const descriptions = place.descriptions || {};
  const code = (language?.slice(0, 2).toLowerCase() || "en") as SupportedLanguage;
  return descriptions[code] || descriptions.en || descriptions.pt || "";
}

export interface CatalogPlaceResult {
  placeId: string;
  name: string;
  category: string;
  description: string;
  tags?: string[];
  priceTier?: string;
  cuisine?: string;
  neighborhood?: string;
  address?: string;
  hours?: string;
  phone?: string;
  imageUrl?: string;
}

/** Up to 80 curated places, ranked, mapped to the ai.suggestPlaces response shape — no Google details fetched yet. */
export function buildCatalogPlaceResults(
  places: CuratedPlace[],
  categories: string[] | undefined,
  language: string | undefined,
  categoriesV2: boolean | undefined,
): CatalogPlaceResult[] {
  return rankCuratedPlaces(places, categories)
    .slice(0, 80)
    .map((place) => ({
      placeId: place.googlePlaceId,
      name: place.aiName,
      category: toCompatCategory(place.category, categoriesV2),
      description: pickCuratedDescription(place, language),
      tags: place.tags ?? undefined,
      priceTier: place.priceTier ?? undefined,
      cuisine: place.cuisine ?? undefined,
      neighborhood: place.aiNeighborhood ?? undefined,
    }));
}

interface GoogleDetails {
  address?: string;
  hours?: string;
  phone?: string;
  imageUrl?: string;
}

/** Runs `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = items[nextIndex++];
      await fn(current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** fetchCuratedPlaceDetails (./google-places), cached for up to 1 hour. */
async function fetchCachedPlaceDetails(placeId: string, language?: string): Promise<GoogleDetails | null> {
  const cacheKey = `${placeId}|${language || ""}`;
  const cached = googleDetailsCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const details = await fetchCuratedPlaceDetails(placeId, language);
  const result = details.address || details.hours || details.phone || details.imageUrl ? details : null;
  googleDetailsCache.set(cacheKey, result, GOOGLE_DETAILS_CACHE_TTL_MS);
  return result;
}

/**
 * Backfills Google Place Details (address/hours/phone/photo) onto the
 * top `limit` catalog results only — concurrency 6, 6s timeout per place. A
 * failed/slow lookup never removes the place, it's just left without those
 * fields (the app's places.catalogDetails fills them in later on demand).
 */
export async function fetchDetailsForTopCandidates(
  places: CatalogPlaceResult[],
  limit: number,
  language?: string,
): Promise<CatalogPlaceResult[]> {
  if (!GOOGLE_PLACES_KEY) return places;
  const top = places.slice(0, limit);
  await mapWithConcurrency(top, 6, async (place) => {
    try {
      const details = await withTimeout(fetchCachedPlaceDetails(place.placeId, language), 6000);
      if (details) {
        place.address = details.address;
        place.hours = details.hours;
        place.phone = details.phone;
        place.imageUrl = details.imageUrl;
      }
    } catch {
      // timeout or fetch failure — leave the place without extra details.
    }
  });
  return places;
}

/** places.catalogDetails: on-demand Google details for up to 12 place_ids at a time, 1h cache. */
export async function fetchCatalogDetailsBatch(
  placeIds: string[],
  language?: string,
): Promise<Record<string, GoogleDetails>> {
  const result: Record<string, GoogleDetails> = {};
  if (!GOOGLE_PLACES_KEY) return result;
  await mapWithConcurrency(placeIds, 6, async (placeId) => {
    try {
      const details = await withTimeout(fetchCachedPlaceDetails(placeId, language), 6000);
      if (details) result[placeId] = details;
    } catch {
      // leave this placeId out of the result — caller keeps whatever it already had.
    }
  });
  return result;
}

/**
 * Records a destination that did NOT match the catalog, so curation can be
 * prioritized for it. Upserts by (destinationNormalized, country), bumping
 * `count` and `lastRequestedAt`. Never throws — a failure here must never
 * affect the ai.suggestPlaces response.
 */
export async function recordCatalogMiss(destinationName: string, country: string | undefined, language: string | undefined): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const destinationNormalized = normalizeDestinationName(destinationName);
    // Never NULL: the unique constraint is on (destinationNormalized, country),
    // and NULL != NULL in SQL would make every country-less request for the
    // same destination insert a new row instead of incrementing count.
    const countryValue = country?.trim() ?? "";
    await db
      .insert(catalogRequests)
      .values({
        destinationNormalized,
        destinationName,
        country: countryValue,
        language: language?.slice(0, 8),
        count: 1,
        firstRequestedAt: new Date(),
        lastRequestedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [catalogRequests.destinationNormalized, catalogRequests.country],
        set: {
          count: sql`${catalogRequests.count} + 1`,
          lastRequestedAt: new Date(),
          language: language?.slice(0, 8),
        },
      });
  } catch (err) {
    console.error(`[catalog] failed to record catalog miss for "${destinationName}":`, err);
  }
}
