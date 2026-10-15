import type { TierGoals } from "../data/curation-config";

export type PriceTier = "budget" | "moderate" | "luxury";

export interface RestaurantCandidate {
  id: string;
  priceTier: PriceTier;
  isLocalCuisine: boolean;
  neighborhood?: string;
  meals: string[];
  /** Higher is better (e.g. derived from AI rank/confidence). Used to break ties. */
  priority: number;
}

const PRICE_TIERS: PriceTier[] = ["budget", "moderate", "luxury"];

function countsByTier(selected: RestaurantCandidate[]): Record<PriceTier, number> {
  const counts: Record<PriceTier, number> = { budget: 0, moderate: 0, luxury: 0 };
  for (const c of selected) counts[c.priceTier]++;
  return counts;
}

/** Index of the lowest-priority selected candidate whose tier is above `min` and isn't `protectedTier`. */
function findEvictableIndex(
  selected: RestaurantCandidate[],
  counts: Record<PriceTier, number>,
  min: number,
  protectedTier: PriceTier,
): number {
  let bestIdx = -1;
  let bestPriority = Infinity;
  for (let i = 0; i < selected.length; i++) {
    const c = selected[i];
    if (c.priceTier === protectedTier) continue;
    if (counts[c.priceTier] <= min) continue;
    if (c.priority < bestPriority) {
      bestPriority = c.priority;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Selects restaurant candidates for a destination: respects the fixed
 * restaurantsMin/restaurantsMax bounds, caps non-local cuisine at
 * `maxForeign`, and tries to guarantee at least `perBudgetMin` per price
 * tier by swapping in missing-tier candidates (evicting the lowest-priority
 * over-represented selection) when the list is already at capacity. Never
 * forces a tier beyond what candidates are actually available.
 */
export function selectRestaurants(
  candidates: RestaurantCandidate[],
  goals: Pick<TierGoals, "restaurantsMin" | "restaurantsMax" | "perBudgetMin">,
  maxForeign = 3,
): RestaurantCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority);
  const selected: RestaurantCandidate[] = [];
  let foreignCount = 0;

  for (const c of sorted) {
    if (selected.length >= goals.restaurantsMax) break;
    if (!c.isLocalCuisine && foreignCount >= maxForeign) continue;
    selected.push(c);
    if (!c.isLocalCuisine) foreignCount++;
  }

  for (const tier of PRICE_TIERS) {
    let counts = countsByTier(selected);
    while (counts[tier] < goals.perBudgetMin) {
      const candidate = sorted.find(
        (c) =>
          c.priceTier === tier &&
          !selected.includes(c) &&
          (c.isLocalCuisine || foreignCount < maxForeign),
      );
      if (!candidate) break;

      if (selected.length < goals.restaurantsMax) {
        selected.push(candidate);
        if (!candidate.isLocalCuisine) foreignCount++;
      } else {
        const evictIdx = findEvictableIndex(selected, counts, goals.perBudgetMin, tier);
        if (evictIdx === -1) break;
        const evicted = selected[evictIdx];
        selected.splice(evictIdx, 1, candidate);
        if (!evicted.isLocalCuisine) foreignCount--;
        if (!candidate.isLocalCuisine) foreignCount++;
      }
      counts = countsByTier(selected);
    }
  }

  return selected;
}

/** Fraction (0..1) of `restaurants` that are local/typical cuisine. */
export function localCuisineRatio(restaurants: { isLocalCuisine: boolean }[]): number {
  if (restaurants.length === 0) return 1;
  const local = restaurants.filter((r) => r.isLocalCuisine).length;
  return local / restaurants.length;
}
