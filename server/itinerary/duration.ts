/**
 * Deterministic, category-driven duration modeling for itinerary stops.
 *
 * The itinerary data contract (types/voyage.ts ItineraryStop) has no explicit
 * duration field — a stop's effective duration is implied by the gap between
 * its `time` and the next stop's `time`, minus travel time. This module gives
 * the planning prompt realistic per-category ranges to work with, and gives
 * the validator (validate.ts) bounds to check the LLM's actual output against.
 *
 * These are guidelines, not hallucinated facts about a specific place — no
 * external duration data source exists in this codebase, so conservative,
 * widely-applicable ranges are used instead of inventing place-specific figures.
 */

export interface DurationRange {
  minMinutes: number;
  maxMinutes: number;
  /** Typical/expected duration, used when a single number is needed (e.g. correction). */
  typicalMinutes: number;
}

const range = (min: number, typical: number, max: number): DurationRange => ({
  minMinutes: min,
  typicalMinutes: typical,
  maxMinutes: max,
});

// Keyed by Google Places `types` values (checked first — most specific signal available).
const DURATION_BY_GOOGLE_TYPE: Record<string, DurationRange> = {
  museum: range(90, 120, 180),
  art_gallery: range(60, 90, 150),
  aquarium: range(90, 120, 180),
  zoo: range(120, 150, 210),
  amusement_park: range(150, 240, 360),
  park: range(45, 75, 120),
  botanical_garden: range(45, 90, 120),
  natural_feature: range(30, 60, 120),
  church: range(20, 40, 60),
  hindu_temple: range(20, 40, 60),
  mosque: range(20, 40, 60),
  synagogue: range(20, 40, 60),
  place_of_worship: range(20, 40, 60),
  historical_landmark: range(30, 60, 90),
  landmark: range(30, 60, 90),
  tourist_attraction: range(45, 75, 120),
  point_of_interest: range(30, 60, 90),
  shopping_mall: range(60, 90, 150),
  department_store: range(45, 75, 120),
  market: range(30, 60, 90),
  night_club: range(90, 120, 180),
  bar: range(60, 90, 150),
  casino: range(60, 120, 180),
  spa: range(60, 90, 150),
  stadium: range(60, 120, 180),
  movie_theater: range(90, 150, 180),
  restaurant: range(45, 75, 120),
  cafe: range(20, 35, 60),
  bakery: range(15, 25, 40),
  meal_takeaway: range(15, 25, 40),
};

// Fallback keyed by the app's own PlaceCategory enum, used when no Google
// `types` array is available (e.g. a user-typed selected place).
const DURATION_BY_APP_CATEGORY: Record<string, DurationRange> = {
  museum: range(90, 120, 180),
  attraction: range(45, 75, 120),
  restaurant: range(45, 75, 120),
  cafe: range(20, 35, 60),
  hidden_gem: range(30, 60, 90),
  other: range(30, 60, 90),
};

const QUICK_MEAL_RANGE = range(20, 30, 45);
const RESTAURANT_MEAL_RANGE = range(45, 75, 120);

export function estimateDurationRange(
  placeCategory: string | undefined,
  googleTypes?: string[],
): DurationRange {
  if (googleTypes && googleTypes.length > 0) {
    for (const t of googleTypes) {
      if (DURATION_BY_GOOGLE_TYPE[t]) return DURATION_BY_GOOGLE_TYPE[t];
    }
  }
  return DURATION_BY_APP_CATEGORY[placeCategory || 'other'] || DURATION_BY_APP_CATEGORY.other;
}

/** Duration range for a meal stop, given the user's chosen meal mode. */
export function estimateMealDurationRange(mode?: 'quick' | 'restaurant' | 'none'): DurationRange {
  if (mode === 'quick') return QUICK_MEAL_RANGE;
  return RESTAURANT_MEAL_RANGE;
}

/**
 * Renders a short, human-readable duration guideline block for the prompt —
 * cheap, deterministic guidance so the LLM doesn't need to guess or the app
 * doesn't need a second LLM pass just to fix timing.
 */
export function buildDurationGuidancePromptBlock(): string {
  return [
    'Durações realistas por tipo de parada (NÃO comprima abaixo do mínimo, mesmo em ritmo intenso):',
    '- Museu importante: 90-180 min',
    '- Galeria de arte: 60-150 min',
    '- Marco histórico / ponto turístico: 45-90 min',
    '- Parque / jardim: 45-120 min',
    '- Mercado / feira gastronômica: 45-90 min',
    '- Restaurante (refeição completa): 60-120 min',
    '- Lanche rápido: 20-45 min',
    '- Café: 20-60 min',
    '- Zoológico / aquário / parque de diversões: 120-240 min',
    '- Bar / vida noturna: 60-180 min',
  ].join('\n');
}
