import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { ENV } from "./_core/env";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { searchIslands } from "../constants/islands-regions";
import * as db from "./db";
import crypto from "crypto";
import { storagePut } from "./storage";
import { getSupabaseAdmin } from "./_core/supabaseAdmin";
import { prepareCandidatePool } from "./itinerary/candidates";
import { buildDurationGuidancePromptBlock } from "./itinerary/duration";
import { validateAndCorrectItinerary, findEmptyDays, type MustVisitPlace, type FillerRestaurantCandidate } from "./itinerary/validate";
import { buildItineraryDaysSchema, buildMinimalDaySchema, buildMinimalTripSchema } from "./itinerary/schema";
import { buildDayDescriptors, assignMustVisitToDays, type DayDescriptor, type AssignableMustVisit } from "./itinerary/day-descriptors";
import { withOneRepairAttempt } from "./itinerary/repair";
import { runIndependentPreparationSteps } from "./itinerary/prepare";
import { filterHallucinatedStops } from "./itinerary/guard";
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

import { GOOGLE_PLACES_KEY, mapToGoogleLanguage, pickBestGooglePhoto, resolveGooglePhotoUrl, fetchCuratedPlaceDetails, resolvePlacesLocationBias, resolveLocalLanguageForCountry } from "./google-places";
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
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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
/** Matches the concurrency already used for Place Details-style backfills elsewhere in the itinerary pipeline (server/itinerary/candidates.ts's backfillCatalogGoogleData, validate.ts's TRAVEL_FETCH_CONCURRENCY) — kept consistent rather than picking a new number without quota data to justify a different one. */
const OPENING_HOURS_FETCH_CONCURRENCY = 6;

export async function fetchOpeningHoursForTopCandidates<T extends { placeId: string; hoursText?: string }>(
  candidates: T[],
  limit: number,
  language?: string,
): Promise<T[]> {
  if (!GOOGLE_PLACES_KEY) return candidates;
  const top = candidates.slice(0, limit);
  // Bounded concurrency (previously an unlimited `Promise.all` over up to
  // `limit` candidates at once — up to 40 simultaneous Place Details
  // requests) instead of one-at-a-time: still fully parallel, just capped,
  // same worker-pool helper already used elsewhere in this file.
  await mapWithConcurrency(top, OPENING_HOURS_FETCH_CONCURRENCY, async (c) => {
    const details = await fetchCuratedPlaceDetails(c.placeId, language);
    if (details.hours) c.hoursText = details.hours;
  });
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

/** Matches the concurrency already used for other Place Details-style fan-outs in this file (OPENING_HOURS_FETCH_CONCURRENCY, validate.ts's TRAVEL_FETCH_CONCURRENCY). */
const STOP_RESOLUTION_CONCURRENCY = 6;

interface StopResolution {
  resolved: boolean;
  googlePlaceId?: string;
  lat?: number;
  lng?: number;
  address?: string;
  hoursText?: string;
}

/**
 * Verifies a single AI-proposed stop (name only, no pre-fetched candidate)
 * against a real Google Place. This is ai.generateFromScratch's "direct
 * generation" replacement for the old pre-fetched-candidate hallucination
 * guard (server/itinerary/guard.ts, still used by ai.generateItinerary):
 * instead of checking a googlePlaceId against a list fetched BEFORE
 * generation, it does a live Find Place From Text + Place Details lookup
 * AFTER generation. `resolved: false` (Google can't find a real match) means
 * the caller should treat the stop as unverifiable — never invent/keep it
 * anyway just because the model sounded confident.
 */
export async function resolveAndVerifyStop(
  placeName: string,
  biasLat: number | undefined,
  biasLng: number | undefined,
  language: string | undefined,
): Promise<StopResolution> {
  if (!placeName || !GOOGLE_PLACES_KEY) return { resolved: false };
  const placeId = await resolvePlaceIdByName(placeName, biasLat, biasLng, language);
  if (!placeId) return { resolved: false };
  const details = await fetchCuratedPlaceDetails(placeId, language);
  if (details.lat == null || details.lng == null) return { resolved: false };
  return { resolved: true, googlePlaceId: placeId, lat: details.lat, lng: details.lng, address: details.address, hoursText: details.hours };
}

/**
 * Resolves and verifies every AI-proposed stop across all days against real
 * Google Places data, bounded concurrency. Stops matching a user-selected or
 * resolved must-see place by name (`trustedNamesLower`) are passed through
 * untouched — they were already trusted/verified earlier (same as before
 * this redesign) and are never re-checked here. An unresolved, untrusted
 * stop is dropped (counted in `droppedCount`) rather than kept with
 * unverified data.
 */
export async function resolveAndVerifyStops(
  days: any[],
  opts: { trustedNamesLower: Set<string>; biasLat?: number; biasLng?: number; language?: string },
): Promise<{ days: any[]; droppedCount: number; resolvedCount: number; hoursByPlaceId: Map<string, string> }> {
  const candidateStops = days.flatMap((day) => (day.stops || [])).filter(
    (stop: any) => stop.placeName && !opts.trustedNamesLower.has(String(stop.placeName).toLowerCase()),
  );

  const resolutions = new Map<any, StopResolution>();
  await mapWithConcurrency(candidateStops, STOP_RESOLUTION_CONCURRENCY, async (stop: any) => {
    resolutions.set(stop, await resolveAndVerifyStop(stop.placeName, opts.biasLat, opts.biasLng, opts.language));
  });

  const hoursByPlaceId = new Map<string, string>();
  let droppedCount = 0;
  let resolvedCount = 0;

  const patchedDays = days.map((day) => {
    const stops = (day.stops || [])
      .map((stop: any) => {
        if (!stop.placeName) return null;
        if (opts.trustedNamesLower.has(String(stop.placeName).toLowerCase())) return stop;

        const resolution = resolutions.get(stop);
        if (!resolution?.resolved) {
          droppedCount++;
          return null;
        }
        resolvedCount++;
        if (resolution.hoursText && resolution.googlePlaceId) hoursByPlaceId.set(resolution.googlePlaceId, resolution.hoursText);
        return {
          ...stop,
          googlePlaceId: resolution.googlePlaceId,
          lat: resolution.lat ?? stop.lat,
          lng: resolution.lng ?? stop.lng,
          address: resolution.address ?? stop.address,
          hours: resolution.hoursText ?? stop.hours,
        };
      })
      .filter(Boolean);
    return { ...day, stops };
  });

  return { days: patchedDays, droppedCount, resolvedCount, hoursByPlaceId };
}

/** Google Places "type" to bias a same-category substitution search when an AI-chosen stop can't be verified as real. Approximate — good enough to keep a substitute thematically close, not an exact category mirror. */
const SUBSTITUTION_GOOGLE_TYPE: Record<string, string> = {
  attraction: "tourist_attraction",
  restaurant: "restaurant",
  cafe: "cafe",
  museum: "museum",
  hidden_gem: "tourist_attraction",
  park: "park",
  beach: "tourist_attraction",
  market: "shopping_mall",
  neighborhood: "tourist_attraction",
  other: "tourist_attraction",
};

/**
 * Finds a real, same-category replacement for a stop whose AI-proposed name
 * could not be verified against Google Places, instead of just dropping it.
 * Picks the top-ranked (rating × log10(reviews)) nearby candidate of a
 * matching Google type that isn't already used elsewhere in the trip.
 * Returns null if no suitable candidate exists — callers must still fall
 * back to dropping the stop in that case, now with an explicit warning
 * instead of silence.
 */
async function findSubstitutePlace(
  category: string,
  biasLat: number | undefined,
  biasLng: number | undefined,
  usedKeysLower: Set<string>,
  language: string | undefined,
): Promise<{ googlePlaceId: string; name: string; lat?: number; lng?: number; address?: string; hoursText?: string } | null> {
  if (!GOOGLE_PLACES_KEY || biasLat == null || biasLng == null) return null;
  const googleType = SUBSTITUTION_GOOGLE_TYPE[category] || "tourist_attraction";
  const candidates = await nearbySearchCandidates(biasLat, biasLng, googleType, 5000, language);
  const best = candidates
    .filter((c) => c.businessStatus !== "CLOSED_PERMANENTLY" && c.businessStatus !== "CLOSED_TEMPORARILY")
    .filter((c) => !usedKeysLower.has(c.placeId.toLowerCase()) && !usedKeysLower.has(c.name.toLowerCase()))
    .sort((a, b) => (b.rating ?? 3.5) * Math.log10(b.userRatingsTotal + 1) - (a.rating ?? 3.5) * Math.log10(a.userRatingsTotal + 1))[0];
  if (!best) return null;
  const details = await fetchCuratedPlaceDetails(best.placeId, language);
  if (details.lat == null || details.lng == null) return null;
  return { googlePlaceId: best.placeId, name: best.name, lat: details.lat, lng: details.lng, address: details.address, hoursText: details.hours };
}

/**
 * Same verification as resolveAndVerifyStops, but an AI-chosen stop that
 * can't be matched to a real place is given one chance at a same-category
 * substitution (findSubstitutePlace) before being dropped — losing a place
 * no longer silently shrinks a day's plan when a credible real alternative
 * exists nearby. A stop that fails BOTH verification and substitution is
 * still dropped, but now with an explicit warning instead of silence (the
 * failure-isolation redesign — see the generateFromScratch rewrite notes).
 */
export async function resolveAndVerifyStopsWithSubstitution(
  days: any[],
  opts: {
    trustedNamesLower: Set<string>;
    biasLat?: number;
    biasLng?: number;
    language?: string;
    biasByDayNumber?: Map<number, { lat?: number; lng?: number }>;
  },
): Promise<{ days: any[]; droppedCount: number; resolvedCount: number; substitutedCount: number; hoursByPlaceId: Map<string, string>; warnings: string[] }> {
  const usedKeysLower = new Set<string>();
  for (const day of days) {
    for (const stop of day.stops || []) {
      if (!stop.placeName) continue;
      if (stop.googlePlaceId) usedKeysLower.add(String(stop.googlePlaceId).toLowerCase());
      usedKeysLower.add(String(stop.placeName).toLowerCase());
    }
  }

  const candidateStops = days.flatMap((day) => (day.stops || []).map((stop: any) => ({ stop, day }))).filter(
    ({ stop }) => stop.placeName && !opts.trustedNamesLower.has(String(stop.placeName).toLowerCase()),
  );

  const warnings: string[] = [];
  const hoursByPlaceId = new Map<string, string>();
  let droppedCount = 0;
  let resolvedCount = 0;
  let substitutedCount = 0;
  const resolutions = new Map<any, { kept: boolean; placeName?: string; description?: string; googlePlaceId?: string; lat?: number; lng?: number; address?: string; hoursText?: string }>();

  await mapWithConcurrency(candidateStops, STOP_RESOLUTION_CONCURRENCY, async ({ stop, day }) => {
    const bias = opts.biasByDayNumber?.get(day.dayNumber);
    const biasLat = bias?.lat ?? opts.biasLat;
    const biasLng = bias?.lng ?? opts.biasLng;

    const resolution = await resolveAndVerifyStop(stop.placeName, biasLat, biasLng, opts.language);
    if (resolution.resolved) {
      resolvedCount++;
      if (resolution.hoursText && resolution.googlePlaceId) hoursByPlaceId.set(resolution.googlePlaceId, resolution.hoursText);
      if (resolution.googlePlaceId) usedKeysLower.add(resolution.googlePlaceId.toLowerCase());
      resolutions.set(stop, { kept: true, googlePlaceId: resolution.googlePlaceId, lat: resolution.lat, lng: resolution.lng, address: resolution.address, hoursText: resolution.hoursText });
      return;
    }

    const substitute = await findSubstitutePlace(stop.placeCategory, biasLat, biasLng, usedKeysLower, opts.language);
    if (substitute) {
      substitutedCount++;
      usedKeysLower.add(substitute.googlePlaceId.toLowerCase());
      usedKeysLower.add(substitute.name.toLowerCase());
      if (substitute.hoursText) hoursByPlaceId.set(substitute.googlePlaceId, substitute.hoursText);
      warnings.push(`Substituted "${stop.placeName}" (could not verify as a real place) with "${substitute.name}" on day ${day.dayNumber ?? "?"}`);
      resolutions.set(stop, {
        kept: true,
        googlePlaceId: substitute.googlePlaceId,
        lat: substitute.lat,
        lng: substitute.lng,
        address: substitute.address,
        hoursText: substitute.hoursText,
        placeName: substitute.name,
        description: genericCategoryDescription(stop.placeCategory || "other", opts.language),
      });
      return;
    }

    droppedCount++;
    warnings.push(`Removed "${stop.placeName}" on day ${day.dayNumber ?? "?"} — could not verify as a real place and no suitable alternative was found nearby`);
    resolutions.set(stop, { kept: false });
  });

  const patchedDays = days.map((day) => {
    const stops = (day.stops || [])
      .map((stop: any) => {
        if (!stop.placeName) return null;
        if (opts.trustedNamesLower.has(String(stop.placeName).toLowerCase())) return stop;
        const outcome = resolutions.get(stop);
        if (!outcome?.kept) return null;
        return {
          ...stop,
          placeName: outcome.placeName ?? stop.placeName,
          description: outcome.description ?? stop.description,
          googlePlaceId: outcome.googlePlaceId,
          lat: outcome.lat ?? stop.lat,
          lng: outcome.lng ?? stop.lng,
          address: outcome.address ?? stop.address,
          hours: outcome.hoursText ?? stop.hours,
        };
      })
      .filter(Boolean);
    return { ...day, stops };
  });

  return { days: patchedDays, droppedCount, resolvedCount, substitutedCount, hoursByPlaceId, warnings };
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

// NOTE: a separate, schema-free web-search "pre-screen" LLM call (a
// gpt-5-mini helper with enableWebSearch, formerly defined just above this
// comment) used to run BEFORE the main itinerary call in both ai.generateItinerary and
// ai.generateFromScratch, folding its free-text output into the prompt as
// "dê peso extra a eles". Removed (itinerary-engine latency pass): it was a
// full extra round-trip — the single largest, least-bounded latency
// contributor per generation (web-search tool calls have no documented
// upper bound) — for a result the main call's own training-knowledge
// judgment already covers once the prompt explicitly asks for it (see
// CANDIDATE_JUDGMENT_GUIDANCE_BLOCK below). The main call still grounds
// every stop in a real candidate (Google Places + curated catalog) or a
// resolved must-see/selected place; it just no longer waits on a second
// model call to tell it which of those candidates are "really" good.

/**
 * Explicit judgment instruction for the main itinerary-generation call. The
 * real-candidates list is pre-ordered by rankCandidates (interest match,
 * quality, editorial affinity, popularity — server/itinerary/scoring.ts) so
 * the model doesn't have to scan an unordered 180-candidate list, but that
 * order is a SIGNAL, not a mandate: the previous prompt wording ("prefira os
 * primeiros da lista") nudged the model straight back toward popularity-
 * ordered picks even after the ranking/catalog work. This tells it instead
 * to apply its own real-world judgment (authenticity, local reputation,
 * cuisine fit, budget fit) and pick further down the list when that's
 * genuinely the better choice — while keeping the hard grounding constraint
 * intact (only real candidates/must-visit places, never an invented name,
 * rating, price or hour).
 */
const CANDIDATE_JUDGMENT_GUIDANCE_BLOCK = `A ordem da lista de candidatos reais é apenas um sinal de popularidade/afinidade declarada (avaliações, catálogo editorial, interesses do viajante) — NÃO é um ranking de qualidade real nem uma ordem obrigatória de escolha. Use seu próprio conhecimento sobre o destino (autenticidade, reputação real entre moradores/conhecedores, culinária típica, adequação ao orçamento e às preferências declaradas do viajante) para decidir quais desses candidatos realmente valem a pena — mesmo que isso signifique escolher um candidato mais abaixo na lista em vez de um mais acima. NUNCA escolha um lugar só porque está no topo da lista ou tem mais avaliações: avalie se ele é genuinamente a melhor escolha para ESSE viajante específico. Mesmo assim, sua escolha final deve se limitar aos lugares que aparecem nas listas de candidatos reais e de lugares obrigatórios — nunca invente nomes de estabelecimentos, avaliações, preços ou horários que não estejam nessas listas ou nos dados fornecidos.`;

/** Quick, approximate travel-time/mode estimate is enough — real values always get recalculated right after generation via the Google Routes API (server/itinerary/routes.ts), so asking the model to compute them precisely just burns output tokens on throwaway work. The fields stay in the prompt (not dropped) as a fallback for the rare case the Routes/Directions call itself fails. */
const TRAVEL_FIELDS_ESTIMATE_NOTE = `Esses campos (travelTimeToNext/travelModeToNext) são apenas uma estimativa rápida de referência — não gaste esforço calculando-os com precisão, pois serão recalculados automaticamente com dados reais de rota logo depois da geração.`;

/**
 * Replaces CANDIDATE_JUDGMENT_GUIDANCE_BLOCK for ai.generateFromScratch's
 * "direct generation" flow: there is no pre-fetched candidate list at all
 * here (see the redesign note above the endpoint's candidate-fetch step),
 * so the model picks every place purely from its own knowledge. Grounding
 * moves from "only pick from this list" (pre-hoc) to "every pick gets
 * checked against real Google Places data afterward, and is dropped if it
 * can't be verified" (post-hoc, resolveAndVerifyStops below) — this block
 * sets the model's side of that contract: real/verifiable names, and never
 * assert a fact (hours/price/rating) it isn't sure of.
 */
const DIRECT_GENERATION_GROUNDING_BLOCK = `Você tem liberdade total para escolher, usando seu próprio conhecimento real sobre o destino, quais atrações, bairros, restaurantes e experiências locais incluir — não existe uma lista de candidatos pré-selecionada para seguir.

Regras de confiabilidade, não negociáveis:
- Escolha SOMENTE lugares reais que você tem boa confiança que existem de fato (estabelecimentos conhecidos, verificáveis em fontes como Google Maps/guias de viagem) — NUNCA invente o nome de um lugar.
- Para cada lugar, use o nome exato e completo como ele aparece publicamente (não abrevie, não traduza nomes próprios).
- NÃO afirme horário de funcionamento, preço, nota/avaliação ou qualquer fato específico que você não tenha certeza de que é real — se não tiver certeza, não mencione esse dado (trate como desconhecido em vez de apresentá-lo como confirmado). O sistema confirma esses dados automaticamente depois, a partir de uma fonte verificada.
- Dê prioridade a experiências autênticas e de qualidade, não apenas aos pontos turísticos mais óbvios — e a restaurantes que reflitam a culinária/cultura gastronômica real do destino, compatíveis com o orçamento e as preferências do viajante.`;

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
        // Optional geographic bias (e.g. the trip's destination center) —
        // old clients that never send these get byte-for-byte the same
        // unbiased request as before. Google's `location`+`radius` (without
        // `strictbounds`) is a SOFT bias, never a hard restriction: a
        // clearly-better match outside the radius can still surface, which
        // is what "não limitar indevidamente a busca a um raio muito
        // pequeno" calls for — this fixes "hotel search returns results from
        // a different region" without risking false negatives for a large
        // destination region.
        biasLat: z.number().optional(),
        biasLng: z.number().optional(),
        biasRadiusMeters: z.number().optional(),
      }))
      .query(async ({ input }) => {
        if (!GOOGLE_PLACES_KEY) return { predictions: [] };

        const makeUrl = (types: string) => {
          const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
          url.searchParams.set("input", input.query);
          url.searchParams.set("types", types);
          url.searchParams.set("language", mapToGoogleLanguage(input.language));
          const bias = resolvePlacesLocationBias(input.biasLat, input.biasLng, input.biasRadiusMeters);
          if (bias) {
            url.searchParams.set("location", bias.location);
            url.searchParams.set("radius", bias.radius);
          }
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
        // Per-stage wall-clock breakdown (spec: observability for the
        // latency-optimization pass) alongside the pre-existing LLM
        // call/token counters — no stage here duplicates an existing
        // counter, it only times stages telemetry.llmCalls/promptTokens/
        // completionTokens didn't already cover.
        const telemetry = {
          llmCalls: 0,
          promptTokens: 0,
          completionTokens: 0,
          candidateFetchMs: 0,
          prepStepsMs: 0,
          llmMainCallMs: 0,
          repairCallMs: 0,
          validateMs: 0,
        };

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
        const candidateFetchStartedAt = Date.now();
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
        telemetry.candidateFetchMs = Date.now() - candidateFetchStartedAt;
        if (excludedCount > 0) {
          console.log(`[ai.generateItinerary] filtered out ${excludedCount} candidate(s) matching the user's avoid list`);
        }
        console.log(`[ai.generateItinerary] candidate pool: ${extraCandidates.length} (of ${totalBeforeCap} ranked before cap), ${catalogCount} from curated catalog`);

        // Independent prep I/O — opening hours (backfills extraCandidates in
        // place), must-see resolution, and weather/daylight lookup don't
        // depend on each other's output, so they run concurrently instead of
        // one after another (previously 3 sequential round-trips; a 4th,
        // the web-search pre-screen call, has been removed entirely — see
        // the note above CANDIDATE_JUDGMENT_GUIDANCE_BLOCK). Catalog
        // candidates' hours/lat/lng were already best-effort backfilled
        // inside prepareCandidatePool — fetchOpeningHoursForTopCandidates
        // here additionally covers Google-only candidates, which never
        // needed that backfill for lat/lng (Nearby Search already returns
        // it) but still need opening hours.
        const destCenter = destinations.find((d) => d.lat != null && d.lng != null);
        const prepStepsStartedAt = Date.now();
        const { resolvedMustSee, weatherBlock } = await runIndependentPreparationSteps({
          fetchOpeningHours: () => fetchOpeningHoursForTopCandidates(extraCandidates, 40, input.language),
          resolveMustSee: () => resolveMustSeePlace(preferences?.mustSee, destCenter?.lat, destCenter?.lng, input.language),
          buildWeatherBlock: () => buildWeatherBlockForDestinations(startDate, destinations, accommodation),
        });
        telemetry.prepStepsMs = Date.now() - prepStepsStartedAt;
        const hoursByPlaceId = new Map(extraCandidates.filter((c) => c.hoursText).map((c) => [c.placeId, c.hoursText!]));

        const realCandidatesSummary = extraCandidates.length > 0
          ? `\nLugares reais e verificados disponíveis${hasSelectedPlaces ? ' para completar o roteiro além dos obrigatórios acima' : ''} (use o nome EXATAMENTE como aparece na lista; NÃO invente nenhum lugar fora desta lista${hasSelectedPlaces ? ' nem da lista de obrigatórios' : ''}):\n${extraCandidates.map((c) => `[${c.placeId}] ${c.name} (${c.destinationName})${c.rating ? `, rating ${c.rating}` : ''}${c.hoursText ? `, horário: ${c.hoursText.replace(/\n/g, ' | ')}` : ''}${c.source === 'catalog' ? ` [recomendação editorial local${c.curatedDescription ? `: ${c.curatedDescription}` : ''}]` : ''}`).join("\n")}`
          : '';

        // Deterministic geographic clustering (server/itinerary/clustering.ts,
        // spec "Stage 4") — a suggested day→zone split per destination, fed
        // to the model as extra planning context instead of an unordered
        // candidate list. Advisory only: never removes a candidate, and the
        // model/validator can still override it for a hard constraint.
        const clusteringBlock = buildClusteringBlockForDestinations(destinations, extraCandidates, accommodation);

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
${placesSummary}${resolvedMustSee ? `\nLugar adicional OBRIGATÓRIO (mencionado pelo usuário, verificado como real): ${resolvedMustSee.name}${resolvedMustSee.address ? `, endereço: ${resolvedMustSee.address}` : ''}, coordenadas: ${resolvedMustSee.lat},${resolvedMustSee.lng}. Inclua-o em algum dia, respeitando horário de funcionamento e tempo disponível.` : ''}${realCandidatesSummary}${clusteringBlock}${weatherBlock}
${hotelBlock}

${CANDIDATE_JUDGMENT_GUIDANCE_BLOCK}

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
- O travelModeToNext deve refletir o meio de transporte preferido: ${cityTransportMode || 'driving'}. Mesmo assim, se duas paradas consecutivas estiverem a uma distância curta (menos de ~1km / menos de 15 min a pé), recomende travelModeToNext como 'walking' independente do meio de transporte geral escolhido. ${TRAVEL_FIELDS_ESTIMATE_NOTE}
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
          const llmCallStartedAt = Date.now();
          const response = await invokeLLM({
            messages: [
              { role: "system", content: "Você é um guia de viagens especialista. Crie roteiros detalhados, práticos e culturalmente ricos. Responda sempre em JSON válido." },
              { role: "user", content: repairBlock ? `${prompt}${repairBlock}` : prompt },
            ],
            outputSchema: { name: "itinerary_days", schema: buildItineraryDaysSchema({ dayTipField: "tips" }), strict: true },
            max_tokens: 16000,
            timeoutMs: 45000,
          });
          // repairBlock is only set on the one possible extra call
          // withOneRepairAttempt makes (server/itinerary/repair.ts) — timing
          // it separately from the first call keeps the breakdown meaningful
          // even when a repair happens.
          if (repairBlock) telemetry.repairCallMs += Date.now() - llmCallStartedAt;
          else telemetry.llmMainCallMs += Date.now() - llmCallStartedAt;
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

          // Hallucination guard: drop any AI-added stop whose googlePlaceId
          // isn't a real candidate and whose name doesn't match a
          // user-selected or must-visit place. Shared with
          // ai.generateFromScratch (server/itinerary/guard.ts).
          const allowedNamesLower = new Set<string>([...selectedNamesLower, ...mustSeeNamesLower]);
          const { days: patchedDays, droppedCount: droppedHallucinatedStops } = filterHallucinatedStops(rawDays, {
            candidatesByPlaceId,
            allowedNamesLower,
            hasCandidatePool: extraCandidates.length > 0,
          });
          if (droppedHallucinatedStops > 0) {
            console.warn(`[ai.generateItinerary] dropped ${droppedHallucinatedStops} stop(s) that referenced places outside the real candidates / selected-places lists`);
          }

          const validateStartedAt = Date.now();
          const { days: correctedDays, warnings } = await validateAndCorrectItinerary(patchedDays, {
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
          // Accumulates across the first attempt AND the repair attempt (if
          // any) — validateAndCorrectItinerary, including its Google Routes
          // calls, runs once per generateAndValidate call either way.
          telemetry.validateMs += Date.now() - validateStartedAt;
          return { result: correctedDays, warnings };
        };

        const outcome = await withOneRepairAttempt(generateAndValidate);
        const totalMs = Date.now() - generationStartedAt;
        console.log(
          `[ai.generateItinerary] telemetry: totalMs=${totalMs} llmCalls=${telemetry.llmCalls} promptTokens=${telemetry.promptTokens} completionTokens=${telemetry.completionTokens} candidatePool=${extraCandidates.length}(catalog=${catalogCount},rankedBeforeCap=${totalBeforeCap},excludedByAvoid=${excludedCount}) repairAttempted=${outcome.repairAttempted} repairUsed=${outcome.repairUsed} unresolvedWarnings=${outcome.warnings.length}`,
        );
        // Structured per-stage timing breakdown (ms) — no secrets/user
        // content, just counts and durations, safe to leave in production
        // logs. repairCallMs/llmMainCallMs stay 0 when that stage didn't
        // run (e.g. repairCallMs when no repair happened).
        console.log(
          `[ai.generateItinerary] timings: ${JSON.stringify({
            candidateFetchMs: telemetry.candidateFetchMs,
            prepStepsMs: telemetry.prepStepsMs,
            llmMainCallMs: telemetry.llmMainCallMs,
            repairCallMs: telemetry.repairCallMs,
            validateMs: telemetry.validateMs,
            totalMs,
          })}`,
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
        // Per-stage wall-clock breakdown for the single-call redesign:
        // generationMs is the one whole-trip planning call's own duration.
        // placeResolutionMs/suggestedPlacesPhotoMs are specific to this
        // endpoint (ai.generateItinerary doesn't have either).
        const telemetry = {
          llmCalls: 0,
          promptTokens: 0,
          completionTokens: 0,
          candidateFetchMs: 0,
          prepStepsMs: 0,
          generationMs: 0,
          planningCallMs: 0,
          planningRetried: false,
          planningFailedOutright: false,
          fallbackDaysUsed: [] as number[],
          fallbackCallsMs: [] as number[],
          fallbackDaysFailed: [] as number[],
          retried: false,
          placeResolutionMs: 0,
          validateMs: 0,
          suggestedPlacesPhotoMs: 0,
          stopsResolved: 0,
          stopsDropped: 0,
          stopsSubstituted: 0,
          repairedDaysCount: 0,
          repairedDaysFailed: [] as number[],
          planningTimedOut: false,
          fallbackDaysTimedOut: [] as number[],
        };
        const warningsFromInfeasibleDays: string[] = [];

        const destSummary = destinations
          .map((d) => `${d.name} (${d.country || ""}) — ${d.days} dias`)
          .join(", ");

        const hasSelectedPlaces = selectedPlaces && selectedPlaces.length > 0;
        const selectedPlacesSummary = hasSelectedPlaces
          ? `\nLugares que o usuário já selecionou e quer manter no roteiro (inclua todos estes, e complete o restante do roteiro com mais sugestões que combinem com o perfil abaixo):\n${selectedPlaces!.map((p) => `- ${p.name} (${p.category}) em ${p.destinationName}${p.hours ? `, horário: ${p.hours}` : ""}${p.address ? `, endereço: ${p.address}` : ""}${p.lat && p.lng ? `, coordenadas: ${p.lat},${p.lng}` : ""}`).join("\n")}`
          : "";

        // ─── "Direct generation" redesign (itinerary-engine latency/quality pass) ──
        // Previously this endpoint pre-fetched a Google Places + curated-catalog
        // candidate pool (ranked/capped/diversified), injected it into the
        // prompt as a long text list, and forced the model to pick only from
        // it. That large upfront fetch + large prompt was both the main
        // latency driver and, per product direction, an unnecessary
        // constraint on the model's own real-world judgment of quality/
        // authenticity. The new flow instead: (1) lets the model choose
        // freely from its own knowledge, grounded by explicit
        // no-invented-facts instructions; (2) verifies every AI-chosen stop
        // against real Google Places data AFTER generation (resolveAndVerifyStops
        // below) instead of constraining it beforehand; (3) keeps a SMALL,
        // never-shown-to-the-model fallback restaurant pool purely as a
        // safety net for validateAndCorrectItinerary's meal-insertion step,
        // so the deterministic validator still has something to fall back on
        // without reintroducing a large candidate fetch.
        const candidateFetchStartedAt = Date.now();
        const fallbackCandidates = await fetchRealCandidatesForDestinations(destinations, input.language);
        const fallbackRestaurantPool = fallbackCandidates
          .filter((c) => c.types.includes('restaurant') && c.lat != null && c.lng != null)
          .slice(0, 15);
        await fetchOpeningHoursForTopCandidates(fallbackRestaurantPool, 15, input.language);
        telemetry.candidateFetchMs = Date.now() - candidateFetchStartedAt;

        // Independent prep I/O run concurrently — must-see resolution and
        // weather/daylight lookup don't depend on each other (or on the
        // fallback pool above).
        const destCenter = destinations.find((d) => d.lat != null && d.lng != null);
        const prepStepsStartedAt = Date.now();
        const [resolvedMustSee, weatherBlock] = await Promise.all([
          resolveMustSeePlace(profile.mustSee, destCenter?.lat, destCenter?.lng, input.language),
          buildWeatherBlockForDestinations(startDate, destinations, accommodation),
        ]);
        telemetry.prepStepsMs = Date.now() - prepStepsStartedAt;

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

        // ─── Single whole-trip planning call (itinerary-engine redesign) ──────────
        // Replaces BOTH earlier approaches: the original single monolithic
        // call under the FULL schema (~81.5s for 5 days — see the
        // optimization session notes) and the parallel-by-day calls that
        // briefly replaced it (one small call per day, run concurrently).
        // The per-day approach cut latency per call but gave the model zero
        // visibility into any day but its own — real end-to-end testing
        // (Barcelona, 1/3/5 days) measured ~42-55s total once post-hoc
        // dedup/resolution/validation were included, i.e. SLOWER overall
        // than this single call under the same reduced per-stop schema
        // (~29.4s for 5 days, measured earlier), while also producing worse
        // itineraries: a per-day call can only avoid repeating a restaurant/
        // attraction it personally generated, so cross-day repeats and lack
        // of restaurant variety had to be caught after the fact by
        // validateAndCorrectItinerary's dedup step — which can only DROP a
        // repeat, never pick a better alternative in its place.
        //
        // This call instead asks the model to plan every day of the trip at
        // once, so it has the full itinerary in view while choosing and can
        // genuinely vary cuisine/attraction type across days and keep
        // geographic continuity between consecutive days on its own. It
        // still uses the same minimal per-stop schema as before (time/
        // placeName/placeCategory/description only — everything the backend
        // can verify/compute itself afterward — googlePlaceId, hours,
        // address, lat/lng, travel time/mode — is left out of the schema
        // entirely, not just "instructed to leave null": a nullable field
        // still costs its key+brackets in output tokens).
        const selectedPlacesLower = new Set((selectedPlaces || []).map((p) => p.name.toLowerCase()));
        const mustSeeNamesLower = new Set([resolvedMustSee?.name.toLowerCase()].filter(Boolean) as string[]);
        const trustedNamesLower = new Set<string>([...selectedPlacesLower, ...mustSeeNamesLower]);
        const mustVisit: MustVisitPlace[] = [
          ...(selectedPlaces || []).map((p) => ({ name: p.name, category: p.category, address: p.address, lat: p.lat, lng: p.lng, hours: p.hours })),
          ...(resolvedMustSee ? [resolvedMustSee] : []),
        ];
        // Small fallback-only pool (never shown to the model) — see the
        // redesign note above the candidate-fetch step.
        const fillerRestaurants: FillerRestaurantCandidate[] = fallbackRestaurantPool
          .map((c) => ({ googlePlaceId: c.placeId, name: c.name, lat: c.lat, lng: c.lng }));

        const dayDescriptors = buildDayDescriptors(startDate, destinations);
        const assignableMustVisit: AssignableMustVisit[] = [
          ...(selectedPlaces || []).map((p) => ({ name: p.name, destinationName: p.destinationName, address: p.address, lat: p.lat, lng: p.lng, hours: p.hours })),
          ...(resolvedMustSee ? [{ name: resolvedMustSee.name, address: resolvedMustSee.address, lat: resolvedMustSee.lat, lng: resolvedMustSee.lng, hours: resolvedMustSee.hours }] : []),
        ];
        const mustVisitByDay = assignMustVisitToDays(dayDescriptors, assignableMustVisit);

        // Per-day context block — date, destination, arrival/departure/
        // wake/bed rules, and any must-visit place assigned to that specific
        // day — folded into every block prompt below (see the block-split
        // redesign note before generateBlock) so every call still sees the
        // WHOLE trip's context even though it only generates stops for its
        // own block's days.
        function buildDayContextBlock(descriptor: DayDescriptor): string {
          const assigned = mustVisitByDay.get(descriptor.index) ?? [];
          const assignedBlock = assigned.length > 0
            ? ` Lugar(es) OBRIGATÓRIO(S) neste dia: ${assigned.map((m) => `${m.name}${m.address ? ` (${m.address})` : ''}${m.lat && m.lng ? `, coordenadas: ${m.lat},${m.lng}` : ''}`).join('; ')}.`
            : '';
          // Independent conditions (never an if/else chain) — a single-day
          // trip is BOTH the arrival and departure day at once, and must get
          // BOTH rules, not just whichever one a chain happened to check
          // first (a real bug caught via an isolated live benchmark of this
          // exact function: a 1-day trip, first+last simultaneously, got
          // told only the arrival rule and never the "leave 2h before
          // departure" bound, measurably different from how the original
          // per-day prompt builder stated both independently).
          const arrivalRule = descriptor.isFirstDay
            ? `Dia de CHEGADA: a primeira parada deve começar depois de ${arrivalTime}, com folga de pelo menos 1h30 para deslocamento e check-in.`
            : `Primeira parada depois de acordar (${wakeUpTime}).`;
          const departureRule = descriptor.isLastDay
            ? `Dia de PARTIDA: a última parada deve terminar com pelo menos 2h de folga antes de ${departureTime}.`
            : `Última parada antes de dormir (${bedtime}).`;
          const scheduleRule = `${arrivalRule} ${departureRule}`;
          return `Dia ${descriptor.index + 1} (dayNumber=${descriptor.index + 1}) — ${descriptor.date}, ${descriptor.destinationName}${descriptor.destinationCountry ? `, ${descriptor.destinationCountry}` : ''}. ${scheduleRule}${assignedBlock}`;
        }

        // Deterministic, pre-LLM feasibility check for each day's own
        // schedule window — minutes between the earliest a stop can start
        // and the latest one can end, from arrival/wake-up/bedtime/
        // departure alone. A 1-day trip is both the arrival AND departure
        // day at once (same bug class fixed in buildDayContextBlock above):
        // arriving 15:00 (+1h30 buffer = 16:30 earliest start) with a
        // departure of 18:00 (-2h buffer = 16:00 latest end) is a NEGATIVE
        // window, confirmed for real in this session's own benchmark (the
        // model correctly returned zero stops for exactly this case). That
        // case must never reach the model at all, and must never crash the
        // whole trip's generation the way a model/validation failure does
        // — it's an expected, explainable outcome, not an error.
        function parseHHMM(value: string): number {
          const [h, m] = value.split(":").map((n) => parseInt(n, 10));
          return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
        }
        function computeDayWindowMinutes(descriptor: DayDescriptor): number {
          const start = descriptor.isFirstDay ? parseHHMM(arrivalTime) + 90 : parseHHMM(wakeUpTime);
          const end = descriptor.isLastDay ? parseHHMM(departureTime) - 120 : parseHHMM(bedtime);
          return end - start;
        }
        const MIN_FEASIBLE_WINDOW_MINUTES = 30;
        const infeasibleDayNumbers = new Set<number>();
        for (const descriptor of dayDescriptors) {
          if (computeDayWindowMinutes(descriptor) < MIN_FEASIBLE_WINDOW_MINUTES) {
            infeasibleDayNumbers.add(descriptor.index + 1);
          }
        }
        const feasibleDescriptors = dayDescriptors.filter((d) => !infeasibleDayNumbers.has(d.index + 1));

        const mustSeeHint = mustSee
          ? `\n- O usuário mencionou que gostaria de incluir, se possível, em algum dia da viagem: ${mustSee}.`
          : '';

        // ─── Whole-trip planning call + per-day fallback (replacing the
        // day-block-chunking design) ───────────────────────────────────────
        // The previous redesign split the trip into small BLOCKs of
        // consecutive days, each its own OpenAI call, run concurrently —
        // meant to cap each call's wall time, but it made generation
        // all-or-nothing: if any one block failed its single retry, the
        // ENTIRE mutation threw and discarded every other block that had
        // already succeeded (this is the root cause of the "days 1, 2
        // could not be created" production symptom — block [1,2] is
        // scheduled first and, for short trips, often the only block).
        //
        // This redesign instead asks for the WHOLE trip in one call (one
        // real benchmark measured ~29.4s for 5 days / ~8.2s for 1 day under
        // this same minimal schema — see buildMinimalTripSchema — faster
        // than block-chunking's retry-compounded worst case), and only
        // falls back to smaller, per-day calls for whatever the whole-trip
        // call failed to produce. A day that fails even in the fallback
        // path becomes a `warnings[]` entry, never a thrown error — see
        // generateDaysWithFallback below.
        const FALLBACK_CONCURRENCY = Math.max(1, Number(process.env.ITINERARY_FALLBACK_CONCURRENCY) || 4);
        // Per-day bias coordinates for place resolution/substitution below —
        // each DayDescriptor already carries its destination's lat/lng.
        const biasByDayNumber = new Map<number, { lat?: number; lng?: number }>(
          dayDescriptors.map((d) => [d.index + 1, { lat: d.lat, lng: d.lng }]),
        );

        function buildBlockPrompt(block: DayDescriptor[]): string {
          const allDayContext = dayDescriptors.map(buildDayContextBlock).join('\n');
          const blockDayNumbers = block.map((d) => d.index + 1);
          return `Planeje uma viagem completa de ${totalDays} dia(s): ${destSummary}.
${HARD_SOFT_FRAMING_BLOCK}
${weatherBlock}
${hotelBlock}

${DIRECT_GENERATION_GROUNDING_BLOCK}

Perfil do viajante:
- Estilo: ${profile.travelStyle.join(", ")}
- Orçamento para atrações: ${attractionsBudget}
- Orçamento para restaurantes: ${restaurantsBudget}
- Ritmo: ${profile.pace} (${paceStops} paradas de ATRAÇÕES/PASSEIOS por dia — café da manhã, almoço e jantar são ADICIONAIS a esse número, não descontados dele)
- Tipo de viagem: ${profile.travelProfile}
${profile.interests ? `- Interesses específicos do viajante: ${profile.interests}. Trate isso como um sinal FORTE de seleção — escolha lugares reais que genuinamente combinem com esses interesses em vez de simplesmente mencioná-los na descrição de lugares genéricos.` : ""}${transportHint}${mealBlock}
${profile.tripPurpose ? `- Motivo da viagem: ${profile.tripPurpose}. Leve isso em conta na escolha de lugares e no tom das descrições.` : ""}${mustSeeHint}
${profile.avoidPlaces ? `- O usuário pediu para EVITAR: ${profile.avoidPlaces}. NUNCA inclua lugares desse tipo, mesmo que populares ou bem avaliados.` : ""}

Contexto de TODOS os dias da viagem (para você manter coerência e variedade mesmo só gerando parte deles agora):
${allDayContext}

${buildDurationGuidancePromptBlock(profile.pace)}

Coerência entre os dias da viagem — isto é o que mais diferencia um roteiro bom de um genérico:
- NUNCA repita o mesmo lugar (atração ou restaurante) em outro dia da viagem, mesmo um dia que você não está gerando agora.
- Distribua variedade real de tipos de lugar e, especialmente, de culinária/estilo de restaurante ao longo de TODA a viagem — não só dentro dos dias que você está gerando agora.
- Agrupe cada dia por proximidade geográfica dentro da mesma região/bairro, minimizando deslocamentos longos entre paradas consecutivas do mesmo dia.
- Quando a viagem tiver vários destinos, nunca misture lugares de destinos diferentes no mesmo dia.

Restaurantes (prioridade explícita de qualidade, não só preencher um horário):
- Escolha por culinária e autenticidade local, adequação ao orçamento de restaurantes do viajante, e adequação ao horário da refeição — nunca um restaurante genérico só para ocupar o horário.
- Quando o destino tiver uma culinária ou cultura gastronômica/de bebidas local característica, inclua pelo menos uma experiência desse tipo em algum dia, se coerente com as preferências do viajante.
- Não escolha só pelo número de avaliações.

IMPORTANTE: mesmo vendo o contexto de todos os dias acima, gere ESTA CHAMADA apenas para o(s) dia(s): ${blockDayNumbers.join(", ")}. Não gere os outros dias.

Para cada dia, retorne: dayNumber (o número do dia, igual ao "dayNumber=" indicado acima), title (título do dia), tip (dica do dia), estimatedCost (número, estimativa aproximada SEMPRE na moeda local do destino daquele dia — nunca em dólar a menos que o destino realmente use USD), estimatedCostCurrency (código ISO 4217 de 3 letras correspondente), e stops: array de paradas, cada uma com time (HH:MM), placeName, placeCategory (attraction|restaurant|cafe|museum|hidden_gem|other|park|beach|market|neighborhood), description.

Importante, para cada dia:
- Inclua ${paceStops} paradas de atrações/passeios (café da manhã, almoço e jantar contam à parte).
- Exatamente uma parada de almoço entre 12:00-14:00 e uma de jantar entre 19:00-21:00${(profile.mealPreferences?.lunch === 'none' || profile.mealPreferences?.dinner === 'none') ? ", salvo as refeições desmarcadas acima" : ""}, salvo se isso for genuinamente inviável no dia de chegada/partida.
- Para cada parada, escreva uma descrição objetiva de 1 frase direta, com uma orientação específica e útil sobre o que fazer ou ver ali — não uma frase genérica que serviria pra qualquer lugar do mesmo tipo. NUNCA deixe a descrição vazia.
- NUNCA escreva um horário específico na descrição que seja diferente do campo "time" dessa parada.

Retorne um único JSON com a chave "days": um array com exatamente ${block.length} objeto(s), apenas para o(s) dia(s) ${blockDayNumbers.join(", ")} listado(s) acima, nessa ordem.`;
        }

        // Timeout MUST cover the worst case of the call's own max_tokens
        // budget, not an independently-guessed constant — production logs
        // showed blocks timing out on BOTH the first attempt and the
        // identical retry, which only happens when the timeout budget is
        // structurally smaller than the time needed to generate up to the
        // allowed max_tokens. Confirmed: the previous per-day timeout
        // increment (20000ms/day) was smaller than the time this model
        // needs to generate the per-day token budget (1300 tokens) at the
        // measured ~40 tokens/sec throughput (~32500ms/day) — the budget
        // was guaranteed to be too tight whenever the model used close to
        // its allowed output, which is exactly when real itineraries (rich
        // per-stop descriptions) need it. Deriving timeoutMs FROM maxTokens
        // (plus a measured-throughput margin and a fixed network/prompt
        // overhead) keeps the two numbers from drifting apart again.
        const BLOCK_MAX_TOKENS_BASE = 600;
        const BLOCK_MAX_TOKENS_PER_DAY = 1300;
        const LLM_TOKENS_PER_SECOND = Number(process.env.ITINERARY_LLM_TOKENS_PER_SECOND) || 40;
        const BLOCK_TIMEOUT_OVERHEAD_MS = Number(process.env.ITINERARY_BLOCK_TIMEOUT_OVERHEAD_MS) || 10000;
        const BLOCK_TIMEOUT_SAFETY_MARGIN = Number(process.env.ITINERARY_BLOCK_TIMEOUT_SAFETY_MARGIN) || 1.4;
        const BLOCK_TIMEOUT_MAX_MS = Number(process.env.ITINERARY_BLOCK_TIMEOUT_MAX_MS) || 150000;

        function timeoutForMaxTokens(maxTokens: number): number {
          const generationMs = (maxTokens / LLM_TOKENS_PER_SECOND) * 1000 * BLOCK_TIMEOUT_SAFETY_MARGIN;
          return Math.min(BLOCK_TIMEOUT_MAX_MS, Math.ceil(BLOCK_TIMEOUT_OVERHEAD_MS + generationMs));
        }

        // Identifies a request that failed because it hit our OWN timeoutMs
        // budget (OpenAI SDK's client-side abort), as opposed to a real API
        // error (auth, rate limit, bad JSON) — needed to tell "the timeout
        // budget was too tight" apart from other failure causes in telemetry.
        function isTimeoutError(err: unknown): boolean {
          return err instanceof Error && /timed? ?out/i.test(err.message);
        }

        type BlockOutcome =
          | { ok: true; dayNumbers: number[]; days: any[]; ms: number; retried: boolean; promptTokens: number; completionTokens: number }
          | { ok: false; dayNumbers: number[]; error: string; retried: boolean; timedOut: boolean };

        async function callBlock(block: DayDescriptor[]): Promise<{ days: any[]; ms: number; promptTokens: number; completionTokens: number }> {
          const promptText = buildBlockPrompt(block);
          const maxTokens = Math.min(16000, BLOCK_MAX_TOKENS_BASE + BLOCK_MAX_TOKENS_PER_DAY * block.length);
          const timeoutMs = timeoutForMaxTokens(maxTokens);
          const startedAt = Date.now();
          const response = await invokeLLM({
            messages: [
              { role: "system", content: "Você é um guia de viagens especialista. Planeja parte de uma viagem maior, mas com visão do contexto da viagem inteira. Responda sempre em JSON válido." },
              { role: "user", content: promptText },
            ],
            outputSchema: { name: "itinerary_block", schema: buildMinimalTripSchema(), strict: true },
            max_tokens: maxTokens,
            timeoutMs,
            maxRetries: 0,
          });
          const ms = Date.now() - startedAt;
          const parsed = JSON.parse(response.choices[0].message.content as string);
          return {
            days: Array.isArray(parsed.days) ? parsed.days : [],
            ms,
            promptTokens: response.usage?.prompt_tokens ?? 0,
            completionTokens: response.usage?.completion_tokens ?? 0,
          };
        }

        // Each block does its OWN single manual retry (never the SDK's
        // default 2) — same reasoning as the earlier single-call design: a
        // call near its timeout budget turning into 3x the wall-clock time
        // before ultimately failing anyway is worse than one fast, explicit
        // retry. A block's outcome is always returned, never thrown, so one
        // failing block can't crash mapWithConcurrency's Promise.all and
        // silently take down blocks that already succeeded — each failure
        // is attributed to EXACTLY the day numbers in that block.
        async function generateBlock(block: DayDescriptor[]): Promise<BlockOutcome> {
          const dayNumbers = block.map((d) => d.index + 1);
          try {
            const r = await callBlock(block);
            return { ok: true, dayNumbers, days: r.days, ms: r.ms, retried: false, promptTokens: r.promptTokens, completionTokens: r.completionTokens };
          } catch (firstErr) {
            console.warn(`[ai.generateFromScratch] block for day(s) ${dayNumbers.join(", ")} failed, retrying once (timedOut=${isTimeoutError(firstErr)}):`, firstErr instanceof Error ? firstErr.message : firstErr);
            try {
              const r = await callBlock(block);
              return { ok: true, dayNumbers, days: r.days, ms: r.ms, retried: true, promptTokens: r.promptTokens, completionTokens: r.completionTokens };
            } catch (secondErr) {
              const error = secondErr instanceof Error ? secondErr.message : String(secondErr);
              const timedOut = isTimeoutError(secondErr);
              console.error(`[ai.generateFromScratch] block for day(s) ${dayNumbers.join(", ")} failed after one retry (timedOut=${timedOut}):`, error);
              return { ok: false, dayNumbers, error, retried: true, timedOut };
            }
          }
        }

        // ─── Step 1: one whole-trip planning call ──────────────────────────
        // generateBlock/callBlock (defined above) are generic over any
        // subset of days — calling them with EVERY feasible day at once is
        // the new primary path. generateBlock already does its own single
        // bounded retry internally, so a transient model/API failure is
        // handled before we ever consider this "failed outright".
        const dayGenerationStartedAt = Date.now();
        const primaryOutcome = feasibleDescriptors.length > 0
          ? await generateBlock(feasibleDescriptors)
          : { ok: true as const, dayNumbers: [], days: [], ms: 0, retried: false, promptTokens: 0, completionTokens: 0 };
        telemetry.generationMs = Date.now() - dayGenerationStartedAt;
        telemetry.planningCallMs = primaryOutcome.ok ? primaryOutcome.ms : telemetry.generationMs;
        telemetry.planningRetried = primaryOutcome.retried;
        telemetry.planningFailedOutright = !primaryOutcome.ok;
        telemetry.planningTimedOut = !primaryOutcome.ok && primaryOutcome.timedOut;
        if (feasibleDescriptors.length > 0) telemetry.llmCalls += primaryOutcome.retried ? 2 : 1;
        if (primaryOutcome.ok) {
          telemetry.promptTokens += primaryOutcome.promptTokens;
          telemetry.completionTokens += primaryOutcome.completionTokens;
        }
        telemetry.retried = primaryOutcome.retried;

        // Matched by dayNumber, not array position, so the backend never
        // silently misattributes one day's stops to another if the
        // response's array order ever drifts from what was asked.
        const byDayNumber = new Map<number, any>();
        if (primaryOutcome.ok) {
          for (const d of primaryOutcome.days) {
            if (typeof d?.dayNumber === "number") byDayNumber.set(d.dayNumber, d);
          }
        } else {
          console.warn(`[ai.generateFromScratch] whole-trip planning call failed after one retry, falling back to per-day generation: ${primaryOutcome.error}`);
        }

        // ─── Step 2: per-day fallback for whatever the primary call didn't
        // produce ────────────────────────────────────────────────────────
        // Never a thrown error at this layer: a day that fails here too is
        // recorded as a warning and left with zero stops (caught by the
        // empty-day repair step below, which gets one more targeted try
        // before it, too, degrades to a warning instead of a hard failure).
        // This is what makes a single day's failure (model timeout, invalid
        // output, etc.) stop being a whole-trip failure.
        const descriptorsNeedingFallback = feasibleDescriptors.filter((d) => !byDayNumber.has(d.index + 1));
        if (descriptorsNeedingFallback.length > 0) {
          const fallbackOutcomes = await mapWithConcurrency(descriptorsNeedingFallback, FALLBACK_CONCURRENCY, (d) => generateBlock([d]));
          for (const outcome of fallbackOutcomes) {
            telemetry.llmCalls += outcome.retried ? 2 : 1;
            if (outcome.ok) {
              telemetry.promptTokens += outcome.promptTokens;
              telemetry.completionTokens += outcome.completionTokens;
              telemetry.fallbackCallsMs.push(outcome.ms);
              for (const d of outcome.days) {
                if (typeof d?.dayNumber === "number") {
                  byDayNumber.set(d.dayNumber, d);
                  telemetry.fallbackDaysUsed.push(d.dayNumber);
                }
              }
            } else {
              telemetry.fallbackDaysFailed.push(...outcome.dayNumbers);
              if (outcome.timedOut) telemetry.fallbackDaysTimedOut.push(...outcome.dayNumbers);
              console.error(`[ai.generateFromScratch] fallback generation for day(s) ${outcome.dayNumbers.join(", ")} also failed after one retry (timedOut=${outcome.timedOut}): ${outcome.error}`);
            }
          }
        }

        // Any day still missing after the primary call AND its per-day
        // fallback is a genuine generation failure for that one day — never
        // silently presented as complete, but also never allowed to discard
        // every OTHER day that did succeed (the all-or-nothing bug this
        // redesign replaces). It surfaces as a specific warning instead.
        const generationFailedDayNumbers = new Set<number>(
          feasibleDescriptors.map((d) => d.index + 1).filter((n) => !byDayNumber.has(n)),
        );
        for (const dayNumber of generationFailedDayNumbers) {
          warningsFromInfeasibleDays.push(
            `Dia ${dayNumber} não pôde ser gerado (falha ao gerar o roteiro desse dia mesmo após nova tentativa). Os demais dias estão completos — tente gerar esse dia novamente.`,
          );
        }

        // Infeasible days (computed deterministically above, never sent to
        // the model) get an explicit, plain-language warning instead of a
        // silently "complete" empty day or a fatal crash of the whole trip
        // — both matter equally per product direction.
        for (const descriptor of dayDescriptors) {
          const dayNumber = descriptor.index + 1;
          if (!infeasibleDayNumbers.has(dayNumber)) continue;
          warningsFromInfeasibleDays.push(
            `Dia ${dayNumber} (${descriptor.date}) não teve nenhuma parada: o tempo entre chegada/acordar e partida/dormir nesse dia é insuficiente (menos de ${MIN_FEASIBLE_WINDOW_MINUTES} minutos livres) para incluir qualquer passeio. Considere ajustar o horário de chegada/partida informado.`,
          );
        }

        const rawDays: any[] = dayDescriptors.map((descriptor) => {
          const dayNumber = descriptor.index + 1;
          if (infeasibleDayNumbers.has(dayNumber) || generationFailedDayNumbers.has(dayNumber)) {
            return {
              date: descriptor.date,
              destination: descriptor.destinationName,
              dayNumber,
              title: null,
              tip: null,
              estimatedCost: null,
              estimatedCostCurrency: null,
              stops: [],
            };
          }
          const result = byDayNumber.get(dayNumber);
          return {
            date: descriptor.date,
            destination: descriptor.destinationName,
            dayNumber,
            title: result.title ?? null,
            tip: result.tip ?? null,
            estimatedCost: result.estimatedCost ?? null,
            estimatedCostCurrency: result.estimatedCostCurrency ?? null,
            stops: Array.isArray(result.stops) ? result.stops : [],
          };
        });

        // Post-generation grounding: verify every AI-chosen stop against
        // real Google Places data (resolveAndVerifyStopsWithSubstitution
        // above) instead of checking it against a pre-fetched candidate
        // list — this endpoint's "direct generation" replacement for
        // server/itinerary/guard.ts's filterHallucinatedStops (still used,
        // unchanged, by ai.generateItinerary). A stop that can't be
        // verified as a real place gets one same-category substitution
        // attempt before being dropped (per-place failure isolation — see
        // resolveAndVerifyStopsWithSubstitution); user-selected/must-see
        // stops are passed through untouched (already trusted). Runs on the
        // MERGED, whole-trip array so verification concurrency isn't
        // needlessly limited per-day.
        const placeResolutionStartedAt = Date.now();
        const { days: patchedDays, droppedCount: droppedUnverifiedStops, resolvedCount, substitutedCount, hoursByPlaceId, warnings: resolutionWarnings } = await resolveAndVerifyStopsWithSubstitution(rawDays, {
          trustedNamesLower,
          biasLat: destCenter?.lat,
          biasLng: destCenter?.lng,
          biasByDayNumber,
          language: input.language,
        });
        telemetry.placeResolutionMs = Date.now() - placeResolutionStartedAt;
        telemetry.stopsResolved = resolvedCount;
        telemetry.stopsDropped = droppedUnverifiedStops;
        telemetry.stopsSubstituted = substitutedCount;
        if (droppedUnverifiedStops > 0) {
          console.warn(`[ai.generateFromScratch] dropped ${droppedUnverifiedStops} stop(s) that could not be verified against real Google Places data or substituted`);
        }

        // Deterministic validate → correct pass, run on the whole merged
        // itinerary (not per day) — this is what catches cross-day issues a
        // per-day call can't see on its own: duplicate stops across
        // different days, must-visit places that still didn't fit
        // anywhere, missing meals, and real Google Routes travel times. No
        // LLM "repair" call here (unlike ai.generateItinerary, which still
        // has withOneRepairAttempt): a global planning call wasn't shown to
        // be necessary or fast for this redesign, so any conflict the
        // deterministic layer can't fix on its own surfaces in `warnings`
        // instead — EXCEPT a day left with zero stops, which gets one
        // targeted regeneration attempt below before IT, too, degrades to
        // a warning (see the empty-day repair step right after).
        function buildValidateCtx(hoursMap: Map<string, string>) {
          return {
            wakeUpTime, bedtime, arrivalTime, departureTime,
            isFirstDay: (i: number) => i === 0,
            isLastDay: (i: number) => i === totalDays - 1,
            avoidText: profile.avoidPlaces,
            mustVisit,
            requireLunch: profile.mealPreferences?.lunch !== 'none',
            requireDinner: profile.mealPreferences?.dinner !== 'none',
            lunchMode: profile.mealPreferences?.lunch,
            dinnerMode: profile.mealPreferences?.dinner,
            hoursByPlaceId: hoursMap,
            fillerRestaurants,
            pace: profile.pace,
            fetchTravel: buildTravelFetcher(cityTransportMode, input.language),
            accommodation,
            language: input.language,
          };
        }
        const validateStartedAt = Date.now();
        let { days: correctedDays, warnings } = await validateAndCorrectItinerary(patchedDays, buildValidateCtx(hoursByPlaceId));
        warnings = [...resolutionWarnings, ...warnings];
        telemetry.validateMs = Date.now() - validateStartedAt;

        // A day with zero stops is never a successful generation, even
        // though validateAndCorrectItinerary completed without throwing —
        // it can legitimately end up removing every stop from a day (e.g.
        // every candidate stop got shifted/removed for not fitting the
        // arrival/departure/wake/bed buffers) and still return normally,
        // because "zero stops left" isn't a condition it treats as fatal on
        // its own. Days deterministically marked infeasible BEFORE
        // generation, or already explicitly warned about as a generation
        // failure above, are excluded here — they already have their own
        // explicit warning and must never be treated as a NEW failure.
        //
        // Any OTHER zero-stop day gets exactly ONE targeted regeneration
        // attempt for that single day (never a whole-trip retry) before it,
        // too, degrades to a warning instead of a thrown error — this is
        // the per-day failure isolation this redesign exists to add: one
        // day failing to assemble a valid schedule no longer discards every
        // other day that already succeeded (the root cause of the original
        // "days 1, 2 could not be created" production symptom).
        let emptyDayNumbersList = findEmptyDays(correctedDays).filter(
          (n) => !infeasibleDayNumbers.has(n) && !generationFailedDayNumbers.has(n),
        );
        if (emptyDayNumbersList.length > 0) {
          for (const dayNumber of emptyDayNumbersList) {
            const descriptor = dayDescriptors[dayNumber - 1];
            const dayIdx = correctedDays.findIndex((d: any) => d.dayNumber === dayNumber);
            if (!descriptor || dayIdx === -1) continue;

            const repairOutcome = await generateBlock([descriptor]);
            telemetry.llmCalls += repairOutcome.retried ? 2 : 1;
            if (!repairOutcome.ok) {
              telemetry.repairedDaysFailed.push(dayNumber);
              console.error(`[ai.generateFromScratch] day ${dayNumber} ended up empty after validation and its repair regeneration also failed: ${repairOutcome.error}`);
              continue;
            }
            const repairedRaw = repairOutcome.days.find((d: any) => d.dayNumber === dayNumber) ?? repairOutcome.days[0];
            if (!repairedRaw) {
              telemetry.repairedDaysFailed.push(dayNumber);
              continue;
            }

            const singleDayInput = [{
              date: correctedDays[dayIdx].date,
              destination: correctedDays[dayIdx].destination,
              dayNumber,
              title: repairedRaw.title ?? null,
              tip: repairedRaw.tip ?? null,
              estimatedCost: repairedRaw.estimatedCost ?? null,
              estimatedCostCurrency: repairedRaw.estimatedCostCurrency ?? null,
              stops: Array.isArray(repairedRaw.stops) ? repairedRaw.stops : [],
            }];
            const { days: resolvedSingleDay, substitutedCount: repairSubstituted, hoursByPlaceId: repairHours, warnings: repairResolutionWarnings } = await resolveAndVerifyStopsWithSubstitution(singleDayInput, {
              trustedNamesLower,
              biasLat: destCenter?.lat,
              biasLng: destCenter?.lng,
              biasByDayNumber,
              language: input.language,
            });
            telemetry.stopsSubstituted += repairSubstituted;
            for (const [k, v] of repairHours) hoursByPlaceId.set(k, v);
            warnings.push(...repairResolutionWarnings);
            correctedDays[dayIdx] = resolvedSingleDay[0];
            telemetry.repairedDaysCount++;
          }

          // Re-run the deterministic validator once more over the WHOLE
          // merged itinerary — cheap and safe to call twice (it only ever
          // reorders/shifts/drops/inserts stops from data already in hand)
          // — so the repaired day's stops get the same dedup/meal/opening-
          // hours/travel-time treatment as every other day, instead of
          // being spliced in raw.
          const revalidated = await validateAndCorrectItinerary(correctedDays, buildValidateCtx(hoursByPlaceId));
          correctedDays = revalidated.days;
          warnings = [...warnings, ...revalidated.warnings];
          emptyDayNumbersList = findEmptyDays(correctedDays).filter(
            (n) => !infeasibleDayNumbers.has(n) && !generationFailedDayNumbers.has(n),
          );
        }

        // Any day still empty after that one repair attempt is a genuine,
        // isolated failure for that single day — reported as a specific
        // warning, never a thrown error that would discard every other
        // day's successfully-assembled schedule.
        for (const dayNumber of emptyDayNumbersList) {
          warningsFromInfeasibleDays.push(
            `Dia ${dayNumber} não pôde ser montado (nenhuma parada coube nas restrições de horário, mesmo após uma nova tentativa). Os demais dias estão completos — tente ajustar os horários informados ou gerar esse dia novamente.`,
          );
        }

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
            // No separate candidate lookup needed here: resolveAndVerifyStops
            // already backfilled lat/lng/address/hours/googlePlaceId directly
            // onto each stop (for user-selected/must-see stops, those fields
            // came from the client/must-see resolution instead) — stop.* is
            // already the best data we have.
            const key = stop.googlePlaceId || stop.placeName.toLowerCase();
            if (!placesByKey.has(key)) {
              placesByKey.set(key, {
                googlePlaceId: stop.googlePlaceId,
                name: stop.placeName,
                category: stop.placeCategory || 'attraction',
                address: stop.address,
                description: stop.description,
                lat: stop.lat,
                lng: stop.lng,
                hours: stop.hours,
                destinationName: day.destination,
              });
            }
          }
        }

        // Fetch a real photo for each unique place, reusing the same landscape /
        // highest-resolution curation as ai.suggestPlaces. Places backed by a
        // real candidate already have a verified place_id; only the (rare)
        // fallback places need the name-based lookup. Bounded concurrency
        // (mapWithConcurrency) instead of an unbounded Promise.all — for a
        // long, dense itinerary (e.g. a 5-day "intenso" trip, ~40 unique
        // places) firing every photo lookup at once was a classic N+1
        // fan-out that could itself contend for Google API rate limits and
        // added unnecessary tail latency to the response.
        const SUGGESTED_PLACES_PHOTO_CONCURRENCY = Math.max(1, Number(process.env.ITINERARY_PHOTO_CONCURRENCY) || 8);
        const suggestedPlacesPhotoStartedAt = Date.now();
        const suggestedPlaces = await mapWithConcurrency(
          Array.from(placesByKey.values()),
          SUGGESTED_PLACES_PHOTO_CONCURRENCY,
          async (place) => {
            let imageUrl: string | undefined;
            if (GOOGLE_PLACES_KEY) {
              const placeId = place.googlePlaceId ?? await resolvePlaceIdByName(place.name, place.lat, place.lng, input.language);
              if (placeId) imageUrl = (await fetchCuratedPlaceDetails(placeId, input.language)).imageUrl;
            }
            return { ...place, imageUrl };
          },
        );
        telemetry.suggestedPlacesPhotoMs = Date.now() - suggestedPlacesPhotoStartedAt;

        const totalMs = Date.now() - generationStartedAt;
        console.log(
          `[ai.generateFromScratch] telemetry: model=${ENV.openaiModel} totalMs=${totalMs} totalDays=${totalDays} llmCalls=${telemetry.llmCalls} planningRetried=${telemetry.planningRetried} planningFailedOutright=${telemetry.planningFailedOutright} planningTimedOut=${telemetry.planningTimedOut} promptTokens=${telemetry.promptTokens} completionTokens=${telemetry.completionTokens} stopsResolved=${telemetry.stopsResolved} stopsSubstituted=${telemetry.stopsSubstituted} stopsDropped=${telemetry.stopsDropped} fallbackDaysUsed=${JSON.stringify(telemetry.fallbackDaysUsed)} fallbackDaysFailed=${JSON.stringify(telemetry.fallbackDaysFailed)} fallbackDaysTimedOut=${JSON.stringify(telemetry.fallbackDaysTimedOut)} repairedDaysCount=${telemetry.repairedDaysCount} repairedDaysFailed=${JSON.stringify(telemetry.repairedDaysFailed)} fallbackRestaurantPool=${fallbackRestaurantPool.length} unresolvedWarnings=${warnings.length}`,
        );
        console.log(
          `[ai.generateFromScratch] timings: ${JSON.stringify({
            candidateFetchMs: telemetry.candidateFetchMs,
            prepStepsMs: telemetry.prepStepsMs,
            generationMs: telemetry.generationMs,
            planningCallMs: telemetry.planningCallMs,
            fallbackCallsMs: telemetry.fallbackCallsMs,
            placeResolutionMs: telemetry.placeResolutionMs,
            validateMs: telemetry.validateMs,
            suggestedPlacesPhotoMs: telemetry.suggestedPlacesPhotoMs,
            totalMs,
            // Per-stage share of totalMs, rounded to whole percent, so the
            // dominant stage is visible at a glance without doing the
            // arithmetic by hand from the raw ms figures above.
            stageSharePct: totalMs > 0 ? {
              candidateFetch: Math.round((telemetry.candidateFetchMs / totalMs) * 100),
              prepSteps: Math.round((telemetry.prepStepsMs / totalMs) * 100),
              generation: Math.round((telemetry.generationMs / totalMs) * 100),
              placeResolution: Math.round((telemetry.placeResolutionMs / totalMs) * 100),
              validate: Math.round((telemetry.validateMs / totalMs) * 100),
              suggestedPlacesPhoto: Math.round((telemetry.suggestedPlacesPhotoMs / totalMs) * 100),
            } : null,
          })}`,
        );

        const allWarnings = [...warningsFromInfeasibleDays, ...warnings];
        return { days: correctedDays, suggestedPlaces, warnings: allWarnings.length > 0 ? allWarnings : undefined };
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
