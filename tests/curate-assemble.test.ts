import { describe, expect, it } from "vitest";
import { assembleFinalPlaces, type AssemblablePlace } from "../scripts/curate/assemble";
import { TIER_GOALS } from "../scripts/data/curation-config";

interface TestPlace extends AssemblablePlace {
  name: string;
}

function place(overrides: Partial<TestPlace> & { googlePlaceId: string; category: string }): TestPlace {
  return {
    name: overrides.googlePlaceId,
    priority: 5,
    isLocalCuisine: true,
    ...overrides,
  };
}

describe("assembleFinalPlaces", () => {
  it("keeps every non-restaurant place, however many of one category there are — no cap", () => {
    const manyMuseums = Array.from({ length: 40 }, (_, i) => place({ googlePlaceId: `museum-${i}`, category: "museum" }));
    const manyBeaches = Array.from({ length: 25 }, (_, i) => place({ googlePlaceId: `beach-${i}`, category: "beach" }));
    const verified = [...manyMuseums, ...manyBeaches];

    const { finalPlaces, discardedRestaurants } = assembleFinalPlaces(verified, TIER_GOALS.small);

    expect(finalPlaces).toHaveLength(65);
    expect(finalPlaces.filter((p) => p.category === "museum")).toHaveLength(40);
    expect(finalPlaces.filter((p) => p.category === "beach")).toHaveLength(25);
    expect(discardedRestaurants).toEqual([]);
  });

  it("keeps parks, markets and neighborhoods untouched too", () => {
    const verified = [
      place({ googlePlaceId: "park-1", category: "park" }),
      place({ googlePlaceId: "market-1", category: "market" }),
      place({ googlePlaceId: "hood-1", category: "neighborhood" }),
    ];
    const { finalPlaces } = assembleFinalPlaces(verified, TIER_GOALS.small);
    expect(finalPlaces.map((p) => p.category).sort()).toEqual(["market", "neighborhood", "park"]);
  });

  it("trims restaurants above restaurantsMax, dropping the lowest-priority ones first", () => {
    const goals = TIER_GOALS.small; // restaurantsMax: 8
    const restaurants = Array.from({ length: 20 }, (_, i) =>
      place({ googlePlaceId: `r-${i}`, category: "restaurant", priority: i, priceTier: "moderate" }),
    );

    const { finalPlaces, discardedRestaurants } = assembleFinalPlaces(restaurants, goals);
    const keptRestaurants = finalPlaces.filter((p) => p.category === "restaurant");

    expect(keptRestaurants.length).toBeLessThanOrEqual(goals.restaurantsMax);
    expect(discardedRestaurants.length).toBe(restaurants.length - keptRestaurants.length);
    // the lowest-priority restaurants (r-0, r-1, ...) should be among the discarded ones
    const keptIds = new Set(keptRestaurants.map((p) => p.googlePlaceId));
    expect(keptIds.has("r-0")).toBe(false);
  });

  it("never lets a non-restaurant category influence or get trimmed by restaurant selection", () => {
    const goals = TIER_GOALS.small;
    const restaurants = Array.from({ length: 20 }, (_, i) => place({ googlePlaceId: `r-${i}`, category: "restaurant", priority: i }));
    const attractions = Array.from({ length: 30 }, (_, i) => place({ googlePlaceId: `a-${i}`, category: "attraction" }));

    const { finalPlaces } = assembleFinalPlaces([...restaurants, ...attractions], goals);

    expect(finalPlaces.filter((p) => p.category === "attraction")).toHaveLength(30);
    expect(finalPlaces.filter((p) => p.category === "restaurant").length).toBeLessThanOrEqual(goals.restaurantsMax);
  });
});
