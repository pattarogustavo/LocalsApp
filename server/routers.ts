import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { z } from "zod";

const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || "";
const AVIATIONSTACK_KEY = process.env.AVIATIONSTACK_API_KEY || "";
const GOOGLE_DIRECTIONS_KEY = process.env.GOOGLE_DIRECTIONS_API_KEY || "";

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

// ─── AviationStack helpers ────────────────────────────────────────────────────

async function fetchFlightData(flightNumber: string, date: string) {
  if (!AVIATIONSTACK_KEY) return null;
  // AviationStack: strip spaces, uppercase
  const iata = flightNumber.replace(/\s+/g, '').toUpperCase();
  const url = new URL('http://api.aviationstack.com/v1/flights');
  url.searchParams.set('access_key', AVIATIONSTACK_KEY);
  url.searchParams.set('flight_iata', iata);
  url.searchParams.set('flight_date', date); // YYYY-MM-DD
  url.searchParams.set('limit', '1');
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const flight = json?.data?.[0];
    if (!flight) return null;
    return {
      flightNumber: flight.flight?.iata || iata,
      airline: flight.airline?.name || '',
      origin: flight.departure?.iata || '',
      originCity: flight.departure?.airport || '',
      destination: flight.arrival?.iata || '',
      destinationCity: flight.arrival?.airport || '',
      departureTime: flight.departure?.scheduled || '',
      arrivalTime: flight.arrival?.scheduled || '',
      departureActual: flight.departure?.actual || '',
      arrivalActual: flight.arrival?.actual || '',
      terminal: flight.departure?.terminal || '',
      gate: flight.departure?.gate || '',
      status: (flight.flight_status as string) || 'scheduled',
      duration: (() => {
        const dep = new Date(flight.departure?.scheduled || '');
        const arr = new Date(flight.arrival?.scheduled || '');
        if (isNaN(dep.getTime()) || isNaN(arr.getTime())) return '';
        const mins = Math.round((arr.getTime() - dep.getTime()) / 60000);
        return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
      })(),
    };
  } catch {
    return null;
  }
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── AviationStack ────────────────────────────────────────────────────────
  flights: router({
    /**
     * Search flights by origin IATA + destination IATA + date.
     * Returns up to 5 matching flights so the user can pick one.
     */
    searchByRoute: publicProcedure
      .input(z.object({
        origin: z.string().min(2).max(4),
        destination: z.string().min(2).max(4),
        date: z.string(),
      }))
      .mutation(async ({ input }) => {
        if (!AVIATIONSTACK_KEY) return { flights: [] };
        const url = new URL('http://api.aviationstack.com/v1/flights');
        url.searchParams.set('access_key', AVIATIONSTACK_KEY);
        url.searchParams.set('dep_iata', input.origin.toUpperCase());
        url.searchParams.set('arr_iata', input.destination.toUpperCase());
        url.searchParams.set('flight_date', input.date);
        url.searchParams.set('limit', '5');
        try {
          const res = await fetch(url.toString());
          if (!res.ok) return { flights: [] };
          const json = (await res.json()) as any;
          const data: any[] = json?.data || [];
          const flights = data.map((flight: any) => {
            const iata = flight.flight?.iata || '';
            const dep = new Date(flight.departure?.scheduled || '');
            const arr = new Date(flight.arrival?.scheduled || '');
            const mins = (!isNaN(dep.getTime()) && !isNaN(arr.getTime()))
              ? Math.round((arr.getTime() - dep.getTime()) / 60000) : 0;
            const duration = mins > 0
              ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : '';
            return {
              flightNumber: iata,
              airline: flight.airline?.name || '',
              origin: flight.departure?.iata || input.origin.toUpperCase(),
              originCity: flight.departure?.airport || '',
              destination: flight.arrival?.iata || input.destination.toUpperCase(),
              destinationCity: flight.arrival?.airport || '',
              departureTime: flight.departure?.scheduled || '',
              arrivalTime: flight.arrival?.scheduled || '',
              departureActual: flight.departure?.actual || '',
              arrivalActual: flight.arrival?.actual || '',
              terminal: flight.departure?.terminal || '',
              gate: flight.departure?.gate || '',
              status: (flight.flight_status as string) || 'scheduled',
              duration,
            };
          });
          return { flights };
        } catch {
          return { flights: [] };
        }
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
     * Autocomplete cities and countries only.
     * Returns structured predictions with placeId, name, country, lat, lng.
     */
    autocomplete: publicProcedure
      .input(z.object({ query: z.string().min(1) }))
      .query(async ({ input }) => {
        if (!GOOGLE_PLACES_KEY) return { predictions: [] };

        const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
        url.searchParams.set("input", input.query);
        url.searchParams.set("types", "(cities)");
        url.searchParams.set("language", "pt-BR");
        url.searchParams.set("key", GOOGLE_PLACES_KEY);

        const res = await fetch(url.toString());
        const data = (await res.json()) as any;

        if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
          return { predictions: [] };
        }

        return {
          predictions: (data.predictions || []).map((p: any) => ({
            placeId: p.place_id,
            name: p.structured_formatting?.main_text || p.description,
            fullDescription: p.description,
            country: p.structured_formatting?.secondary_text || "",
          })),
        };
      }),

    /**
     * Get place details (lat/lng, photo) for a given placeId.
     */
    details: publicProcedure
      .input(z.object({ placeId: z.string() }))
      .query(async ({ input }) => {
        if (!GOOGLE_PLACES_KEY) return null;

        const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
        url.searchParams.set("place_id", input.placeId);
        url.searchParams.set("fields", "geometry,photos,name,address_components");
        url.searchParams.set("language", "pt-BR");
        url.searchParams.set("key", GOOGLE_PLACES_KEY);

        const res = await fetch(url.toString());
        const data = (await res.json()) as any;

        if (data.status !== "OK") return null;

        const result = data.result;
        const lat = result?.geometry?.location?.lat;
        const lng = result?.geometry?.location?.lng;

        // Get a photo URL if available
        let imageUrl: string | undefined;
        if (result?.photos?.[0]?.photo_reference) {
          const photoUrl = new URL("https://maps.googleapis.com/maps/api/place/photo");
          photoUrl.searchParams.set("maxwidth", "1200");
          photoUrl.searchParams.set("photo_reference", result.photos[0].photo_reference);
          photoUrl.searchParams.set("key", GOOGLE_PLACES_KEY);
          imageUrl = photoUrl.toString();
        }

        // Extract country from address_components
        const countryComponent = result?.address_components?.find((c: any) =>
          c.types.includes("country")
        );
        const country = countryComponent?.long_name || "";

        return { lat, lng, imageUrl, country };
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

        const placesSummary = selectedPlaces && selectedPlaces.length > 0
          ? `\nLugares selecionados pelo usuário:\n${selectedPlaces.map((p) => `- ${p.name} (${p.category}) em ${p.destinationName}${p.hours ? `, horário: ${p.hours}` : ""}${p.address ? `, endereço: ${p.address}` : ""}${p.lat && p.lng ? `, coordenadas: ${p.lat},${p.lng}` : ""}`).join("\n")}`
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
- O travelModeToNext deve refletir o meio de transporte preferido: ${cityTransportMode || 'driving'}.`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "Você é um guia de viagens especialista. Crie roteiros detalhados, práticos e culturalmente ricos. Responda sempre em JSON válido." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
        });

        const content = response.choices[0].message.content as string;
        try {
          const parsed = JSON.parse(content);
          return { days: parsed.days || [] };
        } catch {
          return { days: [] };
        }
      }),

    /**
     * Generate place suggestions for a destination by category.
     * Used in the "Lugares" tab when AI selects places.
     */
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
        });

        const content = response.choices[0].message.content as string;
        try {
          const parsed = JSON.parse(content);
          // Handle both flat array and nested object formats
          let places = parsed.places || [];
          if (!Array.isArray(places)) {
            // Flatten nested categories
            places = Object.values(places).flat();
          }
          return { places };
        } catch {
          return { places: [] };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
