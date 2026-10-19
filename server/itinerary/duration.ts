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
 *
 * Personalization (spec "Stage 5"): `estimateDurationRange`'s third,
 * optional parameter applies deterministic multipliers on top of the base
 * category range — traveler pace, a declared interest matching the place's
 * type, and curated-catalog editorial affinity. The ABSOLUTE MINIMUM is
 * never touched by any multiplier (same rule that already existed for
 * "intenso" pace: never compress below the documented realistic minimum) —
 * only `typicalMinutes`/`maxMinutes` can be extended. Omitting the third
 * argument entirely reproduces the exact pre-personalization behavior, so
 * every existing caller (validate.ts, tests) keeps working unchanged.
 */

import { STYLE_TYPE_MAP, type TravelStyleKey } from "./scoring";

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
  park: range(30, 60, 90),
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
  park: range(30, 60, 90),
  beach: range(60, 120, 180),
  market: range(45, 75, 120),
  neighborhood: range(60, 90, 120),
};

const QUICK_MEAL_RANGE = range(20, 30, 45);
const RESTAURANT_MEAL_RANGE = range(45, 75, 120);

export interface DurationPersonalizationOptions {
  /** The traveler's declared interests (scoring.ts TravelStyleKey values) — a match against the place's Google `types` extends typical/max duration, since a declared-interest visit is more likely to run long, never short. */
  travelStyles?: string[];
  /** 0-100 curated-catalog editorial-affinity signal (see candidates.ts) — a strong editorial pick gets a small extra allowance, reflecting it's a curated highlight, not a generic filler stop. */
  editorialPriority?: number;
  /** Traveler pace. "relaxado" extends typical/max duration (more time per stop, since there are fewer stops/day); "intenso"/"moderado" apply no multiplier — pace must NEVER compress a duration below its documented minimum. */
  pace?: 'relaxado' | 'moderado' | 'intenso';
}

function interestMatchesType(travelStyles: string[] | undefined, googleTypes: string[] | undefined): boolean {
  if (!travelStyles || travelStyles.length === 0 || !googleTypes || googleTypes.length === 0) return false;
  return travelStyles.some((style) => {
    const relevant = STYLE_TYPE_MAP[style as TravelStyleKey];
    return relevant ? googleTypes.some((t) => relevant.includes(t)) : false;
  });
}

export function estimateDurationRange(
  placeCategory: string | undefined,
  googleTypes?: string[],
  personalization?: DurationPersonalizationOptions,
): DurationRange {
  const base = ((): DurationRange => {
    if (googleTypes && googleTypes.length > 0) {
      for (const t of googleTypes) {
        if (DURATION_BY_GOOGLE_TYPE[t]) return DURATION_BY_GOOGLE_TYPE[t];
      }
    }
    return DURATION_BY_APP_CATEGORY[placeCategory || 'other'] || DURATION_BY_APP_CATEGORY.other;
  })();

  if (!personalization) return base;

  const interestMultiplier = interestMatchesType(personalization.travelStyles, googleTypes) ? 1.3 : 1.0;
  const editorialScore = personalization.editorialPriority ?? 0;
  const editorialMultiplier = editorialScore >= 80 ? 1.15 : editorialScore >= 50 ? 1.05 : 1.0;
  // "intenso" previously applied NO multiplier at all — identical output to
  // "moderado" everywhere in the codebase, meaning selecting "Intenso" pace
  // had zero measurable deterministic effect (only the free-text prompt
  // mentioned more stops/day, which the model may or may not honor). A
  // tighter, more efficient typical/max duration is a real, bounded way to
  // fit more into the same day without ever compressing below the
  // documented realistic minimum (minMinutes is never touched, same
  // guarantee "relaxado" already had).
  const paceMultiplier = personalization.pace === 'relaxado' ? 1.15 : personalization.pace === 'intenso' ? 0.85 : 1.0;

  const multiplier = interestMultiplier * editorialMultiplier * paceMultiplier;
  if (multiplier === 1) return base;

  return {
    minMinutes: base.minMinutes, // absolute floor — never adjusted, by design
    typicalMinutes: Math.max(base.minMinutes, Math.round(base.typicalMinutes * multiplier)),
    maxMinutes: Math.max(base.minMinutes, Math.round(base.maxMinutes * multiplier)),
  };
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
export function buildDurationGuidancePromptBlock(pace?: 'relaxado' | 'moderado' | 'intenso'): string {
  const lines = [
    'Durações realistas por tipo de parada (NÃO comprima abaixo do mínimo, mesmo em ritmo intenso):',
    '- Museu: 90-180 min (padrão ~2h; museus excepcionalmente grandes, como o Louvre, podem passar disso)',
    '- Galeria de arte: 60-150 min',
    '- Marco histórico / ponto turístico: 45-90 min',
    '- Parque / jardim: 30-90 min (padrão ~1h; parques muito grandes podem passar disso)',
    '- Mercado / feira gastronômica: 45-90 min',
    '- Restaurante (refeição completa): 60-120 min',
    '- Lanche rápido: 20-45 min',
    '- Café: 20-60 min',
    '- Zoológico / aquário / parque de diversões: 120-240 min',
    '- Bar / vida noturna: 60-180 min',
  ];
  if (pace === 'relaxado') {
    lines.push('- Ritmo relaxado: já que há menos paradas por dia, é esperado e desejável usar o lado superior dessas faixas (ou até ~15% mais) em lugares de maior interesse do viajante — não precisa preencher o tempo livre com mais paradas.');
  } else if (pace === 'intenso') {
    lines.push('- Ritmo intenso: mais paradas por dia é o objetivo, mas NUNCA abaixo do mínimo de cada faixa — prefira cortar uma parada de menor prioridade a comprimir todas abaixo do realista.');
  }
  return lines.join('\n');
}
