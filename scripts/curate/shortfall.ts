import type { TierGoals } from "../data/curation-config";
import { COMPLEMENT_TOTAL_THRESHOLD } from "../data/curation-config";

export interface VerifiedCounts {
  total: number;
  restaurants: number;
}

export interface Shortfall {
  meetsGoals: boolean;
  needsMoreRestaurants: boolean;
  needsMoreTotal: boolean;
  missingRestaurants: number;
  missingTotal: number;
}

/**
 * Decides whether another AI research round is needed: restaurants below
 * their fixed minimum, or the overall verified total below
 * COMPLEMENT_TOTAL_THRESHOLD x goals.total. Never asks for more restaurants
 * beyond restaurantsMax.
 */
export function computeShortfall(verified: VerifiedCounts, goals: TierGoals): Shortfall {
  const needsMoreRestaurants = verified.restaurants < goals.restaurantsMin;
  const totalTarget = Math.ceil(goals.total * COMPLEMENT_TOTAL_THRESHOLD);
  const needsMoreTotal = verified.total < totalTarget;

  return {
    meetsGoals: !needsMoreRestaurants && !needsMoreTotal,
    needsMoreRestaurants,
    needsMoreTotal,
    missingRestaurants: needsMoreRestaurants ? Math.max(0, goals.restaurantsMin - verified.restaurants) : 0,
    missingTotal: needsMoreTotal ? Math.max(0, totalTarget - verified.total) : 0,
  };
}

/** How many more restaurant candidates can still be added without exceeding restaurantsMax. */
export function remainingRestaurantRoom(currentRestaurants: number, goals: TierGoals): number {
  return Math.max(0, goals.restaurantsMax - currentRestaurants);
}
