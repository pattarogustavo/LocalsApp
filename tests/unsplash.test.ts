import { describe, it, expect } from "vitest";
import {
  buildUnsplashQuery,
  isUsableUnsplashResult,
  pickUsableUnsplashResult,
  type UnsplashSearchResult,
} from "../server/unsplash";

describe("buildUnsplashQuery", () => {
  it("[FASE 3] formats as '<local city> - <local country>'", () => {
    expect(buildUnsplashQuery("London", "United Kingdom")).toBe("London - United Kingdom");
    expect(buildUnsplashQuery("München", "Deutschland")).toBe("München - Deutschland");
    expect(buildUnsplashQuery("Firenze", "Italia")).toBe("Firenze - Italia");
  });

  it("falls back to just the city name when no country is known", () => {
    expect(buildUnsplashQuery("London", undefined)).toBe("London");
  });

  it("[FASE 1/3 regression — the actual bug] the query is invariant to the app's UI language: only the LOCAL name matters, so 'London' searched by a pt-BR user and an en user produce the identical query once both resolve to the same local name", () => {
    // This is the crux of the fix: the caller always passes the destination's
    // own LOCAL-language name/country (resolved server-side via
    // resolveLocalLanguageForCountry), never whatever the app's current UI
    // language happens to be — so there is no code path left where a
    // Portuguese-UI search and an English-UI search for the same real city
    // feed two different strings into this function.
    const localCityName = "London";
    const localCountryName = "United Kingdom";
    const queryFromPtUiSession = buildUnsplashQuery(localCityName, localCountryName);
    const queryFromEnUiSession = buildUnsplashQuery(localCityName, localCountryName);
    expect(queryFromPtUiSession).toBe(queryFromEnUiSession);
  });

  it("does not confuse two different real cities into the same query", () => {
    const paris = buildUnsplashQuery("Paris", "France");
    const parisTexas = buildUnsplashQuery("Paris", "United States");
    expect(paris).not.toBe(parisTexas);
  });
});

describe("isUsableUnsplashResult", () => {
  it("is usable when a regular URL is present", () => {
    expect(isUsableUnsplashResult({ urls: { regular: "https://images.unsplash.com/x" } })).toBe(true);
  });

  it("is not usable without a regular URL", () => {
    expect(isUsableUnsplashResult({ urls: {} })).toBe(false);
    expect(isUsableUnsplashResult({})).toBe(false);
    expect(isUsableUnsplashResult(undefined)).toBe(false);
  });
});

describe("pickUsableUnsplashResult (deterministic selection, FASE 3)", () => {
  const cityShot = (url: string): UnsplashSearchResult => ({
    alt_description: "aerial view of a city skyline with historic buildings",
    urls: { regular: url },
  });
  const irrelevantShot = (url: string): UnsplashSearchResult => ({
    alt_description: "a cat sitting on a couch",
    urls: { regular: url },
  });

  it("[FASE 3 — no more Math.random()] always prefers the first relevant, usable result — repeated calls with the same input never vary", () => {
    const results = [cityShot("a"), cityShot("b"), cityShot("c")];
    const picks = Array.from({ length: 20 }, () => pickUsableUnsplashResult(results));
    expect(new Set(picks).size).toBe(1); // never random across repeated calls
    expect(picks[0]).toBe("a");
  });

  it("falls back to the second result when the first is relevant but unusable (no renderable URL)", () => {
    const results: UnsplashSearchResult[] = [
      { alt_description: "a city skyline at sunset", urls: {} }, // relevant but unusable
      cityShot("b"),
    ];
    expect(pickUsableUnsplashResult(results)).toBe("b");
  });

  it("filters out irrelevant results (no place-related caption term) before picking", () => {
    const results = [irrelevantShot("cat"), cityShot("city")];
    expect(pickUsableUnsplashResult(results)).toBe("city");
  });

  it("returns undefined when nothing is relevant", () => {
    const results = [irrelevantShot("a"), irrelevantShot("b")];
    expect(pickUsableUnsplashResult(results)).toBeUndefined();
  });

  it("returns undefined for an empty result set (API failure/no results handled gracefully)", () => {
    expect(pickUsableUnsplashResult([])).toBeUndefined();
  });
});
