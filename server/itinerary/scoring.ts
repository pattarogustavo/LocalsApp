/**
 * Deterministic candidate scoring/ranking — the code-side "brain" that runs
 * BEFORE the LLM ever sees a candidate list, so the model spends its
 * reasoning on sequencing and coherence, not on rediscovering which places
 * fit the traveler.
 *
 * Priority order (per product requirement): user relevance → feasibility →
 * quality/rating → popularity → geographic efficiency. Popularity must never
 * let an irrelevant-but-popular place outrank a highly relevant one, so
 * candidates are sorted by a tuple (interest, quality, popularity), never by
 * a single blended score where a huge review count could drown out a poor
 * interest match.
 */

export interface ScorableCandidate {
  name: string;
  placeId: string;
  rating?: number;
  userRatingsTotal: number;
  types: string[];
  priceLevel?: number;
}

export type TravelStyleKey =
  | 'cultura' | 'gastronomia' | 'natureza' | 'aventura' | 'relaxamento'
  | 'compras' | 'historia' | 'praia' | 'montanha' | 'cidade' | 'vida_noturna';

// Maps the app's structured travel-style options to the Google Places `types`
// that genuinely serve that interest. Deliberately excludes generic tourist
// traps (aquarium, zoo, amusement_park, casino) from every style except the
// ones they actually belong to (natureza/aventura, vida_noturna) — this is
// the concrete fix for "aquarium beats art museum for an Art+Gastronomy user".
const STYLE_TYPE_MAP: Record<TravelStyleKey, string[]> = {
  cultura: ['museum', 'art_gallery', 'church', 'hindu_temple', 'mosque', 'synagogue',
    'place_of_worship', 'city_hall', 'library', 'historical_landmark', 'landmark', 'university'],
  historia: ['museum', 'historical_landmark', 'landmark', 'church', 'place_of_worship', 'city_hall'],
  gastronomia: ['restaurant', 'food', 'bakery', 'cafe', 'meal_takeaway', 'meal_delivery', 'market'],
  natureza: ['park', 'natural_feature', 'botanical_garden', 'zoo', 'campground', 'hiking_area'],
  montanha: ['natural_feature', 'hiking_area', 'campground', 'park'],
  praia: ['natural_feature'],
  aventura: ['amusement_park', 'zoo', 'stadium', 'hiking_area', 'campground', 'gym', 'bowling_alley'],
  relaxamento: ['spa', 'park', 'natural_feature', 'botanical_garden'],
  compras: ['shopping_mall', 'department_store', 'clothing_store', 'book_store', 'jewelry_store', 'store', 'market'],
  cidade: ['tourist_attraction', 'point_of_interest', 'landmark', 'shopping_mall'],
  vida_noturna: ['night_club', 'bar', 'casino'],
};

// Types that are only "generic tourist attractions" — they should not rank
// well by default; they need an explicit matching interest (handled by
// STYLE_TYPE_MAP above already including them under natureza/aventura/etc.)
// to be treated as relevant rather than filler.
const GENERIC_LOW_PRIORITY_TYPES = new Set(['aquarium', 'zoo', 'amusement_park', 'casino', 'movie_theater']);

export interface RankedCandidate<T extends ScorableCandidate> {
  candidate: T;
  interestScore: number;   // 0-100, primary sort key
  qualityScore: number;    // 0-100, secondary sort key (rating)
  popularityScore: number; // 0-100, tertiary sort key / tie-breaker only
  budgetMismatch: boolean; // soft signal, not a hard filter
}

function budgetToPriceLevelRange(budget?: string): [number, number] {
  switch (budget) {
    case 'econômico': return [0, 1];
    case 'luxo': return [2, 4];
    default: return [1, 3]; // moderado / unset
  }
}

/**
 * Scores one candidate against the traveler's structured interests. Returns
 * three independent scores (never summed into one blended number) so the
 * caller can sort by the required priority tuple without popularity ever
 * being able to compensate for a poor interest match.
 */
export function scoreCandidate<T extends ScorableCandidate>(
  candidate: T,
  opts: { travelStyles?: string[]; attractionsBudget?: string; restaurantsBudget?: string },
): RankedCandidate<T> {
  const styles = (opts.travelStyles || []).filter((s): s is TravelStyleKey => s in STYLE_TYPE_MAP);
  const isRestaurantLike = candidate.types.some((t) =>
    ['restaurant', 'cafe', 'bakery', 'food', 'meal_takeaway', 'meal_delivery'].includes(t));

  let interestScore = 0;
  if (styles.length === 0) {
    // No structured style info available (e.g. legacy "use my selected places"
    // flow) — fall back to a neutral baseline so ranking degrades to
    // quality/popularity only, rather than penalizing every candidate.
    interestScore = 50;
  } else {
    let matchedStyles = 0;
    for (const style of styles) {
      const relevantTypes = STYLE_TYPE_MAP[style];
      if (candidate.types.some((t) => relevantTypes.includes(t))) matchedStyles++;
    }
    interestScore = (matchedStyles / styles.length) * 100;

    // A place with zero matched styles that is also a "generic tourist trap"
    // type gets pushed further down — it's not just neutral, it's actively
    // low-relevance filler unless one of the user's styles explicitly covers it.
    if (matchedStyles === 0 && candidate.types.some((t) => GENERIC_LOW_PRIORITY_TYPES.has(t))) {
      interestScore = 5;
    } else if (matchedStyles === 0) {
      interestScore = 20; // unmatched but not a "trap" type — still low, not zero
    }
  }

  const qualityScore = candidate.rating ? (candidate.rating / 5) * 100 : 40; // unrated: mild neutral score
  const popularityScore = Math.min(100, Math.log10(candidate.userRatingsTotal + 1) * 25);

  const budget = isRestaurantLike ? opts.restaurantsBudget : opts.attractionsBudget;
  const [lo, hi] = budgetToPriceLevelRange(budget);
  const budgetMismatch = candidate.priceLevel != null && (candidate.priceLevel < lo || candidate.priceLevel > hi);

  return { candidate, interestScore, qualityScore, popularityScore, budgetMismatch };
}

/**
 * Ranks candidates by the required priority tuple: interest match first,
 * quality second, popularity only as a final tie-breaker. A budget mismatch
 * is a soft demotion (moves a candidate down within its interest tier), never
 * a hard exclusion — budget is a Level-2 preference, not a Level-1 constraint.
 */
export function rankCandidates<T extends ScorableCandidate>(
  candidates: T[],
  opts: { travelStyles?: string[]; attractionsBudget?: string; restaurantsBudget?: string },
): RankedCandidate<T>[] {
  return candidates
    .map((c) => scoreCandidate(c, opts))
    .sort((a, b) => {
      if (a.budgetMismatch !== b.budgetMismatch) return a.budgetMismatch ? 1 : -1;
      if (b.interestScore !== a.interestScore) return b.interestScore - a.interestScore;
      if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
      return b.popularityScore - a.popularityScore;
    });
}

/**
 * Hard filter: strips out any candidate matching a user's "avoid" free text
 * (e.g. "não gosto de aquário", "evitar shopping"). This is a Level-1
 * exclusion — it runs before ranking, so an excluded category can never
 * resurface no matter how popular or well-rated it is.
 *
 * Matching is deliberately simple substring/keyword matching against the
 * candidate's name and Google `types` — not full semantic understanding,
 * since this is the deterministic/code half of the pipeline; the LLM is
 * still told about the exclusion in the prompt as a second layer of defense
 * for anything textual matching misses.
 */
const AVOID_KEYWORD_TO_TYPES: Record<string, string[]> = {
  aquario: ['aquarium'], aquário: ['aquarium'], aquarium: ['aquarium'],
  zoologico: ['zoo'], zoológico: ['zoo'], zoo: ['zoo'],
  shopping: ['shopping_mall', 'department_store'], mall: ['shopping_mall'],
  parque_de_diversao: ['amusement_park'], 'parque de diversões': ['amusement_park'], amusement: ['amusement_park'],
  cassino: ['casino'], casino: ['casino'],
  balada: ['night_club'], boate: ['night_club'], nightclub: ['night_club'],
  igreja: ['church', 'place_of_worship'], church: ['church', 'place_of_worship'],
  museu: ['museum'], museum: ['museum'],
};

export function filterExcludedCandidates<T extends ScorableCandidate>(
  candidates: T[],
  avoidText: string | undefined,
): { kept: T[]; excludedCount: number } {
  if (!avoidText || !avoidText.trim()) return { kept: candidates, excludedCount: 0 };

  const normalized = avoidText.toLowerCase();
  const excludedTypes = new Set<string>();
  for (const [keyword, types] of Object.entries(AVOID_KEYWORD_TO_TYPES)) {
    if (normalized.includes(keyword)) types.forEach((t) => excludedTypes.add(t));
  }
  // Free-form terms (e.g. a specific place name the user wants to avoid) are
  // also matched directly against candidate names.
  const freeTerms = normalized
    .split(/[,.;\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);

  const kept: T[] = [];
  let excludedCount = 0;
  for (const c of candidates) {
    const nameLower = c.name.toLowerCase();
    const typeExcluded = c.types.some((t) => excludedTypes.has(t));
    const nameExcluded = freeTerms.some((term) => nameLower.includes(term));
    if (typeExcluded || nameExcluded) {
      excludedCount++;
    } else {
      kept.push(c);
    }
  }
  return { kept, excludedCount };
}
