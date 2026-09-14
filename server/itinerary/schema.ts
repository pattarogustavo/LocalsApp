/**
 * JSON schema for the itinerary-generation LLM call, passed as `outputSchema`
 * to invokeLLM (server/_core/llm.ts) so Anthropic tool-forces valid JSON
 * matching this shape, instead of trusting a "respond with JSON" text
 * instruction (the previous approach, `response_format: json_object`, which
 * has no structural guarantee).
 *
 * This intentionally mirrors only the fields the two itinerary prompts
 * already ask for in text today (see server/routers.ts) — it does not add or
 * rename anything the existing UI (types/voyage.ts DayItinerary/ItineraryStop)
 * doesn't already expect, so the output contract is unchanged.
 */

const stopSchema = {
  type: "object",
  properties: {
    time: { type: "string", description: "HH:MM" },
    placeId: { type: "string" },
    placeName: { type: "string" },
    placeCategory: { type: "string", enum: ["attraction", "restaurant", "cafe", "museum", "hidden_gem", "other"] },
    description: { type: "string" },
    hours: { type: "string" },
    address: { type: "string" },
    lat: { type: "number" },
    lng: { type: "number" },
    travelTimeToNext: { type: "string" },
    travelModeToNext: { type: "string", enum: ["walking", "driving", "transit", "bicycling"] },
  },
  required: ["time", "placeName", "placeCategory"],
} as const;

export function buildItineraryDaysSchema(opts: { dayTipField: "tip" | "tips" }): Record<string, unknown> {
  const dayProperties: Record<string, unknown> = {
    date: { type: "string", description: "YYYY-MM-DD" },
    destination: { type: "string" },
    title: { type: "string" },
    estimatedCost: { type: "number" },
    stops: { type: "array", items: stopSchema },
  };
  dayProperties[opts.dayTipField] = { type: "string" };

  return {
    type: "object",
    properties: {
      days: {
        type: "array",
        items: {
          type: "object",
          properties: dayProperties,
          required: ["date", "destination", "stops"],
        },
      },
    },
    required: ["days"],
  };
}
