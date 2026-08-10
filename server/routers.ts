import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { searchIslands } from "../constants/islands-regions";
import * as db from "./db";
import crypto from "crypto";

const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || "";
const AERODATABOX_KEY = process.env.AERODATABOX_RAPIDAPI_KEY || "";
const AERODATABOX_HOST = 'aerodatabox.p.rapidapi.com';
const GOOGLE_DIRECTIONS_KEY = process.env.GOOGLE_DIRECTIONS_API_KEY || "";
const OPENWEATHER_KEY = process.env.OPENWEATHERMAP_API_KEY || "";
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || "";

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
          "User-Agent": "LocalsApp/1.0 (travel-app)",
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
 * Resolve a Google Places photo_reference to a stable public photo URL,
 * following the redirect so we store an lh3.googleusercontent.com URL
 * (no API key exposed to the client).
 */
async function resolveGooglePhotoUrl(photoReference: string): Promise<string | undefined> {
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
    console.error("[places.details] photo fetch failed:", photoErr);
    return undefined;
  }
}

/**
 * Fetch a representative photo from Unsplash's search API.
 * Last-resort fallback when Google Places and Wikipedia both have nothing.
 */
async function fetchUnsplashPhoto(query: string): Promise<string | undefined> {
  if (!UNSPLASH_ACCESS_KEY || !query) return undefined;
  try {
    const url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("orientation", "landscape");
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
    });
    const data = (await res.json()) as any;
    return data?.results?.[0]?.urls?.regular;
  } catch (unsplashErr) {
    console.error(`[places.details] Unsplash photo search failed for "${query}":`, unsplashErr);
    return undefined;
  }
}

// ─── Google Directions helper ─────────────────────────────────────────────────

type TravelMode = 'driving' | 'walking' | 'transit' | 'bicycling';

async function fetchDirections(
  origin: string,
  destination: string,
  mode: TravelMode = 'driving',
) {
  if (!GOOGLE_DIRECTIONS_KEY) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', destination);
  url.searchParams.set('mode', mode);
  url.searchParams.set('key', GOOGLE_DIRECTIONS_KEY);
  url.searchParams.set('language', 'pt-BR');
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
  }),

  // ─── Destination Info (AI) ───────────────────────────────────────────────
  destinationInfo: router({
    /**
     * Generate per-destination travel info using LLM:
     * climate, crowd level, population, health/vaccine requirements, visa info.
     */
    generate: publicProcedure
      .input(z.object({
        destination: z.string(),
        country: z.string().optional(),
        travelMonth: z.string().optional(), // e.g. "junho"
        originCountry: z.string().optional().default('Brasil'),
      }))
      .mutation(async ({ input }) => {
        const { destination, country, travelMonth, originCountry } = input;
        const prompt = `Você é um especialista em viagens. Forneça informações práticas e concisas sobre viajar para ${destination}${country ? `, ${country}` : ''}${travelMonth ? ` no mês de ${travelMonth}` : ''} para turistas do ${originCountry}.

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
              { role: 'system', content: 'Você é um especialista em viagens internacionais. Responda sempre em JSON válido.' },
              { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
          });
          const content = response.choices[0].message.content as string;
          return { data: JSON.parse(content) };
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
      const now = new Date();
      let daysLeftInTrial: number | null = null;
      if (status.subscriptionStatus === 'trial' && status.trialEndsAt) {
        daysLeftInTrial = Math.max(0, Math.ceil((status.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      }
      return {
        status: status.subscriptionStatus,
        plan: status.subscriptionPlan,
        expiresAt: status.subscriptionExpiresAt,
        trialEndsAt: status.trialEndsAt,
        daysLeftInTrial,
        hasAccess: status.subscriptionStatus === 'trial' || status.subscriptionStatus === 'active',
      };
    }),

    /**
     * Mock purchase endpoint for local testing.
     * In production, this would be handled by RevenueCat webhooks.
     */
    mockPurchase: protectedProcedure
      .input(z.object({
        plan: z.enum(['monthly', 'annual']),
      }))
      .mutation(async ({ ctx, input }) => {
        const now = new Date();
        const expiresAt = new Date(now);
        if (input.plan === 'monthly') {
          expiresAt.setMonth(expiresAt.getMonth() + 1);
        } else {
          expiresAt.setFullYear(expiresAt.getFullYear() + 1);
        }
        await db.updateSubscriptionStatus(ctx.user.id, {
          subscriptionStatus: 'active',
          subscriptionPlan: input.plan,
          subscriptionExpiresAt: expiresAt,
        });
        return {
          success: true,
          status: 'active',
          plan: input.plan,
          expiresAt,
        };
      }),

    /**
     * Cancel subscription (marks as cancelled, access until expiry).
     */
    cancel: protectedProcedure.mutation(async ({ ctx }) => {
      await db.updateSubscriptionStatus(ctx.user.id, {
        subscriptionStatus: 'cancelled',
      });
      return { success: true };
    }),

    /**
     * RevenueCat webhook handler.
     * Receives subscription events and updates user status.
     */
    webhook: publicProcedure
      .input(z.object({
        event: z.object({
          type: z.string(),
          app_user_id: z.string(),
          product_id: z.string().optional(),
          expiration_at_ms: z.number().optional(),
        }),
      }))
      .mutation(async ({ input }) => {
        const { event } = input;
        const user = await db.getUserByOpenId(event.app_user_id);
        if (!user) return { success: false, reason: 'USER_NOT_FOUND' };

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
        }
        return { success: true };
      }),
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
      }))
      .query(async ({ input }) => {
        const data = await fetchDirections(input.origin, input.destination, input.mode);
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
      }))
      .mutation(async ({ input }) => {
        const results = await Promise.all(
          input.pairs.map(async (p) => {
            const data = await fetchDirections(p.origin, p.destination, p.mode);
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
      }))
      .query(async ({ input }) => {
        if (!GOOGLE_PLACES_KEY) return { predictions: [] };

        const makeUrl = (types: string) => {
          const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
          url.searchParams.set("input", input.query);
          url.searchParams.set("types", types);
          url.searchParams.set("language", "pt-BR");
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
      .input(z.object({ placeId: z.string() }))
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
        url.searchParams.set("language", "pt-BR");
        url.searchParams.set("key", GOOGLE_PLACES_KEY);

        const res = await fetch(url.toString());
        const data = (await res.json()) as any;

        if (data.status !== "OK") return null;

        const result = data.result;
        const lat = result?.geometry?.location?.lat;
        const lng = result?.geometry?.location?.lng;

        // Get a photo URL if available for the specific place.
        let imageUrl: string | undefined;
        if (result?.photos?.[0]?.photo_reference) {
          imageUrl = await resolveGooglePhotoUrl(result.photos[0].photo_reference);
        }

        // If the specific place has no photo, try a broader city-level search
        // before falling back to Wikipedia.
        if (!imageUrl) {
          const localityComp = result?.address_components?.find((c: any) => c.types.includes("locality"));
          const adminAreaComp = result?.address_components?.find((c: any) => c.types.includes("administrative_area_level_1"));
          const cityName = localityComp?.long_name || adminAreaComp?.long_name || result?.name || "";
          if (cityName) {
            try {
              const citySearchUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
              citySearchUrl.searchParams.set("query", cityName);
              citySearchUrl.searchParams.set("language", "pt-BR");
              citySearchUrl.searchParams.set("key", GOOGLE_PLACES_KEY);
              const cityRes = await fetch(citySearchUrl.toString());
              const cityData = (await cityRes.json()) as any;
              const cityPhotoRef = cityData?.results?.[0]?.photos?.[0]?.photo_reference;
              if (cityPhotoRef) {
                imageUrl = await resolveGooglePhotoUrl(cityPhotoRef);
              }
            } catch (cityErr) {
              console.error(`[places.details] city photo search failed for "${cityName}":`, cityErr);
            }
          }
        }

        const placeName = result?.name || "";
        const countryComp = result?.address_components?.find((c: any) => c.types.includes("country"));
        const countryName = countryComp?.long_name || "";

        // If Google Places has no photo, try Wikipedia as fallback
        if (!imageUrl) {
          imageUrl = await fetchWikipediaPhoto(placeName, countryName);
        }

        // Last resort: Unsplash search
        if (!imageUrl) {
          imageUrl = await fetchUnsplashPhoto(placeName);
        }

        if (!imageUrl) {
          console.warn(`[places.details] no photo found for "${placeName}" (${countryName}), place_id=${input.placeId}`);
        }

        // Extract country from address_components
        const countryComponent = result?.address_components?.find((c: any) =>
          c.types.includes("country")
        );
        const country = countryComponent?.long_name || "";
        const address = result?.formatted_address || "";
        return { lat, lng, imageUrl, country, address };
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
      }))
      .query(async ({ input }) => {
        if (!GOOGLE_PLACES_KEY) return { places: [] };
        const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
        const q = input.locationBias
          ? `${input.query} em ${input.locationBias}`
          : input.query;
        url.searchParams.set("query", q);
        url.searchParams.set("language", "pt-BR");
        url.searchParams.set("key", GOOGLE_PLACES_KEY);
        try {
          const res = await fetch(url.toString());
          const data = (await res.json()) as any;
          if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return { places: [] };
          const results: any[] = (data.results || []).slice(0, 8);
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
    generateItinerary: publicProcedure
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
          preferences: z.object({
            pace: z.enum(["relaxado", "moderado", "intenso"]).optional(),
            wakeUpTime: z.string().optional(), // e.g. "08:00"
            includeBreakfast: z.boolean().optional(),
            includeLunch: z.boolean().optional(),
            includeDinner: z.boolean().optional(),
          }).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { startDate, totalDays, destinations, selectedPlaces, preferences, cityTransportMode } = input;

        const destSummary = destinations
          .map((d) => `${d.name} (${d.country || ""}) — ${d.days} dias`)
          .join(", ");

        const hasSelectedPlaces = selectedPlaces && selectedPlaces.length > 0;
        const placesSummary = hasSelectedPlaces
          ? `\nLugares OBRIGATÓRIOS selecionados pelo usuário (use APENAS estes lugares nas paradas, não adicione outros):\n${selectedPlaces!.map((p) => `- ${p.name} (${p.category}) em ${p.destinationName}${p.hours ? `, horário: ${p.hours}` : ""}${p.address ? `, endereço: ${p.address}` : ""}${p.lat && p.lng ? `, coordenadas: ${p.lat},${p.lng}` : ""}`).join("\n")}`
          : "\nUse sua expertise para sugerir os melhores lugares para visitar.";

        const paceStops = preferences?.pace === 'relaxado' ? 3 : preferences?.pace === 'intenso' ? 6 : 4;

        // Map cityTransportMode to a human-readable label for the prompt
        const transportLabel: Record<string, string> = {
          walk: 'a pé (walking)',
          bike: 'bicicleta (bicycling)',
          public: 'transporte público / metrô (transit)',
          uber: 'Uber/táxi (driving)',
          car: 'carro próprio (driving)',
          taxi: 'táxi (driving)',
        };
        const transportHint = cityTransportMode
          ? `\n- Meio de transporte dentro da cidade: ${transportLabel[cityTransportMode] || cityTransportMode}`
          : '';

        const prompt = `Crie um roteiro de viagem dia a dia detalhado para ${totalDays} dias.

Data de início: ${startDate}
Destinos: ${destSummary}
${placesSummary}

Preferências:
- Ritmo: ${preferences?.pace || "moderado"} (${paceStops} paradas por dia)
- Horário de acordar: ${preferences?.wakeUpTime || "08:00"}${transportHint}
${preferences?.includeBreakfast !== false ? "- Incluir café da manhã" : ""}
${preferences?.includeLunch !== false ? "- Incluir almoço" : ""}
${preferences?.includeDinner !== false ? "- Incluir jantar" : ""}

Retorne um JSON com o array "days". Cada dia deve ter:
- date: data no formato YYYY-MM-DD
- destination: nome do destino
- title: título do dia (ex: "Chegada em Paris — Torre Eiffel e Champs-Élysées")
- tips: dica do dia em 1 frase
- estimatedCost: custo estimado do dia em USD (número)
- stops: array de paradas do dia, cada parada com:
  { time (HH:MM), placeName, placeCategory (attraction|restaurant|cafe|museum|hidden_gem|other), description, hours (horário de funcionamento), address (endereço completo), lat (latitude numérica), lng (longitude numérica), travelTimeToNext (ex: "15 min a pé"), travelModeToNext (walking|driving|transit|bicycling) }

Importante:
- Inclua ${paceStops} paradas por dia. Distribua bem os horários ao longo do dia.
- Para restaurantes, use horários de refeição (08:00 café, 13:00 almoço, 20:00 jantar).
- Sempre inclua lat/lng reais para cada parada (coordenadas geográficas precisas).
- O travelModeToNext deve refletir o meio de transporte preferido: ${cityTransportMode || 'driving'}.${hasSelectedPlaces ? '\n- ATENÇÃO: Use SOMENTE os lugares listados acima. NÃO adicione nenhum lugar que não esteja na lista. Distribua os lugares selecionados pelos dias de forma ótima considerando proximidade geográfica e tempo de trânsito.' : ''}`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "Você é um guia de viagens especialista. Crie roteiros detalhados, práticos e culturalmente ricos. Responda sempre em JSON válido." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          max_tokens: 16000,
        });

        const content = response.choices[0].message.content as string;
        try {
          const parsed = JSON.parse(content);
          return { days: parsed.days || [] };
        } catch (err) {
          console.error("[ai.generateItinerary] Failed to parse LLM response as JSON. Raw content (first 500 chars):", content.slice(0, 500));
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Não foi possível gerar o roteiro: a resposta da IA veio incompleta ou inválida. Tente novamente.",
            cause: err,
          });
        }
      }),

    /**
     * Generate place suggestions for a destination by category.
     * Used in the "Lugares" tab when AI selects places.
     */
    /**
     * Generate itinerary from scratch with user profile questions.
     * Returns both suggested places AND a day-by-day itinerary.
     */
    generateFromScratch: publicProcedure
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
            })
          ),
          cityTransportMode: z.string().optional(),
          profile: z.object({
            travelStyle: z.array(z.string()),   // e.g. ["cultura", "gastronomia"]
            budget: z.enum(["econômico", "moderado", "luxo"]),
            pace: z.enum(["relaxado", "moderado", "intenso"]),
            travelProfile: z.enum(["casal", "família", "solo", "amigos", "negócios"]),
            interests: z.string().optional(),   // free text
            wakeUpTime: z.string().optional(),
          }),
        })
      )
      .mutation(async ({ input }) => {
        const { startDate, totalDays, destinations, cityTransportMode, profile } = input;

        const destSummary = destinations
          .map((d) => `${d.name} (${d.country || ""}) — ${d.days} dias`)
          .join(", ");

        const paceStops = profile.pace === 'relaxado' ? 3 : profile.pace === 'intenso' ? 6 : 4;

        const transportLabel: Record<string, string> = {
          walk: 'a pé (walking)',
          bike: 'bicicleta (bicycling)',
          public: 'transporte público / metrô (transit)',
          uber: 'Uber/táxi (driving)',
          car: 'carro próprio (driving)',
          taxi: 'táxi (driving)',
        };
        const transportHint = cityTransportMode
          ? `\n- Meio de transporte: ${transportLabel[cityTransportMode] || cityTransportMode}`
          : '';

        const prompt = `Crie um roteiro de viagem personalizado para ${totalDays} dias.

Data de início: ${startDate}
Destinos: ${destSummary}

Perfil do viajante:
- Estilo: ${profile.travelStyle.join(", ")}
- Orçamento: ${profile.budget}
- Ritmo: ${profile.pace} (${paceStops} paradas/dia)
- Tipo de viagem: ${profile.travelProfile}
${profile.interests ? `- Interesses específicos: ${profile.interests}` : ""}
- Horário de acordar: ${profile.wakeUpTime || "08:00"}${transportHint}

Crie o roteiro completo com lugares autênticos que combinem com o perfil acima.

Retorne um JSON com:
1. "suggestedPlaces": array de todos os lugares usados no roteiro, cada um com:
   { id (string uuid único), name, category (attraction|restaurant|cafe|museum|hidden_gem|other), address, hours, description, lat, lng, destinationName }
2. "days": array dia-a-dia, cada dia com:
   { date (YYYY-MM-DD), destination, dayNumber, title, tip, estimatedCost, stops: [{ id (uuid), time (HH:MM), placeId (deve corresponder ao id em suggestedPlaces), placeName, placeCategory, description, address, lat, lng, travelTimeToNext, travelModeToNext }] }

Importante:
- Inclua lat/lng reais para cada lugar.
- O travelModeToNext deve ser: ${cityTransportMode || 'driving'}.
- Distribua bem os horários ao longo do dia.
- Respeite o orçamento e o ritmo do viajante.`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "Você é um guia de viagens especialista. Crie roteiros personalizados, detalhados e culturalmente ricos. Responda sempre em JSON válido." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          max_tokens: 16000,
        });

        const content = response.choices[0].message.content as string;
        try {
          const parsed = JSON.parse(content);
          return { days: parsed.days || [], suggestedPlaces: parsed.suggestedPlaces || [] };
        } catch (err) {
          console.error("[ai.generateFromScratch] Failed to parse LLM response as JSON. Raw content (first 500 chars):", content.slice(0, 500));
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Não foi possível gerar o roteiro: a resposta da IA veio incompleta ou inválida. Tente novamente.",
            cause: err,
          });
        }
      }),

    suggestPlaces: publicProcedure
      .input(
        z.object({
          destinationName: z.string(),
          country: z.string().optional(),
          categories: z.array(z.string()).optional(),
          existingPlaces: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { destinationName, country, categories, existingPlaces } = input;

        const existing = existingPlaces && existingPlaces.length > 0
          ? `\nExclua estes lugares que o usuário já tem: ${existingPlaces.join(", ")}`
          : "";

        const prompt = `Sugira os melhores lugares para visitar em ${destinationName}${country ? `, ${country}` : ""}.

Categorias solicitadas: ${(categories || ["attraction", "restaurant", "cafe", "museum", "hidden_gem"]).join(", ")}${existing}

Retorne um JSON com o array "places" (lista plana, máx 20 lugares no total).
Cada lugar deve ter: { name (string), category (attraction|restaurant|cafe|museum|hidden_gem|other), address (string), hours (string, ex: "09:00 - 18:00"), description (string, 1 frase), phone (string, opcional) }`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "Você é um especialista em viagens e gastronomia local. Sugira lugares autênticos e relevantes. Responda em JSON válido." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          max_tokens: 16000,
        });

        const content = response.choices[0].message.content as string;
        let parsed: any;
        try {
          parsed = JSON.parse(content);
        } catch (err) {
          console.error("[ai.suggestPlaces] Failed to parse LLM response as JSON. Raw content (first 500 chars):", content.slice(0, 500));
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Não foi possível sugerir lugares: a resposta da IA veio incompleta ou inválida. Tente novamente.",
            cause: err,
          });
        }
        // Handle both flat array and nested object formats
        let places = parsed.places || [];
        if (!Array.isArray(places)) {
          // Flatten nested categories
          places = Object.values(places).flat();
        }
        return { places };
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
        // Check the trip belongs to the inviting user
        const trips = await db.getUserTrips(ctx.user.id);
        const trip = trips.find((t) => t.clientId === input.tripClientId);
        if (!trip) throw new Error('Trip not found or not owned by you');
        // Create the share record
        const token = crypto.randomBytes(24).toString('hex');
        await db.createTripShare({
          tripId: trip.id,
          ownerId: ctx.user.id,
          inviteeEmail: input.email,
          role: input.role,
          token,
        });
        return { ok: true, token };
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
        shareId: s.id,
        tripClientId: s.clientId ?? '',
        tripData: s.data ?? '',
        shareRole: (s as { shareRole?: string }).shareRole ?? 'viewer',
      }));
    }),

    /** List all shares the current user has sent (as owner) */
    listSentByMe: protectedProcedure
      .input(z.object({ tripClientId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const trips = await db.getUserTrips(ctx.user.id);
        const trip = trips.find((t) => t.clientId === input.tripClientId);
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
        await db.revokeTripShare(ctx.user.id, input.shareId);
        return { ok: true };
      }),
  }),

  // ─── Cloud Trip Sync ──────────────────────────────────────────────────────────────────────────────
  cloudTrips: router({
    /** Fetch all trips for the authenticated user. Returns array of { clientId, data } */
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await db.getUserTrips(ctx.user.id);
      return rows.map((r) => ({ clientId: r.clientId, data: r.data, updatedAt: r.updatedAt.toISOString() }));
    }),

    /** Upsert a single trip (create or update by clientId). */
    upsert: protectedProcedure
      .input(z.object({
        clientId: z.string().min(1).max(64),
        data: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.upsertTrip(ctx.user.id, input.clientId, input.data);
        return { ok: true };
      }),

    /** Delete a trip by clientId. */
    delete: protectedProcedure
      .input(z.object({ clientId: z.string().min(1).max(64) }))
      .mutation(async ({ ctx, input }) => {
        await db.deleteTripByClientId(ctx.user.id, input.clientId);
        return { ok: true };
      }),
  }),
});
export type AppRouter = typeof appRouter;
