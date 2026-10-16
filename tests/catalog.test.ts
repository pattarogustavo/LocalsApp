import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { categorizeCandidate, buildDeterministicFallbackPlaces, type NearbyCandidate } from "../server/routers";

// Minimal chainable stand-in for a drizzle query builder (same pattern as
// tests/push-tokens.test.ts): every method records the call and returns
// `this`, and the chain is awaitable, resolving to `result`.
function createChain(result: unknown = []) {
  const calls: Array<[string, ...any[]]> = [];
  const chain: any = { calls };
  const methods = ["from", "where", "values", "onConflictDoUpdate", "set", "limit", "orderBy"];
  for (const name of methods) {
    chain[name] = vi.fn((...args: unknown[]) => {
      calls.push([name, ...args]);
      return chain;
    });
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

function mockDb(rows: unknown[]) {
  const selectChain = createChain(rows);
  const fakeDb = { select: vi.fn(() => selectChain) };
  vi.doMock("drizzle-orm/postgres-js", () => ({ drizzle: () => fakeDb }));
  return fakeDb;
}

const londonRow = {
  id: 1,
  slug: "london-gb",
  nameEn: "London",
  namePt: "Londres",
  country: "United Kingdom",
  countryCode: "GB",
  googlePlaceId: "ChIJdd4hrwug2EcRmSrV3Vo6llI",
  status: "active" as const,
};

describe("catalog.findCatalogDestination — destination matching", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.CATALOG_ENABLED;
    delete process.env.GOOGLE_PLACES_API_KEY;
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches the English name with the country in English", async () => {
    mockDb([londonRow]);
    const catalog = await import("../server/catalog");
    const result = await catalog.findCatalogDestination("London", "United Kingdom");
    expect(result?.slug).toBe("london-gb");
  });

  it("matches the Portuguese name with the country in Portuguese", async () => {
    mockDb([londonRow]);
    const catalog = await import("../server/catalog");
    const result = await catalog.findCatalogDestination("Londres", "Reino Unido");
    expect(result?.slug).toBe("london-gb");
  });

  it("matches via the destination's ISO country code", async () => {
    mockDb([londonRow]);
    const catalog = await import("../server/catalog");
    const result = await catalog.findCatalogDestination("London", "GB");
    expect(result?.slug).toBe("london-gb");
  });

  it("is case/accent/punctuation-insensitive on both name and country", async () => {
    mockDb([londonRow]);
    const catalog = await import("../server/catalog");
    const result = await catalog.findCatalogDestination("lóndon!!", "united-kingdom");
    expect(result?.slug).toBe("london-gb");
  });

  it("does not match the right name with the wrong country", async () => {
    mockDb([londonRow]);
    const catalog = await import("../server/catalog");
    const result = await catalog.findCatalogDestination("London", "France");
    expect(result).toBeNull();
  });

  it("falls back to resolving the destination's Google place_id when the name doesn't match nameEn/namePt (e.g. 'Londra', the Italian name)", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    mockDb([londonRow]);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({ results: [{ place_id: londonRow.googlePlaceId }] }),
    })));
    const catalog = await import("../server/catalog");
    const result = await catalog.findCatalogDestination("Londra", "Italia");
    expect(result?.slug).toBe("london-gb");
  });

  it("returns null when no destination matches by name or place_id", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    mockDb([londonRow]);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({ results: [{ place_id: "some-other-place-id" }] }),
    })));
    const catalog = await import("../server/catalog");
    const result = await catalog.findCatalogDestination("Nowhereville", "Nowhereland");
    expect(result).toBeNull();
  });

  it("CATALOG_ENABLED=false short-circuits without touching the database", async () => {
    process.env.CATALOG_ENABLED = "false";
    const fakeDb = mockDb([londonRow]);
    const catalog = await import("../server/catalog");
    const result = await catalog.findCatalogDestination("London", "United Kingdom");
    expect(result).toBeNull();
    expect(fakeDb.select).not.toHaveBeenCalled();
  });
});

describe("catalog.toCompatCategory — old-app category compatibility (categoriesV2)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("maps the new categories down to the pre-existing set when categoriesV2 is unset/false", async () => {
    const catalog = await import("../server/catalog");
    expect(catalog.toCompatCategory("park", undefined)).toBe("attraction");
    expect(catalog.toCompatCategory("beach", false)).toBe("attraction");
    expect(catalog.toCompatCategory("market", undefined)).toBe("other");
    expect(catalog.toCompatCategory("neighborhood", undefined)).toBe("hidden_gem");
  });

  it("leaves pre-existing categories untouched regardless of categoriesV2", async () => {
    const catalog = await import("../server/catalog");
    expect(catalog.toCompatCategory("museum", undefined)).toBe("museum");
    expect(catalog.toCompatCategory("restaurant", true)).toBe("restaurant");
  });

  it("keeps the new categories as-is when categoriesV2 is true", async () => {
    const catalog = await import("../server/catalog");
    expect(catalog.toCompatCategory("park", true)).toBe("park");
    expect(catalog.toCompatCategory("beach", true)).toBe("beach");
    expect(catalog.toCompatCategory("market", true)).toBe("market");
    expect(catalog.toCompatCategory("neighborhood", true)).toBe("neighborhood");
  });
});

describe("catalog.rankCuratedPlaces — ordering", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function place(overrides: Record<string, unknown>) {
    return { confidence: "medium", rank: 0, category: "attraction", ...overrides } as any;
  }

  it("ranks higher confidence before lower confidence", async () => {
    const catalog = await import("../server/catalog");
    const ranked = catalog.rankCuratedPlaces([
      place({ aiName: "low", confidence: "low" }),
      place({ aiName: "high", confidence: "high" }),
      place({ aiName: "med", confidence: "medium" }),
    ]);
    expect(ranked.map((p: any) => p.aiName)).toEqual(["high", "med", "low"]);
  });

  it("prioritizes requested categories ahead of confidence", async () => {
    const catalog = await import("../server/catalog");
    const ranked = catalog.rankCuratedPlaces(
      [
        place({ aiName: "high-other", confidence: "high", category: "other" }),
        place({ aiName: "low-wanted", confidence: "low", category: "museum" }),
      ],
      ["museum"],
    );
    expect(ranked[0].aiName).toBe("low-wanted");
  });
});

describe("buildDeterministicFallbackPlaces (server/routers.ts) — no-AI fallback selection", () => {
  function candidate(overrides: Partial<NearbyCandidate>): NearbyCandidate {
    return { name: "Place", placeId: "p", userRatingsTotal: 100, types: [], hasPhoto: true, ...overrides };
  }

  it("returns empty only when there are no real candidates", () => {
    expect(buildDeterministicFallbackPlaces([], new Set(), "pt", 15)).toEqual([]);
  });

  it("never returns empty when candidates exist", () => {
    const candidates = [
      candidate({ placeId: "p1", rating: 4.8, userRatingsTotal: 500, types: ["museum"] }),
      candidate({ placeId: "p2", rating: 4.0, userRatingsTotal: 50, types: ["restaurant"] }),
    ];
    const picked = buildDeterministicFallbackPlaces(candidates, new Set(), "pt", 15);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.length).toBeLessThanOrEqual(15);
  });

  it("caps results at the given limit and diversifies across categories", () => {
    const candidates = Array.from({ length: 30 }, (_, i) =>
      candidate({
        placeId: `p${i}`,
        name: `Place ${i}`,
        rating: 4.5,
        userRatingsTotal: 100 + i,
        types: [i % 2 === 0 ? "restaurant" : "museum"],
      })
    );
    const picked = buildDeterministicFallbackPlaces(candidates, new Set(), "en", 15);
    expect(picked.length).toBe(15);
    const categories = new Set(picked.map((p) => p.category));
    expect(categories.has("restaurant")).toBe(true);
    expect(categories.has("museum")).toBe(true);
  });

  it("excludes places already in the user's trip by name", () => {
    const candidates = [candidate({ name: "Already Added", placeId: "p1", rating: 4.8, userRatingsTotal: 500, types: ["museum"] })];
    const picked = buildDeterministicFallbackPlaces(candidates, new Set(["already added"]), "pt", 15);
    expect(picked).toEqual([]);
  });

  it("writes a short, localized generic description per category instead of leaving it blank", () => {
    const candidates = [candidate({ placeId: "p1", rating: 4.5, userRatingsTotal: 100, types: ["museum"] })];
    const [pick] = buildDeterministicFallbackPlaces(candidates, new Set(), "en", 15);
    expect(pick.category).toBe("museum");
    expect(pick.description.length).toBeGreaterThan(0);
    expect(pick.description.toLowerCase()).toContain("museum");
  });
});

describe("categorizeCandidate — Google types/rating heuristic (no AI)", () => {
  it("buckets by Google type first", () => {
    expect(categorizeCandidate({ name: "x", placeId: "p", userRatingsTotal: 1000, types: ["museum"], hasPhoto: true } as any)).toBe("museum");
    expect(categorizeCandidate({ name: "x", placeId: "p", userRatingsTotal: 1000, types: ["cafe"], hasPhoto: true } as any)).toBe("cafe");
    expect(categorizeCandidate({ name: "x", placeId: "p", userRatingsTotal: 1000, types: ["restaurant"], hasPhoto: true } as any)).toBe("restaurant");
  });

  it("flags a well-rated, low-review-count place as a hidden gem", () => {
    expect(categorizeCandidate({ name: "x", placeId: "p", rating: 4.6, userRatingsTotal: 20, types: ["point_of_interest"], hasPhoto: true } as any)).toBe("hidden_gem");
  });

  it("defaults to attraction otherwise", () => {
    expect(categorizeCandidate({ name: "x", placeId: "p", rating: 4.0, userRatingsTotal: 1000, types: ["point_of_interest"], hasPhoto: true } as any)).toBe("attraction");
  });
});
