import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { z } from "zod";

const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

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
            })
          ).optional(),
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
        const { startDate, totalDays, destinations, selectedPlaces, preferences } = input;

        const destSummary = destinations
          .map((d) => `${d.name} (${d.country || ""}) — ${d.days} dias`)
          .join(", ");

        const placesSummary = selectedPlaces && selectedPlaces.length > 0
          ? `\nLugares selecionados pelo usuário:\n${selectedPlaces.map((p) => `- ${p.name} (${p.category}) em ${p.destinationName}${p.hours ? `, horário: ${p.hours}` : ""}`).join("\n")}`
          : "\nUse sua expertise para sugerir os melhores lugares para visitar.";

        const paceStops = preferences?.pace === 'relaxado' ? 3 : preferences?.pace === 'intenso' ? 6 : 4;

        const prompt = `Crie um roteiro de viagem dia a dia detalhado para ${totalDays} dias.

Data de início: ${startDate}
Destinos: ${destSummary}
${placesSummary}

Preferências:
- Ritmo: ${preferences?.pace || "moderado"} (${paceStops} paradas por dia)
- Horário de acordar: ${preferences?.wakeUpTime || "08:00"}
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
  { time (HH:MM), placeName, placeCategory (attraction|restaurant|cafe|museum|hidden_gem|other), description, hours (horário de funcionamento), address, travelTimeToNext (ex: "15 min a pé"), travelModeToNext (walking|driving|transit) }

Importante: inclua ${paceStops} paradas por dia. Distribua bem os horários ao longo do dia. Para restaurantes, use horários de refeição (08:00 café, 13:00 almoço, 20:00 jantar).`;

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
          destination: z.string(),
          country: z.string().optional(),
          days: z.number(),
          preferences: z.object({
            style: z.array(z.string()).optional(),
            budget: z.enum(["econômico", "moderado", "luxo"]).optional(),
          }).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { destination, country, days, preferences } = input;

        const prompt = `Sugira os melhores lugares para visitar em ${destination}${country ? `, ${country}` : ""} para uma viagem de ${days} dias.

${preferences?.style ? `Estilo: ${preferences.style.join(", ")}` : ""}
${preferences?.budget ? `Orçamento: ${preferences.budget}` : ""}

Retorne um JSON com o objeto "places" contendo arrays por categoria:
- attractions: pontos turísticos (máx 6)
- restaurants: restaurantes (máx 5)
- cafes: cafés (máx 4)
- museums: museus (máx 4)
- hidden_gems: lugares menos conhecidos (máx 3)

Cada lugar deve ter: { name, category, address, hours, description, rating, estimatedDuration, priceRange }`;

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
          return { places: parsed.places || parsed };
        } catch {
          return { places: {} };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
