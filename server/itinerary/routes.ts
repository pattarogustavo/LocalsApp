/**
 * Google Routes API integration — replaces the legacy Google Directions API
 * as the primary source of travel time/distance between itinerary stops
 * (`ctx.fetchTravel` in server/itinerary/validate.ts). See the migration
 * report (coordinating session hand-back) for the official doc sources
 * consulted for endpoint paths, auth header, field-mask syntax, and
 * per-mode limits.
 *
 * Key facts this module relies on (verified against current Google docs,
 * not assumed):
 * - Auth is an API key in the `X-Goog-Api-Key` HEADER — not a `key` query
 *   param (that's the legacy Directions convention).
 * - Both `computeRoutes` and `computeRouteMatrix` REQUIRE a response field
 *   mask (`X-Goog-FieldMask` header) — there is no default field set, and
 *   omitting it is a request error.
 * - `computeRouteMatrix`'s REST response is a JSON ARRAY of per-pair
 *   elements (not one object wrapping a `routes`/`matrix` array like
 *   `computeRoutes`), and Google's own docs warn to always include `status`
 *   in the field mask — otherwise every element looks like status OK by
 *   omission.
 * - `travelMode: TRANSIT` on `computeRouteMatrix` is capped at 100
 *   origin×destination pairs (vs. 625 for other modes) — this module
 *   enforces that bound itself rather than letting Google's API reject an
 *   oversized request after the fact.
 * - `routingPreference` (e.g. `TRAFFIC_AWARE`) is only valid for
 *   `DRIVE`/`TWO_WHEELER` — never sent for other modes.
 *
 * Reuses the SAME Google Cloud project/key as the legacy Directions
 * integration (`GOOGLE_DIRECTIONS_API_KEY`, falling back to
 * `GOOGLE_PLACES_API_KEY` if unset) — Routes API generally works on an
 * existing Places/Directions key on the same GCP project, but the Routes
 * API must be separately ENABLED on that project's API library; this code
 * cannot do that enablement itself (see the migration report for what the
 * user still needs to do in the Google Cloud Console).
 */

export type RoutesTravelMode = "DRIVE" | "WALK" | "BICYCLE" | "TWO_WHEELER" | "TRANSIT";

const GOOGLE_ROUTES_KEY = process.env.GOOGLE_DIRECTIONS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "";

const COMPUTE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const COMPUTE_ROUTE_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

/** Per-mode max origin×destination pairs computeRouteMatrix accepts in one request (Google's documented limits). */
const MAX_MATRIX_ELEMENTS: Record<RoutesTravelMode, number> = {
  TRANSIT: 100,
  DRIVE: 625,
  WALK: 625,
  BICYCLE: 625,
  TWO_WHEELER: 625,
};

const REQUEST_TIMEOUT_MS = 8000;

export interface LatLng {
  lat: number;
  lng: number;
}

export class RoutesApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "RoutesApiError";
    this.status = status;
  }
}

/** Parses a protobuf-style Duration string (e.g. "734s") into whole seconds. Returns 0 for anything unparsable — never guesses. */
export function parseDurationSeconds(duration: string | undefined | null): number {
  if (!duration) return 0;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration);
  return match ? Math.round(parseFloat(match[1])) : 0;
}

/** Formats a duration in seconds as "Xh Ymin" / "Ymin", matching the text format validate.ts's parseTravelMinutes already parses. */
export function formatDurationText(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  return `${m}min`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableRoutesError(err: unknown): boolean {
  if (err instanceof RoutesApiError) return err.status === 429 || (err.status != null && err.status >= 500);
  if (err instanceof Error) return err.name === "AbortError" || /network|fetch failed|ECONNRESET|ETIMEDOUT/i.test(err.message);
  return false;
}

/** Exactly one retry on a transient error (timeout/429/5xx) — never an unbounded loop. */
async function withBoundedRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRetryableRoutesError(err)) throw err;
    return await fn();
  }
}

export interface ComputeRouteResult {
  durationSeconds: number;
  distanceMeters: number;
}

/**
 * Single origin→destination route via `computeRoutes`. Returns `null` (never
 * throws) when the key is missing or the call ultimately fails after one
 * bounded retry — callers are expected to fall back gracefully (see
 * `buildTravelFetcher` below), never to treat null as "zero distance".
 */
export async function computeRoute(
  origin: LatLng,
  destination: LatLng,
  mode: RoutesTravelMode,
  opts: { languageCode?: string } = {},
): Promise<ComputeRouteResult | null> {
  if (!GOOGLE_ROUTES_KEY) return null;

  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: mode,
    languageCode: opts.languageCode,
  };
  if (mode === "DRIVE" || mode === "TWO_WHEELER") body.routingPreference = "TRAFFIC_AWARE";

  try {
    return await withBoundedRetry(async () => {
      const res = await fetchWithTimeout(COMPUTE_ROUTES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_ROUTES_KEY,
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new RoutesApiError(`computeRoutes failed (${res.status}): ${text.slice(0, 300)}`, res.status);
      }
      const json = (await res.json()) as { routes?: Array<{ duration?: string; distanceMeters?: number }> };
      const route = json.routes?.[0];
      if (!route) return null;
      return { durationSeconds: parseDurationSeconds(route.duration), distanceMeters: route.distanceMeters ?? 0 };
    });
  } catch (err) {
    console.error(`[routes-api] computeRoutes failed for travelMode=${mode}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export interface RouteMatrixElement {
  originIndex: number;
  destinationIndex: number;
  durationSeconds: number;
  distanceMeters: number;
  status: "OK" | "ERROR";
}

/**
 * Batch distance/time between multiple origins and destinations via
 * `computeRouteMatrix` — used for day-level clustering/feasibility checks
 * where checking every candidate pair individually would mean one HTTP
 * request per pair. Enforces the per-mode pair-count cap itself (throws a
 * `RoutesApiError` before making the request if exceeded) rather than
 * silently truncating the request or letting Google reject it.
 */
export async function computeRouteMatrix(
  origins: LatLng[],
  destinations: LatLng[],
  mode: RoutesTravelMode,
  opts: { languageCode?: string } = {},
): Promise<RouteMatrixElement[]> {
  if (!GOOGLE_ROUTES_KEY) return [];
  if (origins.length === 0 || destinations.length === 0) return [];

  const maxElements = MAX_MATRIX_ELEMENTS[mode];
  const requested = origins.length * destinations.length;
  if (requested > maxElements) {
    throw new RoutesApiError(
      `computeRouteMatrix request exceeds the ${maxElements}-element limit for travelMode=${mode} (requested ${origins.length}x${destinations.length}=${requested}) — select a smaller candidate pool first`,
    );
  }

  const body: Record<string, unknown> = {
    origins: origins.map((o) => ({ waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } } })),
    destinations: destinations.map((d) => ({ waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } } })),
    travelMode: mode,
    languageCode: opts.languageCode,
  };
  if (mode === "DRIVE" || mode === "TWO_WHEELER") body.routingPreference = "TRAFFIC_AWARE";

  try {
    return await withBoundedRetry(async () => {
      const res = await fetchWithTimeout(COMPUTE_ROUTE_MATRIX_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_ROUTES_KEY,
          // `status` MUST be in the mask — Google's docs warn every element
          // otherwise looks like status OK purely by field-mask omission.
          "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,status,condition",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new RoutesApiError(`computeRouteMatrix failed (${res.status}): ${text.slice(0, 300)}`, res.status);
      }
      // computeRouteMatrix streams back a JSON ARRAY of per-pair elements —
      // unlike computeRoutes, there's no wrapping `{ matrix: [...] }` object.
      const json = (await res.json()) as unknown;
      const elements = Array.isArray(json) ? json : [];
      return elements.map((el: any) => {
        const hasError = el?.status && typeof el.status === "object" && el.status.code != null && el.status.code !== 0;
        return {
          originIndex: el?.originIndex ?? 0,
          destinationIndex: el?.destinationIndex ?? 0,
          durationSeconds: hasError ? 0 : parseDurationSeconds(el?.duration),
          distanceMeters: hasError ? 0 : (el?.distanceMeters ?? 0),
          status: hasError ? ("ERROR" as const) : ("OK" as const),
        };
      });
    });
  } catch (err) {
    console.error(`[routes-api] computeRouteMatrix failed for travelMode=${mode}:`, err instanceof Error ? err.message : err);
    return [];
  }
}

// ─── Itinerary-facing travel fetcher (replaces the legacy Directions-backed one) ──

export type ItineraryTransportMode = "walking" | "driving" | "transit";

/** Mirrors the client's own cityTransportMode → travel-mode mapping (itinerary-block.tsx toDirectionsMode), translated to Routes API mode names. */
function cityTransportModeToRoutesMode(mode?: string): RoutesTravelMode {
  if (mode === "public") return "TRANSIT";
  return "DRIVE";
}

const ROUTES_MODE_TO_ITINERARY_MODE: Record<RoutesTravelMode, ItineraryTransportMode> = {
  DRIVE: "driving",
  WALK: "walking",
  TRANSIT: "transit",
  BICYCLE: "walking", // closest existing app transport-mode icon; app has no dedicated cycling icon today
  TWO_WHEELER: "driving",
};

/**
 * Builds a Google Maps navigation URL via its own, stable URL scheme
 * (`https://www.google.com/maps/dir/?api=1&...`) — deliberately NOT derived
 * from the Routes API response, which has no equivalent user-facing deep
 * link. A computed route and a maps navigation URL are different concerns.
 */
function buildMapsUrl(origin: LatLng, destination: LatLng, mode: ItineraryTransportMode): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=${mode}`;
}

export interface TravelFetchResult {
  durationText: string;
  durationMinutes: number;
  mode: ItineraryTransportMode;
  mapsUrl: string;
}

/**
 * Builds the `fetchTravel` callback server/itinerary/validate.ts uses to
 * replace LLM-guessed travel times with real data. Tries the Google Routes
 * API first; on any failure (key present but Routes API not enabled on the
 * project yet, transient error exhausted its one retry, etc.) falls back to
 * the legacy Directions API so travel times keep working even before the
 * user has enabled Routes API billing/access — see the migration report.
 * Short hops are re-checked against walking, mirroring the prompt's own
 * "prefer walking under ~1km/15min" instruction, but code-enforced.
 */
export function buildTravelFetcher(cityTransportMode: string | undefined, language: string | undefined) {
  const mode = cityTransportModeToRoutesMode(cityTransportMode);

  return async (oLat: number, oLng: number, dLat: number, dLng: number): Promise<TravelFetchResult | null> => {
    const origin: LatLng = { lat: oLat, lng: oLng };
    const destination: LatLng = { lat: dLat, lng: dLng };

    const primary = await computeRouteOrLegacyFallback(origin, destination, mode, language);
    if (!primary) return null;

    if (mode !== "WALK" && primary.distanceMeters > 0 && primary.distanceMeters < 1200) {
      const walking = await computeRouteOrLegacyFallback(origin, destination, "WALK", language);
      if (walking && walking.durationSeconds <= 15 * 60) {
        return {
          durationText: formatDurationText(walking.durationSeconds),
          durationMinutes: Math.round(walking.durationSeconds / 60),
          mode: "walking",
          mapsUrl: buildMapsUrl(origin, destination, "walking"),
        };
      }
    }

    const itineraryMode = ROUTES_MODE_TO_ITINERARY_MODE[mode];
    return {
      durationText: formatDurationText(primary.durationSeconds),
      durationMinutes: Math.round(primary.durationSeconds / 60),
      mode: itineraryMode,
      mapsUrl: buildMapsUrl(origin, destination, itineraryMode),
    };
  };
}

// ─── Legacy Google Directions fallback ──────────────────────────────────────
// Kept ONLY as a fallback for when the Routes API call fails (most likely
// because Routes API hasn't been enabled yet on the reused GCP project —
// see the migration report) — NOT used as the primary path. Isolated here
// rather than deleted, since a repo-wide search found no other caller of
// the legacy Directions integration besides this file's own former home
// (server/routers.ts) and the pre-existing live-credential integration test
// (tests/directions.test.ts, which calls the Directions REST API directly
// and doesn't depend on this module at all).

const GOOGLE_DIRECTIONS_KEY = process.env.GOOGLE_DIRECTIONS_API_KEY || "";

async function fetchLegacyDirections(
  origin: LatLng,
  destination: LatLng,
  mode: "driving" | "walking" | "transit",
  language: string | undefined,
): Promise<ComputeRouteResult | null> {
  if (!GOOGLE_DIRECTIONS_KEY) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
  url.searchParams.set("mode", mode);
  url.searchParams.set("key", GOOGLE_DIRECTIONS_KEY);
  if (language) url.searchParams.set("language", language);
  try {
    const res = await fetchWithTimeout(url.toString(), { method: "GET" });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (json.status !== "OK" || !json.routes?.length) return null;
    const leg = json.routes[0]?.legs?.[0];
    if (!leg) return null;
    return { durationSeconds: leg.duration?.value ?? 0, distanceMeters: leg.distance?.value ?? 0 };
  } catch {
    return null;
  }
}

async function computeRouteOrLegacyFallback(
  origin: LatLng,
  destination: LatLng,
  mode: RoutesTravelMode,
  language: string | undefined,
): Promise<ComputeRouteResult | null> {
  const viaRoutesApi = await computeRoute(origin, destination, mode, { languageCode: language });
  if (viaRoutesApi) return viaRoutesApi;

  const legacyMode = mode === "TRANSIT" ? "transit" : mode === "WALK" ? "walking" : "driving";
  return fetchLegacyDirections(origin, destination, legacyMode, language);
}
