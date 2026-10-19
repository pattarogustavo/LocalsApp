import { describe, expect, it } from "vitest";

import { resolveLocalLanguageForCountry } from "../server/google-places";

describe("resolveLocalLanguageForCountry (destination-name/Unsplash-query language fix, FASE 1/3)", () => {
  it("resolves well-known countries to their dominant local language", () => {
    expect(resolveLocalLanguageForCountry("GB")).toBe("en");
    expect(resolveLocalLanguageForCountry("DE")).toBe("de");
    expect(resolveLocalLanguageForCountry("IT")).toBe("it");
    expect(resolveLocalLanguageForCountry("FR")).toBe("fr");
    expect(resolveLocalLanguageForCountry("PT")).toBe("pt");
    expect(resolveLocalLanguageForCountry("BR")).toBe("pt");
  });

  it("is case-insensitive on the ISO code", () => {
    expect(resolveLocalLanguageForCountry("gb")).toBe("en");
  });

  it("falls back to English for an unmapped or missing country code — never throws, never guesses a made-up language", () => {
    expect(resolveLocalLanguageForCountry("XX")).toBe("en");
    expect(resolveLocalLanguageForCountry(undefined)).toBe("en");
  });
});

describe("Google Places API Key", () => {
  it("should be set in environment", () => {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    expect(key).toBeDefined();
    expect(key?.length).toBeGreaterThan(10);
  });

  it("should be able to call Places Autocomplete API", async () => {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=Paris&types=(cities)&key=${key}`;
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    const data = await res.json() as any;
    expect(data.status).toBe("OK");
    expect(data.predictions.length).toBeGreaterThan(0);
    expect(data.predictions[0].description).toContain("Paris");
  }, 10000);
});
