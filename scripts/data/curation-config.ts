import type { DestinationTier } from "./destinations";

export interface TierGoals {
  total: number;
  restaurantsMin: number;
  restaurantsMax: number;
  cafesMin: number;
  /** Minimum places per price tier (budget/moderate/luxury), restaurants only. */
  perBudgetMin: number;
  /** Minimum % of restaurants that must be local/typical cuisine. */
  localCuisineMinPct: number;
  /** Candidates requested = ceil(target x overGenerate). */
  overGenerate: number;
}

/** Editable per-tier generation targets. Change these numbers to tune catalog size/mix. */
export const TIER_GOALS: Record<DestinationTier, TierGoals> = {
  mega: { total: 75, restaurantsMin: 15, restaurantsMax: 18, cafesMin: 10, perBudgetMin: 4, localCuisineMinPct: 70, overGenerate: 1.4 },
  large: { total: 58, restaurantsMin: 12, restaurantsMax: 15, cafesMin: 8, perBudgetMin: 3, localCuisineMinPct: 70, overGenerate: 1.4 },
  medium: { total: 41, restaurantsMin: 9, restaurantsMax: 11, cafesMin: 6, perBudgetMin: 2, localCuisineMinPct: 70, overGenerate: 1.4 },
  small: { total: 24, restaurantsMin: 6, restaurantsMax: 8, cafesMin: 4, perBudgetMin: 2, localCuisineMinPct: 70, overGenerate: 1.4 },
};

/**
 * Category caps at "mega" scale. Scaled down per tier by TIER_CAP_SCALE below.
 * These are ceilings ("up to"), never a forced minimum — a destination with
 * fewer good options in a category is simply left under the cap.
 */
export const BASE_CATEGORY_CAPS: Record<string, number> = {
  museum: 15,
  attraction: 15,
  park_viewpoint: 8,
  neighborhood_walk: 5,
  nightlife: 5,
  shopping: 4,
  hidden_gem: 8,
};

export const TIER_CAP_SCALE: Record<DestinationTier, number> = {
  mega: 1,
  large: 0.8,
  medium: 0.6,
  small: 0.4,
};

/** Max simultaneous Google Places verification calls. */
export const VERIFICATION_CONCURRENCY = 5;

/** Max distance (km) from a destination's center for a verified candidate to be accepted. */
export const MAX_DISTANCE_FROM_CENTER_KM = 35;

/** Max extra AI research/structuring rounds run to complement a shortfall. */
export const MAX_COMPLEMENT_ROUNDS = 2;

/** If verified total is below this fraction of the target total, trigger complementation. */
export const COMPLEMENT_TOTAL_THRESHOLD = 1.15;

/** Max AI calls (research + structure + complement rounds) allowed per destination. */
export const MAX_AI_CALLS_PER_DESTINATION = 8;

/** Default cap on Google API calls per script execution (across all destinations). */
export const DEFAULT_MAX_GOOGLE_CALLS = 1500;

export function categoryCapFor(category: string, tier: DestinationTier): number | undefined {
  const base = BASE_CATEGORY_CAPS[category];
  if (base == null) return undefined;
  return Math.max(1, Math.round(base * TIER_CAP_SCALE[tier]));
}

export function restaurantCandidateTarget(goals: TierGoals): number {
  return Math.ceil(goals.restaurantsMin * goals.overGenerate);
}

export function totalCandidateTarget(goals: TierGoals): number {
  return Math.ceil(goals.total * goals.overGenerate);
}
