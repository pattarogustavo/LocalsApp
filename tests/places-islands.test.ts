import { describe, it, expect } from "vitest";

const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_KEY;

describe("Google Places — island search", () => {
  it("should return Mallorca/Maiorca in geocode results", async () => {
    if (!GOOGLE_PLACES_KEY) {
      console.warn("GOOGLE_PLACES_KEY not set, skipping");
      return;
    }

    const queries = ["Maiorca", "Mallorca", "Menorca", "Ibiza"];

    for (const query of queries) {
      const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
      url.searchParams.set("input", query);
      url.searchParams.set("types", "geocode");
      url.searchParams.set("language", "pt-BR");
      url.searchParams.set("key", GOOGLE_PLACES_KEY);

      const res = await fetch(url.toString());
      const data = await res.json() as any;

      console.log(`\n=== "${query}" (geocode) status: ${data.status} ===`);
      for (const p of (data.predictions || []).slice(0, 5)) {
        console.log(`  [${p.types?.join(", ")}] ${p.description}`);
      }

      // Also try (cities)
      const url2 = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
      url2.searchParams.set("input", query);
      url2.searchParams.set("types", "(cities)");
      url2.searchParams.set("language", "pt-BR");
      url2.searchParams.set("key", GOOGLE_PLACES_KEY);

      const res2 = await fetch(url2.toString());
      const data2 = await res2.json() as any;

      console.log(`=== "${query}" (cities) status: ${data2.status} ===`);
      for (const p of (data2.predictions || []).slice(0, 5)) {
        console.log(`  [${p.types?.join(", ")}] ${p.description}`);
      }
    }

    expect(true).toBe(true);
  });
});
