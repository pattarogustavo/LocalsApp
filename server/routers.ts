import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { searchIslands } from "../constants/islands-regions";
import * as db from "./db";
import crypto from "crypto";
import { storagePut } from "./storage";
import { getSupabaseAdmin } from "./_core/supabaseAdmin";
import { prepareCandidatePool } from "./itinerary/candidates";
import { buildDurationGuidancePromptBlock } from "./itinerary/duration";
import { validateAndCorrectItinerary, type MustVisitPlace, type FillerRestaurantCandidate } from "./itinerary/validate";
import { buildItineraryDaysSchema } from "./itinerary/schema";
import { withOneRepairAttempt } from "./itinerary/repair";
import { buildTravelFetcher } from "./itinerary/routes";
import { clusterByDay, buildClusteringPromptBlock } from "./itinerary/clustering";
import { fetchForecastSummary, computeApproxSunTimes } from "./itinerary/weather";
import { addDaysToDateString, normalizeToDateOnlyString } from "./itinerary/dates";
import { sanitizeTripPatch, getSharedTripSaveError, MAX_PATCH_JSON_LENGTH } from "./sharing/trip-merge";
import { sendPush, buildTripInviteMessage } from "./push";
import {
  suggestPlacesCache,
  destinationInfoCache,
  normalizeCacheKeyPart,
  AI_SUGGEST_PLACES_CACHE_TTL_MS,
  AI_DESTINATION_INFO_CACHE_TTL_MS,
} from "./cache";

import { GOOGLE_PLACES_KEY, mapToGoogleLanguage, pickBestGooglePhoto, resolveGooglePhotoUrl, fetchCuratedPlaceDetails, resolveLocalLanguageForCountry } from "./google-places";
import { fetchUnsplashPhoto } from "./unsplash";
import * as catalog from "./catalog";

const AERODATABOX_KEY = process.env.AERODATABOX_RAPIDAPI_KEY || "";
const AERODATABOX_HOST = 'aerodatabox.p.rapidapi.com';
const GOOGLE_DIRECTIONS_KEY = process.env.GOOGLE_DIRECTIONS_API_KEY || "";
const OPENWEATHER_KEY = process.env.OPENWEATHERMAP_API_KEY || "";
/** Kill switch for shared-trip editing (sharing.saveSharedTrip). Enabled unless explicitly set to "false". */
const SHARED_EDITING_ENABLED = process.env.SHARED_EDITING_ENABLED !== "false";
/** Kill switch for the web-search tool in the ai.suggestPlaces fallback flow. Disabled unless explicitly set to "true" (cost control). */
const SUGGEST_FALLBACK_WEB_SEARCH = process.env.SUGGEST_FALLBACK_WEB_SEARCH === "true";

// Human-readable (Portuguese) name for each supported language code, used to
// instruct the LLM which language to write generated text in — since the
// rest of our prompts are written in Portuguese regardless of the user's
// preferred language.
const LANGUAGE_NAMES: Record<string, string> = {
  pt: "português",
  en: "inglês",
  es: "espanhol",
  fr: "francês",
  de: "alemão",
  it: "italiano",
};

function getLanguageName(lang?: string): string {
  const code = lang?.slice(0, 2).toLowerCase();
  return (code && LANGUAGE_NAMES[code]) || "português";
}

/**
 * Constant-time string comparison, so a bad webhook secret guess can't be
 * narrowed down via response-time differences.
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const revenueCatWebhookEventSchema = z.object({
  event: z.object({
    type: z.string(),
    app_user_id: z.string().optional(),
    product_id: z.string().nullable().optional(),
    expiration_at_ms: z.number().nullable().optional(),
    transferred_to: z.array(z.string()).optional(),
    transferred_from: z.array(z.string()).optional(),
  }),
});

/**
 * RevenueCat webhook handler, called from the standalone Express route in
 * server/_core/index.ts — RevenueCat posts plain JSON with no tRPC envelope,
 * so it can't go through a tRPC procedure.
 *
 * Verifies the Authorization header against REVENUECAT_WEBHOOK_SECRET and
 * applies the subscription status update for the event.
 */
export async function processRevenueCatWebhook(
  authorizationHeader: string | undefined,
  rawBody: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const expectedSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expectedSecret || !authorizationHeader || !timingSafeEqualStrings(authorizationHeader, expectedSecret)) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  const parsed = revenueCatWebhookEventSchema.safeParse(rawBody);
  if (!parsed.success) {
    console.error("[RevenueCat webhook] Invalid payload", {
      rawBody,
      issues: parsed.error.issues,
    });
    return { status: 400, body: { error: "Invalid payload" } };
  }

  const { event } = parsed.data;

  // TRANSFER events move an entitlement between app_user_ids, so they carry
  // transferred_to/transferred_from arrays instead of a top-level
  // app_user_id, and often omit product_id/expiration_at_ms entirely — in
  // that case we just flip the destination user to active and leave their
  // existing plan/expiration alone.
  if (event.type === 'TRANSFER') {
    const newAppUserId = event.transferred_to?.[0];
    if (!newAppUserId) return { status: 200, body: { ok: true, reason: "USER_NOT_FOUND" } };
    const user = await db.getUserByOpenId(newAppUserId);
    if (!user) return { status: 200, body: { ok: true, reason: "USER_NOT_FOUND" } };

    const plan = event.product_id?.includes('annual') ? 'annual' as const
      : event.product_id?.includes('monthly') ? 'monthly' as const
      : undefined;
    const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined;

    await db.updateSubscriptionStatus(user.id, {
      subscriptionStatus: 'active',
      subscriptionPlan: plan,
      subscriptionExpiresAt: expiresAt,
      revenuecatUserId: newAppUserId,
    });
    return { status: 200, body: { ok: true } };
  }

  if (!event.app_user_id) return { status: 200, body: { ok: true, reason: "USER_NOT_FOUND" } };
  const user = await db.getUserByOpenId(event.app_user_id);
  if (!user) return { status: 200, body: { ok: true, reason: "USER_NOT_FOUND" } };

  const plan = event.product_id?.includes('annual') ? 'annual' as const
    : event.product_id?.includes('monthly') ? 'monthly' as const
    : null;

  const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;

  switch (event.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
      await db.updateSubscriptionStatus(user.id, {
        subscriptionStatus: 'active',
        subscriptionPlan: plan ?? undefined,
        subscriptionExpiresAt: expiresAt ?? undefined,
        revenuecatUserId: event.app_user_id,
      });
      break;
    case 'CANCELLATION':
      await db.updateSubscriptionStatus(user.id, {
        subscriptionStatus: 'cancelled',
      });
      break;
    case 'EXPIRATION':
      await db.updateSubscriptionStatus(user.id, {
        subscriptionStatus: 'expired',
      });
      break;
    default:
      return { status: 200, body: { ok: true, reason: "EVENT_TYPE_IGNORED" } };
  }
  return { status: 200, body: { ok: true } };
}

/**
 * Guards AI-powered procedures (itinerary generation, place suggestions,
 * destination info) behind an active subscription, checked fresh against the
 * DB (which auto-expires stale statuses) so no OpenAI call is ever made
 * on behalf of a non-subscriber.
 */
async function requireActiveSubscription(userId: number): Promise<void> {
  const status = await db.getSubscriptionStatus(userId);
  if (!status || status.subscriptionStatus !== "active") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Este recurso de IA é exclusivo para assinantes do TheLocals Pro. Assine para continuar.",
    });
  }
}

// ─── Trip content translation helpers ──────────────────────────────────────────

/** Cheap, fast model for simple fidelity translation — not creative generation. */
const TRANSLATION_MODEL = "gpt-5-mini";

/** Runs `fn` over `items` with at most `limit` in flight at once, preserving result order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Translates a single trip's user-facing text (name, Info tab, recommended
 * place descriptions) to `targetLanguage`, in place, and persists it. Place
 * *names* (from Google) are never sent to the model, only descriptive text.
 * A plain, non-creative translation prompt — deliberately not the same
 * "curate/generate" prompts used elsewhere in this file.
 */
async function translateTripContent(
  userId: number,
  clientId: string,
  targetLanguage: string,
): Promise<{ ok: boolean; skipped?: boolean; clientId: string; data?: string }> {
  const row = await db.getTripByClientId(userId, clientId);
  if (!row) return { ok: false, clientId };
  if (row.contentLanguage === targetLanguage) return { ok: true, skipped: true, clientId };

  let trip: any;
  try {
    trip = JSON.parse(row.data);
  } catch {
    return { ok: false, clientId };
  }

  const destinations: any[] = Array.isArray(trip.destinations) ? trip.destinations : [];
  const places: any[] = Array.isArray(trip.places) ? trip.places : [];

  const payload = {
    name: typeof trip.name === "string" ? trip.name : null,
    destinationsInfo: destinations.map((d) => d.aiDestinationInfo ?? null),
    places: places.map((p) => ({
      description: typeof p.description === "string" ? p.description : null,
      curiosities: typeof p.curiosities === "string" ? p.curiosities : null,
    })),
  };

  const hasTranslatableContent =
    Boolean(payload.name) ||
    payload.destinationsInfo.some(Boolean) ||
    payload.places.some((p) => p.description || p.curiosities);

  // Nothing to translate (e.g. brand-new empty trip) — just stamp the language.
  if (!hasTranslatableContent) {
    await db.upsertTrip(userId, clientId, row.data, targetLanguage);
    return { ok: true, clientId, data: row.data };
  }

  const languageName = getLanguageName(targetLanguage);
  const prompt = `Traduza os valores de texto do JSON abaixo para ${languageName}.

Regras:
- Traduza SOMENTE os valores de texto (strings). NUNCA traduza nomes próprios de lugares.
- Preserve exatamente a mesma estrutura, chaves e tipos do JSON, incluindo valores "null" (mantenha "null" como está).
- Não adicione, remova ou explique nada. Responda apenas com o JSON traduzido, no mesmo formato recebido.

JSON:
${JSON.stringify(payload)}`;

  let response;
  try {
    response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Você é um tradutor fiel de texto. Traduza para ${languageName} sem reformular, resumir ou adicionar conteúdo novo. Responda apenas com JSON válido, na mesma estrutura recebida.`,
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      model: TRANSLATION_MODEL,
      max_tokens: 4000,
    });
  } catch (err) {
    console.error(`[trip.translateContent] LLM call failed for trip ${clientId}:`, err);
    return { ok: false, clientId };
  }

  let translated: any;
  try {
    translated = JSON.parse(response.choices[0].message.content as string);
  } catch (err) {
    console.error(
      `[trip.translateContent] Failed to parse translation for trip ${clientId}. Raw content (first 300 chars):`,
      String(response.choices[0].message.content).slice(0, 300),
    );
    return { ok: false, clientId };
  }

  if (typeof translated.name === "string") trip.name = translated.name;

  if (Array.isArray(translated.destinationsInfo)) {
    destinations.forEach((d, i) => {
      if (translated.destinationsInfo[i] != null) d.aiDestinationInfo = translated.destinationsInfo[i];
    });
  }

  if (Array.isArray(translated.places)) {
    places.forEach((p, i) => {
      const t = translated.places[i];
      if (!t) return;
      if (typeof t.description === "string") p.description = t.description;
      if (typeof t.curiosities === "string") p.curiosities = t.curiosities;
    });
  }

  trip.contentLanguage = targetLanguage;
  trip.updatedAt = new Date().toISOString();
  const newData = JSON.stringify(trip);
  await db.upsertTrip(userId, clientId, newData, targetLanguage);

  return { ok: true, clientId, data: newData };
}

// ─── Photo helpers ────────────────────────────────────────────────────────────

/**
 * Fetch a representative photo from Wikipedia for a city/destination.
 * Tries "CityName, Country" first, then just "CityName".
 * Returns a resized thumbnail URL (1200px wide) or undefined.
 */
async function fetchWikipediaPhoto(cityName: string, country?: string): Promise<string | undefined> {
  const queries = [
    country ? `${cityName}, ${country}` : null,
    cityName,
  ].filter(Boolean) as string[];

  for (const q of queries) {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`;
      const r = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "TheLocals/1.0 (travel-app)",
        },
        redirect: "follow",
      });
      if (!r.ok) continue;
      const d = (await r.json()) as any;
      const src: string | undefined = d.originalimage?.source;
      if (src) {
        // Resize to 1200px wide by replacing the size token in the URL
        return src.replace(/\/\d+px-/, "/1200px-");
      }
    } catch {
      // ignore and try next query
    }
  }
  return undefined;
}

/**
 * Resolve a destination name to a center lat/lng via Places Text Search.
 * Used as a fallback when the client doesn't have coordinates cached yet
 * (e.g. a destination added before coordinates were persisted).
 */
async function resolveDestinationCenter(destinationName: string, country?: string, language?: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", country ? `${destinationName}, ${country}` : destinationName);
    url.searchParams.set("language", mapToGoogleLanguage(language));
    url.searchParams.set("key", GOOGLE_PLACES_KEY);
    const res = await fetch(url.toString());
    const data = (await res.json()) as any;
    const loc = data?.results?.[0]?.geometry?.location;
    if (typeof loc?.lat === "number" && typeof loc?.lng === "number") {
      return { lat: loc.lat, lng: loc.lng };
    }
    return null;
  } catch (err) {
    console.error(`[ai.suggestPlaces] failed to resolve center point for "${destinationName}":`, err);
    return null;
  }
}

export interface NearbyCandidate {
  name: string;
  placeId: string;
  rating?: number;
  userRatingsTotal: number;
  types: string[];
  hasPhoto: boolean;
  businessStatus?: string;
  lat?: number;
  lng?: number;
  priceLevel?: number;
  /** Real opening_hours.weekday_text, backfilled by fetchOpeningHoursForTopCandidates. */
  hoursText?: string;
}

/**
 * Nearby Search for a single Google Places `type` around a center point.
 * Returns the raw candidates (name, place_id, rating, review count, types,
 * business status, coordinates) — business_status is part of Nearby Search's
 * default response shape, no extra request param needed.
 */
async function nearbySearchCandidates(lat: number, lng: number, type: string, radius = 5000, language?: string): Promise<NearbyCandidate[]> {
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
    url.searchParams.set("location", `${lat},${lng}`);
    url.searchParams.set("radius", String(radius));
    url.searchParams.set("type", type);
    url.searchParams.set("language", mapToGoogleLanguage(language));
    url.searchParams.set("key", GOOGLE_PLACES_KEY);
    const res = await fetch(url.toString());
    const data = (await res.json()) as any;
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return [];
    return ((data.results || []) as any[])
      .filter((r) => r.place_id && r.name)
      .map((r) => ({
        name: r.name as string,
        placeId: r.place_id as string,
        rating: r.rating,
        userRatingsTotal: r.user_ratings_total || 0,
        types: r.types || [],
        hasPhoto: !!r.photos?.[0],
        businessStatus: r.business_status as string | undefined,
        lat: r.geometry?.location?.lat,
        lng: r.geometry?.location?.lng,
        priceLevel: typeof r.price_level === "number" ? r.price_level : undefined,
      }));
  } catch (err) {
    console.error(`[places] nearby search failed for type="${type}":`, err);
    return [];
  }
}

/**
 * Gather real, currently-open place candidates near a point across the
 * standard category set (attractions/restaurants/cafes/museums), deduped by
 * place_id, ranked by review count, and capped at `limit`. Filters out
 * permanently/temporarily closed places. Shared by every AI flow that needs
 * a grounded pool of real places instead of letting the model invent its own.
 */
async function fetchRealPlaceCandidates(lat: number, lng: number, radius = 8000, limit = 90, language?: string): Promise<NearbyCandidate[]> {
  // Includes 'bar' (the closest Google Places type to "traditional pub" /
  // local drinking-and-eating culture — no dedicated "pub" type exists) and
  // 'park' (previously entirely absent from real candidate discovery, despite
  // scoring.ts's STYLE_TYPE_MAP already expecting it for natureza/relaxamento
  // interest matching). Deliberately generic/reusable — not city-specific.
  // 'art_gallery' and 'shopping_mall' close a confirmed gap: scoring.ts's
  // STYLE_TYPE_MAP expects these types for the "Arte" and "Compras" travel
  // styles, but they were never fetched here — so no amount of interest-based
  // ranking could ever surface a shopping or art-gallery candidate, since
  // they never existed in the candidate pool to begin with.
  const NEARBY_TYPES = ['tourist_attraction', 'restaurant', 'cafe', 'museum', 'bar', 'park', 'art_gallery', 'shopping_mall'];
  const nearbyResults = await Promise.all(
    NEARBY_TYPES.map((type) => nearbySearchCandidates(lat, lng, type, radius, language))
  );
  const byPlaceId = new Map<string, NearbyCandidate>();
  for (const results of nearbyResults) {
    for (const c of results) {
      if (c.businessStatus === 'CLOSED_PERMANENTLY' || c.businessStatus === 'CLOSED_TEMPORARILY') continue;
      if (!byPlaceId.has(c.placeId)) byPlaceId.set(c.placeId, c);
    }
  }
  return Array.from(byPlaceId.values())
    .sort((a, b) => b.userRatingsTotal - a.userRatingsTotal)
    .slice(0, limit);
}

/**
 * Same as `fetchRealPlaceCandidates`, but for a trip spanning multiple
 * destinations at once: resolves each destination's center (from its own
 * lat/lng, falling back to a text-search lookup), fetches real candidates
 * around each, and merges them into one deduped pool tagged with the
 * destination they belong to.
 */
async function fetchRealCandidatesForDestinations(
  destinations: { name: string; country?: string; lat?: number; lng?: number }[],
  language?: string
): Promise<(NearbyCandidate & { destinationName: string })[]> {
  if (!GOOGLE_PLACES_KEY) return [];

  const byPlaceId = new Map<string, NearbyCandidate & { destinationName: string }>();
  await Promise.all(
    destinations.map(async (d) => {
      const center = (d.lat != null && d.lng != null)
        ? { lat: d.lat, lng: d.lng }
        : await resolveDestinationCenter(d.name, d.country, language);
      if (!center) return;
      const found = await fetchRealPlaceCandidates(center.lat, center.lng, undefined, undefined, language);
      for (const c of found) {
        if (!byPlaceId.has(c.placeId)) byPlaceId.set(c.placeId, { ...c, destinationName: d.name });
      }
    })
  );
  return Array.from(byPlaceId.values());
}

/**
 * Backfills real opening_hours (weekday_text) onto the top-ranked candidates
 * only (capped at `limit`) — one Place Details call per candidate is too
 * costly/slow to run for the entire raw pool, so this runs *after* ranking,
 * on the shortlist that's actually going to be offered to the LLM. Mutates
 * and returns the same candidate objects.
 */
async function fetchOpeningHoursForTopCandidates<T extends { placeId: string; hoursText?: string }>(
  candidates: T[],
  limit: number,
  language?: string,
): Promise<T[]> {
  if (!GOOGLE_PLACES_KEY) return candidates;
  const top = candidates.slice(0, limit);
  await Promise.all(
    top.map(async (c) => {
      const details = await fetchCuratedPlaceDetails(c.placeId, language);
      if (details.hours) c.hoursText = details.hours;
    })
  );
  return candidates;
}

/**
 * Resolve a place name (optionally biased toward a lat/lng) to a Google Places
 * place_id via Find Place From Text, so a place invented by the LLM (name +
 * coordinates only) can be matched to real Place Details for a photo.
 */
async function resolvePlaceIdByName(name: string, lat?: number, lng?: number, language?: string): Promise<string | undefined> {
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
    url.searchParams.set("input", name);
    url.searchParams.set("inputtype", "textquery");
    url.searchParams.set("fields", "place_id");
    url.searchParams.set("language", mapToGoogleLanguage(language));
    if (lat != null && lng != null) {
      url.searchParams.set("locationbias", `point:${lat},${lng}`);
    }
    url.searchParams.set("key", GOOGLE_PLACES_KEY);
    const res = await fetch(url.toString());
    const data = (await res.json()) as any;
    return data?.candidates?.[0]?.place_id;
  } catch (err) {
    console.error(`[ai.generateFromScratch] findPlaceFromText failed for "${name}":`, err);
    return undefined;
  }
}

// ─── Deterministic fallback for ai.suggestPlaces (item 4b) ───────────────────
// Engaged when the AI curation step fails, times out, returns invalid JSON,
// or the hallucination guard discards every pick — picks straight from the
// real Google candidate pool with no LLM call, so a destination outside the
// curated catalog never ends up with an empty list just because the AI step
// had a bad day.

/** Short, generic description per app category, used only by the deterministic fallback (no AI call). */
const GENERIC_CATEGORY_DESCRIPTIONS: Record<string, Record<string, string>> = {
  attraction: {
    pt: "Ponto turístico bem avaliado por quem visita.", en: "A well-rated spot visitors recommend.",
    es: "Un lugar bien valorado por los visitantes.", fr: "Un lieu bien noté par les visiteurs.",
    de: "Ein von Besuchern gut bewerteter Ort.", it: "Un luogo ben valutato dai visitatori.",
  },
  restaurant: {
    pt: "Restaurante bem avaliado na região.", en: "A well-rated restaurant in the area.",
    es: "Un restaurante bien valorado en la zona.", fr: "Un restaurant bien noté dans le quartier.",
    de: "Ein gut bewertetes Restaurant in der Gegend.", it: "Un ristorante ben valutato nella zona.",
  },
  cafe: {
    pt: "Café bem avaliado por quem passa por ali.", en: "A well-rated cafe nearby.",
    es: "Una cafetería bien valorada por aquí cerca.", fr: "Un café bien noté dans les environs.",
    de: "Ein gut bewertetes Café in der Nähe.", it: "Un caffè ben valutato nelle vicinanze.",
  },
  museum: {
    pt: "Museu bem avaliado por quem visita.", en: "A well-rated museum visitors recommend.",
    es: "Un museo bien valorado por los visitantes.", fr: "Un musée bien noté par les visiteurs.",
    de: "Ein von Besuchern gut bewertetes Museum.", it: "Un museo ben valutato dai visitatori.",
  },
  hidden_gem: {
    pt: "Boa nota, mas ainda pouco conhecido — uma descoberta.", en: "Highly rated but still under the radar — a real find.",
    es: "Muy bien valorado pero poco conocido — un verdadero hallazgo.", fr: "Très bien noté mais encore peu connu — une vraie découverte.",
    de: "Sehr gut bewertet, aber noch wenig bekannt — ein echter Fund.", it: "Molto apprezzato ma ancora poco conosciuto — una vera scoperta.",
  },
  other: {
    pt: "Lugar bem avaliado por quem visita.", en: "A well-rated place visitors recommend.",
    es: "Un lugar bien valorado por los visitantes.", fr: "Un lieu bien noté par les visiteurs.",
    de: "Ein von Besuchern gut bewerteter Ort.", it: "Un luogo ben valutato dai visitatori.",
  },
};

export function genericCategoryDescription(category: string, language?: string): string {
  const lang = language?.slice(0, 2).toLowerCase() || "pt";
  const table = GENERIC_CATEGORY_DESCRIPTIONS[category] || GENERIC_CATEGORY_DESCRIPTIONS.other;
  return table[lang] || table.pt;
}

/** Buckets a real candidate into an app PlaceCategory using only its Google `types` + rating/review signals (no AI). */
export function categorizeCandidate(candidate: NearbyCandidate): string {
  if (candidate.types.includes("museum")) return "museum";
  if (candidate.types.includes("cafe")) return "cafe";
  if (candidate.types.includes("restaurant")) return "restaurant";
  // "hidden gem": well-rated but comparatively few reviews — "discovered by few".
  if ((candidate.rating ?? 0) >= 4.4 && candidate.userRatingsTotal > 0 && candidate.userRatingsTotal < 150) return "hidden_gem";
  return "attraction";
}

/**
 * Picks up to `limit` real candidates with no AI call: ranked by
 * rating × log10(reviews) (a simple, deterministic quality proxy), then
 * diversified round-robin across categories so the result isn't all
 * restaurants or all attractions.
 */
export function buildDeterministicFallbackPlaces(
  candidates: NearbyCandidate[],
  excludeNamesLower: Set<string>,
  language: string | undefined,
  limit = 15,
): { placeId: string; category: string; description: string }[] {
  const scored = candidates
    .filter((c) => !excludeNamesLower.has(c.name.toLowerCase()))
    .map((c) => ({ candidate: c, category: categorizeCandidate(c), score: (c.rating ?? 3.5) * Math.log10(c.userRatingsTotal + 1) }))
    .sort((a, b) => b.score - a.score);

  const byCategory = new Map<string, typeof scored>();
  for (const entry of scored) {
    const arr = byCategory.get(entry.category) ?? [];
    arr.push(entry);
    byCategory.set(entry.category, arr);
  }

  const picked: typeof scored = [];
  let exhausted = false;
  while (picked.length < limit && !exhausted) {
    exhausted = true;
    for (const arr of byCategory.values()) {
      if (arr.length === 0) continue;
      picked.push(arr.shift()!);
      exhausted = false;
      if (picked.length >= limit) break;
    }
  }

  return picked.map(({ candidate, category }) => ({
    placeId: candidate.placeId,
    category,
    description: genericCategoryDescription(category, language),
  }));
}

// ─── Google Directions helper ─────────────────────────────────────────────────

type TravelMode = 'driving' | 'walking' | 'transit' | 'bicycling';

async function fetchDirections(
  origin: string,
  destination: string,
  mode: TravelMode = 'driving',
  language?: string,
) {
  if (!GOOGLE_DIRECTIONS_KEY) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', destination);
  url.searchParams.set('mode', mode);
  url.searchParams.set('key', GOOGLE_DIRECTIONS_KEY);
  url.searchParams.set('language', mapToGoogleLanguage(language));
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (json.status !== 'OK' || !json.routes?.length) return null;
    const leg = json.routes[0]?.legs?.[0];
    if (!leg) return null;
    return {
      durationText: leg.duration?.text as string || '',
      durationSeconds: leg.duration?.value as number || 0,
      distanceText: leg.distance?.text as string || '',
      distanceMeters: leg.distance?.value as number || 0,
      mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${mode}`,
    };
  } catch {
    return null;
  }
}

/** Mirrors the client's own cityTransportMode → Directions mode mapping (itinerary-block.tsx toDirectionsMode). */
function cityTransportModeToDirectionsMode(mode?: string): TravelMode {
  if (mode === 'public') return 'transit';
  return 'driving';
}

// NOTE: itinerary generation's travel-time fetcher (previously defined here
// as `buildTravelFetcher`, backed by this same legacy Directions API) has
// been migrated to the Google Routes API — see
// server/itinerary/routes.ts's `buildTravelFetcher` export, imported below.
// `fetchDirections`/`cityTransportModeToDirectionsMode` above are KEPT here
// because the separate `directions.route`/`directions.batchRoute` tRPC
// procedures (below) and the general-purpose "Atualizar rotas" / transport
// screens (components/trip/itinerary-block.tsx, components/trip/transport-block.tsx)
// still call them directly — a repo-wide search found those real,
// independent call sites, so this isn't dead code and migrating THEM to
// Routes API is out of scope for this itinerary-engine pass (see the
// migration report for why).

/**
 * Resolves a free-text "must-see" hint (e.g. "Louvre Museum") to a real
 * Google Place via Find Place From Text + Place Details, so it can be
 * promoted to a HARD must-visit constraint (same treatment as an explicitly
 * selected place) instead of the old "try to include, not mandatory" text
 * instruction. Returns null — never a guess — if it can't be resolved, in
 * which case the caller falls back to the softer, purely textual prompt hint.
 */
async function resolveMustSeePlace(
  text: string | undefined,
  biasLat: number | undefined,
  biasLng: number | undefined,
  language: string | undefined,
): Promise<MustVisitPlace | null> {
  if (!text || !GOOGLE_PLACES_KEY) return null;
  const trimmed = text.trim();
  // Only attempt resolution for something that reads like a single specific
  // place name, not a longer free-text wishlist/sentence.
  if (trimmed.length < 3 || trimmed.length > 80 || /[,.;\n]/.test(trimmed)) return null;
  const placeId = await resolvePlaceIdByName(trimmed, biasLat, biasLng, language);
  if (!placeId) return null;
  const details = await fetchCuratedPlaceDetails(placeId, language);
  if (details.lat == null || details.lng == null) return null;
  return {
    name: trimmed,
    googlePlaceId: placeId,
    category: "attraction",
    address: details.address,
    lat: details.lat,
    lng: details.lng,
    hours: details.hours,
  };
}

/**
 * Runs deterministic geographic clustering (server/itinerary/clustering.ts)
 * independently per destination (so a multi-destination trip never mixes
 * zones across cities), offsetting each destination's cluster day-index by
 * the trip's running day count so "Dia N" in the resulting prompt block
 * matches the global day numbering the rest of the prompt uses. Only
 * candidates with real lat/lng participate — everything else (including
 * selected/must-visit places, which are handled by their own hard-inclusion
 * logic in validate.ts) is left for the model to place using the rest of
 * the prompt's rules.
 */
function buildClusteringBlockForDestinations(
  destinations: { name: string; country?: string; days: number; lat?: number; lng?: number }[],
  candidates: { placeId: string; name: string; destinationName: string; lat?: number; lng?: number }[],
  accommodation: { name?: string; address?: string; lat?: number; lng?: number } | undefined,
): string {
  let dayOffset = 0;
  const blocks: string[] = [];
  for (const d of destinations) {
    const destCandidates = candidates
      .filter((c) => c.destinationName === d.name && c.lat != null && c.lng != null)
      .map((c) => ({ id: c.placeId, name: c.name, lat: c.lat as number, lng: c.lng as number }));
    const anchor =
      accommodation?.lat != null && accommodation?.lng != null
        ? { lat: accommodation.lat, lng: accommodation.lng }
        : d.lat != null && d.lng != null
          ? { lat: d.lat, lng: d.lng }
          : undefined;
    const { clusters } = clusterByDay(destCandidates, Math.max(1, d.days), { anchor });
    const block = buildClusteringPromptBlock(clusters, dayOffset);
    if (block) blocks.push(block);
    dayOffset += d.days;
  }
  return blocks.join("\n");
}

/**
 * Builds the weather/daylight prompt block (spec "Stage 7") per destination,
 * reusing the existing OpenWeatherMap integration (server/itinerary/weather.ts)
 * — real forecast data when the trip date falls within the ~5-day window,
 * explicit "out of range" framing otherwise (never an invented forecast).
 * Sunrise/sunset come from a deterministic solar-position formula, not a
 * new paid API. Requires a usable anchor point (accommodation, or the
 * destination's own lat/lng) — silently contributes nothing for a
 * destination with neither, same graceful-degradation pattern as the
 * clustering block above.
 */
async function buildWeatherBlockForDestinations(
  startDate: string,
  destinations: { name: string; days: number; lat?: number; lng?: number }[],
  accommodation: { lat?: number; lng?: number } | undefined,
): Promise<string> {
  let dayOffset = 0;
  const sections: string[] = [];
  for (const d of destinations) {
    const anchor: { lat: number; lng: number } | undefined =
      accommodation?.lat != null && accommodation?.lng != null
        ? { lat: accommodation.lat, lng: accommodation.lng }
        : d.lat != null && d.lng != null
          ? { lat: d.lat, lng: d.lng }
          : undefined;

    if (anchor) {
      const dates = Array.from({ length: Math.max(1, d.days) }, (_, i) => addDaysToDateString(startDate, dayOffset + i));
      const forecastByDate = await fetchForecastSummary(anchor.lat, anchor.lng, dates);
      const lines = dates.map((date) => {
        const sun = computeApproxSunTimes(anchor.lat, anchor.lng, date);
        const forecast = forecastByDate.get(date);
        const weatherText = forecast
          ? `previsão real — ${forecast.tempMinC}°C a ${forecast.tempMaxC}°C, "${forecast.description}", chance de chuva ${Math.round(forecast.rainProbability * 100)}%`
          : `fora do alcance da previsão (só cobre ~5 dias à frente) — NÃO afirme números específicos de temperatura/chuva para esta data`;
        const sunsetNote = sun.polarExtreme
          ? "latitude/data com luz do dia atípica (verão/inverno polar) — pôr do sol não é um horário único confiável"
          : `pôr do sol ~${sun.sunsetLocal} (hora local aproximada, calculada pela posição solar)`;
        return `- ${date} (${d.name}): ${weatherText}. ${sunsetNote}.`;
      });
      sections.push(lines.join("\n"));
    }
    dayOffset += d.days;
  }

  if (sections.length === 0) return "";
  return `\nClima e luz do dia (use dados reais quando houver; para datas fora do alcance da previsão NÃO invente números — pode mencionar o clima típico da estação de forma genérica, deixando claro que é uma expectativa e não uma garantia; use isso para favorecer atividades internas em dias de chuva prevista e para alinhar passeios que dependam de luz natural, como pôr do sol, ao horário real calculado — mas NUNCA ignore uma prioridade explícita do viajante só por causa do clima):\n${sections.join("\n")}`;
}

/** Builds the "hotel as route anchor" prompt block — only added when accommodation data is provided. */
function buildHotelPromptBlock(accommodation: { name?: string; address?: string; lat?: number; lng?: number } | undefined): string {
  if (!accommodation || (!accommodation.address && (accommodation.lat == null || accommodation.lng == null))) return "";
  const location = accommodation.address || `${accommodation.lat},${accommodation.lng}`;
  return `\n- Hospedagem (âncora do roteiro): ${accommodation.name || "hotel do viajante"} em ${location}. Sempre que possível, a primeira parada do dia deve ser geograficamente próxima à hospedagem (ou o dia deve iniciar considerando o deslocamento a partir dela), e a última parada do dia deve terminar em um ponto razoável para o retorno à hospedagem à noite.`;
}

/** Builds the meal-preferences prompt block from the structured mealPreferences field, falling back to the legacy include-booleans when absent. */
function buildMealPreferencesBlock(
  mealPreferences: { breakfast?: string; lunch?: string; dinner?: string } | undefined,
  legacy: { includeBreakfast?: boolean; includeLunch?: boolean; includeDinner?: boolean },
): string {
  const lines: string[] = [];
  const breakfast = mealPreferences?.breakfast;
  const lunch = mealPreferences?.lunch;
  const dinner = mealPreferences?.dinner;

  if (breakfast === "hotel") lines.push("- Café da manhã: incluído na hospedagem — NÃO crie uma parada externa de café da manhã.");
  else if (breakfast === "outside") lines.push("- Café da manhã: fora da hospedagem — inclua uma parada real de café da manhã.");
  else if (breakfast === "none") lines.push("- Café da manhã: não planejar.");
  else if (legacy.includeBreakfast !== false) lines.push("- Incluir café da manhã.");

  if (lunch === "quick") lines.push("- Almoço: lanche rápido (20-45 min), não uma refeição longa em restaurante.");
  else if (lunch === "restaurant") lines.push("- Almoço: refeição completa em restaurante (60-120 min).");
  else if (lunch === "none") lines.push("- Almoço: não planejar.");
  else if (legacy.includeLunch !== false) lines.push("- Incluir almoço (refeição completa em restaurante).");

  if (dinner === "quick") lines.push("- Jantar: lanche rápido (20-45 min).");
  else if (dinner === "restaurant") lines.push("- Jantar: refeição completa em restaurante (60-120 min).");
  else if (dinner === "none") lines.push("- Jantar: não planejar.");
  else if (legacy.includeDinner !== false) lines.push("- Incluir jantar (refeição completa em restaurante).");

  return lines.length > 0 ? `\n${lines.join("\n")}` : "";
}

/** Nudges the model to use its native web-search tool to cross-check real candidates against outside opinion, without forcing it to search every single place. */
const WEB_SEARCH_INSTRUCTION = `Você pode pesquisar na web (sites de viagem, guias locais, imprensa, redes sociais, fóruns) pra confirmar ou descobrir quais dos candidatos reais listados são de fato os mais recomendados por moradores e conhecedores do destino — combine isso com seu próprio conhecimento e com os dados de avaliação disponíveis. Use a busca quando agregar valor real à escolha, não é obrigatório pesquisar pra cada lugar individualmente. Sua resposta final deve ser SOMENTE o JSON pedido, sem nenhum texto antes ou depois, mesmo que você tenha pesquisado antes de responder.`;

/** Cheap, fast model for auxiliary passes that aren't the creative itinerary assembly itself. */
const WEB_SEARCH_PRESCREEN_MODEL = "gpt-5-mini";

/**
 * Separate, schema-free web-search pass run BEFORE the main itinerary
 * generation call (generateItinerary/generateFromScratch). Those calls force
 * tool_choice to their output-schema tool (see buildItineraryDaysSchema),
 * which can't coexist with the "auto" tool_choice web search needs to decide
 * for itself whether/when to search (see invokeLLM's `enableWebSearch`) — so
 * this runs its own free-text call first, and its result is folded into the
 * main prompt as extra context. Best-effort: any failure here is swallowed
 * and returns null, never blocking itinerary generation.
 */
async function preScreenRecommendedCandidates(
  destinationSummary: string,
  candidates: { name: string; types: string[]; rating?: number }[],
): Promise<string | null> {
  if (candidates.length === 0) return null;

  const candidatesList = candidates
    .slice(0, 150)
    .map((c) => `- ${c.name} (${c.types[0] || "lugar"}${c.rating ? `, rating ${c.rating}` : ""})`)
    .join("\n");

  const prompt = `Você vai ajudar a decidir quais lugares reais priorizar num roteiro de viagem para ${destinationSummary}.

Candidatos reais disponíveis (já verificados no Google Places):
${candidatesList}

Pesquise na web se necessário, e identifique quais desses candidatos são genuinamente os mais recomendados por moradores/conhecedores do destino — não apenas os mais bem avaliados no Google. Retorne uma lista curta (até 15-20 nomes) dos que você mais recomendaria, com uma frase dizendo por quê.

Responda em texto simples, um lugar por linha, no formato "Nome do lugar — motivo". Sem introdução nem conclusão.`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "Você é um especialista local em viagens. Seja direto e objetivo." },
        { role: "user", content: prompt },
      ],
      enableWebSearch: true,
      model: WEB_SEARCH_PRESCREEN_MODEL,
      max_tokens: 1500,
    });
    const text = String(response.choices[0]?.message.content || "").trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    console.warn("[itinerary] web-search pre-screening failed, proceeding without it:", err);
    return null;
  }
}

/** Explicit hard-vs-soft constraint framing, so the model prioritizes correctly by itself before the deterministic validator double-checks it. */
const HARD_SOFT_FRAMING_BLOCK = `
REGRAS OBRIGATÓRIAS (nunca podem ser quebradas, mesmo que isso signifique um roteiro menos "cheio"):
- Respeitar horário de chegada/saída e os horários de acordar/dormir.
- Respeitar o horário de funcionamento de cada lugar.
- Incluir todo lugar marcado como OBRIGATÓRIO.
- Nunca incluir lugares da lista de exclusão do usuário, mesmo que populares.
- Incluir as refeições solicitadas (não pule almoço ou jantar para "economizar tempo").
- Nunca sobrepor horários nem repetir o mesmo lugar duas vezes.

PREFERÊNCIAS (aplicar com bom senso, mas nunca à custa das regras acima):
- Ritmo de viagem, orçamento, popularidade/avaliação dos lugares, eficiência geográfica, variedade.
- É permitido deixar tempo livre em vez de forçar mais uma parada de baixa relevância só para preencher o dia.`;

// ─── AeroDataBox helpers ─────────────────────────────────────────────────────

function adbHeaders() {
  return {
    'x-rapidapi-key': AERODATABOX_KEY,
    'x-rapidapi-host': AERODATABOX_HOST,
  };
}

function calcDuration(dep: string, arr: string): string {
  const d = new Date(dep);
  const a = new Date(arr);
  if (isNaN(d.getTime()) || isNaN(a.getTime())) return '';
  const mins = Math.round((a.getTime() - d.getTime()) / 60000);
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
}

function mapAdbFlight(f: any, fallbackOrigin = '', fallbackDest = '') {
  const dep = f.departure || {};
  const arr = f.arrival || {};
  const flightNum = f.number || f.iataNumber || '';
  const airline = f.airline?.name || '';
  const depTime = dep.scheduledTime?.utc || dep.scheduledTime?.local || '';
  const arrTime = arr.scheduledTime?.utc || arr.scheduledTime?.local || '';
  const depActual = dep.actualTime?.utc || dep.actualTime?.local || '';
  const arrActual = arr.actualTime?.utc || arr.actualTime?.local || '';
  return {
    flightNumber: flightNum,
    airline,
    origin: dep.airport?.iata || fallbackOrigin,
    originCity: dep.airport?.municipalityName || dep.airport?.name || '',
    destination: arr.airport?.iata || fallbackDest,
    destinationCity: arr.airport?.municipalityName || arr.airport?.name || '',
    departureTime: depTime,
    arrivalTime: arrTime,
    departureActual: depActual,
    arrivalActual: arrActual,
    terminal: dep.terminal || '',
    gate: dep.gate || '',
    status: (f.status || 'scheduled').toLowerCase(),
    duration: calcDuration(depTime, arrTime),
  };
}

async function fetchFlightData(flightNumber: string, date: string) {
  if (!AERODATABOX_KEY) return null;
  const fn = flightNumber.replace(/\s+/g, '').toUpperCase();
  const url = `https://${AERODATABOX_HOST}/flights/number/${fn}/${date}`;
  try {
    const res = await fetch(url, { headers: adbHeaders() });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const flight = Array.isArray(json) ? json[0] : json;
    if (!flight) return null;
    return mapAdbFlight(flight);
  } catch {
    return null;
  }
}

export const appRouter = router({
  system: systemRouter,

  // ─── User Profile ─────────────────────────────────────────────────────────
  user: router({
    /**
     * Returns the authenticated user's profile straight from the DB —
     * used right after login to overwrite whatever stale subscription
     * data was sitting in the local cache from a previous session.
     */
    me: protectedProcedure.query(async ({ ctx }) => {
      const status = await db.getSubscriptionStatus(ctx.user.id);
      return {
        name: ctx.user.name ?? null,
        bio: ctx.user.bio ?? null,
        subscriptionStatus: status?.subscriptionStatus ?? null,
        subscriptionPlan: status?.subscriptionPlan ?? null,
        subscriptionExpiresAt: status?.subscriptionExpiresAt ?? null,
      };
    }),

    /**
     * Update the authenticated user's profile (name and/or bio).
     * Looks up the row by openId, same auth pattern used by sdk.authenticateRequest.
     */
    updateProfile: protectedProcedure
      .input(z.object({
        name: z.string().max(200).optional(),
        bio: z.string().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.updateUserProfile(ctx.user.openId, input);
        return { success: true };
      }),

    /**
     * Permanently deletes the authenticated user's account and all associated
     * data, including the Supabase Auth identity (Apple Guideline 5.1.1v).
     */
    deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
      await db.deleteUserData(ctx.user.id);
      const { error } = await getSupabaseAdmin().auth.admin.deleteUser(ctx.user.openId);
      if (error) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }
      return { success: true };
    }),
  }),

  // ─── Push Notifications (Expo) ────────────────────────────────────────────
  push: router({
    /**
     * Registers (or re-registers) this device's Expo push token. Tokens are
     * device-scoped, not account-scoped — upserting by token reassigns it
     * to the current user if it was previously registered under a
     * different account on the same device.
     */
    register: protectedProcedure
      .input(z.object({
        token: z.string().min(1),
        platform: z.string().min(1),
        language: z.string().min(1).max(8),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.upsertPushToken({
          userId: ctx.user.id,
          token: input.token,
          platform: input.platform,
          language: input.language,
        });
        return { ok: true };
      }),

    /** Removes this device's token — called on logout so it stops receiving push for this account. */
    unregister: protectedProcedure
      .input(z.object({ token: z.string().min(1) }))
      .mutation(async ({ input }) => {
        await db.deletePushToken(input.token);
        return { ok: true };
      }),
  }),

  // ─── Destination Info (AI) ───────────────────────────────────────────────
  destinationInfo: router({
    /**
     * Generate per-destination travel info using LLM:
     * climate, crowd level, population, health/vaccine requirements, visa info.
     */
    generate: protectedProcedure
      .input(z.object({
        destination: z.string(),
        country: z.string().optional(),
        travelMonth: z.string().optional(), // e.g. "junho"
        originCountry: z.string().optional().default('Brasil'),
        language: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Subscription check always runs before the cache is consulted, so a
        // cache hit can never substitute for AI access on a free account.
        await requireActiveSubscription(ctx.user.id);
        const { destination, country, travelMonth, originCountry } = input;

        // Keyed on every input that can change the LLM's answer (climate/visa
        // text depends on the travel month and the traveler's origin country,
        // not just the destination), so a hit is always a valid substitute
        // for a fresh generation.
        const cacheKey = [
          normalizeCacheKeyPart(destination),
          normalizeCacheKeyPart(country),
          normalizeCacheKeyPart(input.language),
          normalizeCacheKeyPart(travelMonth),
          normalizeCacheKeyPart(originCountry),
        ].join('|');
        const cached = destinationInfoCache.get(cacheKey);
        if (cached) {
          console.log(`[destinationInfo.generate] cache hit: "${destination}"`);
          return { data: cached };
        }
        console.log(`[destinationInfo.generate] cache miss: "${destination}"`);

        const languageName = getLanguageName(input.language);
        const prompt = `Você é um especialista em viagens. Forneça informações práticas e concisas sobre viajar para ${destination}${country ? `, ${country}` : ''}${travelMonth ? ` no mês de ${travelMonth}` : ''} para turistas do ${originCountry}.

Escreva todos os textos (description, recommendation, tip, notes, type, tips) em ${languageName}, não em português, a menos que ${languageName} seja português.

Responda APENAS com JSON válido neste formato exato:
{
  "climate": {
    "avgTempC": 22,
    "description": "Clima ameno, dias ensolarados com noites frescas",
    "recommendation": "Leve um casaco leve para as noites"
  },
  "crowd": {
    "level": "Alto",
    "description": "Alta temporada turística, muitos visitantes",
    "tip": "Reserve atrações com antecedência"
  },
  "population": {
    "count": "3,2 milhões",
    "city": "${destination}"
  },
  "health": {
    "vaccines": ["Febre Amarela (recomendada)", "Hepatite A"],
    "waterSafe": true,
    "notes": "Água da torneira potável. Sem riscos sanitários especiais."
  },
  "visa": {
    "required": false,
    "type": "Isento de visto para turismo até 90 dias",
    "notes": "Passaporte válido por pelo menos 6 meses necessário"
  },
  "tips": ["Dica prática 1", "Dica prática 2"]
}`;

        try {
          const response = await invokeLLM({
            messages: [
              { role: 'system', content: `Você é um especialista em viagens internacionais. Escreva os textos em ${languageName}, não em português, a menos que ${languageName} seja português. Responda sempre em JSON válido.` },
              { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
          });
          const content = response.choices[0].message.content as string;
          const data = JSON.parse(content);
          // Never cache an empty/falsy result — only a real answer is reused.
          if (data) destinationInfoCache.set(cacheKey, data, AI_DESTINATION_INFO_CACHE_TTL_MS);
          return { data };
        } catch {
          return { data: null };
        }
      }),
  }),

  // ─── Airport Search ───────────────────────────────────────────────────────
  airports: router({
    /**
     * Search airports by query string (IATA code, name, city, country).
     * Uses AeroDataBox airport search endpoint.
     */
    search: publicProcedure
      .input(z.object({ query: z.string().min(1) }))
      .query(async ({ input }) => {
        if (!AERODATABOX_KEY) return { airports: [] };
        try {
          const url = `https://${AERODATABOX_HOST}/airports/search/term?q=${encodeURIComponent(input.query)}&limit=7`;
          const res = await fetch(url, {
            headers: {
              'x-rapidapi-key': AERODATABOX_KEY,
              'x-rapidapi-host': AERODATABOX_HOST,
            },
          });
          if (!res.ok) return { airports: [] };
          const json = (await res.json()) as any;
          const items = json.items || [];
          return {
            airports: items.map((a: any) => ({
              iata: a.iata || '',
              name: a.name || '',
              city: a.municipalityName || '',
              country: a.countryCode || '',
              fullName: `${a.municipalityName || a.name} (${a.iata})`,
            })).filter((a: any) => a.iata),
          };
        } catch {
          return { airports: [] };
        }
      }),
  }),

  // ─── Subscription ─────────────────────────────────────────────────────────
  subscription: router({
    /**
     * Get current subscription status for the authenticated user.
     */
    status: protectedProcedure.query(async ({ ctx }) => {
      const status = await db.getSubscriptionStatus(ctx.user.id);
      if (!status) return null;
      return {
        status: status.subscriptionStatus,
        plan: status.subscriptionPlan,
        expiresAt: status.subscriptionExpiresAt,
        hasAccess: status.subscriptionStatus === 'active',
      };
    }),

    /**
     * Writes the subscription status straight to the DB right after a
     * purchase/restore succeeds on-device, instead of waiting on the
     * RevenueCat webhook — some events (e.g. TRANSFER) arrive without a
     * product_id, so relying solely on the webhook can leave the plan
     * incomplete. The webhook keeps running as a redundant safety net.
     */
    syncStatus: protectedProcedure
      .input(z.object({
        status: z.enum(['active', 'expired', 'cancelled']),
        plan: z.enum(['monthly', 'annual']).nullable().optional(),
        expiresAt: z.string().datetime().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.updateSubscriptionStatus(ctx.user.id, {
          subscriptionStatus: input.status,
          subscriptionPlan: input.plan ?? undefined,
          subscriptionExpiresAt: input.expiresAt ? new Date(input.expiresAt) : (input.expiresAt === null ? null : undefined),
        });
        return { success: true };
      }),

    // RevenueCat webhook handling moved to the standalone Express route at
    // POST /api/webhooks/revenuecat (see server/_core/index.ts) — RevenueCat
    // posts plain JSON with no tRPC envelope, which the tRPC procedure format
    // can't accept. See processRevenueCatWebhook above.
  }),

  // ─── AeroDataBox ─────────────────────────────────────────────────────────
  flights: router({
    /**
     * Search flights by origin IATA + destination IATA + date.
     * Uses AeroDataBox airport departures endpoint, filtered by destination.
     * Returns up to 6 matching flights so the user can pick one.
     */
    searchByRoute: publicProcedure
      .input(z.object({
        origin: z.string().min(2).max(10),
        destination: z.string().min(2).max(10),
        date: z.string(), // YYYY-MM-DD
      }))
      .mutation(async ({ input }) => {
        if (!AERODATABOX_KEY) return { flights: [] };
        const orig = input.origin.toUpperCase().trim();
        const dest = input.destination.toUpperCase().trim();
        const date = input.date;

        // Helper: resolve IATA codes from a query (may be IATA code or city name)
        const resolveIatas = async (query: string): Promise<string[]> => {
          // If it looks like a 3-letter IATA code, use directly
          if (/^[A-Z]{3}$/.test(query)) return [query];
          // Otherwise search airports by term and return all matching IATAs
          try {
            const url = `https://${AERODATABOX_HOST}/airports/search/term?q=${encodeURIComponent(query)}&limit=5`;
            const res = await fetch(url, { headers: adbHeaders() });
            if (!res.ok) return [];
            const json = (await res.json()) as any;
            const items: any[] = json.items || [];
            return items.map((a: any) => a.iata).filter(Boolean).map((s: string) => s.toUpperCase());
          } catch { return []; }
        };

        const [origIatas, destIatas] = await Promise.all([resolveIatas(orig), resolveIatas(dest)]);
        if (origIatas.length === 0 || destIatas.length === 0) return { flights: [] };

        // Fetch departures for each origin airport and filter by any destination IATA.
        // AeroDataBox caps each request window at 12h, so the day is split into two windows.
        const destSet = new Set(destIatas);
        const allFlights: any[] = [];
        const windows: Array<[string, string]> = [
          [`${date}T00:00`, `${date}T11:59`],
          [`${date}T12:00`, `${date}T23:59`],
        ];
        const fetchWindow = async (iata: string, from: string, to: string) => {
          const url = `https://${AERODATABOX_HOST}/flights/airports/iata/${iata}/${from}/${to}?direction=Departure&withLeg=true&withCancelled=false&withCodeshared=true&withCargo=false&withPrivate=false&withLocation=false`;
          try {
            const res = await fetch(url, { headers: adbHeaders() });
            if (!res.ok) {
              const errBody = await res.text().catch(() => '');
              console.error(`[flights.searchByRoute] AeroDataBox request failed for iata=${iata}: status=${res.status}`, errBody);
              return;
            }
            const json = (await res.json()) as any;
            const departures: any[] = json?.departures || [];
            const filtered = departures.filter((f: any) =>
              destSet.has((f.arrival?.airport?.iata || '').toUpperCase())
            );
            allFlights.push(...filtered.map((f: any) => mapAdbFlight(f, iata, '')));
          } catch { /* skip */ }
        };
        await Promise.all(
          origIatas.slice(0, 3).flatMap((iata) =>
            windows.map(([from, to]) => fetchWindow(iata, from, to))
          )
        );

        return { flights: allFlights.slice(0, 8) };
      }),
    lookup: publicProcedure
      .input(z.object({ flightNumber: z.string().min(2), date: z.string() }))
      .mutation(async ({ input }) => {
        const data = await fetchFlightData(input.flightNumber, input.date);
        if (!data) return { found: false as const, flight: null };
        return { found: true as const, flight: data };
      }),
    refreshStatus: publicProcedure
      .input(z.object({ flightNumber: z.string(), date: z.string() }))
      .mutation(async ({ input }) => {
        const data = await fetchFlightData(input.flightNumber, input.date);
        if (!data) return { updated: false as const };
        return {
          updated: true as const,
          status: data.status,
          terminal: data.terminal,
          gate: data.gate,
          departureActual: data.departureActual,
          arrivalActual: data.arrivalActual,
        };
      }),
  }),

  // u2500u2500u2500 Google Directions u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500
  directions: router({
    route: publicProcedure
      .input(z.object({
        origin: z.string().min(1),
        destination: z.string().min(1),
        mode: z.enum(["driving", "walking", "transit", "bicycling"]).default("driving"),
        language: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const data = await fetchDirections(input.origin, input.destination, input.mode, input.language);
        if (!data) return { found: false as const };
        return { found: true as const, ...data };
      }),
    batchRoute: publicProcedure
      .input(z.object({
        pairs: z.array(z.object({
          origin: z.string(),
          destination: z.string(),
          mode: z.enum(["driving", "walking", "transit", "bicycling"]).default("driving"),
        })).max(20),
        language: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const results = await Promise.all(
          input.pairs.map(async (p) => {
            const data = await fetchDirections(p.origin, p.destination, p.mode, input.language);
            return data ? { found: true as const, ...data } : { found: false as const };
          })
        );
        return { results };
      }),
  }),

  // ─── Google Places Proxy ───────────────────────────────────────────────────
  places: router({
    /**
     * Autocomplete cities, countries, islands and regions.
     * Uses geocode type to support (cities), countries, islands (e.g. Mallorca, Ibiza, Santorini).
     * Returns structured predictions with placeId, name, country, lat, lng.
     */
    autocomplete: publicProcedure
      .input(z.object({
        query: z.string().min(1),
        types: z.enum(['address', 'establishment', 'cities', 'geocode', 'mixed']).optional(),
        language: z.string().optional(),
      }))
      .query(async ({ input }) => {
        if (!GOOGLE_PLACES_KEY) return { predictions: [] };

        const makeUrl = (types: string) => {
          const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
          url.searchParams.set("input", input.query);
          url.searchParams.set("types", types);
          url.searchParams.set("language", mapToGoogleLanguage(input.language));
          url.searchParams.set("key", GOOGLE_PLACES_KEY!);
          return url.toString();
        };

        // For address/establishment/mixed searches (transport forms), skip island fallback
        if (input.types === 'address' || input.types === 'establishment' || input.types === 'mixed') {
          if (input.types === 'mixed') {
            // Fetch both address and establishment results in parallel and merge
            const [resAddr, resEst] = await Promise.all([
              fetch(makeUrl('address')),
              fetch(makeUrl('establishment')),
            ]);
            const [dataAddr, dataEst] = await Promise.all([
              resAddr.json() as Promise<any>,
              resEst.json() as Promise<any>,
            ]);
            const seen = new Set<string>();
            const merged: any[] = [];
            for (const p of [...(dataEst.predictions || []), ...(dataAddr.predictions || [])]) {
              if (!seen.has(p.place_id)) {
                seen.add(p.place_id);
                merged.push(p);
              }
            }
            const predictions = merged.slice(0, 8).map((p: any) => ({
              placeId: p.place_id,
              name: p.structured_formatting?.main_text || p.description,
              fullDescription: p.description,
              country: p.structured_formatting?.secondary_text || "",
            }));
            return { predictions };
          }
          const googleType = input.types === 'address' ? 'address' : 'establishment';
          const res = await fetch(makeUrl(googleType));
          const data = await res.json() as any;
          const predictions = (data.predictions || []).slice(0, 8).map((p: any) => ({
            placeId: p.place_id,
            name: p.structured_formatting?.main_text || p.description,
            fullDescription: p.description,
            country: p.structured_formatting?.secondary_text || "",
          }));
          return { predictions };
        }

        // Default: city/destination search with island fallback
        const [resCities, resGeocode] = await Promise.all([
          fetch(makeUrl("(cities)")),
          fetch(makeUrl("geocode")),
        ]);
        const [dataCities, dataGeocode] = await Promise.all([
          resCities.json() as Promise<any>,
          resGeocode.json() as Promise<any>,
        ]);

        const seen = new Set<string>();
        const googleMerged: any[] = [];
        for (const p of [...(dataCities.predictions || []), ...(dataGeocode.predictions || [])]) {
          if (!seen.has(p.place_id)) {
            seen.add(p.place_id);
            const types: string[] = p.types || [];
            const relevant = types.some((t: string) =>
              ["locality", "sublocality", "administrative_area_level_1",
               "administrative_area_level_2", "country", "natural_feature",
               "archipelago", "island", "political"].includes(t)
            );
            if (relevant) googleMerged.push(p);
          }
        }

        const islandMatches = searchIslands(input.query);
        const islandPredictions = islandMatches.map((island) => ({
          placeId: `island:${island.id}`,
          name: island.name,
          fullDescription: island.fullDescription,
          country: island.country,
          lat: island.lat,
          lng: island.lng,
          isIsland: true,
        }));

        const googlePredictions = googleMerged.slice(0, 6).map((p: any) => ({
          placeId: p.place_id,
          name: p.structured_formatting?.main_text || p.description,
          fullDescription: p.description,
          country: p.structured_formatting?.secondary_text || "",
        }));

        const islandNames = new Set(islandPredictions.map((i) => i.name.toLowerCase()));
        const filteredGoogle = googlePredictions.filter(
          (p) => !islandNames.has(p.name.toLowerCase())
        );

        const combined = [...islandPredictions, ...filteredGoogle].slice(0, 8);
        return { predictions: combined };
      }),

    /**
     * Get place details (lat/lng, photo) for a given placeId.
     */
    details: publicProcedure
      .input(z.object({ placeId: z.string(), language: z.string().optional() }))
      .query(async ({ input }) => {
        // Handle local island entries (placeId starts with "island:")
        if (input.placeId.startsWith("island:")) {
          const islandId = input.placeId.replace("island:", "");
          const { ISLANDS_AND_REGIONS } = await import("../constants/islands-regions");
          const island = ISLANDS_AND_REGIONS.find((i) => i.id === islandId);
          if (island) {
            // Try to get a photo using the island's imageKeyword or name
            const searchTerm = island.imageKeyword || island.name;
            const countryStr = island.country.split(",").pop()?.trim() || island.country;
            let islandImageUrl: string | undefined;
            try {
              islandImageUrl = await fetchWikipediaPhoto(searchTerm, countryStr);
              if (!islandImageUrl) {
                islandImageUrl = await fetchWikipediaPhoto(island.nameAlt?.[0] || island.name);
              }
            } catch {
              // ignore
            }
            if (!islandImageUrl) {
              console.warn(`[places.details] no photo for island "${island.name}" (${countryStr})`);
            }
            return {
              lat: island.lat,
              lng: island.lng,
              imageUrl: islandImageUrl,
              country: countryStr,
            };
          }
          return null;
        }

        if (!GOOGLE_PLACES_KEY) return null;

        const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
        url.searchParams.set("place_id", input.placeId);
        url.searchParams.set("fields", "geometry,photos,name,address_components,formatted_address");
        url.searchParams.set("language", mapToGoogleLanguage(input.language));
        url.searchParams.set("key", GOOGLE_PLACES_KEY);

        const res = await fetch(url.toString());
        const data = (await res.json()) as any;

        if (data.status !== "OK") return null;

        const result = data.result;
        const lat = result?.geometry?.location?.lat;
        const lng = result?.geometry?.location?.lng;
        // Display name/country — localized to the app's OWN current UI
        // language (input.language). This is what Destination.name/.country
        // should show across the app: previously computed here but never
        // returned, so the UI stayed stuck with whatever raw Autocomplete
        // prediction text the user originally typed (in whichever language
        // they searched), even though this authoritative, reconciled value
        // was sitting right here. Fixes "London" vs "Londres" showing
        // inconsistently depending on search language.
        const placeName = result?.name || "";
        const countryComponent = result?.address_components?.find((c: any) => c.types.includes("country"));
        const country = countryComponent?.long_name || "";
        // `short_name` for a `country` component is always the ISO 3166-1
        // alpha-2 code, regardless of the requested `language` — safe to use
        // as a language-invariant lookup key.
        const countryCode = countryComponent?.short_name;

        // Local-language name/country — ALWAYS the destination's own local
        // language (e.g. "München"/"Deutschland" for Munich), independent of
        // the app's UI language — used ONLY for the Unsplash cover-image
        // query (FASE 3), never for display. This is the fix for the cover
        // image changing depending on which language the user searched in:
        // the old code fed the UI-language `placeName` straight into
        // Unsplash, so the same city searched in English vs. Portuguese
        // produced two different query strings.
        const localLanguage = resolveLocalLanguageForCountry(countryCode);
        let localPlaceName = placeName;
        let localCountryName = country;
        if (mapToGoogleLanguage(input.language) !== mapToGoogleLanguage(localLanguage)) {
          try {
            const localUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
            localUrl.searchParams.set("place_id", input.placeId);
            localUrl.searchParams.set("fields", "name,address_components");
            localUrl.searchParams.set("language", mapToGoogleLanguage(localLanguage));
            localUrl.searchParams.set("key", GOOGLE_PLACES_KEY);
            const localRes = await fetch(localUrl.toString());
            const localData = (await localRes.json()) as any;
            if (localData.status === "OK") {
              const localResult = localData.result;
              localPlaceName = localResult?.name || placeName;
              const localCountryComp = localResult?.address_components?.find((c: any) => c.types.includes("country"));
              localCountryName = localCountryComp?.long_name || country;
            }
          } catch (err) {
            console.error(`[places.details] local-language lookup failed for place_id=${input.placeId}, falling back to display-language name for the Unsplash query:`, err);
          }
        }

        const debugSteps: string[] = [];
        let imageUrl: string | undefined;

        // 1. Unsplash first, using the destination's LOCAL-language name — never the UI-display name.
        imageUrl = await fetchUnsplashPhoto(localPlaceName, localCountryName, debugSteps);
        debugSteps.push(imageUrl ? "unsplash: found" : "unsplash: no results");

        // 2. Curated Google Places photo for the specific place_id, only if Unsplash has nothing.
        if (!imageUrl) {
          const bestPhotoRef = pickBestGooglePhoto(result?.photos);
          if (bestPhotoRef) {
            imageUrl = await resolveGooglePhotoUrl(bestPhotoRef);
          }
          debugSteps.push(imageUrl ? "google-place: found" : "google-place: no photo");
        }

        // 3. Nothing found — leave imageUrl undefined; the client falls back to its default photo.
        if (!imageUrl) {
          debugSteps.push("default: no photo found, app fallback applies");
        }

        if (!imageUrl) {
          console.warn(`[places.details] no photo found for "${localPlaceName}" (${localCountryName}), place_id=${input.placeId}`, debugSteps);
        } else {
          console.log(`[places.details] photo resolution steps for "${localPlaceName}":`, debugSteps);
        }

        const address = result?.formatted_address || "";
        return { lat, lng, imageUrl, name: placeName, country, address };
      }),

    /**
     * Text search for places within a destination (for manual place search in Lugares tab).
     * Uses Google Places Text Search API.
     * Returns up to 8 places with name, address, category, lat, lng, imageUrl.
     */
    textSearch: publicProcedure
      .input(z.object({
        query: z.string().min(1),
        locationBias: z.string().optional(), // e.g. "Paris, France"
        countries: z.array(z.string()).optional(), // destination country/countries — restricts results
        language: z.string().optional(),
      }))
      .query(async ({ input }) => {
        if (!GOOGLE_PLACES_KEY) return { places: [] };
        const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
        const q = input.locationBias
          ? `${input.query} em ${input.locationBias}`
          : input.query;
        url.searchParams.set("query", q);
        url.searchParams.set("language", mapToGoogleLanguage(input.language));
        url.searchParams.set("key", GOOGLE_PLACES_KEY);
        try {
          const res = await fetch(url.toString());
          const data = (await res.json()) as any;
          if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return { places: [] };
          // Text Search (legacy API) has no country/component restriction
          // param, so the country of the destination is enforced afterward
          // by matching it against each result's formatted address.
          const countriesLower = (input.countries || []).map((c) => c.toLowerCase()).filter(Boolean);
          const rawResults: any[] = data.results || [];
          const countryFiltered = countriesLower.length > 0
            ? rawResults.filter((r: any) => {
                const addr = (r.formatted_address || '').toLowerCase();
                return countriesLower.some((c) => addr.includes(c));
              })
            : rawResults;
          const results: any[] = countryFiltered.slice(0, 8);
          const places = results.map((r: any) => {
            // Map Google types to app categories
            const types: string[] = r.types || [];
            let category = 'other';
            if (types.some((t: string) => ['restaurant', 'food', 'meal_takeaway', 'bakery'].includes(t))) category = 'restaurant';
            else if (types.some((t: string) => ['cafe', 'coffee_shop'].includes(t))) category = 'cafe';
            else if (types.some((t: string) => ['museum', 'art_gallery'].includes(t))) category = 'museum';
            else if (types.some((t: string) => ['tourist_attraction', 'amusement_park', 'park', 'natural_feature', 'landmark'].includes(t))) category = 'attraction';

            let imageUrl: string | undefined;
            if (r.photos?.[0]?.photo_reference) {
              const photoUrl = new URL("https://maps.googleapis.com/maps/api/place/photo");
              photoUrl.searchParams.set("maxwidth", "800");
              photoUrl.searchParams.set("photo_reference", r.photos[0].photo_reference);
              photoUrl.searchParams.set("key", GOOGLE_PLACES_KEY);
              imageUrl = photoUrl.toString();
            }
            return {
              placeId: r.place_id,
              name: r.name,
              address: r.formatted_address || '',
              category,
              lat: r.geometry?.location?.lat,
              lng: r.geometry?.location?.lng,
              imageUrl,
              rating: r.rating,
            };
          });
          return { places };
        } catch {
          return { places: [] };
        }
      }),

    /**
     * Full place details (address/hours/phone/photo) for a single placeId —
     * used to preview a custom-search result (opening hours + formatted
     * address) before the user confirms adding it to the trip.
     */
    curatedDetails: publicProcedure
      .input(z.object({ placeId: z.string(), language: z.string().optional() }))
      .query(async ({ input }) => {
        if (!GOOGLE_PLACES_KEY) return {};
        return fetchCuratedPlaceDetails(input.placeId, input.language);
      }),

    /**
     * Batch Google Place Details (address/hours/phone/photo) for up to 12
     * catalog-sourced place_ids at once, cached for up to 1h — lets the app
     * backfill details for catalog suggestions beyond the top 20 already
     * resolved by ai.suggestPlaces, on demand as they scroll into view.
     */
    catalogDetails: protectedProcedure
      .input(z.object({ placeIds: z.array(z.string()).min(1).max(12), language: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        await requireActiveSubscription(ctx.user.id);
        const details = await catalog.fetchCatalogDetailsBatch(input.placeIds, input.language);
        return { details };
      }),
  }),

  // ─── AI / Itinerary ────────────────────────────────────────────────────────
  ai: router({
    /**
     * Generate destination suggestions based on travel preferences.
     * Used in the "Criar com IA" flow.
     */
    suggestDestinations: publicProcedure
      .input(
        z.object({
          totalDays: z.number().min(1).max(90),
          startDate: z.string(),
          preferences: z.object({
            style: z.array(z.string()), // e.g. ["cultura", "gastronomia", "natureza"]
            budget: z.enum(["econômico", "moderado", "luxo"]),
            pace: z.enum(["relaxado", "moderado", "intenso"]).optional(),
            climate: z.string().optional(),
            avoidLongFlights: z.boolean().optional(),
            originCity: z.string().optional(),
          }),
        })
      )
      .mutation(async ({ input }) => {
        const { totalDays, startDate, preferences } = input;

        const prompt = `Você é um especialista em viagens. Sugira destinos de viagem para um roteiro de ${totalDays} dias começando em ${startDate}.

Preferências do viajante:
- Estilo: ${preferences.style.join(", ")}
- Orçamento: ${preferences.budget}
${preferences.climate ? `- Clima preferido: ${preferences.climate}` : ""}
${preferences.avoidLongFlights ? "- Prefere evitar voos longos" : ""}
${preferences.originCity ? `- Cidade de origem: ${preferences.originCity}` : ""}

Retorne um JSON com 3 opções de roteiro. Cada opção deve ter:
- name: nome do roteiro (ex: "Clássicos da Europa")
- destinations: array de destinos com { name, country, days, reason }
- totalDays deve ser exatamente ${totalDays}
- highlight: frase de destaque do roteiro`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "Você é um especialista em viagens que cria roteiros personalizados. Responda sempre em JSON válido." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
        });

        const content = response.choices[0].message.content as string;
        try {
          const parsed = JSON.parse(content);
          return { options: parsed.options || parsed.roteiros || [parsed] };
        } catch {
          return { options: [] };
        }
      }),

    /**
     * Generate a day-by-day itinerary for a trip.
     * Can use AI-selected places or user-selected places.
     */
    generateItinerary: protectedProcedure
      .input(
        z.object({
          tripId: z.string(),
          startDate: z.string(),
          totalDays: z.number(),
          destinations: z.array(
            z.object({
              name: z.string(),
              country: z.string().optional(),
              days: z.number(),
              lat: z.number().optional(),
              lng: z.number().optional(),
            })
          ),
          selectedPlaces: z.array(
            z.object({
              name: z.string(),
              category: z.string(),
              destinationName: z.string(),
              hours: z.string().optional(),
              address: z.string().optional(),
              lat: z.number().optional(),
              lng: z.number().optional(),
            })
          ).optional(),
          cityTransportMode: z.string().optional(),
          // Optional route anchor — not yet sent by the UI, but the backend is
          // ready for it so itinerary logic can start using the hotel as soon
          // as it's wired up client-side (no UI change required for that wiring).
          accommodation: z.object({
            name: z.string().optional(),
            address: z.string().optional(),
            lat: z.number().optional(),
            lng: z.number().optional(),
          }).optional(),
          preferences: z.object({
            pace: z.enum(["relaxado", "moderado", "intenso"]).optional(),
            wakeUpTime: z.string().optional(), // e.g. "08:00"
            includeBreakfast: z.boolean().optional(),
            includeLunch: z.boolean().optional(),
            includeDinner: z.boolean().optional(),
            attractionsBudget: z.string().optional(),
            restaurantsBudget: z.string().optional(),
            bedtime: z.string().optional(),
            arrivalTime: z.string().optional(),
            departureTime: z.string().optional(),
            tripPurpose: z.string().optional(),
            mustSee: z.string().optional(),
            // Structured extras — optional, no UI surface yet (see product plan).
            travelStyle: z.array(z.string()).optional(),
            avoidPlaces: z.string().optional(),
            mealPreferences: z.object({
              breakfast: z.enum(["hotel", "outside", "none"]).optional(),
              lunch: z.enum(["restaurant", "quick", "none"]).optional(),
              dinner: z.enum(["restaurant", "quick", "none"]).optional(),
            }).optional(),
          }).optional(),
          language: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireActiveSubscription(ctx.user.id);
        const { totalDays, destinations, selectedPlaces, preferences, cityTransportMode, accommodation } = input;
        const startDate = normalizeToDateOnlyString(input.startDate);
        const generationStartedAt = Date.now();
        const telemetry = { llmCalls: 0, promptTokens: 0, completionTokens: 0 };

        const destSummary = destinations
          .map((d) => `${d.name} (${d.country || ""}) — ${d.days} dias`)
          .join(", ");

        const hasSelectedPlaces = selectedPlaces && selectedPlaces.length > 0;
        const placesSummary = hasSelectedPlaces
          ? `\nLugares OBRIGATÓRIOS selecionados pelo usuário (use APENAS estes lugares nas paradas, não adicione outros):\n${selectedPlaces!.map((p) => `- ${p.name} (${p.category}) em ${p.destinationName}${p.hours ? `, horário: ${p.hours}` : ""}${p.address ? `, endereço: ${p.address}` : ""}${p.lat && p.lng ? `, coordenadas: ${p.lat},${p.lng}` : ""}`).join("\n")}`
          : "\nUse sua expertise para sugerir os melhores lugares para visitar.";

        // Ground any place the AI adds beyond the (optional) obligatory list in
        // real, currently-open places from Google Places PLUS our own curated
        // catalog (server/itinerary/candidates.ts) — previously the catalog
        // only fed ai.suggestPlaces, never actual itinerary generation (see
        // docs/itinerary-audit.md section 1) — instead of letting the model
        // invent places from memory. Hard exclusion (avoid list) and ranking
        // (interest/editorial/quality/popularity, never a hard filter) both
        // happen inside prepareCandidatePool.
        const selectedNamesLower = new Set((selectedPlaces || []).map((p) => p.name.toLowerCase()));
        const rawGoogleCandidates = await fetchRealCandidatesForDestinations(destinations, input.language);
        const { candidates: extraCandidates, excludedCount, catalogCount, totalBeforeCap } = await prepareCandidatePool(
          rawGoogleCandidates,
          destinations,
          {
            travelStyles: preferences?.travelStyle,
            attractionsBudget: preferences?.attractionsBudget,
            restaurantsBudget: preferences?.restaurantsBudget,
            avoidText: preferences?.avoidPlaces,
            language: input.language,
            excludeNamesLower: selectedNamesLower,
          },
        );
        if (excludedCount > 0) {
          console.log(`[ai.generateItinerary] filtered out ${excludedCount} candidate(s) matching the user's avoid list`);
        }
        console.log(`[ai.generateItinerary] candidate pool: ${extraCandidates.length} (of ${totalBeforeCap} ranked before cap), ${catalogCount} from curated catalog`);

        // Real opening hours, fetched only for the shortlist actually offered
        // to the model (keeps the extra Place Details calls bounded). Catalog
        // candidates' hours/lat/lng were already best-effort backfilled
        // inside prepareCandidatePool — this additionally covers Google-only
        // candidates, which never needed that backfill for lat/lng (Nearby
        // Search already returns it) but still need opening hours.
        await fetchOpeningHoursForTopCandidates(extraCandidates, 40, input.language);
        const hoursByPlaceId = new Map(extraCandidates.filter((c) => c.hoursText).map((c) => [c.placeId, c.hoursText!]));

        const realCandidatesSummary = extraCandidates.length > 0
          ? `\nLugares reais e verificados disponíveis${hasSelectedPlaces ? ' para completar o roteiro além dos obrigatórios acima' : ''} (use o nome EXATAMENTE como aparece na lista; NÃO invente nenhum lugar fora desta lista${hasSelectedPlaces ? ' nem da lista de obrigatórios' : ''}):\n${extraCandidates.map((c) => `[${c.placeId}] ${c.name} (${c.destinationName})${c.rating ? `, rating ${c.rating}` : ''}${c.hoursText ? `, horário: ${c.hoursText.replace(/\n/g, ' | ')}` : ''}${c.source === 'catalog' ? ` [recomendação editorial local${c.curatedDescription ? `: ${c.curatedDescription}` : ''}]` : ''}`).join("\n")}`
          : '';

        // Separate, schema-free web-search pass — see preScreenRecommendedCandidates
        // for why this can't just be `enableWebSearch: true` on the main call below.
        const preScreenedPlaces = await preScreenRecommendedCandidates(destSummary, extraCandidates);
        const preScreenBlock = preScreenedPlaces
          ? `\nPesquisa prévia identificou estes lugares como especialmente recomendados:\n${preScreenedPlaces}\n— dê peso extra a eles na sua escolha, mas você não é obrigado a usar só esses.`
          : '';

        // Promote a resolvable free-text "must-see" hint to a HARD constraint.
        const destCenter = destinations.find((d) => d.lat != null && d.lng != null);
        const resolvedMustSee = await resolveMustSeePlace(preferences?.mustSee, destCenter?.lat, destCenter?.lng, input.language);

        // Deterministic geographic clustering (server/itinerary/clustering.ts,
        // spec "Stage 4") — a suggested day→zone split per destination, fed
        // to the model as extra planning context instead of an unordered
        // candidate list. Advisory only: never removes a candidate, and the
        // model/validator can still override it for a hard constraint.
        const clusteringBlock = buildClusteringBlockForDestinations(destinations, extraCandidates, accommodation);
        const weatherBlock = await buildWeatherBlockForDestinations(startDate, destinations, accommodation);

        const paceStops = preferences?.pace === 'relaxado' ? 3 : preferences?.pace === 'intenso' ? 6 : 4;

        // Map cityTransportMode to a human-readable label for the prompt
        const transportLabel: Record<string, string> = {
          public: 'transporte público / metrô (transit)',
          car: 'carro / táxi (driving)',
        };
        const transportHint = cityTransportMode
          ? `\n- Meio de transporte dentro da cidade: ${transportLabel[cityTransportMode] || cityTransportMode}`
          : '';

        const wakeUpTime = preferences?.wakeUpTime || "08:00";
        const bedtime = preferences?.bedtime || "23:00";
        const arrivalTime = preferences?.arrivalTime || wakeUpTime;
        const departureTime = preferences?.departureTime || "18:00";
        const attractionsBudget = preferences?.attractionsBudget;
        const restaurantsBudget = preferences?.restaurantsBudget;
        const tripPurpose = preferences?.tripPurpose;
        const mustSee = resolvedMustSee ? undefined : preferences?.mustSee;
        const hotelBlock = buildHotelPromptBlock(accommodation);
        const mealBlock = buildMealPreferencesBlock(preferences?.mealPreferences, preferences || {});

        const prompt = `Crie um roteiro de viagem dia a dia detalhado para ${totalDays} dias.
${HARD_SOFT_FRAMING_BLOCK}

Data de início: ${startDate}
Destinos: ${destSummary}
${placesSummary}${resolvedMustSee ? `\nLugar adicional OBRIGATÓRIO (mencionado pelo usuário, verificado como real): ${resolvedMustSee.name}${resolvedMustSee.address ? `, endereço: ${resolvedMustSee.address}` : ''}, coordenadas: ${resolvedMustSee.lat},${resolvedMustSee.lng}. Inclua-o em algum dia, respeitando horário de funcionamento e tempo disponível.` : ''}${realCandidatesSummary}${preScreenBlock}${clusteringBlock}${weatherBlock}
${hotelBlock}

Preferências:
- Ritmo: ${preferences?.pace || "moderado"} (${paceStops} paradas de ATRAÇÕES/PASSEIOS por dia — café da manhã, almoço e jantar são ADICIONAIS a esse número, não descontados dele; ex: ritmo moderado = ${paceStops} atrações/passeios por dia, MAIS café da manhã, almoço e jantar quando aplicável)
- Horário de acordar: ${wakeUpTime}
- Horário de dormir: ${bedtime}
- Horário de chegada (dia 1): ${arrivalTime}
- Horário de saída (último dia): ${departureTime}${transportHint}
${attractionsBudget ? `- Orçamento para atrações: ${attractionsBudget}` : ""}
${restaurantsBudget ? `- Orçamento para restaurantes: ${restaurantsBudget}` : ""}${mealBlock}
${tripPurpose ? `- Motivo da viagem: ${tripPurpose}. Leve isso em conta na escolha de lugares e no tom das descrições (ex: lua de mel → lugares/restaurantes românticos; aniversário → sugerir algo especial em um dos dias).` : ""}
${mustSee ? `- O usuário mencionou que gostaria de incluir, se possível: ${mustSee}. É OBRIGATÓRIO tentar incluir, desde que tecnicamente viável (horário de funcionamento, tempo disponível, deslocamento); só deixe de fora se for genuinamente inviável.` : ""}
${preferences?.avoidPlaces ? `- O usuário pediu para EVITAR: ${preferences.avoidPlaces}. NUNCA inclua lugares desse tipo, mesmo que populares ou bem avaliados.` : ""}

Regras de horário:
- No primeiro dia (chegada), a primeira parada deve começar depois de ${arrivalTime}, com folga de pelo menos 1h30 para deslocamento e check-in.
- No último dia (partida), a última parada deve terminar com pelo menos 2h de folga antes de ${departureTime}, para dar tempo de chegar ao aeroporto/estação.
- Nos demais dias, a primeira parada deve começar depois do horário de acordar (${wakeUpTime}), com 30 a 60 minutos para o café da manhã.
- A última parada de cada dia deve terminar antes do horário de dormir (${bedtime}), com folga de pelo menos 1h.

${buildDurationGuidancePromptBlock(preferences?.pace)}

Retorne um JSON com o array "days". Cada dia deve ter:
- date: data no formato YYYY-MM-DD
- destination: nome do destino
- title: título do dia (ex: "Chegada em Paris — Torre Eiffel e Champs-Élysées")
- tips: dica do dia em 1 frase
- estimatedCost: custo estimado do dia (número), SEMPRE na moeda local do destino (nunca converta para dólar) — ex: para Paris use EUR, para Londres use GBP, para Tóquio use JPY. É uma estimativa aproximada, não um preço verificado — não finja mais precisão do que você realmente tem.
- estimatedCostCurrency: o código ISO 4217 de 3 letras da moeda usada acima (ex: "EUR", "GBP", "JPY", "USD" apenas se o destino realmente usar dólar americano)
- stops: array de paradas do dia, cada parada com:
  { time (HH:MM), googlePlaceId (se a parada vier da lista de candidatos reais, o placeId entre colchetes; vazio caso contrário), placeName, placeCategory (attraction|restaurant|cafe|museum|hidden_gem|other), description, hours (horário de funcionamento), address (endereço completo), lat (latitude numérica), lng (longitude numérica), travelTimeToNext (ex: "15 min a pé"), travelModeToNext (walking|driving|transit|bicycling) }

Importante:
- Inclua ${paceStops} paradas de atrações/passeios por dia (café da manhã, almoço e jantar contam à parte, não fazem parte desse número). Distribua bem os horários ao longo do dia.
- TODO dia (exceto talvez o dia de chegada, se chegar muito tarde) deve ter exatamente uma parada de almoço entre 12:00-14:00 e uma de jantar entre 19:00-21:00, sem exceção${(preferences?.includeLunch === false || preferences?.includeDinner === false || preferences?.mealPreferences?.lunch === 'none' || preferences?.mealPreferences?.dinner === 'none') ? ", salvo as refeições desmarcadas acima" : ""}.
- Sempre inclua lat/lng reais para cada parada (coordenadas geográficas precisas).
- Para cada parada, escreva uma descrição de 1-2 frases com uma orientação específica e útil sobre o que fazer ou ver ali — não uma frase genérica que serviria pra qualquer lugar do mesmo tipo. Se o lugar tiver uma obra, prato, vista ou horário especialmente recomendado, mencione isso especificamente. NUNCA deixe a descrição vazia, mesmo para a primeira parada do dia.
- NUNCA escreva um horário específico (ex: "das 20:55 às 21:40") na descrição que seja diferente do campo "time" dessa parada — se quiser mencionar um período do dia na descrição, ele PRECISA ser exatamente consistente com o horário agendado, porque o campo "time" é a única fonte de verdade sobre quando a parada acontece.
- Se a primeira ou última parada do dia for apenas um ponto de referência logístico (estação, aeroporto, ou a própria hospedagem do viajante) e não um lugar para efetivamente visitar/conhecer, deixe isso claro na descrição (ex: "ponto de partida para o passeio de hoje") em vez de escrever como se fosse uma recomendação de passeio.
- Restaurantes: não escolha só pelo número de avaliações. Quando o destino tiver uma culinária ou cultura gastronômica/de bebidas local característica (ex: pubs tradicionais no Reino Unido, trattorias na Itália, bares de tapas na Espanha), inclua pelo menos uma experiência desse tipo quando for coerente com as preferências do viajante — não repita o mesmo tipo de cozinha em todas as refeições do roteiro só porque é popular.
- O travelModeToNext deve refletir o meio de transporte preferido: ${cityTransportMode || 'driving'}. Mesmo assim, se duas paradas consecutivas estiverem a uma distância curta (menos de ~1km / menos de 15 min a pé), recomende travelModeToNext como 'walking' independente do meio de transporte geral escolhido.
- Ao escolher os lugares e a ordem das paradas de cada dia, agrupe por proximidade geográfica dentro da mesma região/bairro da cidade, minimizando deslocamentos longos entre paradas consecutivas.${hasSelectedPlaces ? '\n- ATENÇÃO: Use SOMENTE os lugares listados acima. NÃO adicione nenhum lugar que não esteja na lista.' : ''}${extraCandidates.length > 0 ? '\n- Use SOMENTE lugares da(s) lista(s) acima (obrigatórios e/ou candidatos reais). NÃO invente nenhum lugar de memória.' : ''}
- Antes de finalizar o horário de cada parada, releia a descrição que você mesmo escreveu para esse lugar — se ela menciona um período do dia específico (manhã, tarde, entardecer, pôr do sol, noite, etc.), o horário agendado da parada PRECISA bater com essa recomendação. Se não bater, ajuste o horário pra refletir o que você mesmo recomendou, não o contrário.`;

        const candidatesByPlaceId = new Map(extraCandidates.map((c) => [c.placeId, c]));
        const mustSeeNamesLower = new Set([resolvedMustSee?.name.toLowerCase()].filter(Boolean) as string[]);
        const mustVisit: MustVisitPlace[] = [
          ...(selectedPlaces || []).map((p) => ({ name: p.name, category: p.category, address: p.address, lat: p.lat, lng: p.lng, hours: p.hours })),
          ...(resolvedMustSee ? [resolvedMustSee] : []),
        ];
        const fillerRestaurants: FillerRestaurantCandidate[] = extraCandidates
          .filter((c) => c.types.includes('restaurant') && c.lat != null && c.lng != null)
          .slice(0, 15)
          .map((c) => ({ googlePlaceId: c.placeId, name: c.name, lat: c.lat, lng: c.lng }));

        // Generate → hallucination-guard → deterministic validate, wrapped in
        // a bounded single-repair loop (server/itinerary/repair.ts): if
        // validation surfaces an unresolved hard conflict (e.g. a must-visit
        // place that didn't fit), make ONE more targeted call describing
        // exactly what to fix, then keep whichever attempt is strictly
        // better. Never more than one extra call, never silently hidden from
        // the response (see the `warnings` field returned below).
        const generateAndValidate = async (repairBlock: string | undefined) => {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: "Você é um guia de viagens especialista. Crie roteiros detalhados, práticos e culturalmente ricos. Responda sempre em JSON válido." },
              { role: "user", content: repairBlock ? `${prompt}${repairBlock}` : prompt },
            ],
            outputSchema: { name: "itinerary_days", schema: buildItineraryDaysSchema({ dayTipField: "tips" }), strict: true },
            max_tokens: 16000,
          });
          telemetry.llmCalls++;
          telemetry.promptTokens += response.usage?.prompt_tokens ?? 0;
          telemetry.completionTokens += response.usage?.completion_tokens ?? 0;

          const content = response.choices[0].message.content as string;
          let parsed: any;
          try {
            parsed = JSON.parse(content);
          } catch (err) {
            console.error("[ai.generateItinerary] Failed to parse LLM response as JSON. Raw content (first 500 chars):", content.slice(0, 500));
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Não foi possível gerar o roteiro: a resposta da IA veio incompleta ou inválida. Tente novamente.",
              cause: err,
            });
          }

          const rawDays: any[] = parsed.days || [];

          // Hallucination guard (previously only applied in generateFromScratch):
          // drop any AI-added stop whose googlePlaceId isn't a real candidate and
          // whose name doesn't match a user-selected or must-visit place.
          let droppedHallucinatedStops = 0;
          for (const day of rawDays) {
            day.stops = (day.stops || []).filter((stop: any) => {
              if (!stop.placeName) return false;
              if (extraCandidates.length === 0) return true; // no grounding pool available — nothing to check against
              const isKnownCandidate = stop.googlePlaceId && candidatesByPlaceId.has(stop.googlePlaceId);
              const isSelected = selectedNamesLower.has((stop.placeName || '').toLowerCase());
              const isMustSee = mustSeeNamesLower.has((stop.placeName || '').toLowerCase());
              if (!isKnownCandidate && !isSelected && !isMustSee) {
                droppedHallucinatedStops++;
                return false;
              }
              if (isKnownCandidate) {
                const c = candidatesByPlaceId.get(stop.googlePlaceId)!;
                stop.lat = c.lat ?? stop.lat;
                stop.lng = c.lng ?? stop.lng;
              }
              return true;
            });
          }
          if (droppedHallucinatedStops > 0) {
            console.warn(`[ai.generateItinerary] dropped ${droppedHallucinatedStops} stop(s) that referenced places outside the real candidates / selected-places lists`);
          }

          const { days: correctedDays, warnings } = await validateAndCorrectItinerary(rawDays, {
            wakeUpTime, bedtime, arrivalTime, departureTime,
            isFirstDay: (i) => i === 0,
            isLastDay: (i) => i === totalDays - 1,
            avoidText: preferences?.avoidPlaces,
            mustVisit,
            requireLunch: preferences?.includeLunch !== false,
            requireDinner: preferences?.includeDinner !== false,
            lunchMode: preferences?.mealPreferences?.lunch,
            dinnerMode: preferences?.mealPreferences?.dinner,
            hoursByPlaceId,
            fillerRestaurants,
            pace: preferences?.pace,
            fetchTravel: buildTravelFetcher(cityTransportMode, input.language),
            accommodation,
            language: input.language,
          });
          return { result: correctedDays, warnings };
        };

        const outcome = await withOneRepairAttempt(generateAndValidate);
        console.log(
          `[ai.generateItinerary] telemetry: totalMs=${Date.now() - generationStartedAt} llmCalls=${telemetry.llmCalls} promptTokens=${telemetry.promptTokens} completionTokens=${telemetry.completionTokens} candidatePool=${extraCandidates.length}(catalog=${catalogCount},rankedBeforeCap=${totalBeforeCap},excludedByAvoid=${excludedCount}) repairAttempted=${outcome.repairAttempted} repairUsed=${outcome.repairUsed} unresolvedWarnings=${outcome.warnings.length}`,
        );

        return { days: outcome.result, warnings: outcome.warnings.length > 0 ? outcome.warnings : undefined };
      }),

    /**
     * Generate place suggestions for a destination by category.
     * Used in the "Lugares" tab when AI selects places.
     */
    /**
     * Generate itinerary from scratch with user profile questions.
     * Returns both suggested places AND a day-by-day itinerary.
     */
    generateFromScratch: protectedProcedure
      .input(
        z.object({
          tripId: z.string(),
          startDate: z.string(),
          totalDays: z.number(),
          destinations: z.array(
            z.object({
              name: z.string(),
              country: z.string().optional(),
              days: z.number(),
              lat: z.number().optional(),
              lng: z.number().optional(),
            })
          ),
          cityTransportMode: z.string().optional(),
          accommodation: z.object({
            name: z.string().optional(),
            address: z.string().optional(),
            lat: z.number().optional(),
            lng: z.number().optional(),
          }).optional(),
          selectedPlaces: z.array(
            z.object({
              name: z.string(),
              category: z.string(),
              destinationName: z.string(),
              hours: z.string().optional(),
              address: z.string().optional(),
              lat: z.number().optional(),
              lng: z.number().optional(),
            })
          ).optional(),
          profile: z.object({
            travelStyle: z.array(z.string()),   // e.g. ["cultura", "gastronomia"]
            budget: z.enum(["econômico", "moderado", "luxo"]).optional(), // legacy single-budget field, kept for old callers
            pace: z.enum(["relaxado", "moderado", "intenso"]),
            travelProfile: z.enum(["casal", "família", "solo", "amigos", "negócios"]),
            interests: z.string().optional(),   // free text
            wakeUpTime: z.string().optional(),
            attractionsBudget: z.string().optional(),
            restaurantsBudget: z.string().optional(),
            bedtime: z.string().optional(),
            arrivalTime: z.string().optional(),
            departureTime: z.string().optional(),
            tripPurpose: z.string().optional(),
            mustSee: z.string().optional(),
            avoidPlaces: z.string().optional(),
            mealPreferences: z.object({
              breakfast: z.enum(["hotel", "outside", "none"]).optional(),
              lunch: z.enum(["restaurant", "quick", "none"]).optional(),
              dinner: z.enum(["restaurant", "quick", "none"]).optional(),
            }).optional(),
          }),
          language: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await requireActiveSubscription(ctx.user.id);
        const { totalDays, destinations, cityTransportMode, selectedPlaces, profile, accommodation } = input;
        const startDate = normalizeToDateOnlyString(input.startDate);
        const generationStartedAt = Date.now();
        const telemetry = { llmCalls: 0, promptTokens: 0, completionTokens: 0 };

        const destSummary = destinations
          .map((d) => `${d.name} (${d.country || ""}) — ${d.days} dias`)
          .join(", ");

        const hasSelectedPlaces = selectedPlaces && selectedPlaces.length > 0;
        const selectedPlacesSummary = hasSelectedPlaces
          ? `\nLugares que o usuário já selecionou e quer manter no roteiro (inclua todos estes, e complete o restante do roteiro com mais sugestões que combinem com o perfil abaixo):\n${selectedPlaces!.map((p) => `- ${p.name} (${p.category}) em ${p.destinationName}${p.hours ? `, horário: ${p.hours}` : ""}${p.address ? `, endereço: ${p.address}` : ""}${p.lat && p.lng ? `, coordenadas: ${p.lat},${p.lng}` : ""}`).join("\n")}`
          : "";

        // Ground the whole itinerary in real, currently-open places from Google
        // Places PLUS our own curated catalog (server/itinerary/candidates.ts)
        // — same principle as ai.suggestPlaces, now extended to real
        // itinerary generation too — instead of letting the model invent
        // places from memory. Hard exclusion (avoid list) and ranking
        // (interest/editorial/quality/popularity, never a hard filter) both
        // happen inside prepareCandidatePool.
        const rawRealCandidates = await fetchRealCandidatesForDestinations(destinations, input.language);
        const selectedPlacesNamesLower = new Set((selectedPlaces || []).map((p) => p.name.toLowerCase()));
        const { candidates: realCandidates, excludedCount: excludedRealCount, catalogCount, totalBeforeCap } = await prepareCandidatePool(
          rawRealCandidates,
          destinations,
          {
            travelStyles: profile.travelStyle,
            attractionsBudget: profile.attractionsBudget || profile.budget,
            restaurantsBudget: profile.restaurantsBudget || profile.budget,
            avoidText: profile.avoidPlaces,
            language: input.language,
            excludeNamesLower: selectedPlacesNamesLower,
          },
        );
        if (excludedRealCount > 0) {
          console.log(`[ai.generateFromScratch] filtered out ${excludedRealCount} candidate(s) matching the user's avoid list`);
        }
        console.log(`[ai.generateFromScratch] candidate pool: ${realCandidates.length} (of ${totalBeforeCap} ranked before cap), ${catalogCount} from curated catalog`);

        await fetchOpeningHoursForTopCandidates(realCandidates, 40, input.language);
        const candidatesByPlaceId = new Map(realCandidates.map((c) => [c.placeId, c]));
        const hoursByPlaceId = new Map(realCandidates.filter((c) => c.hoursText).map((c) => [c.placeId, c.hoursText!]));
        const realCandidatesSummary = realCandidates.length > 0
          ? `\nLugares reais e verificados disponíveis para montar o roteiro (a lista já está ordenada por relevância/afinidade para o perfil do viajante):\n${realCandidates.map((c) => `[${c.placeId}] ${c.name} — destino: ${c.destinationName}, tipos: ${c.types.join(", ") || "?"}, rating: ${c.rating ?? "?"}, avaliações: ${c.userRatingsTotal}${c.hoursText ? `, horário: ${c.hoursText.replace(/\n/g, ' | ')}` : ''}${c.source === 'catalog' ? ` [recomendação editorial local${c.curatedDescription ? `: ${c.curatedDescription}` : ''}]` : ''}`).join("\n")}`
          : "";

        // Separate, schema-free web-search pass — see preScreenRecommendedCandidates
        // for why this can't just be `enableWebSearch: true` on the main call below.
        const preScreenedPlaces = await preScreenRecommendedCandidates(destSummary, realCandidates);
        const preScreenBlock = preScreenedPlaces
          ? `\nPesquisa prévia identificou estes lugares como especialmente recomendados:\n${preScreenedPlaces}\n— dê peso extra a eles na sua escolha, mas você não é obrigado a usar só esses.`
          : '';

        const destCenter = destinations.find((d) => d.lat != null && d.lng != null);
        const resolvedMustSee = await resolveMustSeePlace(profile.mustSee, destCenter?.lat, destCenter?.lng, input.language);

        // Deterministic geographic clustering — see the identical use in
        // ai.generateItinerary above for the full rationale.
        const clusteringBlock = buildClusteringBlockForDestinations(destinations, realCandidates, accommodation);
        const weatherBlock = await buildWeatherBlockForDestinations(startDate, destinations, accommodation);

        const paceStops = profile.pace === 'relaxado' ? 3 : profile.pace === 'intenso' ? 6 : 4;

        const transportLabel: Record<string, string> = {
          public: 'transporte público / metrô (transit)',
          car: 'carro / táxi (driving)',
        };
        const transportHint = cityTransportMode
          ? `\n- Meio de transporte: ${transportLabel[cityTransportMode] || cityTransportMode}`
          : '';

        const wakeUpTime = profile.wakeUpTime || "08:00";
        const bedtime = profile.bedtime || "23:00";
        const arrivalTime = profile.arrivalTime || wakeUpTime;
        const departureTime = profile.departureTime || "18:00";
        const attractionsBudget = profile.attractionsBudget || profile.budget || "moderado";
        const restaurantsBudget = profile.restaurantsBudget || profile.budget || "moderado";
        const mustSee = resolvedMustSee ? undefined : profile.mustSee;
        const hotelBlock = buildHotelPromptBlock(accommodation);
        const mealBlock = buildMealPreferencesBlock(profile.mealPreferences, {});

        const prompt = `Crie um roteiro de viagem personalizado para ${totalDays} dias.
${HARD_SOFT_FRAMING_BLOCK}

Data de início: ${startDate}
Destinos: ${destSummary}
${selectedPlacesSummary}${resolvedMustSee ? `\nLugar adicional OBRIGATÓRIO (mencionado pelo usuário, verificado como real): ${resolvedMustSee.name}${resolvedMustSee.address ? `, endereço: ${resolvedMustSee.address}` : ''}, coordenadas: ${resolvedMustSee.lat},${resolvedMustSee.lng}. Inclua-o em algum dia, respeitando horário de funcionamento e tempo disponível.` : ''}${realCandidatesSummary}${preScreenBlock}${clusteringBlock}${weatherBlock}
${hotelBlock}

Perfil do viajante:
- Estilo: ${profile.travelStyle.join(", ")}
- Orçamento para atrações: ${attractionsBudget}
- Orçamento para restaurantes: ${restaurantsBudget}
- Ritmo: ${profile.pace} (${paceStops} paradas de ATRAÇÕES/PASSEIOS por dia — café da manhã, almoço e jantar são ADICIONAIS a esse número, não descontados dele; ex: ritmo moderado = ${paceStops} atrações/passeios por dia, MAIS café da manhã, almoço e jantar quando aplicável)
- Tipo de viagem: ${profile.travelProfile}
${profile.interests ? `- Interesses específicos do viajante: ${profile.interests}. Trate isso como um sinal FORTE de seleção, não um detalhe decorativo — priorize candidatos reais da lista acima que combinem com esses interesses em vez de simplesmente mencioná-los na descrição de lugares genéricos. Exemplos do nível de especificidade útil: "arquitetura gótica", "mercados de rua e feiras locais", "spots de fotografia ao pôr do sol", "cervejarias artesanais", "lojas de discos de vinil", "museus de ciência para crianças". Se nenhum candidato real combinar bem, é preferível manter a seleção pela qualidade geral a forçar um lugar irrelevante só para citar o interesse.` : ""}
- Horário de acordar: ${wakeUpTime}
- Horário de dormir: ${bedtime}
- Horário de chegada (dia 1): ${arrivalTime}
- Horário de saída (último dia): ${departureTime}${transportHint}${mealBlock}
${profile.tripPurpose ? `- Motivo da viagem: ${profile.tripPurpose}. Leve isso em conta na escolha de lugares e no tom das descrições (ex: lua de mel → lugares/restaurantes românticos; aniversário → sugerir algo especial em um dos dias).` : ""}
${mustSee ? `- O usuário mencionou que gostaria de incluir, se possível: ${mustSee}. É OBRIGATÓRIO tentar incluir, desde que tecnicamente viável (horário de funcionamento, tempo disponível, deslocamento); só deixe de fora se for genuinamente inviável.` : ""}
${profile.avoidPlaces ? `- O usuário pediu para EVITAR: ${profile.avoidPlaces}. NUNCA inclua lugares desse tipo, mesmo que populares ou bem avaliados.` : ""}

${realCandidates.length > 0
  ? 'Monte o roteiro dia a dia usando SOMENTE os lugares da lista de candidatos reais acima (e os lugares já selecionados pelo usuário, se houver), referenciando o googlePlaceId de cada um. A lista já está ordenada por relevância para o perfil do viajante — prefira os primeiros da lista quando fizer sentido, mas use bom senso de sequência geográfica e variedade. NÃO invente lugares fora dessas listas.'
  : 'Crie o roteiro completo com lugares autênticos que combinem com o perfil acima.'}

Regras de horário:
- No primeiro dia (chegada), a primeira parada deve começar depois de ${arrivalTime}, com folga de pelo menos 1h30 para deslocamento e check-in.
- No último dia (partida), a última parada deve terminar com pelo menos 2h de folga antes de ${departureTime}, para dar tempo de chegar ao aeroporto/estação.
- Nos demais dias, a primeira parada deve começar depois do horário de acordar (${wakeUpTime}), com 30 a 60 minutos para o café da manhã.
- A última parada de cada dia deve terminar antes do horário de dormir (${bedtime}), com folga de pelo menos 1h.

${buildDurationGuidancePromptBlock(profile.pace)}

Retorne um JSON com "days": array dia-a-dia, cada dia com:
   { date (YYYY-MM-DD), destination, dayNumber, title, tip, estimatedCost, estimatedCostCurrency, stops: [{ id (uuid), time (HH:MM), googlePlaceId${realCandidates.length > 0 ? ' (exatamente o placeId entre colchetes do candidato real escolhido, ou vazio se a parada for um dos lugares já selecionados pelo usuário)' : ''}, placeName, placeCategory, description, address, lat, lng, travelTimeToNext, travelModeToNext }] }

Importante:
- estimatedCost é uma estimativa aproximada SEMPRE na moeda local do destino (nunca em dólar, a menos que o destino realmente use USD) — preencha estimatedCostCurrency com o código ISO 4217 de 3 letras correspondente (ex: "EUR" para Paris, "GBP" para Londres). Não apresente isso como um preço verificado.
- Inclua ${paceStops} paradas de atrações/passeios por dia (café da manhã, almoço e jantar contam à parte, não fazem parte desse número).
- TODO dia (exceto talvez o dia de chegada, se chegar muito tarde) deve ter exatamente uma parada de almoço entre 12:00-14:00 e uma de jantar entre 19:00-21:00, sem exceção${(profile.mealPreferences?.lunch === 'none' || profile.mealPreferences?.dinner === 'none') ? ", salvo as refeições desmarcadas acima" : ""}.
- Inclua lat/lng reais para cada lugar.
- Para cada parada, escreva uma descrição de 1-2 frases com uma orientação específica e útil sobre o que fazer ou ver ali — não uma frase genérica que serviria pra qualquer lugar do mesmo tipo. Se o lugar tiver uma obra, prato, vista ou horário especialmente recomendado, mencione isso especificamente. NUNCA deixe a descrição vazia, mesmo para a primeira parada do dia.
- NUNCA escreva um horário específico (ex: "das 20:55 às 21:40") na descrição que seja diferente do campo "time" dessa parada — se quiser mencionar um período do dia na descrição, ele PRECISA ser exatamente consistente com o horário agendado, porque o campo "time" é a única fonte de verdade sobre quando a parada acontece.
- Se a primeira ou última parada do dia for apenas um ponto de referência logístico (estação, aeroporto, ou a própria hospedagem do viajante) e não um lugar para efetivamente visitar/conhecer, deixe isso claro na descrição (ex: "ponto de partida para o passeio de hoje") em vez de escrever como se fosse uma recomendação de passeio.
- Restaurantes: não escolha só pelo número de avaliações. Quando o destino tiver uma culinária ou cultura gastronômica/de bebidas local característica (ex: pubs tradicionais no Reino Unido, trattorias na Itália, bares de tapas na Espanha), inclua pelo menos uma experiência desse tipo quando for coerente com as preferências do viajante — não repita o mesmo tipo de cozinha em todas as refeições do roteiro só porque é popular.
- O travelModeToNext deve refletir o meio de transporte preferido: ${cityTransportMode || 'driving'}. Mesmo assim, se duas paradas consecutivas estiverem a uma distância curta (menos de ~1km / menos de 15 min a pé), recomende travelModeToNext como 'walking' independente do meio de transporte geral escolhido.
- Ao escolher os lugares e a ordem das paradas de cada dia, agrupe por proximidade geográfica dentro da mesma região/bairro da cidade, minimizando deslocamentos longos entre paradas consecutivas.
- Distribua bem os horários ao longo do dia.
- Respeite o orçamento (atrações e restaurantes separadamente) e o ritmo do viajante.${realCandidates.length > 0 ? '\n- NÃO invente nenhum lugar fora da lista de candidatos reais e da lista de lugares já selecionados pelo usuário.' : ''}
- Antes de finalizar o horário de cada parada, releia a descrição que você mesmo escreveu para esse lugar — se ela menciona um período do dia específico (manhã, tarde, entardecer, pôr do sol, noite, etc.), o horário agendado da parada PRECISA bater com essa recomendação. Se não bater, ajuste o horário pra refletir o que você mesmo recomendou, não o contrário.`;

        // Deterministic validate → correct pass checks: opening hours,
        // must-visit inclusion, exclusions, required meals,
        // arrival/departure/wake/bed bounds, duplicate/overlap cleanup, and
        // real travel times. Wrapped in a bounded single-repair loop
        // (server/itinerary/repair.ts): a hard unresolved conflict (e.g. a
        // must-visit place that didn't fit) triggers exactly ONE more
        // targeted LLM call before the result is finalized.
        const selectedPlacesLower = new Set((selectedPlaces || []).map((p) => p.name.toLowerCase()));
        const mustVisit: MustVisitPlace[] = [
          ...(selectedPlaces || []).map((p) => ({ name: p.name, category: p.category, address: p.address, lat: p.lat, lng: p.lng, hours: p.hours })),
          ...(resolvedMustSee ? [resolvedMustSee] : []),
        ];
        const fillerRestaurants: FillerRestaurantCandidate[] = realCandidates
          .filter((c) => c.types.includes('restaurant') && c.lat != null && c.lng != null)
          .slice(0, 15)
          .map((c) => ({ googlePlaceId: c.placeId, name: c.name, lat: c.lat, lng: c.lng }));

        const generateAndValidate = async (repairBlock: string | undefined) => {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: "Você é um guia de viagens especialista. Crie roteiros personalizados, detalhados e culturalmente ricos. Responda sempre em JSON válido." },
              { role: "user", content: repairBlock ? `${prompt}${repairBlock}` : prompt },
            ],
            outputSchema: { name: "itinerary_days", schema: buildItineraryDaysSchema({ dayTipField: "tip" }), strict: true },
            max_tokens: 16000,
          });
          telemetry.llmCalls++;
          telemetry.promptTokens += response.usage?.prompt_tokens ?? 0;
          telemetry.completionTokens += response.usage?.completion_tokens ?? 0;

          const content = response.choices[0].message.content as string;
          let parsed: any;
          try {
            parsed = JSON.parse(content);
          } catch (err) {
            console.error("[ai.generateFromScratch] Failed to parse LLM response as JSON. Raw content (first 500 chars):", content.slice(0, 500));
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Não foi possível gerar o roteiro: a resposta da IA veio incompleta ou inválida. Tente novamente.",
              cause: err,
            });
          }

          const days: any[] = parsed.days || [];

          // Rebuild suggestedPlaces from the stops actually used in the itinerary,
          // discarding whatever "suggestedPlaces" the AI may still have volunteered
          // (which can include places that never made it into any day). Also
          // backfills a googlePlaceId on any stop that's missing one, so every
          // stop links to a real suggestedPlaces entry.
          //
          // Guard against hallucination — same principle as ai.suggestPlaces: when
          // real candidates were available, a stop only survives if its
          // googlePlaceId matches one of them or its name matches a place the
          // user selected; anything else means the AI ignored the "don't
          // invent" instruction, so the stop is dropped rather than trusting an
          // unverifiable place.
          let droppedHallucinatedStops = 0;
          const patchedDays = days.map((day: any) => {
            const stops = (day.stops || []).map((stop: any) => {
              if (!stop.placeName) return null;

              const candidate = stop.googlePlaceId ? candidatesByPlaceId.get(stop.googlePlaceId) : undefined;
              const isSelectedPlace = selectedPlacesLower.has(stop.placeName.toLowerCase());
              if (realCandidates.length > 0 && !candidate && !isSelectedPlace) {
                droppedHallucinatedStops++;
                return null;
              }

              const resolvedGooglePlaceId = candidate?.placeId || stop.googlePlaceId || undefined;
              return {
                ...stop,
                googlePlaceId: resolvedGooglePlaceId,
                placeName: candidate?.name || stop.placeName,
                lat: candidate?.lat ?? stop.lat,
                lng: candidate?.lng ?? stop.lng,
              };
            }).filter(Boolean);
            return { ...day, stops };
          });

          if (droppedHallucinatedStops > 0) {
            console.warn(`[ai.generateFromScratch] dropped ${droppedHallucinatedStops} stop(s) that referenced places outside the real candidates / selected-places lists`);
          }

          const { days: correctedDays, warnings } = await validateAndCorrectItinerary(patchedDays, {
            wakeUpTime, bedtime, arrivalTime, departureTime,
            isFirstDay: (i) => i === 0,
            isLastDay: (i) => i === totalDays - 1,
            avoidText: profile.avoidPlaces,
            mustVisit,
            requireLunch: profile.mealPreferences?.lunch !== 'none',
            requireDinner: profile.mealPreferences?.dinner !== 'none',
            lunchMode: profile.mealPreferences?.lunch,
            dinnerMode: profile.mealPreferences?.dinner,
            hoursByPlaceId,
            fillerRestaurants,
            pace: profile.pace,
            fetchTravel: buildTravelFetcher(cityTransportMode, input.language),
            accommodation,
            language: input.language,
          });
          return { result: correctedDays, warnings };
        };

        const outcome = await withOneRepairAttempt(generateAndValidate);
        console.log(
          `[ai.generateFromScratch] telemetry: totalMs=${Date.now() - generationStartedAt} llmCalls=${telemetry.llmCalls} promptTokens=${telemetry.promptTokens} completionTokens=${telemetry.completionTokens} candidatePool=${realCandidates.length}(catalog=${catalogCount},rankedBeforeCap=${totalBeforeCap},excludedByAvoid=${excludedRealCount}) repairAttempted=${outcome.repairAttempted} repairUsed=${outcome.repairUsed} unresolvedWarnings=${outcome.warnings.length}`,
        );
        const correctedDays = outcome.result;

        // Build placesByKey exclusively from correctedDays — the itinerary
        // AFTER validation/correction — so suggestedPlaces reflects exactly
        // and only what survived validation. Building it any earlier (e.g.
        // from patchedDays, pre-validation) would leak places the validator
        // removed (closed, excluded, duplicate/overlap cleanup, etc.) into
        // the returned suggestions, where they'd wrongly show up as
        // "unscheduled" even though they're not actually in any day.
        const placesByKey = new Map<string, {
          googlePlaceId?: string; name: string; category: string; address?: string;
          description?: string; lat?: number; lng?: number; hours?: string; destinationName?: string;
        }>();
        for (const day of correctedDays) {
          for (const stop of day.stops || []) {
            if (!stop.placeName) continue;
            const candidate = stop.googlePlaceId ? candidatesByPlaceId.get(stop.googlePlaceId) : undefined;
            const key = stop.googlePlaceId || stop.placeName.toLowerCase();
            if (!placesByKey.has(key)) {
              placesByKey.set(key, {
                googlePlaceId: stop.googlePlaceId,
                name: candidate?.name || stop.placeName,
                category: stop.placeCategory || 'attraction',
                address: stop.address,
                description: stop.description,
                lat: candidate?.lat ?? stop.lat,
                lng: candidate?.lng ?? stop.lng,
                hours: stop.hours,
                destinationName: candidate?.destinationName || day.destination,
              });
            }
          }
        }

        // Fetch a real photo for each unique place, reusing the same landscape /
        // highest-resolution curation as ai.suggestPlaces. Places backed by a
        // real candidate already have a verified place_id; only the (rare)
        // fallback places need the name-based lookup.
        const suggestedPlaces = await Promise.all(
          Array.from(placesByKey.values()).map(async (place) => {
            let imageUrl: string | undefined;
            if (GOOGLE_PLACES_KEY) {
              const placeId = place.googlePlaceId ?? await resolvePlaceIdByName(place.name, place.lat, place.lng, input.language);
              if (placeId) imageUrl = (await fetchCuratedPlaceDetails(placeId, input.language)).imageUrl;
            }
            return { ...place, imageUrl };
          })
        );

        return { days: correctedDays, suggestedPlaces, warnings: outcome.warnings.length > 0 ? outcome.warnings : undefined };
      }),

    /**
     * Suggest places for a destination. Order: subscription check → curated
     * catalog (server/catalog.ts, our own editorial content, no invented
     * places) → fallback flow (real Google candidates + AI curation, or a
     * fully deterministic selection if the AI step fails/times out/comes
     * back invalid). See server/catalog.ts and the deterministic-fallback
     * helpers above (buildDeterministicFallbackPlaces) for the two paths
     * that replace the old single Google+AI flow.
     */
    suggestPlaces: protectedProcedure
      .input(
        z.object({
          destinationName: z.string(),
          country: z.string().optional(),
          categories: z.array(z.string()).optional(),
          existingPlaces: z.array(z.string()).optional(),
          lat: z.number().optional(),
          lng: z.number().optional(),
          language: z.string().optional(),
          // Lets an old app build keep working: when unset/false, catalog
          // places using the new categories (park/beach/market/neighborhood)
          // are mapped back to the pre-existing category set in the response.
          categoriesV2: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Subscription check always runs before anything else, so neither the
        // catalog nor a cache hit can substitute for AI access on a free account.
        await requireActiveSubscription(ctx.user.id);
        const { destinationName, country, existingPlaces, categoriesV2 } = input;
        const debugSteps: string[] = [];
        const existingLower = new Set((existingPlaces || []).map((n) => n.toLowerCase()));

        // ── Curated catalog first ─────────────────────────────────────────
        const catalogDestination = await catalog.findCatalogDestination(destinationName, country, input.lat, input.lng);
        if (catalogDestination) {
          debugSteps.push(`catalog: matched destination "${catalogDestination.slug}"`);
          const approved = await catalog.getApprovedCuratedPlaces(catalogDestination.id);
          if (approved.length > 0) {
            let places = catalog.buildCatalogPlaceResults(approved, input.categories, input.language, categoriesV2);
            places = places.filter((p) => !existingLower.has(p.name.toLowerCase()));
            places = await catalog.fetchDetailsForTopCandidates(places, 20, input.language);
            debugSteps.push(`catalog: returning ${places.length} places`);
            console.log(`[ai.suggestPlaces] "${destinationName}": served from catalog (${places.length} places)`, debugSteps);
            return { places, debugSteps, source: 'catalog' as const };
          }
          debugSteps.push('catalog: destination matched but has no approved places — falling back');
        } else {
          debugSteps.push(catalog.CATALOG_ENABLED ? 'catalog: no match' : 'catalog: disabled');
          if (catalog.CATALOG_ENABLED) {
            await catalog.recordCatalogMiss(destinationName, country, input.language);
          }
        }

        // ── Fallback flow (destination outside the catalog, or not curated yet) ──

        // Not keyed on existingPlaces: the cached list is the destination's
        // canonical curated set, shared across users. Whichever caller's
        // existingPlaces first populates the cache may have slightly shaped
        // which places got excluded from curation, but every caller —
        // cached or not — still gets the "already added" filter applied
        // below/in the curation guard, so nobody ever sees a place they
        // already have.
        const cacheKey = [
          normalizeCacheKeyPart(destinationName),
          normalizeCacheKeyPart(country),
          normalizeCacheKeyPart(input.language),
          (input.categories ?? []).map(normalizeCacheKeyPart).sort().join(','),
        ].join('|');
        const cached = suggestPlacesCache.get(cacheKey) as { places: any[]; source: 'ai' | 'fallback' } | undefined;
        if (cached) {
          console.log(`[ai.suggestPlaces] cache hit: "${destinationName}"`);
          const places = cached.places.filter((p) => !existingLower.has(String(p.name).toLowerCase()));
          return { places, debugSteps: [...debugSteps, 'cache: hit'], source: cached.source };
        }
        console.log(`[ai.suggestPlaces] cache miss: "${destinationName}"`);

        if (!GOOGLE_PLACES_KEY) {
          console.warn(`[ai.suggestPlaces] no GOOGLE_PLACES_API_KEY configured — returning empty list for "${destinationName}"`);
          return { places: [], debugSteps: [...debugSteps, "google-places-key: missing"], source: 'fallback' as const, reason: 'no-google-key' as const };
        }

        // ── Stage 1: real candidates from Google Places ──────────────────────
        let center: { lat: number; lng: number } | null =
          input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;

        if (center) {
          debugSteps.push(`center: provided (${center.lat},${center.lng})`);
        } else {
          center = await resolveDestinationCenter(destinationName, country, input.language);
          debugSteps.push(center ? `center: resolved via text search (${center.lat},${center.lng})` : "center: failed to resolve");
        }

        if (!center) {
          console.warn(`[ai.suggestPlaces] could not resolve a center point for "${destinationName}" — returning empty list`, debugSteps);
          return { places: [], debugSteps, source: 'fallback' as const, reason: 'no-center' as const };
        }

        const candidates = await fetchRealPlaceCandidates(center.lat, center.lng, undefined, undefined, input.language);
        const candidatesByPlaceId = new Map(candidates.map((c) => [c.placeId, c]));
        debugSteps.push(`candidates: ${candidates.length} unique (after dedupe/sort/limit/closed-filter)`);

        if (candidates.length === 0) {
          console.warn(`[ai.suggestPlaces] no real candidates found near "${destinationName}"`, debugSteps);
          return { places: [], debugSteps, source: 'fallback' as const, reason: 'no-candidates' as const };
        }

        // ── Stage 2: AI curates the real list (can't invent places) ──────────
        // Capped at 25s total and, by default, without the web_search tool
        // (SUGGEST_FALLBACK_WEB_SEARCH=true opts back in) — this is the
        // fallback path for destinations outside the curated catalog, so it
        // must stay cheap and fast. Any failure here (timeout, bad JSON, the
        // hallucination guard discarding every pick) falls through to the
        // deterministic selection below instead of erroring out.
        const existingList = existingPlaces && existingPlaces.length > 0 ? existingPlaces.join(", ") : "";
        const candidatesList = candidates
          .map((c) => `[${c.placeId}] ${c.name} — tipos: ${c.types.join(", ") || "?"}, rating: ${c.rating ?? "?"}, avaliações: ${c.userRatingsTotal}${c.hasPhoto ? "" : " (sem foto)"}`)
          .join("\n");
        const languageName = getLanguageName(input.language);

        const prompt = `Você vai curar uma lista de lugares REAIS (já verificados no Google Places) para ${destinationName}${country ? `, ${country}` : ""}.

Candidatos disponíveis (${candidates.length} no total):
${candidatesList}
${existingList ? `\nExclua estes lugares que o usuário já tem: ${existingList}` : ""}

Sua tarefa:
- Escolha os MELHORES candidatos dessa lista. NÃO invente nenhum lugar que não esteja nela — use apenas os place_id fornecidos entre colchetes.
- A quantidade escolhida deve refletir a qualidade/quantidade real dos candidatos: se houver poucos candidatos bons (destino pequeno), escolha poucos (pode ser só 5-8); se houver muitos candidatos de qualidade (destino grande/turístico), escolha mais (até uns 25). NÃO force preencher um número fixo com opções fracas.
- Classifique cada escolhido em uma categoria: attraction, restaurant, cafe, museum, ou hidden_gem (hidden_gem = rating bom mas número de avaliações relativamente baixo comparado aos outros candidatos — "descoberto por poucos"), ou other.
- Escreva uma descrição de 1 frase para cada, em ${languageName}, não em português, a menos que ${languageName} seja português.

Retorne um JSON com o array "places": [{ placeId (exatamente o place_id entre colchetes do candidato escolhido), category, description }]
${SUGGEST_FALLBACK_WEB_SEARCH ? `\n${WEB_SEARCH_INSTRUCTION}` : ''}`;

        const VALID_CATEGORIES = new Set(['attraction', 'restaurant', 'cafe', 'museum', 'hidden_gem', 'other']);

        let picked: { placeId: string; category: string; description: string }[] = [];
        let source: 'ai' | 'fallback' = 'fallback';

        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: `Você é um especialista em viagens que cura listas de lugares reais já verificados no Google Places. Nunca invente lugares fora da lista fornecida. Escreva as descrições em ${languageName}, não em português, a menos que ${languageName} seja português. Responda em JSON válido.` },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
            max_tokens: 6000,
            enableWebSearch: SUGGEST_FALLBACK_WEB_SEARCH,
            timeoutMs: 25000,
          });

          const content = response.choices[0].message.content as string;
          const parsed = JSON.parse(content);
          const curated: any[] = Array.isArray(parsed.places) ? parsed.places : [];
          debugSteps.push(`ai curation: chose ${curated.length}`);

          // Guard against hallucination: only keep picks that reference a real candidate
          // and aren't in the user's existing list (in case the AI didn't fully comply).
          const validCurated = curated
            .filter((c) => typeof c?.placeId === "string" && candidatesByPlaceId.has(c.placeId))
            .filter((c) => !existingLower.has(candidatesByPlaceId.get(c.placeId)!.name.toLowerCase()))
            .map((c) => ({
              placeId: c.placeId as string,
              category: VALID_CATEGORIES.has(c.category) ? c.category : 'other',
              description: typeof c.description === 'string' ? c.description : '',
            }));
          debugSteps.push(`ai curation: ${validCurated.length} valid after guard`);

          if (validCurated.length > 0) {
            picked = validCurated;
            source = 'ai';
          }
        } catch (err) {
          console.error(`[ai.suggestPlaces] AI curation failed for "${destinationName}", using deterministic fallback:`, err);
          debugSteps.push('ai curation: failed/timed out');
        }

        if (picked.length === 0) {
          picked = buildDeterministicFallbackPlaces(candidates, existingLower, input.language, 15);
          source = 'fallback';
          debugSteps.push(`deterministic fallback: picked ${picked.length}`);
        }

        // ── Stage 3: real details (address/hours/phone/photo) for the picks only ──
        const detailed = await Promise.all(
          picked.map(async (c) => {
            const candidate = candidatesByPlaceId.get(c.placeId)!;
            const details = await fetchCuratedPlaceDetails(c.placeId, input.language);
            return {
              placeId: c.placeId,
              name: candidate.name,
              category: c.category,
              description: c.description,
              address: details.address,
              hours: details.hours,
              phone: details.phone,
              imageUrl: details.imageUrl,
            };
          })
        );
        debugSteps.push(`place-details: resolved ${detailed.filter((d) => d.address || d.imageUrl).length}/${detailed.length}`);

        // Never cache an empty result — only a real curated list is reused.
        // candidates.length > 0 at this point, so detailed is only ever empty
        // if something upstream is broken — treat that defensively as 'ai-failed'.
        if (detailed.length > 0) {
          suggestPlacesCache.set(cacheKey, { places: detailed, source }, AI_SUGGEST_PLACES_CACHE_TTL_MS);
        }

        console.log(`[ai.suggestPlaces] "${destinationName}": returning ${detailed.length} places (source=${source})`, debugSteps);
        if (detailed.length === 0) {
          return { places: detailed, debugSteps, source, reason: 'ai-failed' as const };
        }
        return { places: detailed, debugSteps, source };
      }),
    }),

  // ─── Weather ─────────────────────────────────────────────────────────────────────────────────────
  weather: router({
    /**
     * Get weather forecast for a specific location and date range.
     * Uses OpenWeatherMap 5-day/3-hour forecast API.
     * Returns one entry per day with min/max temp, description, icon, and rain probability.
     */
    forecast: publicProcedure
      .input(z.object({
        lat: z.number(),
        lon: z.number(),
        days: z.number().min(1).max(5).default(5),
      }))
      .query(async ({ input }) => {
        if (!OPENWEATHER_KEY) {
          return { days: [], available: false };
        }
        try {
          const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${input.lat}&lon=${input.lon}&appid=${OPENWEATHER_KEY}&units=metric&cnt=40`;
          const res = await fetch(url);
          if (!res.ok) return { days: [], available: false };
          const json = (await res.json()) as any;
          // Group by day
          const byDay: Record<string, any[]> = {};
          for (const item of json.list ?? []) {
            const day = item.dt_txt.split(' ')[0];
            if (!byDay[day]) byDay[day] = [];
            byDay[day].push(item);
          }
          const days = Object.entries(byDay)
            .slice(0, input.days)
            .map(([date, items]) => {
              const temps = items.map((i: any) => i.main.temp);
              const rains = items.map((i: any) => i.pop ?? 0);
              // Pick midday entry or first available
              const midday = items.find((i: any) => i.dt_txt.includes('12:00')) ?? items[0];
              return {
                date,
                tempMin: Math.round(Math.min(...temps)),
                tempMax: Math.round(Math.max(...temps)),
                description: midday.weather[0].description as string,
                icon: midday.weather[0].icon as string,
                rainProbability: Math.round(Math.max(...rains) * 100),
              };
            });
          return { days, available: true };
        } catch {
          return { days: [], available: false };
        }
      }),
  }),

  // ─── Trip Sharing ─────────────────────────────────────────────────────────────────────────────────
  sharing: router({
    /** Invite a traveler by email to access a trip */
    invite: protectedProcedure
      .input(z.object({
        tripClientId: z.string().min(1),
        email: z.string().email(),
        role: z.enum(['viewer', 'editor']).default('viewer'),
      }))
      .mutation(async ({ ctx, input }) => {
        const email = input.email.trim().toLowerCase();
        if (ctx.user.email && email === ctx.user.email.toLowerCase()) {
          throw new Error('Você não pode convidar seu próprio e-mail.');
        }
        // Check the trip belongs to the inviting user
        const trip = await db.getUserTripByClientId(ctx.user.id, input.tripClientId);
        if (!trip) throw new Error('Trip not found or not owned by you');

        // Already has an active invite for this email? Update its role instead of duplicating.
        const existingShares = await db.getTripSharesByTripId(trip.id);
        const existing = existingShares.find(
          (s) => s.inviteeEmail.toLowerCase() === email && (s.status === 'pending' || s.status === 'accepted')
        );
        if (existing) {
          if (existing.role !== input.role) {
            await db.updateTripShareRole(existing.id, input.role);
          }
          return { ok: true, token: existing.token };
        }

        // Create the share record
        const token = crypto.randomBytes(24).toString('hex');
        await db.createTripShare({
          tripId: trip.id,
          ownerId: ctx.user.id,
          inviteeEmail: email,
          role: input.role,
          token,
        });

        // Best-effort: if the invitee already has an account, let them know
        // by push. Never awaited — a slow/failed push must never delay or
        // break the invite response.
        db.getUserByEmail(email).then((invitee) => {
          if (!invitee) return;
          let tripName = '';
          try { tripName = JSON.parse(trip.data)?.name ?? ''; } catch {}
          const ownerName = ctx.user.name || ctx.user.email || '';
          sendPush([invitee.id], (language) => buildTripInviteMessage(language, ownerName, tripName));
        }).catch((err) => console.warn('[sharing.invite] push lookup failed:', err));

        return { ok: true, token };
      }),

    /** Updates the role of an existing invite sent by the current user. */
    updateRole: protectedProcedure
      .input(z.object({
        shareId: z.number(),
        role: z.enum(['viewer', 'editor']),
      }))
      .mutation(async ({ ctx, input }) => {
        // tripShares already carries ownerId, so this is one query instead
        // of loading every trip the user owns plus a share query per trip.
        const share = await db.getTripShareById(input.shareId);
        if (!share || share.ownerId !== ctx.user.id) throw new Error('Share not found or not owned by you');
        await db.updateTripShareRole(input.shareId, input.role);
        return { ok: true };
      }),

    /**
     * Lets an editor save their changes into the owner's trip. Only the
     * top-level sections present in `patch` are touched — everything else
     * (including concurrent edits from the owner or another editor on a
     * different section) is preserved. See server/sharing/trip-merge.ts.
     */
    saveSharedTrip: protectedProcedure
      .input(z.object({
        shareId: z.number(),
        patch: z.record(z.string(), z.unknown()),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!SHARED_EDITING_ENABLED) {
          throw new Error('A edição compartilhada está temporariamente desativada. Tente novamente mais tarde.');
        }
        if (JSON.stringify(input.patch).length > MAX_PATCH_JSON_LENGTH) {
          throw new Error('Alteração muito grande para ser enviada.');
        }
        const share = await db.getTripShareById(input.shareId);
        const saveError = getSharedTripSaveError(
          share
            ? {
                status: share.status,
                hiddenByInvitee: share.hiddenByInvitee,
                role: share.role,
                inviteeUserId: share.inviteeUserId,
                inviteeEmail: share.inviteeEmail,
              }
            : null,
          { id: ctx.user.id, email: ctx.user.email ?? null }
        );
        if (saveError) throw new Error(saveError);
        const sanitized = sanitizeTripPatch(input.patch);
        const { data, updatedAt } = await db.applyTripPatch(share!.tripId, sanitized);
        return { tripData: data, updatedAt: updatedAt.toISOString() };
      }),

    /** Accept a trip share invite via token */
    accept: protectedProcedure
      .input(z.object({ token: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const share = await db.getTripShareByToken(input.token);
        if (!share) throw new Error('Invite not found or already used');
        // Accept the share
        await db.acceptTripShare(share.token, ctx.user.id);
        // Get the trip clientId
        const userTrips = await db.getUserTrips(share.ownerId);
        const trip = userTrips.find((t) => t.id === share.tripId);
        return { ok: true, tripClientId: trip?.clientId ?? '' };
      }),

    /** List all trips shared with the current user */
    listSharedWithMe: protectedProcedure.query(async ({ ctx }) => {
      const email = ctx.user.email ?? '';
      const sharedTrips = await db.getSharedTripsForUser(ctx.user.id, email);
      return sharedTrips.map((s) => ({
        shareId: s.shareId,
        tripClientId: s.clientId ?? '',
        tripData: s.data ?? '',
        shareRole: s.shareRole ?? 'viewer',
      }));
    }),

    /** List pending invites addressed to the current user */
    listPendingForMe: protectedProcedure.query(async ({ ctx }) => {
      const email = ctx.user.email ?? '';
      const pending = await db.getPendingSharesForUser(ctx.user.id, email);
      return pending.map((s) => ({
        shareId: s.shareId,
        token: s.token,
        tripClientId: s.tripClientId,
        tripData: s.tripData,
        role: s.role,
        ownerName: s.ownerName,
      }));
    }),

    /** Decline a pending invite */
    decline: protectedProcedure
      .input(z.object({ shareId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.declineTripShare(input.shareId, ctx.user.id, ctx.user.email ?? '');
        return { ok: true };
      }),

    /** Hide a shared trip from the invitee's own view, without affecting the owner or other invitees */
    hideForMe: protectedProcedure
      .input(z.object({ shareId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.hideTripShareForInvitee(input.shareId, ctx.user.id, ctx.user.email ?? '');
        return { ok: true };
      }),

    /** List all shares the current user has sent (as owner) */
    listSentByMe: protectedProcedure
      .input(z.object({ tripClientId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const trip = await db.getUserTripByClientId(ctx.user.id, input.tripClientId);
        if (!trip) return [];
        const shares = await db.getTripSharesByTripId(trip.id);
        return shares.map((s) => ({
          shareId: s.id,
          inviteeEmail: s.inviteeEmail,
          role: s.role,
          status: s.status,
        }));
      }),

    /** Revoke a share */
    revoke: protectedProcedure
      .input(z.object({ shareId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.revokeTripShare(input.shareId, ctx.user.id);
        return { ok: true };
      }),
  }),

  // ─── Trip content translation ────────────────────────────────────────────────────────────────────
  trip: router({
    /** Translates a single trip's name, Info tab, and place descriptions into `targetLanguage`. */
    translateContent: protectedProcedure
      .input(z.object({ tripId: z.string().min(1), targetLanguage: z.string().min(2).max(8) }))
      .mutation(async ({ ctx, input }) => {
        const result = await translateTripContent(ctx.user.id, input.tripId, input.targetLanguage);
        if (!result.ok) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Não foi possível traduzir o conteúdo da viagem. Tente novamente.",
          });
        }
        return result;
      }),

    /**
     * Translates every trip belonging to the user whose content isn't already
     * in `targetLanguage`. Fired in the background right after a language
     * switch, so it runs with bounded concurrency rather than all at once.
     */
    translateAllContent: protectedProcedure
      .input(z.object({ targetLanguage: z.string().min(2).max(8) }))
      .mutation(async ({ ctx, input }) => {
        const rows = await db.getUserTripsNeedingTranslation(ctx.user.id, input.targetLanguage);
        const results = await mapWithConcurrency(rows, 4, (row) =>
          translateTripContent(ctx.user.id, row.clientId, input.targetLanguage),
        );
        return { results };
      }),
  }),

  // ─── Cloud Trip Sync ──────────────────────────────────────────────────────────────────────────────
  cloudTrips: router({
    /** Fetch all trips for the authenticated user. Returns array of { clientId, data } */
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await db.getUserTrips(ctx.user.id);
      return rows.map((r) => ({ clientId: r.clientId, data: r.data, updatedAt: r.updatedAt.toISOString() }));
    }),

    /**
     * Fetch a single owned trip's current server state by clientId, so the
     * owner's device can check whether an editor saved something newer
     * without re-downloading every trip. Returns null if not found.
     */
    get: protectedProcedure
      .input(z.object({ clientId: z.string().min(1).max(64) }))
      .query(async ({ ctx, input }) => {
        const found = await db.getTripByClientId(ctx.user.id, input.clientId);
        if (!found) return null;
        return { data: found.data, updatedAt: found.updatedAt.toISOString() };
      }),

    /** Upsert a single trip (create or update by clientId). */
    upsert: protectedProcedure
      .input(z.object({
        clientId: z.string().min(1).max(64),
        data: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        // The Trip JSON itself may carry the language its content was authored
        // in (set client-side at creation) — mirror it into its own column so
        // trip.translateAllContent can cheaply find what needs re-translating.
        let contentLanguage: string | undefined;
        try {
          const parsed = JSON.parse(input.data);
          if (typeof parsed?.contentLanguage === "string") contentLanguage = parsed.contentLanguage;
        } catch {
          // Malformed JSON is caught/handled elsewhere; just skip the language extraction here.
        }
        await db.upsertTrip(ctx.user.id, input.clientId, input.data, contentLanguage);
        return { ok: true };
      }),

    /**
     * Partial update by clientId: only the top-level sections present in
     * `patch` are merged into the stored trip (see server/sharing/trip-merge.ts)
     * instead of overwriting the whole row — this is what lets an editor's
     * concurrent sharing.saveSharedTrip on a different section survive the
     * owner's own save of this same trip. The trip must already exist
     * (created via `upsert`); this never creates a new row.
     */
    patch: protectedProcedure
      .input(z.object({
        clientId: z.string().min(1).max(64),
        patch: z.record(z.string(), z.unknown()),
      }))
      .mutation(async ({ ctx, input }) => {
        if (JSON.stringify(input.patch).length > MAX_PATCH_JSON_LENGTH) {
          throw new Error('Alteração muito grande para ser enviada.');
        }
        const found = await db.getTripByClientId(ctx.user.id, input.clientId);
        if (!found) throw new Error('Trip not found');
        const sanitized = sanitizeTripPatch(input.patch);
        const { data, updatedAt } = await db.applyTripPatch(found.id, sanitized);
        return { data, updatedAt: updatedAt.toISOString() };
      }),

    /** Delete a trip by clientId. */
    delete: protectedProcedure
      .input(z.object({ clientId: z.string().min(1).max(64) }))
      .mutation(async ({ ctx, input }) => {
        await db.deleteTripByClientId(ctx.user.id, input.clientId);
        return { ok: true };
      }),
  }),

  // ─── Trip Documents ───────────────────────────────────────────────────────────────────────────────
  tripDocuments: router({
    /** Uploads a trip document (photo or PDF) to Supabase Storage and returns its URL. */
    upload: protectedProcedure
      .input(z.object({
        tripId: z.string().min(1).max(64),
        fileName: z.string().min(1).max(200),
        contentType: z.string().min(1).max(100),
        base64Data: z.string().min(1).max(28_000_000), // ~20MB decoded
      }))
      .mutation(async ({ ctx, input }) => {
        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const key = `trip-documents/${ctx.user.id}/${input.tripId}/${safeName}`;
        const buffer = Buffer.from(input.base64Data, "base64");

        try {
          const { url } = await storagePut(key, buffer, input.contentType);
          return { url };
        } catch (err) {
          console.error("[tripDocuments.upload] failed:", err);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Falha ao enviar o arquivo." });
        }
      }),
  }),
});
export type AppRouter = typeof appRouter;
