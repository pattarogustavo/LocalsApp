/**
 * Shared Google Places helpers used both by the AI suggestion fallback flow
 * (server/routers.ts) and by the curated-catalog flow (server/catalog.ts).
 * Kept in its own module so catalog.ts never needs to import from
 * routers.ts (which itself imports catalog.ts) — avoids a circular import.
 */

export const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// Maps the app's internal language codes to the codes Google's APIs
// (Places, Directions) expect. Falls back to pt-BR for unrecognized or
// missing values, so callers that don't pass a language keep working as before.
const GOOGLE_LANGUAGE_MAP: Record<string, string> = {
  pt: "pt-BR",
  en: "en",
  es: "es",
  fr: "fr",
  de: "de",
  it: "it",
};

export function mapToGoogleLanguage(lang?: string): string {
  const code = lang?.slice(0, 2).toLowerCase();
  return (code && GOOGLE_LANGUAGE_MAP[code]) || "pt-BR";
}

/**
 * ISO 3166-1 alpha-2 country code → that country's dominant Google language
 * code — used ONLY to resolve a destination's OWN local-language name (e.g.
 * "München"/"Deutschland" for Munich, regardless of which language the app's
 * UI is currently in), never for display text shown to the user. The
 * `country` field's `short_name` from Google Place Details' address
 * components is language-invariant (always the ISO code, no matter what
 * `language` param the request used), so this map can be looked up from a
 * single Place Details call. Deliberately a bounded, best-effort list (not
 * exhaustive ISO 3166) — an unmapped country falls back to English, same as
 * Google's own Places API default.
 */
const COUNTRY_CODE_TO_LOCAL_LANGUAGE: Record<string, string> = {
  GB: "en", US: "en", AU: "en", CA: "en", IE: "en", NZ: "en", ZA: "en", IN: "en", SG: "en",
  PT: "pt", BR: "pt",
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es",
  FR: "fr", BE: "fr", MC: "fr",
  DE: "de", AT: "de", CH: "de", // Switzerland is multilingual (de/fr/it/rm) — "de" is the best single-value approximation (largest population share); a French- or Italian-speaking Swiss city's local name may not match this pick

  IT: "it",
  NL: "nl",
  GR: "el",
  TR: "tr",
  RU: "ru",
  JP: "ja",
  KR: "ko",
  CN: "zh-CN", TW: "zh-TW", HK: "zh-TW",
  TH: "th",
  VN: "vi",
  ID: "id",
  PL: "pl",
  SE: "sv",
  NO: "no",
  DK: "da",
  FI: "fi",
  CZ: "cs",
  HU: "hu",
  RO: "ro",
  MA: "ar", AE: "ar", SA: "ar", EG: "ar",
  IL: "he",
};

export function resolveLocalLanguageForCountry(countryCode: string | undefined): string {
  const code = countryCode?.toUpperCase();
  return (code && COUNTRY_CODE_TO_LOCAL_LANGUAGE[code]) || "en";
}

/** Default soft-bias radius for a destination-scoped Places Autocomplete search (e.g. hotels) — wide enough to cover a whole metro area without hard-restricting results to it. */
export const DEFAULT_PLACES_BIAS_RADIUS_METERS = 50000;

/**
 * Resolves the `location`/`radius` query params for a geographically-biased
 * Google Places Autocomplete request, or `null` when no destination
 * coordinates are available — callers should simply omit the params in that
 * case (an unbiased global search), never invent a center. This is a SOFT
 * bias only (no `strictbounds`): Google can still surface a clearly-better
 * match outside the radius, so a real, differently-named destination within
 * the radius is never hard-excluded, and a wide destination region (e.g. a
 * big city) isn't clipped by too small a radius.
 */
export function resolvePlacesLocationBias(
  lat: number | undefined,
  lng: number | undefined,
  radiusMeters?: number,
): { location: string; radius: string } | null {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { location: `${lat},${lng}`, radius: String(radiusMeters ?? DEFAULT_PLACES_BIAS_RADIUS_METERS) };
}

/**
 * Pick the best photo from a Google Places `photos` array.
 * User-submitted photos vary wildly in subject and orientation, so we prefer
 * strictly landscape shots (width > height) — more likely to be a view of the place
 * rather than a close-up of food, an interior, or a menu — and among those
 * pick the highest resolution. If no landscape photo exists, fall back to
 * the highest-resolution photo overall so we never end up without an image.
 */
export function pickBestGooglePhoto(
  photos: { photo_reference: string; width?: number; height?: number }[] | undefined
): string | undefined {
  if (!photos || photos.length === 0) return undefined;

  const byResolutionDesc = (a: typeof photos[number], b: typeof photos[number]) =>
    (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0);

  const landscape = photos.filter((p) => (p.width || 0) > (p.height || 0));
  const pool = landscape.length > 0 ? landscape : photos;

  return [...pool].sort(byResolutionDesc)[0]?.photo_reference;
}

/**
 * Resolve a Google Places photo_reference to a stable public photo URL,
 * following the redirect so we store an lh3.googleusercontent.com URL
 * (no API key exposed to the client).
 */
export async function resolveGooglePhotoUrl(photoReference: string): Promise<string | undefined> {
  try {
    const photoUrl = new URL("https://maps.googleapis.com/maps/api/place/photo");
    photoUrl.searchParams.set("maxwidth", "1200");
    photoUrl.searchParams.set("photo_reference", photoReference);
    photoUrl.searchParams.set("key", GOOGLE_PLACES_KEY);
    const photoRes = await fetch(photoUrl.toString(), { redirect: "follow" });
    if (photoRes.ok && photoRes.url.includes("googleusercontent.com")) {
      return photoRes.url;
    }
    // Fallback: return the redirect URL (React Native follows redirects natively)
    return photoUrl.toString();
  } catch (photoErr) {
    console.error("[google-places] photo fetch failed:", photoErr);
    return undefined;
  }
}

/**
 * Fetch real address/hours/phone/photo for a single place_id via Place Details,
 * reusing the same landscape + highest-resolution photo curation as places.details.
 *
 * `opts.includePhoto` (default true) controls whether the photo_reference is
 * resolved to a stable URL — that resolution is its OWN extra network
 * round-trip (resolveGooglePhotoUrl follows a redirect to
 * googleusercontent.com) on top of this Place Details call. Several callers
 * in the itinerary-generation path (stop verification, must-see resolution,
 * opening-hours backfill, same-category substitution) only ever read
 * address/hours/lat/lng from this result and discard imageUrl — for those,
 * paying for a photo fetch on every single call was pure latency with no
 * effect on the response. `hasPhoto` is always populated for free from the
 * same Details response (no extra request) so a caller that only needs to
 * know whether a photo exists (not the resolved URL) never needs
 * `includePhoto: true` either.
 */
export async function fetchCuratedPlaceDetails(
  placeId: string,
  language?: string,
  opts?: { includePhoto?: boolean },
): Promise<{ address?: string; hours?: string; phone?: string; imageUrl?: string; hasPhoto?: boolean; lat?: number; lng?: number }> {
  if (!GOOGLE_PLACES_KEY) return {};
  const includePhoto = opts?.includePhoto ?? true;
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", placeId);
    url.searchParams.set("fields", "formatted_address,opening_hours,formatted_phone_number,photos,geometry");
    url.searchParams.set("language", mapToGoogleLanguage(language));
    url.searchParams.set("key", GOOGLE_PLACES_KEY);
    const res = await fetch(url.toString());
    const data = (await res.json()) as any;
    if (data.status !== "OK") return {};
    const result = data.result;
    const bestPhotoRef = pickBestGooglePhoto(result?.photos);
    let imageUrl: string | undefined;
    if (bestPhotoRef && includePhoto) {
      imageUrl = await resolveGooglePhotoUrl(bestPhotoRef);
    }
    return {
      address: result?.formatted_address,
      hours: result?.opening_hours?.weekday_text?.join("\n"),
      phone: result?.formatted_phone_number,
      imageUrl,
      hasPhoto: !!bestPhotoRef,
      lat: result?.geometry?.location?.lat,
      lng: result?.geometry?.location?.lng,
    };
  } catch (err) {
    console.error(`[google-places] place details fetch failed for place_id=${placeId}:`, err);
    return {};
  }
}

/**
 * Resolve a destination/place name (optionally scoped by country) to its
 * Google Places place_id via Text Search — used to match a destination
 * against curatedDestinations.googlePlaceId when name matching fails.
 */
export async function resolvePlaceIdViaTextSearch(query: string, language?: string): Promise<string | null> {
  if (!GOOGLE_PLACES_KEY) return null;
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", query);
    url.searchParams.set("language", mapToGoogleLanguage(language));
    url.searchParams.set("key", GOOGLE_PLACES_KEY);
    const res = await fetch(url.toString());
    const data = (await res.json()) as any;
    return data?.results?.[0]?.place_id ?? null;
  } catch (err) {
    console.error(`[google-places] text search place_id resolution failed for "${query}":`, err);
    return null;
  }
}
