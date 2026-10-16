import type { TierGoals } from "../data/curation-config";
import { selectRestaurants, type RestaurantCandidate, type PriceTier } from "./distribution";

export interface AssemblablePlace {
  googlePlaceId: string;
  category: string;
  priority: number;
  priceTier?: PriceTier;
  isLocalCuisine: boolean;
  neighborhood?: string;
  meals?: string[];
}

export interface AssembleResult<T> {
  finalPlaces: T[];
  /** Restaurants selectRestaurants dropped — over restaurantsMax or not needed for price-tier distribution. */
  discardedRestaurants: T[];
}

/**
 * Builds the final place list from every verified candidate for a
 * destination. No category has a ceiling: every non-restaurant place passes
 * through untouched, however many there are (a destination with many
 * museums, beaches or parks keeps all of them). Restaurants are the one
 * exception — trimmed down to restaurantsMax by selectRestaurants, which
 * drops the lowest-priority candidates first and tries to preserve the
 * perBudgetMin/localCuisineMinPct distribution.
 */
export function assembleFinalPlaces<T extends AssemblablePlace>(verified: T[], goals: TierGoals): AssembleResult<T> {
  const restaurantCandidates: RestaurantCandidate[] = verified
    .filter((v) => v.category === "restaurant")
    .map((v) => ({
      id: v.googlePlaceId,
      priceTier: v.priceTier ?? "moderate",
      isLocalCuisine: v.isLocalCuisine,
      neighborhood: v.neighborhood,
      meals: v.meals ?? [],
      priority: v.priority,
    }));
  const selectedIds = new Set(selectRestaurants(restaurantCandidates, goals).map((r) => r.id));
  const keptRestaurants = verified.filter((v) => v.category === "restaurant" && selectedIds.has(v.googlePlaceId));
  const discardedRestaurants = verified.filter((v) => v.category === "restaurant" && !selectedIds.has(v.googlePlaceId));
  const others = verified.filter((v) => v.category !== "restaurant");

  return { finalPlaces: [...keptRestaurants, ...others], discardedRestaurants };
}
