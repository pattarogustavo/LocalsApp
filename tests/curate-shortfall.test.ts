import { describe, expect, it } from "vitest";
import { computeShortfall, remainingRestaurantRoom } from "../scripts/curate/shortfall";
import { TIER_GOALS } from "../scripts/data/curation-config";

describe("computeShortfall", () => {
  const goals = TIER_GOALS.mega; // total 75, restaurantsMin 15, restaurantsMax 18

  it("reports goals met when both thresholds are satisfied", () => {
    const result = computeShortfall({ total: 90, restaurants: 16 }, goals);
    expect(result.meetsGoals).toBe(true);
    expect(result.needsMoreRestaurants).toBe(false);
    expect(result.needsMoreTotal).toBe(false);
  });

  it("flags a restaurant shortfall below restaurantsMin", () => {
    const result = computeShortfall({ total: 80, restaurants: 10 }, goals);
    expect(result.needsMoreRestaurants).toBe(true);
    expect(result.missingRestaurants).toBe(5);
    expect(result.meetsGoals).toBe(false);
  });

  it("flags a total shortfall below 1.15x goal total", () => {
    const result = computeShortfall({ total: 50, restaurants: 16 }, goals);
    expect(result.needsMoreTotal).toBe(true);
    expect(result.meetsGoals).toBe(false);
  });
});

describe("remainingRestaurantRoom", () => {
  it("never goes negative past restaurantsMax", () => {
    expect(remainingRestaurantRoom(20, TIER_GOALS.mega)).toBe(0);
  });

  it("computes the room left under the max", () => {
    expect(remainingRestaurantRoom(10, TIER_GOALS.mega)).toBe(8);
  });
});
