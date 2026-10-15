/**
 * Thin Google Places wrappers for the curation script. Deliberately
 * separate from server/routers.ts (not shared/modified) — same endpoints
 * and conventions, but scoped to exactly what curation needs: resolving a
 * destination's center/place_id, and verifying an AI-proposed place against
 * a real Google match using the minimal field mask.
 */

import { withRetry, isRetryableGoogleError, GoogleApiStatusError } from "./retry";

const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

const GOOGLE_RETRY_OPTIONS = { maxAttempts: 4, baseDelayMs: 500, isRetryable: isRetryableGoogleError };

/** Fetches a Google Places JSON endpoint with retry on OVER_QUERY_LIMIT/UNKNOWN_ERROR/network errors. */
async function fetchGoogleJson(url: string): Promise<any> {
  return withRetry(async () => {
    const res = await fetch(url);
    const data = (await res.json()) as any;
    const nonRetryablePassthrough = new Set(["OK", "ZERO_RESULTS", "NOT_FOUND", "INVALID_REQUEST"]);
    if (data.status && !nonRetryablePassthrough.has(data.status)) {
      throw new GoogleApiStatusError(data.status);
    }
    return data;
  }, GOOGLE_RETRY_OPTIONS);
}

export class GoogleCallBudget {
  private calls = 0;
  constructor(private readonly max: number) {}

  get count() {
    return this.calls;
  }

  /** Increments and throws once `max` is exceeded, so a run aborts instead of silently overspending. */
  consume(n = 1) {
    this.calls += n;
    if (this.calls > this.max) {
      throw new Error(`Google Places call budget exceeded (${this.calls} > ${this.max}). Aborting.`);
    }
  }
}

export interface CityCenter {
  lat: number;
  lng: number;
  placeId?: string;
}

/** Resolves a destination name to its center point and the city's own place_id via Text Search. */
export async function resolveCityCenter(
  destinationName: string,
  country: string,
  budget: GoogleCallBudget,
): Promise<CityCenter | null> {
  if (!GOOGLE_PLACES_KEY) throw new Error("GOOGLE_PLACES_API_KEY is not configured");
  budget.consume();
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", `${destinationName}, ${country}`);
  url.searchParams.set("key", GOOGLE_PLACES_KEY);
  const data = await fetchGoogleJson(url.toString());
  const top = data?.results?.[0];
  const loc = top?.geometry?.location;
  if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") return null;
  return { lat: loc.lat, lng: loc.lng, placeId: top?.place_id };
}

export interface GoogleMatch {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  businessStatus?: string;
}

/**
 * Finds a Google Places match for an AI-proposed place by name, biased
 * toward the destination center, using the minimal field mask needed for
 * verification (place_id, name, geometry, business_status — nothing else is
 * requested or stored).
 */
export async function findPlaceMatch(
  name: string,
  neighborhood: string | undefined,
  destinationName: string,
  center: { lat: number; lng: number },
  budget: GoogleCallBudget,
): Promise<GoogleMatch | null> {
  if (!GOOGLE_PLACES_KEY) throw new Error("GOOGLE_PLACES_API_KEY is not configured");
  budget.consume();
  const input = [name, neighborhood, destinationName].filter(Boolean).join(", ");
  const url = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
  url.searchParams.set("input", input);
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set("fields", "place_id,name,geometry,business_status");
  url.searchParams.set("locationbias", `point:${center.lat},${center.lng}`);
  url.searchParams.set("key", GOOGLE_PLACES_KEY);
  const data = await fetchGoogleJson(url.toString());
  const match = data?.candidates?.[0];
  const loc = match?.geometry?.location;
  if (!match?.place_id || typeof loc?.lat !== "number" || typeof loc?.lng !== "number") return null;
  return {
    placeId: match.place_id,
    name: match.name,
    lat: loc.lat,
    lng: loc.lng,
    businessStatus: match.business_status,
  };
}

export type PlaceDetailsStatus = "ok" | "closed" | "not_found";

/** Re-checks a single place_id's status for curate:verify — no AI cost, minimal field mask. */
export async function checkPlaceStatus(placeId: string, budget: GoogleCallBudget): Promise<PlaceDetailsStatus> {
  if (!GOOGLE_PLACES_KEY) throw new Error("GOOGLE_PLACES_API_KEY is not configured");
  budget.consume();
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "business_status");
  url.searchParams.set("key", GOOGLE_PLACES_KEY);
  const data = await fetchGoogleJson(url.toString());
  if (data.status === "NOT_FOUND" || data.status === "INVALID_REQUEST") return "not_found";
  if (data.status !== "OK") return "not_found";
  const status = data.result?.business_status;
  if (status === "CLOSED_PERMANENTLY") return "closed";
  return "ok";
}
