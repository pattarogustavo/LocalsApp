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
 * No category has a ceiling: a destination with many museums, beaches or
 * parks should have that reflected in its catalog instead of being trimmed
 * to an arbitrary cap. The only two shares that are genuinely configurable
 * are how the non-food candidate budget (everything left after restaurants,
 * cafés/markets, and the fixed-size icon batch) splits between group A
 * (attraction/museum/park/beach) and group D (hidden_gem/neighborhood/other)
 * — see computeGroupTargets in ./curate/batches. Must sum to 1.
 */
export const NON_FOOD_SPLIT_A = 0.6;
export const NON_FOOD_SPLIT_D = 0.4;

/** Max simultaneous Google Places verification calls. */
export const VERIFICATION_CONCURRENCY = 5;

/** Max distance (km) from a destination's center for a verified candidate to be accepted. */
export const MAX_DISTANCE_FROM_CENTER_KM = 35;

/** Max extra AI research/structuring rounds run to complement a shortfall — at most 1; skip complementation if it fails. */
export const MAX_COMPLEMENT_ROUNDS = 1;

/** If verified total is below this fraction of the target total, trigger complementation. */
export const COMPLEMENT_TOTAL_THRESHOLD = 1.15;

/** Max AI calls (research + structure, across every batch + the complement round) allowed per destination. */
export const MAX_AI_CALLS_PER_DESTINATION = 40;

/** Default cap on Google API calls per script execution (across all destinations). */
export const DEFAULT_MAX_GOOGLE_CALLS = 1500;

/** No research/structure batch asks for more than this many places at once. */
export const MAX_PLACES_PER_BATCH = 15;

/** Max times a too-large/truncated batch is halved and retried before being marked failed. */
export const MAX_BATCH_SPLIT_LEVELS = 2;

export function restaurantCandidateTarget(goals: TierGoals): number {
  return Math.ceil(goals.restaurantsMin * goals.overGenerate);
}

export function totalCandidateTarget(goals: TierGoals): number {
  return Math.ceil(goals.total * goals.overGenerate);
}
