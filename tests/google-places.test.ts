import { describe, expect, it } from "vitest";
import { resolvePlacesLocationBias, DEFAULT_PLACES_BIAS_RADIUS_METERS, resolveLocalLanguageForCountry } from "../server/google-places";

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

describe("resolvePlacesLocationBias (hotel/address search region fix)", () => {
  it("[fixture: região correta] builds a location+radius bias when destination coordinates are known", () => {
    const bias = resolvePlacesLocationBias(41.3851, 2.1734); // Barcelona
    expect(bias).toEqual({ location: "41.3851,2.1734", radius: String(DEFAULT_PLACES_BIAS_RADIUS_METERS) });
  });

  it("respects an explicit radius override", () => {
    const bias = resolvePlacesLocationBias(41.3851, 2.1734, 10000);
    expect(bias?.radius).toBe("10000");
  });

  it("[fixture: ausência de destino] returns null (no bias, plain global search) when coordinates are missing — never invents a center", () => {
    expect(resolvePlacesLocationBias(undefined, undefined)).toBeNull();
    expect(resolvePlacesLocationBias(41.3851, undefined)).toBeNull();
    expect(resolvePlacesLocationBias(undefined, 2.1734)).toBeNull();
  });

  it("[fixture: destino ambíguo] a bias is still just a SOFT hint (location+radius, no strictbounds) — same mechanism Google uses to prefer the nearby match for an ambiguous name (e.g. a city sharing its name with another elsewhere) without hard-excluding every other result", () => {
    const bias = resolvePlacesLocationBias(48.8566, 2.3522); // Paris, France
    expect(bias?.location).toBe("48.8566,2.3522");
    // No strictbounds param exists in this helper's output shape at all —
    // asserting the shape itself documents the "bias, not restriction" contract.
    expect(Object.keys(bias!)).toEqual(["location", "radius"]);
  });

  it("treats NaN coordinates as missing rather than sending a malformed request", () => {
    expect(resolvePlacesLocationBias(NaN, 2.1734)).toBeNull();
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
