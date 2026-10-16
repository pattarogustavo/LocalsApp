/**
 * Defensive validation of AI-structured places before they ever reach
 * verification or the database. The structuring call already forces a JSON
 * schema, but a truncated response, a bad enum coercion, or an empty string
 * can still slip through — this is the last line of defense, and anything
 * that fails is dropped individually (never written partial/invalid).
 */

export const VALID_CATEGORIES = ["attraction", "restaurant", "cafe", "museum", "hidden_gem", "other"] as const;
export const VALID_TAGS = ["culture", "gastronomy", "nature", "adventure", "shopping", "relaxation", "nightlife", "art"] as const;
export const VALID_PRICE_TIERS = ["budget", "moderate", "luxury"] as const;
export const VALID_MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export const VALID_CONFIDENCE = ["high", "medium", "low"] as const;

export interface RawProposedPlace {
  name?: unknown;
  neighborhood?: unknown;
  category?: unknown;
  tags?: unknown;
  priceTier?: unknown;
  meals?: unknown;
  cuisine?: unknown;
  isLocalCuisine?: unknown;
  confidence?: unknown;
  priority?: unknown;
  descriptionPt?: unknown;
  descriptionEn?: unknown;
}

export interface ValidatedPlace {
  name: string;
  neighborhood?: string;
  category: (typeof VALID_CATEGORIES)[number];
  tags: (typeof VALID_TAGS)[number][];
  priceTier?: (typeof VALID_PRICE_TIERS)[number];
  meals?: (typeof VALID_MEALS)[number][];
  cuisine?: string;
  isLocalCuisine: boolean;
  confidence: (typeof VALID_CONFIDENCE)[number];
  priority: number;
  descriptionPt: string;
  descriptionEn: string;
}

export interface ValidationResult {
  valid: boolean;
  place?: ValidatedPlace;
  errors: string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArrayOf<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && (allowed as readonly string[]).includes(v));
}

/**
 * Common synonyms the AI proposes instead of the stored category enum.
 * Anything not listed here and not already a VALID_CATEGORIES value stays
 * invalid — this is a fixed mapping, never a fuzzy guess.
 */
const CATEGORY_SYNONYMS: Record<string, (typeof VALID_CATEGORIES)[number]> = {
  landmark: "attraction",
  monument: "attraction",
  palace: "attraction",
  square: "attraction",
  park: "attraction",
  viewpoint: "attraction",
  church: "attraction",
  cathedral: "attraction",
  bridge: "attraction",
  castle: "attraction",
  gallery: "museum",
  market: "other",
  shop: "other",
  bookstore: "other",
  nightclub: "other",
  bar: "other",
  venue: "other",
  theatre: "other",
};

export interface NormalizeOptions {
  /**
   * curate:add only: a category with no VALID_CATEGORIES/CATEGORY_SYNONYMS
   * match falls back to "other" instead of invalidating the item — a
   * manually-picked place (neighborhood, district, street market, ...) is
   * never discarded over a category word the structuring call phrased
   * differently. Batch generation (structureBatch) never sets this, and
   * stays strict: an unrecognized category there still invalidates the item.
   */
  lenientCategory?: boolean;
}

/**
 * Coerces common, harmless shape mismatches BEFORE validation, so a place is
 * only ever rejected for something that's actually wrong (missing name,
 * missing description, unrecognizable category) rather than a cosmetic
 * detail the AI got slightly wrong (an invented tag, a stringified priority,
 * a category synonym). Each rule below is additive and never widens what
 * validateProposedPlace still requires (name/descriptionPt/descriptionEn
 * non-empty, category valid after mapping, isLocalCuisine present for
 * restaurant/cafe).
 */
export function normalizeRawPlace(raw: RawProposedPlace, options: NormalizeOptions = {}): RawProposedPlace {
  const normalized: RawProposedPlace = { ...raw };

  if (typeof normalized.category === "string") {
    const cat = normalized.category.toLowerCase().trim();
    if ((VALID_CATEGORIES as readonly string[]).includes(cat)) normalized.category = cat;
    else if (CATEGORY_SYNONYMS[cat]) normalized.category = CATEGORY_SYNONYMS[cat];
    else if (options.lenientCategory) normalized.category = "other";
  }

  if (Array.isArray(normalized.tags)) {
    const allowed = normalized.tags.filter((t) => typeof t === "string" && (VALID_TAGS as readonly string[]).includes(t));
    normalized.tags = allowed.length > 0 ? allowed : ["culture"];
  }

  if (normalized.isLocalCuisine == null) {
    const cat = typeof normalized.category === "string" ? normalized.category : undefined;
    if (cat !== "restaurant" && cat !== "cafe") normalized.isLocalCuisine = false;
  }

  if (normalized.priority == null) {
    normalized.priority = 5;
  } else if (typeof normalized.priority === "string") {
    const parsed = Number(normalized.priority);
    if (Number.isFinite(parsed)) normalized.priority = parsed;
  }

  if (normalized.confidence == null) {
    normalized.confidence = "medium";
  } else if (!(typeof normalized.confidence === "string" && (VALID_CONFIDENCE as readonly string[]).includes(normalized.confidence))) {
    normalized.confidence = "medium";
  }

  if (normalized.priceTier != null && !(typeof normalized.priceTier === "string" && (VALID_PRICE_TIERS as readonly string[]).includes(normalized.priceTier))) {
    normalized.priceTier = undefined;
  }

  if (normalized.meals != null) {
    normalized.meals = Array.isArray(normalized.meals)
      ? normalized.meals.filter((m) => typeof m === "string" && (VALID_MEALS as readonly string[]).includes(m))
      : undefined;
  }

  return normalized;
}

/** Validates one structured place (after normalization). Returns the validated (type-narrowed) object, or the list of reasons it was rejected. */
export function validateProposedPlace(rawInput: RawProposedPlace, options: NormalizeOptions = {}): ValidationResult {
  const raw = normalizeRawPlace(rawInput, options);
  const errors: string[] = [];

  if (!isNonEmptyString(raw.name)) errors.push("name is missing or empty");
  if (!(typeof raw.category === "string" && (VALID_CATEGORIES as readonly string[]).includes(raw.category))) {
    errors.push(`category "${String(raw.category)}" is not one of ${VALID_CATEGORIES.join(", ")}`);
  }
  if (!isStringArrayOf(raw.tags, VALID_TAGS)) errors.push("tags contains an invalid value or isn't an array");
  if (typeof raw.isLocalCuisine !== "boolean") errors.push("isLocalCuisine is missing or not a boolean");
  if (!(typeof raw.confidence === "string" && (VALID_CONFIDENCE as readonly string[]).includes(raw.confidence))) {
    errors.push(`confidence "${String(raw.confidence)}" is not one of ${VALID_CONFIDENCE.join(", ")}`);
  }
  if (typeof raw.priority !== "number" || !Number.isFinite(raw.priority)) errors.push("priority is missing or not a number");
  if (!isNonEmptyString(raw.descriptionPt)) errors.push("descriptionPt is missing or empty");
  if (!isNonEmptyString(raw.descriptionEn)) errors.push("descriptionEn is missing or empty");

  if (raw.priceTier != null && !(typeof raw.priceTier === "string" && (VALID_PRICE_TIERS as readonly string[]).includes(raw.priceTier))) {
    errors.push(`priceTier "${String(raw.priceTier)}" is not one of ${VALID_PRICE_TIERS.join(", ")}`);
  }
  if (raw.meals != null && !isStringArrayOf(raw.meals, VALID_MEALS)) errors.push("meals contains an invalid value or isn't an array");
  if (raw.neighborhood != null && typeof raw.neighborhood !== "string") errors.push("neighborhood is not a string");
  if (raw.cuisine != null && typeof raw.cuisine !== "string") errors.push("cuisine is not a string");

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    place: {
      name: (raw.name as string).trim(),
      neighborhood: raw.neighborhood as string | undefined,
      category: raw.category as ValidatedPlace["category"],
      tags: raw.tags as ValidatedPlace["tags"],
      priceTier: raw.priceTier as ValidatedPlace["priceTier"],
      meals: raw.meals as ValidatedPlace["meals"],
      cuisine: raw.cuisine as string | undefined,
      isLocalCuisine: raw.isLocalCuisine as boolean,
      confidence: raw.confidence as ValidatedPlace["confidence"],
      priority: raw.priority as number,
      descriptionPt: (raw.descriptionPt as string).trim(),
      descriptionEn: (raw.descriptionEn as string).trim(),
    },
  };
}

export interface InvalidPlaceExample {
  name: string;
  errors: string[];
}

/** Max invalid-place examples kept per validated batch (checkpoint + log). */
export const MAX_INVALID_EXAMPLES = 8;

/** The leading identifier word of a validation error message, e.g. "tags is not an array" -> "tags". Used to count invalid reasons by field. */
function errorField(error: string): string {
  return error.match(/^[A-Za-z]+/)?.[0] ?? "other";
}

/** Tallies how many invalid items failed because of each field, e.g. { tags: 9, isLocalCuisine: 2 }. */
export function countInvalidReasons(invalid: { errors: string[] }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of invalid) {
    for (const error of item.errors) {
      const field = errorField(error);
      counts[field] = (counts[field] ?? 0) + 1;
    }
  }
  return counts;
}

export interface ValidatePlacesSummary {
  valid: ValidatedPlace[];
  invalidCount: number;
  invalid: { input: RawProposedPlace; errors: string[] }[];
  /** Invalid-reason tallies by field (see countInvalidReasons), for per-batch and destination-level reporting. */
  invalidReasonCounts: Record<string, number>;
  /** Up to MAX_INVALID_EXAMPLES invalid items, kept for the checkpoint/log so discards are debuggable. */
  invalidExamples: InvalidPlaceExample[];
}

/** Validates a whole batch, discarding invalid items individually instead of failing the batch. */
export function validateProposedPlaces(raw: RawProposedPlace[], options: NormalizeOptions = {}): ValidatePlacesSummary {
  const valid: ValidatedPlace[] = [];
  const invalid: { input: RawProposedPlace; errors: string[] }[] = [];
  for (const item of raw) {
    const result = validateProposedPlace(item, options);
    if (result.valid && result.place) {
      valid.push(result.place);
    } else {
      invalid.push({ input: item, errors: result.errors });
    }
  }
  const invalidExamples: InvalidPlaceExample[] = invalid.slice(0, MAX_INVALID_EXAMPLES).map((i) => ({
    name: isNonEmptyString(i.input.name) ? i.input.name : "(sem nome)",
    errors: i.errors,
  }));
  return { valid, invalidCount: invalid.length, invalid, invalidReasonCounts: countInvalidReasons(invalid), invalidExamples };
}

/** "tags=9, isLocalCuisine=2" style summary of countInvalidReasons' output, for logs/reports. */
export function formatInvalidReasonCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return "(nenhum)";
  return entries.map(([field, n]) => `${field}=${n}`).join(", ");
}

/** Merges two invalid-reason-count maps field by field. Tolerates undefined/null for either argument (treated as empty) — a checkpoint saved before this field existed can still hand one in. */
export function addInvalidReasonCounts(a: Record<string, number> | null | undefined, b: Record<string, number> | null | undefined): Record<string, number> {
  const result: Record<string, number> = { ...(a ?? {}) };
  for (const [field, n] of Object.entries(b ?? {})) result[field] = (result[field] ?? 0) + n;
  return result;
}
