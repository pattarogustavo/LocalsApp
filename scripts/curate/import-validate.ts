/**
 * Validation for curate:import's raw place entries. Deliberately reuses
 * normalizeRawPlace (the same category-synonym mapping, tag filtering,
 * priceTier/meals coercion, and confidence default used by curate:generate
 * and curate:add) so a place normalizes identically no matter which command
 * produced it — but the acceptance rules differ from validateProposedPlace:
 * a category is allowed to be entirely absent (curate:import infers it from
 * Google's types after resolving the place), and only one of pt/en is
 * required rather than both.
 */

import { normalizeRawPlace, VALID_CATEGORIES, type RawProposedPlace } from "./validate-place";
import type { Descriptions, DescriptionLang } from "./descriptions";
import type { ImportRawPlace } from "./import-json";
import type { ImportCategory } from "./import-category";

const DESCRIPTION_LANGS: DescriptionLang[] = ["pt", "en", "es", "fr", "de", "it"];

export interface ImportValidatedPlace {
  name: string;
  /** Alternative names (e.g. the same place in another language) — any of them matching Google's result is enough; see pickVerifiedCandidate. */
  altNames: string[];
  neighborhood?: string;
  /** undefined when the input gave no usable category — resolved later from Google's types. */
  category?: ImportCategory;
  tags: string[];
  priceTier?: string;
  meals?: string[];
  cuisine?: string;
  confidence: string;
  descriptions: Descriptions;
}

export interface ImportValidationResult {
  valid: boolean;
  place?: ImportValidatedPlace;
  errors: string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizeDescriptions(raw: unknown): { descriptions: Descriptions; errors: string[] } {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { descriptions: {}, errors: ["descriptions is missing or not an object"] };
  }
  const errors: string[] = [];
  const descriptions: Descriptions = {};
  const obj = raw as Record<string, unknown>;
  for (const lang of DESCRIPTION_LANGS) {
    const value = obj[lang];
    if (value == null) continue;
    if (typeof value !== "string") {
      errors.push(`descriptions.${lang} is not a string`);
      continue;
    }
    if (value.trim()) descriptions[lang] = value.trim();
  }
  return { descriptions, errors };
}

/** Validates and normalizes one curate:import place entry; see module doc for how this differs from validateProposedPlace. */
export function validateImportPlace(raw: ImportRawPlace): ImportValidationResult {
  const errors: string[] = [];

  if (!isNonEmptyString(raw.name)) errors.push("name is missing or empty");
  if (raw.neighborhood != null && typeof raw.neighborhood !== "string") errors.push("neighborhood is not a string");

  let altNames: string[] = [];
  if (raw.altNames != null) {
    if (!Array.isArray(raw.altNames)) {
      errors.push("altNames is not an array");
    } else {
      altNames = raw.altNames.filter((n): n is string => typeof n === "string" && n.trim().length > 0).map((n) => n.trim());
    }
  }

  const normalized = normalizeRawPlace(raw as RawProposedPlace, { lenientCategory: true });

  let category: ImportCategory | undefined;
  if (raw.category != null) {
    if (typeof normalized.category === "string" && (VALID_CATEGORIES as readonly string[]).includes(normalized.category)) {
      category = normalized.category as ImportCategory;
    } else {
      errors.push(`category "${String(raw.category)}" is not recognized`);
    }
  }

  const tags = Array.isArray(normalized.tags) ? (normalized.tags as string[]) : [];
  const priceTier = typeof normalized.priceTier === "string" ? normalized.priceTier : undefined;
  const meals = Array.isArray(normalized.meals) ? (normalized.meals as string[]) : undefined;
  const cuisine = isNonEmptyString(raw.cuisine) ? raw.cuisine.trim() : undefined;
  const confidence = typeof normalized.confidence === "string" ? normalized.confidence : "medium";

  const { descriptions, errors: descriptionErrors } = sanitizeDescriptions(raw.descriptions);
  errors.push(...descriptionErrors);
  if (!descriptions.pt && !descriptions.en) errors.push("descriptions must include at least pt or en");

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    place: {
      name: (raw.name as string).trim(),
      altNames,
      neighborhood: typeof raw.neighborhood === "string" ? raw.neighborhood : undefined,
      category,
      tags,
      priceTier,
      meals,
      cuisine,
      confidence,
      descriptions,
    },
  };
}
