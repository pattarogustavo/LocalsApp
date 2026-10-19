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
  /**
   * 0-100 editorial-affinity signal (e.g. a curated-catalog match, scaled
   * from curator confidence). Optional — absent/undefined candidates (the
   * default for anything not catalog-sourced) score 0 on this dimension and
   * are ranked purely by interest/quality/popularity exactly as before this
   * field existed. Never a hard filter, same as every other score here.
   */
  editorialPriority?: number;
}

export type TravelStyleKey =
  | 'cultura' | 'gastronomia' | 'natureza' | 'aventura' | 'relaxamento'
  | 'compras' | 'historia' | 'praia' | 'montanha' | 'cidade' | 'vida_noturna' | 'arte';

// Maps the app's structured travel-style options to the Google Places `types`
// that genuinely serve that interest. Deliberately excludes generic tourist
// traps (aquarium, zoo, amusement_park, casino) from every style except the
// ones they actually belong to (natureza/aventura, vida_noturna) — this is
// the concrete fix for "aquarium beats art museum for an Art+Gastronomy user".
export const STYLE_TYPE_MAP: Record<TravelStyleKey, string[]> = {
  cultura: ['museum', 'art_gallery', 'church', 'hindu_temple', 'mosque', 'synagogue',
    'place_of_worship', 'city_hall', 'library', 'historical_landmark', 'landmark', 'university'],
  historia: ['museum', 'historical_landmark', 'landmark', 'church', 'place_of_worship', 'city_hall'],
  gastronomia: ['restaurant', 'food', 'bakery', 'cafe', 'meal_takeaway', 'meal_delivery', 'market'],
  natureza: ['park', 'natural_feature', 'botanical_garden', 'zoo', 'campground', 'hiking_area'],
  montanha: ['natural_feature', 'hiking_area', 'campground', 'park'],
  praia: ['natural_feature', 'beach'],
  aventura: ['amusement_park', 'zoo', 'stadium', 'hiking_area', 'campground', 'gym', 'bowling_alley'],
  relaxamento: ['spa', 'park', 'natural_feature', 'botanical_garden'],
  compras: ['shopping_mall', 'department_store', 'clothing_store', 'book_store', 'jewelry_store', 'store', 'market'],
  cidade: ['tourist_attraction', 'point_of_interest', 'landmark', 'shopping_mall'],
  vida_noturna: ['night_club', 'bar', 'casino'],
  // Was missing entirely until this fix — the app's "Arte" chip
  // (components/trip/itinerary-block.tsx) sends the literal id "arte", which
  // isn't a valid TravelStyleKey without this entry: `s in STYLE_TYPE_MAP`
  // (scoreCandidate below) silently filtered it out of every ranking pass,
  // so selecting ONLY "Arte" was functionally identical to selecting
  // nothing (falls back to the neutral interestScore=50 baseline).
  arte: ['art_gallery', 'museum'],
};

// Types that are only "generic tourist attractions" — they should not rank
// well by default; they need an explicit matching interest (handled by
// STYLE_TYPE_MAP above already including them under natureza/aventura/etc.)
// to be treated as relevant rather than filler.
const GENERIC_LOW_PRIORITY_TYPES = new Set(['aquarium', 'zoo', 'amusement_park', 'casino', 'movie_theater']);

export interface RankedCandidate<T extends ScorableCandidate> {
  candidate: T;
  interestScore: number;   // 0-100, primary sort key
  editorialScore: number;  // 0-100, secondary sort key (curated-catalog affinity)
  qualityScore: number;    // 0-100, tertiary sort key (rating)
  popularityScore: number; // 0-100, final tie-breaker only
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
  const editorialScore = Math.max(0, Math.min(100, candidate.editorialPriority ?? 0));

  const budget = isRestaurantLike ? opts.restaurantsBudget : opts.attractionsBudget;
  const [lo, hi] = budgetToPriceLevelRange(budget);
  const budgetMismatch = candidate.priceLevel != null && (candidate.priceLevel < lo || candidate.priceLevel > hi);

  return { candidate, interestScore, editorialScore, qualityScore, popularityScore, budgetMismatch };
}

/**
 * Ranks candidates by the required priority tuple: interest match first,
 * editorial affinity (curated catalog) second, quality third, popularity
 * only as a final tie-breaker. A budget mismatch is a soft demotion (moves a
 * candidate down within its interest tier), never a hard exclusion — budget
 * is a Level-2 preference, not a Level-1 constraint. A candidate that also
 * exists in the curated catalog gains PRIORITY OF POSITION this way, never
 * exclusivity — it still has to clear the same interest-match bar as any
 * other candidate before editorial affinity can move it up within that tier.
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
      if (b.editorialScore !== a.editorialScore) return b.editorialScore - a.editorialScore;
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

const RESTAURANT_LIKE_TYPES = new Set(['restaurant', 'cafe', 'bakery', 'food', 'meal_takeaway', 'meal_delivery', 'bar']);

function isRestaurantLikeCandidate<T extends ScorableCandidate & { category?: string; cuisine?: string }>(c: T): boolean {
  const category = (c.category || '').toLowerCase();
  return category === 'restaurant' || category === 'cafe' || c.types.some((t) => RESTAURANT_LIKE_TYPES.has(t));
}

/** Best available "what kind of food/drink is this" signal — catalog `cuisine` metadata when present (most reliable), otherwise the most specific Google `types` entry available. Never invented; just a grouping key for the diversity pass below. */
function cuisineSignature<T extends ScorableCandidate & { category?: string; cuisine?: string }>(c: T): string {
  if (c.cuisine) return c.cuisine.toLowerCase();
  const specific = c.types.find((t) => t !== 'restaurant' && t !== 'food' && t !== 'point_of_interest' && t !== 'establishment' && RESTAURANT_LIKE_TYPES.has(t));
  return specific || 'restaurant';
}

/**
 * Reorders ONLY the restaurant-like candidates (attractions/museums/etc. keep
 * their rank position untouched) by round-robin across cuisine/type buckets —
 * so a single highly-reviewed cluster (e.g. many similarly-ranked Thai or
 * Indian places) can't monopolize the top of the list and crowd out other
 * local food options (traditional pubs, other cuisines) purely by volume.
 * Reorder-only, same invariant as rankCandidates: never drops a candidate,
 * never changes how many restaurant slots exist, only which order they
 * appear in within those slots.
 */
export function diversifyRestaurantLikeOrder<T extends ScorableCandidate & { category?: string; cuisine?: string }>(ranked: T[]): T[] {
  const restaurantSlots: number[] = [];
  const restaurants: T[] = [];
  ranked.forEach((c, i) => {
    if (isRestaurantLikeCandidate(c)) {
      restaurantSlots.push(i);
      restaurants.push(c);
    }
  });
  if (restaurants.length <= 2) return ranked;

  const buckets = new Map<string, T[]>();
  for (const r of restaurants) {
    const sig = cuisineSignature(r);
    if (!buckets.has(sig)) buckets.set(sig, []);
    buckets.get(sig)!.push(r); // already rank-ordered, so bucket order is preserved
  }
  const bucketArrays = Array.from(buckets.values());

  const diversified: T[] = [];
  for (let round = 0; diversified.length < restaurants.length; round++) {
    for (const bucket of bucketArrays) {
      if (round < bucket.length) diversified.push(bucket[round]);
    }
  }

  const result = ranked.slice();
  restaurantSlots.forEach((slotIdx, i) => {
    result[slotIdx] = diversified[i];
  });
  return result;
}

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
