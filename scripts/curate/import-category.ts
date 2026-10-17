import { VALID_CATEGORIES } from "./validate-place";

export type ImportCategory = (typeof VALID_CATEGORIES)[number];

/**
 * Google Places `types` -> our category enum, used only to fill in a
 * category curate:import's input left out. Checked in array order against
 * each candidate's `types` list, so a more specific type earlier in a
 * place's own types array wins over a generic one later in it.
 */
const TYPE_CATEGORY_MAP: Record<string, ImportCategory> = {
  restaurant: "restaurant",
  meal_takeaway: "restaurant",
  meal_delivery: "restaurant",
  cafe: "cafe",
  bakery: "cafe",
  museum: "museum",
  art_gallery: "museum",
  park: "park",
  campground: "park",
  rv_park: "park",
  natural_feature: "park",
  supermarket: "market",
  grocery_or_supermarket: "market",
  market: "market",
  shopping_mall: "market",
  department_store: "market",
  clothing_store: "market",
  neighborhood: "neighborhood",
  sublocality: "neighborhood",
  tourist_attraction: "attraction",
  point_of_interest: "attraction",
  place_of_worship: "attraction",
  church: "attraction",
  mosque: "attraction",
  synagogue: "attraction",
  hindu_temple: "attraction",
  amusement_park: "attraction",
  zoo: "attraction",
  aquarium: "attraction",
  stadium: "attraction",
  city_hall: "attraction",
  night_club: "other",
  bar: "other",
};

/** Returns our category for the first Google type that has a mapping, or undefined if none does. */
export function inferCategoryFromGoogleTypes(types: string[]): ImportCategory | undefined {
  for (const type of types) {
    const category = TYPE_CATEGORY_MAP[type];
    if (category) return category;
  }
  return undefined;
}
