/**
 * JSON schema for the itinerary-generation LLM call, passed as `outputSchema`
 * to invokeLLM (server/_core/llm.ts) so the model's output is constrained to
 * this shape via Structured Outputs, instead of trusting a "respond with
 * JSON" text instruction (which has no structural guarantee).
 *
 * This intentionally mirrors only the fields the two itinerary prompts
 * already ask for in text today (see server/routers.ts) — it does not add or
 * rename anything the existing UI (types/voyage.ts DayItinerary/ItineraryStop)
 * doesn't already expect, so the output contract is unchanged.
 *
 * Strict-mode shape (OpenAI Structured Outputs, `strict: true`): every
 * property must appear in `required` and every object needs
 * `additionalProperties: false` — optionality is expressed as a nullable
 * union (`type: [..., "null"]`) rather than omission from `required`. See
 * the migration report for the source. Callers that still want a *softer*
 * best-effort shape (no strict enforcement) can pass `strict: false` on the
 * outer `{ name, schema, strict }` wrapper given to invokeLLM — this
 * function always emits the strict-compatible shape either way, since a
 * stricter schema is also valid input for non-strict mode.
 */

const nullable = (schema: Record<string, unknown>): Record<string, unknown> => {
  const type = schema.type;
  return { ...schema, type: Array.isArray(type) ? type : [type, "null"] };
};

const stopSchema = {
  type: "object",
  properties: {
    time: { type: "string", description: "HH:MM" },
    googlePlaceId: nullable({ type: "string" }),
    placeName: { type: "string" },
    placeCategory: { type: "string", enum: ["attraction", "restaurant", "cafe", "museum", "hidden_gem", "other", "park", "beach", "market", "neighborhood"] },
    description: nullable({ type: "string" }),
    hours: nullable({ type: "string" }),
    address: nullable({ type: "string" }),
    lat: nullable({ type: "number" }),
    lng: nullable({ type: "number" }),
    travelTimeToNext: nullable({ type: "string" }),
    travelModeToNext: nullable({ type: "string", enum: ["walking", "driving", "transit", "bicycling", null] }),
  },
  required: [
    "time", "googlePlaceId", "placeName", "placeCategory", "description",
    "hours", "address", "lat", "lng", "travelTimeToNext", "travelModeToNext",
  ],
  additionalProperties: false,
} as const;

export function buildItineraryDaysSchema(opts: { dayTipField: "tip" | "tips" }): Record<string, unknown> {
  const dayProperties: Record<string, unknown> = {
    date: { type: "string", description: "YYYY-MM-DD" },
    destination: { type: "string" },
    title: nullable({ type: "string" }),
    estimatedCost: nullable({ type: "number" }),
    // Additive — lets the model state WHICH currency estimatedCost is
    // actually in (its own local-currency estimate, per the updated prompt
    // instruction below) instead of the prior hardcoded-USD assumption,
    // which silently mismatched types/voyage.ts's own documented contract
    // ("estimatedCost: ... in local currency" + a separate
    // estimatedCostCurrency field that the old schema never populated).
    estimatedCostCurrency: nullable({ type: "string" }),
    stops: { type: "array", items: stopSchema },
  };
  dayProperties[opts.dayTipField] = nullable({ type: "string" });

  return {
    type: "object",
    properties: {
      days: {
        type: "array",
        items: {
          type: "object",
          properties: dayProperties,
          required: ["date", "destination", "title", "estimatedCost", "estimatedCostCurrency", "stops", opts.dayTipField],
          additionalProperties: false,
        },
      },
    },
    required: ["days"],
    additionalProperties: false,
  };
}

/**
 * Minimal per-day schema for ai.generateFromScratch's parallel-by-day
 * "direct generation" redesign (itinerary-engine speed/quality pass).
 *
 * Drops everything the backend computes/verifies itself after generation
 * instead of trusting the model for it: googlePlaceId, hours, address, lat,
 * lng, travelTimeToNext, travelModeToNext (resolved by
 * resolveAndVerifyStops + the Google Routes travel fetcher in
 * server/routers.ts), plus date/destination/dayNumber (the backend already
 * knows these from the day descriptor it generated the prompt from — asking
 * the model to echo them back is pure wasted output). Measured impact of
 * dropping the stop-level fields alone (server/itinerary/schema.ts's full
 * stopSchema vs. this one): ~3.5x fewer output tokens for the same content,
 * ~2.8-3.1x faster wall-clock time, in a real isolated OpenAI benchmark
 * (gpt-6.1-sol, Responses API, Structured Outputs) run before this change —
 * see the itinerary-engine optimization session notes for the raw numbers.
 */
const minimalStopSchema = {
  type: "object",
  properties: {
    time: { type: "string", description: "HH:MM" },
    placeName: { type: "string" },
    placeCategory: { type: "string", enum: ["attraction", "restaurant", "cafe", "museum", "hidden_gem", "other", "park", "beach", "market", "neighborhood"] },
    description: { type: "string" },
  },
  required: ["time", "placeName", "placeCategory", "description"],
  additionalProperties: false,
} as const;

export function buildMinimalDaySchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      title: nullable({ type: "string" }),
      tip: nullable({ type: "string" }),
      estimatedCost: nullable({ type: "number" }),
      estimatedCostCurrency: nullable({ type: "string" }),
      stops: { type: "array", items: minimalStopSchema },
    },
    required: ["title", "tip", "estimatedCost", "estimatedCostCurrency", "stops"],
    additionalProperties: false,
  };
}
