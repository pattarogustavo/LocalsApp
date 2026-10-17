import { describe, expect, it, vi } from "vitest";
import { resolveDestinationForCity, planCityPlaces, type PlanCityPlacesDeps } from "../scripts/curate/import-run";
import { newDiscardReasonCounts } from "../scripts/curate/verify";
import type { ResolvedCityDestination } from "../scripts/curate/import-json";
import type { ImportRawPlace } from "../scripts/curate/import-json";
import type { GoogleMatch } from "../scripts/curate/google";

const center = { lat: 38.7223, lng: -9.1393 };

function destination(overrides: Partial<ResolvedCityDestination> = {}): ResolvedCityDestination {
  return { slug: "lisbon-pt", nameEn: "Lisbon", namePt: "Lisboa", country: "Portugal", countryCode: "PT", tier: "large", slugInferred: false, ...overrides };
}

function match(overrides: Partial<GoogleMatch> = {}): GoogleMatch {
  return { placeId: "ChIJQ1h4rH83GQ0RI_94yeuAN9U", name: "Torre de Belém", lat: center.lat, lng: center.lng, types: ["tourist_attraction"], ...overrides };
}

function deps(overrides: Partial<PlanCityPlacesDeps> = {}): PlanCityPlacesDeps {
  return {
    places: [{ name: "Torre de Belém", descriptions: { pt: "p", en: "e" } }],
    destinationName: "Lisbon",
    countryCode: "PT",
    center,
    maxDistanceKm: 35,
    discardCounts: newDiscardReasonCounts(),
    findByText: async () => [match()],
    findByTextSearch: async () => [],
    ...overrides,
  };
}

describe("resolveDestinationForCity", () => {
  it("uses an existing destinations.ts seed, ignoring the given fields", async () => {
    const resolution = await resolveDestinationForCity(
      destination({ nameEn: "WRONG", namePt: "WRONG", country: "WRONG", countryCode: "ZZ", tier: "small" }),
      (slug) => (slug === "lisbon-pt" ? { nameEn: "Lisbon", namePt: "Lisboa", countryCode: "PT", tier: "large" } : undefined),
      async () => undefined,
      (code) => (code === "PT" ? "Portugal" : code),
    );
    expect(resolution).toMatchObject({ nameEn: "Lisbon", country: "Portugal", tier: "large", isNew: false });
  });

  it("uses an existing database row when no destinations.ts seed matches", async () => {
    const resolution = await resolveDestinationForCity(
      destination({ slug: "porto-pt", nameEn: "WRONG", namePt: "WRONG", country: "WRONG", countryCode: "ZZ", tier: "small" }),
      () => undefined,
      async (slug) =>
        slug === "porto-pt" ? { nameEn: "Porto", namePt: "Porto", country: "Portugal", countryCode: "PT", tier: "medium", googlePlaceId: "existing-id" } : undefined,
      (code) => code,
    );
    expect(resolution).toMatchObject({ nameEn: "Porto", tier: "medium", googlePlaceId: "existing-id", isNew: false });
  });

  it("keeps the given fields for a brand-new slug", async () => {
    const resolution = await resolveDestinationForCity(destination(), () => undefined, async () => undefined, (code) => code);
    expect(resolution).toMatchObject({ slug: "lisbon-pt", nameEn: "Lisbon", country: "Portugal", tier: "large", isNew: true });
    expect(resolution.googlePlaceId).toBeUndefined();
  });
});

describe("planCityPlaces", () => {
  it("resolves a place that matches Google, with its given category kept", async () => {
    const plan = await planCityPlaces(
      deps({ places: [{ name: "Torre de Belém", category: "attraction", descriptions: { pt: "p", en: "e" } }] }),
    );
    expect(plan.resolved).toHaveLength(1);
    expect(plan.resolved[0]).toMatchObject({ requestedName: "Torre de Belém", googlePlaceId: match().placeId, category: "attraction" });
    expect(plan.rejected).toEqual([]);
    expect(plan.invalidInput).toEqual([]);
    expect(plan.languageRetryAccepted).toBe(0);
    expect(plan.typeRetryAccepted).toBe(0);
  });

  it("infers a missing category from the matched Google candidate's types", async () => {
    const plan = await planCityPlaces(
      deps({
        places: [{ name: "Mercado do Bolhão", descriptions: { en: "a market" } }],
        findByText: async () => [match({ name: "Mercado do Bolhão", types: ["market", "point_of_interest"] })],
      }),
    );
    expect(plan.resolved[0].category).toBe("market");
  });

  it("falls back to 'other' when the category is missing and Google's types don't map to anything", async () => {
    const plan = await planCityPlaces(
      deps({
        places: [{ name: "Something", descriptions: { en: "x" } }],
        findByText: async () => [match({ name: "Something", types: ["establishment"] })],
      }),
    );
    expect(plan.resolved[0].category).toBe("other");
  });

  it("reports a place with no Google match as rejected, not invalid", async () => {
    const plan = await planCityPlaces(deps({ findByText: async () => [] }));
    expect(plan.resolved).toEqual([]);
    expect(plan.rejected).toEqual([{ name: "Torre de Belém", reason: "no Google match found", googleNames: [] }]);
  });

  it("reports a place that fails our own validation as invalid, without calling Google", async () => {
    const findByText = vi.fn(async () => [match()]);
    const plan = await planCityPlaces(deps({ places: [{ name: "No description", descriptions: {} }], findByText }));
    expect(findByText).not.toHaveBeenCalled();
    expect(plan.invalidInput).toHaveLength(1);
    expect(plan.invalidInput[0].name).toBe("No description");
  });

  it("matches via an explicit altName even when the primary name doesn't match Google's result", async () => {
    const plan = await planCityPlaces(
      deps({
        places: [{ name: "Torre de Belém", altNames: ["Belem Tower"], descriptions: { en: "x" } }],
        findByText: async () => [match({ name: "Belém Tower" })],
      }),
    );
    expect(plan.resolved).toHaveLength(1);
  });

  it("counts a place accepted only via the local-language retry", async () => {
    const findByText = vi.fn(async (_names: string[], _nb: unknown, language: string | undefined) =>
      language === "pt" ? [match({ name: "Torre de Belém" })] : [match({ name: "Belém Tower" })],
    );
    const plan = await planCityPlaces(deps({ findByText }));
    expect(plan.resolved).toHaveLength(1);
    expect(plan.languageRetryAccepted).toBe(1);
  });

  it("counts a place accepted only via the type-biased Text Search retry (Puerta del Sol)", async () => {
    const plan = await planCityPlaces(
      deps({
        places: [{ name: "Puerta del Sol", category: "attraction", descriptions: { en: "x" } }],
        findByText: async () => [match({ name: "Puerta del Sol", types: ["route"] })],
        findByTextSearch: async (_names, type) => {
          expect(type).toBe("tourist_attraction");
          return [match({ name: "Puerta del Sol", placeId: "ChIJtextsearchRealId00000000000000", types: ["tourist_attraction"] })];
        },
      }),
    );
    expect(plan.resolved).toHaveLength(1);
    expect(plan.typeRetryAccepted).toBe(1);
  });

  it("dedupes two places that resolve to the same googlePlaceId", async () => {
    const plan = await planCityPlaces(
      deps({
        places: [
          { name: "Torre de Belém", descriptions: { en: "a" } },
          { name: "Belem Tower", descriptions: { en: "b" } },
        ],
        findByText: async (names: string[]) => [match({ name: names[0] })],
      }),
    );
    expect(plan.resolved).toHaveLength(1);
  });

  it("processes every place independently — one failure doesn't block the rest", async () => {
    const plan = await planCityPlaces(
      deps({
        places: [
          { name: "Good Place", descriptions: { en: "ok" } },
          { name: "No Match", descriptions: { en: "ok" } },
        ],
        findByText: async (names: string[]) => (names[0] === "Good Place" ? [match({ name: names[0] })] : []),
      }),
    );
    expect(plan.resolved.map((p) => p.requestedName)).toEqual(["Good Place"]);
    expect(plan.rejected.map((r) => r.name)).toEqual(["No Match"]);
  });

  it("D) still rejects a false match end-to-end (Le Marais vs 3rd arrondissement)", async () => {
    const plan = await planCityPlaces(
      deps({
        places: [{ name: "Le Marais", descriptions: { en: "x" } }],
        findByText: async () => [match({ name: "3rd arrondissement", types: ["route"] })],
        findByTextSearch: async () => [match({ name: "3rd arrondissement", placeId: "ChIJ3rdarrondissement00000000000000" })],
      }),
    );
    expect(plan.resolved).toEqual([]);
    expect(plan.rejected).toHaveLength(1);
  });

  it("running the same input twice is idempotent (same resolved set both times)", async () => {
    const run = () => planCityPlaces(deps());
    const a = await run();
    const b = await run();
    expect(a.resolved).toEqual(b.resolved);
  });
});
