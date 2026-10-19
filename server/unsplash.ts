/**
 * Unsplash cover-image search — split out of server/routers.ts so the query-
 * construction and result-selection logic (pure, no network) can be unit
 * tested directly, without mocking `fetch` for every assertion.
 *
 * Reuses the existing `UNSPLASH_ACCESS_KEY` env var and the existing
 * Unsplash integration — no new provider, no new credentials.
 */

export const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || "";

// Terms expected in the caption of a photo that actually depicts a place/city,
// used to filter out unrelated results (e.g. animals, objects) that happen to
// rank well for a loosely-matched destination name.
export const UNSPLASH_PLACE_RELEVANCE_TERMS = [
  "city", "cityscape", "skyline", "building", "buildings", "architecture",
  "street", "town", "aerial", "downtown", "plaza", "square", "church",
  "cathedral", "bridge", "landmark", "urban", "view", "sunset", "sunrise",
];

/**
 * Standardized Unsplash query: "<local city name> - <local country name>"
 * (e.g. "London - United Kingdom", "München - Deutschland"). The caller is
 * responsible for passing the destination's own LOCAL-language name/country
 * (see resolveLocalLanguageForCountry in server/google-places.ts) — never
 * the app's current UI-display language — so the exact same real city
 * always produces the exact same query regardless of which language the
 * user searched in.
 */
export function buildUnsplashQuery(localCityName: string, localCountryName: string | undefined): string {
  return localCountryName ? `${localCityName} - ${localCountryName}` : localCityName;
}

export interface UnsplashSearchResult {
  alt_description?: string | null;
  description?: string | null;
  urls?: { regular?: string };
}

/** A photo is only usable as a cover if Unsplash actually returned a renderable image URL for it. */
export function isUsableUnsplashResult(r: UnsplashSearchResult | undefined): boolean {
  return typeof r?.urls?.regular === "string" && r.urls.regular.length > 0;
}

/**
 * Deterministically picks a cover photo from Unsplash's (already
 * relevance-ranked) search results: filters out anything whose caption has
 * no place-related term, then prefers the first relevant+usable result,
 * falling back to the second only when the first isn't usable. No
 * randomness — the same input results always produce the same pick.
 * Pure — no network, safe to unit test directly against fixture JSON.
 */
export function pickUsableUnsplashResult(
  results: UnsplashSearchResult[],
  debugSteps: string[] = [],
): string | undefined {
  const relevant = results.filter((r) => {
    const caption = (r?.alt_description || r?.description || "").toLowerCase();
    const isRelevant = UNSPLASH_PLACE_RELEVANCE_TERMS.some((term) => caption.includes(term));
    if (!isRelevant) {
      debugSteps.push(`unsplash: discarded result "${caption || "(no caption)"}" (failed relevance filter)`);
    }
    return isRelevant;
  });
  if (relevant.length === 0) return undefined;

  const first = relevant[0];
  if (isUsableUnsplashResult(first)) return first.urls!.regular;
  debugSteps.push("unsplash: first relevant result wasn't usable, trying the second");

  const second = relevant[1];
  if (second && isUsableUnsplashResult(second)) return second.urls!.regular;

  return undefined;
}

/**
 * Fetches a cover photo from Unsplash's search API for a destination.
 * Requests the top 4 results (already ranked by Unsplash's own relevance)
 * and delegates selection to pickUsableUnsplashResult.
 */
export async function fetchUnsplashPhoto(
  localCityName: string,
  localCountryName: string | undefined,
  debugSteps: string[],
): Promise<string | undefined> {
  if (!UNSPLASH_ACCESS_KEY || !localCityName) return undefined;
  try {
    const query = buildUnsplashQuery(localCityName, localCountryName);
    const url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", "4");
    url.searchParams.set("orientation", "landscape");
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
    });
    const data = (await res.json()) as any;
    const results: UnsplashSearchResult[] = data?.results || [];
    if (results.length === 0) return undefined;
    const picked = pickUsableUnsplashResult(results, debugSteps);
    if (!picked) debugSteps.push("unsplash: no usable result among the relevant candidates");
    return picked;
  } catch (unsplashErr) {
    console.error(`[unsplash] photo search failed for "${localCityName}":`, unsplashErr);
    return undefined;
  }
}
