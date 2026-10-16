import { describe, expect, it } from "vitest";
import {
  computeGroupTargets,
  splitIntoBatchSizes,
  planBatches,
  batchKey,
  iconBatchPlan,
  allowNeighborhoodForGroup,
  ICON_BATCH_SIZE,
  GROUP_CATEGORIES,
  GROUP_LABELS,
} from "../scripts/curate/batches";
import {
  TIER_GOALS,
  MAX_PLACES_PER_BATCH,
  NON_FOOD_SPLIT_A,
  NON_FOOD_SPLIT_D,
  restaurantCandidateTarget,
  totalCandidateTarget,
} from "../scripts/data/curation-config";

describe("computeGroupTargets", () => {
  it("gives B exactly the restaurant candidate target and C the cafe candidate target", () => {
    const goals = TIER_GOALS.mega;
    const targets = computeGroupTargets(goals, "mega");
    const byGroup = Object.fromEntries(targets.map((t) => [t.group, t.target]));
    expect(byGroup.B).toBe(restaurantCandidateTarget(goals));
    expect(byGroup.C).toBe(Math.ceil(goals.cafesMin * goals.overGenerate));
  });

  it("splits what's left after restaurants, cafés/markets AND the icon batch between A and D, with nothing uncounted", () => {
    const goals = TIER_GOALS.mega;
    const targets = computeGroupTargets(goals, "mega");
    const byGroup = Object.fromEntries(targets.map((t) => [t.group, t.target]));
    const total = totalCandidateTarget(goals);
    expect(byGroup.A + byGroup.B + byGroup.C + byGroup.D + ICON_BATCH_SIZE).toBe(total);
  });

  it("splits the non-food budget between A and D by NON_FOOD_SPLIT_A/D, with no per-category composition or cap", () => {
    for (const tier of ["mega", "large", "medium", "small"] as const) {
      const goals = TIER_GOALS[tier];
      const targets = computeGroupTargets(goals, tier);
      const byGroup = Object.fromEntries(targets.map((t) => [t.group, t.target]));
      const total = totalCandidateTarget(goals);
      const remaining = Math.max(0, total - byGroup.B - byGroup.C - ICON_BATCH_SIZE);
      expect(byGroup.A).toBe(Math.round(remaining * NON_FOOD_SPLIT_A));
      expect(byGroup.D).toBe(remaining - byGroup.A);
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

  it("assigns the new categories to their documented groups", () => {
    expect(GROUP_CATEGORIES.A).toEqual(["attraction", "museum", "park", "beach"]);
    expect(GROUP_CATEGORIES.B).toEqual(["restaurant"]);
    expect(GROUP_CATEGORIES.C).toEqual(["cafe", "market"]);
    expect(GROUP_CATEGORIES.D).toEqual(["hidden_gem", "neighborhood", "other"]);
  });

  it("produces a unique, stable batchKey per batch", () => {
    const plans = planBatches(TIER_GOALS.mega, "mega");
    const keys = plans.map(batchKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("B-1");
  });

  it("never includes the icon group — that batch runs separately via iconBatchPlan", () => {
    for (const tier of ["mega", "large", "medium", "small"] as const) {
      const plans = planBatches(TIER_GOALS[tier], tier);
      expect(plans.some((p) => p.group === "I")).toBe(false);
    }
  });
});

describe("iconBatchPlan", () => {
  it("proposes up to ICON_BATCH_SIZE places in attraction/museum/park/beach/neighborhood/other", () => {
    const plan = iconBatchPlan();
    expect(plan.group).toBe("I");
    expect(plan.size).toBe(ICON_BATCH_SIZE);
    expect(plan.categories).toEqual(["attraction", "museum", "park", "beach", "neighborhood", "other"]);
  });

  it("has a stable batchKey distinct from every goal-driven batch", () => {
    const plan = iconBatchPlan();
    expect(batchKey(plan)).toBe("I-1");
  });

  it("has a group label describing the city's icons", () => {
    expect(GROUP_LABELS.I).toMatch(/ícon/i);
  });

  it("GROUP_CATEGORIES.I matches the icon plan's categories", () => {
    expect(GROUP_CATEGORIES.I).toEqual(iconBatchPlan().categories);
  });
});

describe("allowNeighborhoodForGroup", () => {
  it("allows neighborhood/sublocality only for groups D and I", () => {
    expect(allowNeighborhoodForGroup("D")).toBe(true);
    expect(allowNeighborhoodForGroup("I")).toBe(true);
    expect(allowNeighborhoodForGroup("A")).toBe(false);
    expect(allowNeighborhoodForGroup("B")).toBe(false);
    expect(allowNeighborhoodForGroup("C")).toBe(false);
  });
});
