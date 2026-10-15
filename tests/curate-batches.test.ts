import { describe, expect, it } from "vitest";
import { computeGroupTargets, splitIntoBatchSizes, planBatches, batchKey, GROUP_CATEGORIES } from "../scripts/curate/batches";
import { TIER_GOALS, MAX_PLACES_PER_BATCH, restaurantCandidateTarget, totalCandidateTarget } from "../scripts/data/curation-config";

describe("computeGroupTargets", () => {
  it("gives B exactly the restaurant candidate target and C the cafe candidate target", () => {
    const goals = TIER_GOALS.mega;
    const targets = computeGroupTargets(goals, "mega");
    const byGroup = Object.fromEntries(targets.map((t) => [t.group, t.target]));
    expect(byGroup.B).toBe(restaurantCandidateTarget(goals));
    expect(byGroup.C).toBe(Math.ceil(goals.cafesMin * goals.overGenerate));
  });

  it("splits the remaining total between A and D", () => {
    const goals = TIER_GOALS.mega;
    const targets = computeGroupTargets(goals, "mega");
    const byGroup = Object.fromEntries(targets.map((t) => [t.group, t.target]));
    const total = totalCandidateTarget(goals);
    expect(byGroup.A + byGroup.B + byGroup.C + byGroup.D).toBe(total);
  });

  it("never gives A more than the sum of its category caps", () => {
    for (const tier of ["mega", "large", "medium", "small"] as const) {
      const targets = computeGroupTargets(TIER_GOALS[tier], tier);
      const a = targets.find((t) => t.group === "A")!;
      expect(a.target).toBeLessThanOrEqual(30); // museum(15)+attraction(15) at mega scale, less for smaller tiers
    }
  });
});

describe("splitIntoBatchSizes", () => {
  it("returns a single batch when total fits within maxSize", () => {
    expect(splitIntoBatchSizes(10, 15)).toEqual([10]);
  });

  it("splits into evenly-sized batches, each at most maxSize", () => {
    const sizes = splitIntoBatchSizes(21, 15);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(21);
    expect(sizes.every((s) => s <= 15)).toBe(true);
    expect(sizes).toEqual([11, 10]);
  });

  it("returns an empty array for a zero or negative total", () => {
    expect(splitIntoBatchSizes(0, 15)).toEqual([]);
    expect(splitIntoBatchSizes(-5, 15)).toEqual([]);
  });
});

describe("planBatches", () => {
  it("never produces a batch bigger than MAX_PLACES_PER_BATCH", () => {
    for (const tier of ["mega", "large", "medium", "small"] as const) {
      const plans = planBatches(TIER_GOALS[tier], tier);
      expect(plans.every((p) => p.size <= MAX_PLACES_PER_BATCH)).toBe(true);
    }
  });

  it("covers every group and tags each batch with its allowed categories", () => {
    const plans = planBatches(TIER_GOALS.large, "large");
    const groups = new Set(plans.map((p) => p.group));
    expect(groups).toEqual(new Set(["A", "B", "C", "D"]));
    const restaurantBatch = plans.find((p) => p.group === "B")!;
    expect(restaurantBatch.categories).toEqual(GROUP_CATEGORIES.B);
  });

  it("produces a unique, stable batchKey per batch", () => {
    const plans = planBatches(TIER_GOALS.mega, "mega");
    const keys = plans.map(batchKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("B-1");
  });
});
