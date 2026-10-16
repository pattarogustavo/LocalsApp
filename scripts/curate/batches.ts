import type { DestinationTier } from "../data/destinations";
import {
  restaurantCandidateTarget,
  totalCandidateTarget,
  MAX_PLACES_PER_BATCH,
  NON_FOOD_SPLIT_A,
  NON_FOOD_SPLIT_D,
  type TierGoals,
} from "../data/curation-config";

export type GroupKey = "A" | "B" | "C" | "D" | "I";

/**
 * Maps each research/structure group to the stored `curated_places.category`
 * values it's allowed to produce. No group/category has a ceiling — see
 * NON_FOOD_SPLIT_A/D in ../data/curation-config for the only configurable
 * share (how much of the non-food candidate budget goes to A vs. D). I
 * (icons) is a separate, fixed-size batch run once per destination (see
 * iconBatchPlan).
 */
export const GROUP_CATEGORIES: Record<GroupKey, string[]> = {
  A: ["attraction", "museum", "park", "beach"],
  B: ["restaurant"],
  C: ["cafe", "market"],
  D: ["hidden_gem", "neighborhood", "other"],
  I: ["attraction", "museum", "park", "beach", "neighborhood", "other"],
};

export const GROUP_LABELS: Record<GroupKey, string> = {
  A: "atrações, monumentos, museus, parques e praias",
  B: "restaurantes",
  C: "cafés e mercados",
  D: "segredos de morador, bairros, vida noturna e compras",
  I: "ícones imperdíveis da cidade",
};

/** Max places proposed in the icon batch — see iconBatchPlan. */
export const ICON_BATCH_SIZE = 12;

/**
 * A standalone Google result typed neighborhood/sublocality is only a
 * legitimate match for group D (bairros/passeios) and the icon batch I —
 * icons like Covent Garden or Notting Hill are themselves neighborhoods.
 * Every other group rejects it (see checkPlaceIdAndTypes in ./verify).
 */
export function allowNeighborhoodForGroup(group: GroupKey): boolean {
  return group === "D" || group === "I";
}

export interface GroupTarget {
  group: GroupKey;
  target: number;
}

/**
 * Splits the destination's total candidate target across the four groups.
 * B and C get exactly ceil(min x overGenerate) each (their own fixed
 * bounds). What's left over — the non-food budget — is whatever remains
 * after restaurants, cafés/markets, AND the fixed-size icon batch (which
 * also proposes attraction/museum/park/beach/neighborhood/other candidates),
 * split between A and D by NON_FOOD_SPLIT_A/D (no per-category composition
 * or cap: a destination with many museums or beaches should simply get
 * many museum/beach candidates).
 */
export function computeGroupTargets(goals: TierGoals, _tier: DestinationTier): GroupTarget[] {
  const targetB = restaurantCandidateTarget(goals);
  const targetC = Math.ceil(goals.cafesMin * goals.overGenerate);
  const total = totalCandidateTarget(goals);
  const remaining = Math.max(0, total - targetB - targetC - ICON_BATCH_SIZE);

  const targetA = Math.round(remaining * NON_FOOD_SPLIT_A);
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

/**
 * The icon batch: up to ICON_BATCH_SIZE of the destination's most iconic
 * places, run once before the goal-driven plans. Its size is subtracted from
 * the non-food budget in computeGroupTargets (rather than counted twice);
 * duplicates against the rest of the catalog are simply dropped at dedupe
 * time.
 */
export function iconBatchPlan(): BatchPlan {
  return { group: "I", index: 1, of: 1, size: ICON_BATCH_SIZE, categories: GROUP_CATEGORIES.I };
}
