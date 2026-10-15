import { describe, expect, it } from "vitest";
import { selectRestaurants, localCuisineRatio, type RestaurantCandidate } from "../scripts/curate/distribution";

function candidate(partial: Partial<RestaurantCandidate> & { id: string }): RestaurantCandidate {
  return {
    priceTier: "moderate",
    isLocalCuisine: true,
    meals: ["dinner"],
    priority: 0,
    ...partial,
  };
}

describe("selectRestaurants", () => {
  it("never exceeds restaurantsMax", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => candidate({ id: `r${i}`, priority: i }));
    const goals = { restaurantsMin: 5, restaurantsMax: 8, perBudgetMin: 1 };
    const selected = selectRestaurants(candidates, goals);
    expect(selected.length).toBeLessThanOrEqual(8);
  });

  it("caps non-local cuisine at maxForeign", () => {
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) => candidate({ id: `foreign${i}`, isLocalCuisine: false, priority: 100 - i })),
      ...Array.from({ length: 5 }, (_, i) => candidate({ id: `local${i}`, isLocalCuisine: true, priority: 10 - i })),
    ];
    const goals = { restaurantsMin: 6, restaurantsMax: 8, perBudgetMin: 0 };
    const selected = selectRestaurants(candidates, goals, 2);
    const foreignCount = selected.filter((c) => !c.isLocalCuisine).length;
    expect(foreignCount).toBeLessThanOrEqual(2);
  });

  it("prefers higher-priority candidates when not constrained otherwise", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => candidate({ id: `r${i}`, priority: i }));
    const goals = { restaurantsMin: 3, restaurantsMax: 3, perBudgetMin: 0 };
    const selected = selectRestaurants(candidates, goals);
    expect(selected.map((c) => c.id).sort()).toEqual(["r7", "r8", "r9"].sort());
  });

  it("fills perBudgetMin per price tier by swapping in a missing tier when at capacity", () => {
    const candidates = [
      ...Array.from({ length: 6 }, (_, i) => candidate({ id: `mod${i}`, priceTier: "moderate", priority: 100 - i })),
      candidate({ id: "budget0", priceTier: "budget", priority: 1 }),
    ];
    const goals = { restaurantsMin: 6, restaurantsMax: 6, perBudgetMin: 1 };
    const selected = selectRestaurants(candidates, goals);
    expect(selected.length).toBe(6);
    expect(selected.some((c) => c.priceTier === "budget")).toBe(true);
  });

  it("doesn't force a tier that has no available candidates", () => {
    const candidates = Array.from({ length: 6 }, (_, i) => candidate({ id: `mod${i}`, priceTier: "moderate", priority: i }));
    const goals = { restaurantsMin: 6, restaurantsMax: 6, perBudgetMin: 2 };
    const selected = selectRestaurants(candidates, goals);
    expect(selected.length).toBe(6);
    expect(selected.every((c) => c.priceTier === "moderate")).toBe(true);
  });
});

describe("localCuisineRatio", () => {
  it("computes the fraction of local-cuisine restaurants", () => {
    const restaurants = [{ isLocalCuisine: true }, { isLocalCuisine: true }, { isLocalCuisine: false }];
    expect(localCuisineRatio(restaurants)).toBeCloseTo(2 / 3);
  });

  it("is 1 for an empty list (no foreign over-representation possible)", () => {
    expect(localCuisineRatio([])).toBe(1);
  });
});
