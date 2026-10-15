import type { DestinationTier } from "../data/destinations";
import { categoryCapFor, restaurantCandidateTarget, totalCandidateTarget, MAX_PLACES_PER_BATCH, type TierGoals } from "../data/curation-config";

export type GroupKey = "A" | "B" | "C" | "D";

/**
 * Maps each research/structure group to the stored `curated_places.category`
 * values it's allowed to produce. B/C map 1:1 to restaurant/cafe (governed
 * by their own min/max, not a category cap); A/D cover everything else and
 * are bounded by BASE_CATEGORY_CAPS.
 */
export const GROUP_CATEGORIES: Record<GroupKey, string[]> = {
  A: ["attraction", "museum"],
  B: ["restaurant"],
  C: ["cafe"],
  D: ["hidden_gem", "other"],
};

export const GROUP_LABELS: Record<GroupKey, string> = {
  A: "atrações, monumentos, museus e parques/mirantes",
  B: "restaurantes",
  C: "cafés, padarias e mercados",
  D: "segredos de morador, bairros/passeios, vida noturna e compras",
};

function sumCaps(categories: string[], tier: DestinationTier): number {
  return categories.reduce((sum, cat) => sum + (categoryCapFor(cat, tier) ?? Infinity), 0);
}

export interface GroupTarget {
  group: GroupKey;
  target: number;
}

/**
 * Splits the destination's total candidate target across the four groups.
 * B and C get exactly ceil(min x overGenerate) each (their own fixed
 * bounds). A and D split what's left of the total, with A clamped to the
 * sum of its category caps (museum/attraction) — any amount A can't use
 * falls through to D instead, since D's categories (hidden_gem/other)
 * have more headroom.
 */
export function computeGroupTargets(goals: TierGoals, tier: DestinationTier): GroupTarget[] {
  const targetB = restaurantCandidateTarget(goals);
  const targetC = Math.ceil(goals.cafesMin * goals.overGenerate);
  const total = totalCandidateTarget(goals);
  const remaining = Math.max(0, total - targetB - targetC);

  const capA = sumCaps(GROUP_CATEGORIES.A, tier);
  const targetA = Math.min(Math.ceil(remaining / 2), capA);
  const targetD = remaining - targetA;

  return [
    { group: "A", target: targetA },
    { group: "B", target: targetB },
    { group: "C", target: targetC },
    { group: "D", target: targetD },
  ];
}

/** Splits `total` into chunks of at most `maxSize`, as evenly sized as possible. */
export function splitIntoBatchSizes(total: number, maxSize: number): number[] {
  if (total <= 0) return [];
  const batchCount = Math.ceil(total / maxSize);
  const base = Math.floor(total / batchCount);
  const remainder = total % batchCount;
  return Array.from({ length: batchCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

export interface BatchPlan {
  group: GroupKey;
  /** 1-based index within the group. */
  index: number;
  /** Total batches for this group. */
  of: number;
  size: number;
  categories: string[];
}

/** Full per-destination batch plan: group targets, split into MAX_PLACES_PER_BATCH-sized batches. */
export function planBatches(goals: TierGoals, tier: DestinationTier): BatchPlan[] {
  const targets = computeGroupTargets(goals, tier);
  const plans: BatchPlan[] = [];
  for (const { group, target } of targets) {
    const sizes = splitIntoBatchSizes(target, MAX_PLACES_PER_BATCH);
    sizes.forEach((size, i) => {
      plans.push({ group, index: i + 1, of: sizes.length, size, categories: GROUP_CATEGORIES[group] });
    });
  }
  return plans;
}

/** Stable key identifying a batch for checkpointing/logging, e.g. "A-1". */
export function batchKey(plan: Pick<BatchPlan, "group" | "index">): string {
  return `${plan.group}-${plan.index}`;
}
