import { describe, expect, it } from "vitest";
import { resolveDestinationForCity, planCityPlaces } from "../scripts/curate/import-run";
import { newDiscardReasonCounts } from "../scripts/curate/verify";
import type { ImportCityBlock } from "../scripts/curate/import-json";
import type { GoogleMatch } from "../scripts/curate/google";

const center = { lat: 38.7223, lng: -9.1393 };

function block(overrides: Partial<ImportCityBlock> = {}): ImportCityBlock {
  return {
    destination: { slug: "lisbon-pt", nameEn: "Lisbon", namePt: "Lisboa", country: "Portugal", countryCode: "PT", tier: "large" },
    places: [{ name: "Torre de Belém", descriptions: { pt: "p", en: "e" } }],
    ...overrides,
  };
}

function match(overrides: Partial<GoogleMatch> = {}): GoogleMatch {
  return { placeId: "ChIJQ1h4rH83GQ0RI_94yeuAN9U", name: "Torre de Belém", lat: center.lat, lng: center.lng, types: ["tourist_attraction"], ...overrides };
}

describe("resolveDestinationForCity", () => {
  it("uses an existing destinations.ts seed, ignoring the block's own fields", async () => {
    const resolution = await resolveDestinationForCity(
      block({ destination: { slug: "lisbon-pt", nameEn: "WRONG", namePt: "WRONG", country: "WRONG", countryCode: "ZZ", tier: "small" } }),
      (slug) => (slug === "lisbon-pt" ? { nameEn: "Lisbon", namePt: "Lisboa", countryCode: "PT", tier: "large" } : undefined),
      async () => undefined,
      (code) => (code === "PT" ? "Portugal" : code),
    );
    expect(resolution).toMatchObject({ nameEn: "Lisbon", country: "Portugal", tier: "large", isNew: false });
  });

  it("uses an existing database row when no destinations.ts seed matches", async () => {
    const resolution = await resolveDestinationForCity(
      block({ destination: { slug: "porto-pt", nameEn: "WRONG", namePt: "WRONG", country: "WRONG", countryCode: "ZZ", tier: "small" } }),
      () => undefined,
      async (slug) =>
        slug === "porto-pt" ? { nameEn: "Porto", namePt: "Porto", country: "Portugal", countryCode: "PT", tier: "medium", googlePlaceId: "existing-id" } : undefined,
      (code) => code,
    );
    expect(resolution).toMatchObject({ nameEn: "Porto", tier: "medium", googlePlaceId: "existing-id", isNew: false });
  });

  it("keeps the block's own fields for a brand-new slug", async () => {
    const resolution = await resolveDestinationForCity(block(), () => undefined, async () => undefined, (code) => code);
    expect(resolution).toMatchObject({ slug: "lisbon-pt", nameEn: "Lisbon", country: "Portugal", tier: "large", isNew: true });
    expect(resolution.googlePlaceId).toBeUndefined();
  });
});

describe("planCityPlaces", () => {
  it("resolves a place that matches Google, with its given category kept", async () => {
    const plan = await planCityPlaces(
      block({ places: [{ name: "Torre de Belém", category: "attraction", descriptions: { pt: "p", en: "e" } }] }),
      async () => [match()],
      center,
      35,
      newDiscardReasonCounts(),
    );
    expect(plan.resolved).toHaveLength(1);
    expect(plan.resolved[0]).toMatchObject({ requestedName: "Torre de Belém", googlePlaceId: match().placeId, category: "attraction" });
    expect(plan.rejected).toEqual([]);
    expect(plan.invalidInput).toEqual([]);
  });

  it("infers a missing category from the matched Google candidate's types", async () => {
    const plan = await planCityPlaces(
      block({ places: [{ name: "Mercado do Bolhão", descriptions: { en: "a market" } }] }),
      async () => [match({ name: "Mercado do Bolhão", types: ["market", "point_of_interest"] })],
      center,
      35,
      newDiscardReasonCounts(),
    );
    expect(plan.resolved[0].category).toBe("market");
  });

  it("falls back to 'other' when the category is missing and Google's types don't map to anything", async () => {
    const plan = await planCityPlaces(
      block({ places: [{ name: "Something", descriptions: { en: "x" } }] }),
      async () => [match({ name: "Something", types: ["establishment"] })],
      center,
      35,
      newDiscardReasonCounts(),
    );
    expect(plan.resolved[0].category).toBe("other");
  });

  it("reports a place with no Google match as rejected, not invalid", async () => {
    const plan = await planCityPlaces(block(), async () => [], center, 35, newDiscardReasonCounts());
    expect(plan.resolved).toEqual([]);
    expect(plan.rejected).toEqual([{ name: "Torre de Belém", reason: "no Google match found" }]);
  });

  it("reports a place that fails our own validation as invalid, without calling Google", async () => {
    let called = false;
    const plan = await planCityPlaces(
      block({ places: [{ name: "No description", descriptions: {} }] }),
      async () => {
        called = true;
        return [match()];
      },
      center,
      35,
      newDiscardReasonCounts(),
    );
    expect(called).toBe(false);
    expect(plan.invalidInput).toHaveLength(1);
    expect(plan.invalidInput[0].name).toBe("No description");
  });

  it("dedupes two places that resolve to the same googlePlaceId", async () => {
    const plan = await planCityPlaces(
      block({
        places: [
          { name: "Torre de Belém", descriptions: { en: "a" } },
          { name: "Belem Tower", descriptions: { en: "b" } },
        ],
      }),
      async (name) => [match({ name })],
      center,
      35,
      newDiscardReasonCounts(),
    );
    expect(plan.resolved).toHaveLength(1);
  });

  it("processes every place independently — one failure doesn't block the rest", async () => {
    const plan = await planCityPlaces(
      block({
        places: [
          { name: "Good Place", descriptions: { en: "ok" } },
          { name: "No Match", descriptions: { en: "ok" } },
        ],
      }),
      async (name) => (name === "Good Place" ? [match({ name })] : []),
      center,
      35,
      newDiscardReasonCounts(),
    );
    expect(plan.resolved.map((p) => p.requestedName)).toEqual(["Good Place"]);
    expect(plan.rejected.map((r) => r.name)).toEqual(["No Match"]);
  });

  it("running the same input twice is idempotent (same resolved set both times)", async () => {
    const findMatches = async () => [match()];
    const a = await planCityPlaces(block(), findMatches, center, 35, newDiscardReasonCounts());
    const b = await planCityPlaces(block(), findMatches, center, 35, newDiscardReasonCounts());
    expect(a.resolved).toEqual(b.resolved);
  });
});
