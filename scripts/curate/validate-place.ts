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

/** Validates one structured place. Returns the validated (type-narrowed) object, or the list of reasons it was rejected. */
export function validateProposedPlace(raw: RawProposedPlace): ValidationResult {
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

export interface ValidatePlacesSummary {
  valid: ValidatedPlace[];
  invalidCount: number;
  invalid: { input: RawProposedPlace; errors: string[] }[];
}

/** Validates a whole batch, discarding invalid items individually instead of failing the batch. */
export function validateProposedPlaces(raw: RawProposedPlace[]): ValidatePlacesSummary {
  const valid: ValidatedPlace[] = [];
  const invalid: { input: RawProposedPlace; errors: string[] }[] = [];
  for (const item of raw) {
    const result = validateProposedPlace(item);
    if (result.valid && result.place) {
      valid.push(result.place);
    } else {
      invalid.push({ input: item, errors: result.errors });
    }
  }
  return { valid, invalidCount: invalid.length, invalid };
}
