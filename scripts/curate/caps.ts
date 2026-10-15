import type { DestinationTier } from "../data/destinations";
import { categoryCapFor } from "../data/curation-config";

export interface CappedPlace {
  category: string;
  priority: number;
}

/**
 * Enforces per-category ceilings (scaled by tier): keeps the highest-priority
 * places in each capped category, drops the rest. Categories with no
 * configured cap (e.g. "restaurant", which is governed by restaurantsMin/Max
 * instead) pass through untouched.
 */
export function applyCategoryCaps<T extends CappedPlace>(places: T[], tier: DestinationTier): T[] {
  const byCategory = new Map<string, T[]>();
  for (const place of places) {
    const list = byCategory.get(place.category) ?? [];
    list.push(place);
    byCategory.set(place.category, list);
  }

  const result: T[] = [];
  for (const [category, list] of byCategory) {
    const cap = categoryCapFor(category, tier);
    if (cap == null) {
      result.push(...list);
      continue;
    }
    const sorted = [...list].sort((a, b) => b.priority - a.priority);
    result.push(...sorted.slice(0, cap));
  }
  return result;
}
