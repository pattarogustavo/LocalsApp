import { describe, expect, it } from "vitest";
import {
  validateProposedPlace,
  validateProposedPlaces,
  normalizeRawPlace,
  countInvalidReasons,
  formatInvalidReasonCounts,
  addInvalidReasonCounts,
  type RawProposedPlace,
} from "../scripts/curate/validate-place";

function validRaw(overrides: Partial<RawProposedPlace> = {}): RawProposedPlace {
  return {
    name: "Louvre Museum",
    category: "museum",
    tags: ["culture", "art"],
    isLocalCuisine: true,
    confidence: "high",
    priority: 10,
    descriptionPt: "Um dos maiores museus do mundo.",
    descriptionEn: "One of the world's largest museums.",
    ...overrides,
  };
}

describe("validateProposedPlace", () => {
  it("accepts a fully valid place", () => {
    const result = validateProposedPlace(validRaw());
    expect(result.valid).toBe(true);
    expect(result.place?.name).toBe("Louvre Museum");
  });

  it("rejects a missing name", () => {
    const result = validateProposedPlace(validRaw({ name: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects a category with no synonym mapping", () => {
    const result = validateProposedPlace(validRaw({ category: "spaceship" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("category"))).toBe(true);
  });

  it("accepts a category synonym (e.g. landmark -> attraction), mapped on the resulting place", () => {
    const result = validateProposedPlace(validRaw({ category: "landmark" }));
    expect(result.valid).toBe(true);
    expect(result.place?.category).toBe("attraction");
  });

  it("drops an invented tag instead of invalidating the place", () => {
    const result = validateProposedPlace(validRaw({ tags: ["culture", "unknown-tag"] }));
    expect(result.valid).toBe(true);
    expect(result.place?.tags).toEqual(["culture"]);
  });

  it("falls back tags to [\"culture\"] when every tag is invented", () => {
    const result = validateProposedPlace(validRaw({ tags: ["made-up-1", "made-up-2"] }));
    expect(result.valid).toBe(true);
    expect(result.place?.tags).toEqual(["culture"]);
  });

  it("rejects a non-boolean isLocalCuisine", () => {
    const result = validateProposedPlace(validRaw({ isLocalCuisine: "yes" }));
    expect(result.valid).toBe(false);
  });

  it("defaults isLocalCuisine to false when absent for a non-restaurant/cafe category", () => {
    const { isLocalCuisine, ...rest } = validRaw({ category: "attraction" });
    const result = validateProposedPlace(rest);
    expect(result.valid).toBe(true);
    expect(result.place?.isLocalCuisine).toBe(false);
  });

  it("still requires isLocalCuisine for restaurant and cafe", () => {
    const { isLocalCuisine, ...rest } = validRaw({ category: "restaurant" });
    const result = validateProposedPlace(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("isLocalCuisine"))).toBe(true);
  });

  it("rejects a missing description", () => {
    const result = validateProposedPlace(validRaw({ descriptionEn: "" }));
    expect(result.valid).toBe(false);
  });

  it("converts a stringified priority to a number", () => {
    const result = validateProposedPlace(validRaw({ priority: "3" as unknown as number }));
    expect(result.valid).toBe(true);
    expect(result.place?.priority).toBe(3);
  });

  it("defaults priority to 5 when absent", () => {
    const { priority, ...rest } = validRaw();
    const result = validateProposedPlace(rest);
    expect(result.valid).toBe(true);
    expect(result.place?.priority).toBe(5);
  });

  it("defaults confidence to medium when absent or unrecognized", () => {
    const { confidence, ...rest } = validRaw();
    expect(validateProposedPlace(rest).place?.confidence).toBe("medium");
    expect(validateProposedPlace(validRaw({ confidence: "very-high" })).place?.confidence).toBe("medium");
  });

  it("discards an out-of-list priceTier instead of invalidating the place", () => {
    const result = validateProposedPlace(validRaw({ category: "restaurant", priceTier: "cheap" }));
    expect(result.valid).toBe(true);
    expect(result.place?.priceTier).toBeUndefined();
  });

  it("accepts a valid priceTier and meals", () => {
    const result = validateProposedPlace(validRaw({ category: "restaurant", priceTier: "budget", meals: ["lunch"] }));
    expect(result.valid).toBe(true);
    expect(result.place?.priceTier).toBe("budget");
  });

  it("filters out-of-list meals instead of invalidating the place", () => {
    const result = validateProposedPlace(validRaw({ category: "restaurant", meals: ["lunch", "brunch"] }));
    expect(result.valid).toBe(true);
    expect(result.place?.meals).toEqual(["lunch"]);
  });

  it("tolerates missing optional fields (neighborhood, cuisine, priceTier, meals)", () => {
    const result = validateProposedPlace(validRaw());
    expect(result.valid).toBe(true);
  });
});

describe("normalizeRawPlace", () => {
  it("maps every documented category synonym to its stored category", () => {
    const synonyms: Record<string, string> = {
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
    for (const [input, expected] of Object.entries(synonyms)) {
      expect(normalizeRawPlace({ category: input }).category).toBe(expected);
    }
  });

  it("leaves an already-valid category untouched", () => {
    expect(normalizeRawPlace({ category: "restaurant" }).category).toBe("restaurant");
  });

  it("leaves an unrecognized category untouched (no synonym, stays invalid downstream)", () => {
    expect(normalizeRawPlace({ category: "spaceship" }).category).toBe("spaceship");
  });
});

describe("countInvalidReasons / formatInvalidReasonCounts / addInvalidReasonCounts", () => {
  it("tallies invalid items by the leading field name in each error", () => {
    const counts = countInvalidReasons([
      { errors: ["tags contains an invalid value or isn't an array"] },
      { errors: ["tags contains an invalid value or isn't an array"] },
      { errors: ["isLocalCuisine is missing or not a boolean"] },
    ]);
    expect(counts).toEqual({ tags: 2, isLocalCuisine: 1 });
  });

  it("formats counts as a 'field=n, field=n' string, and '(nenhum)' when empty", () => {
    expect(formatInvalidReasonCounts({ tags: 9, isLocalCuisine: 2 })).toBe("tags=9, isLocalCuisine=2");
    expect(formatInvalidReasonCounts({})).toBe("(nenhum)");
  });

  it("merges two count maps field by field", () => {
    expect(addInvalidReasonCounts({ tags: 2, name: 1 }, { tags: 3, category: 1 })).toEqual({ tags: 5, name: 1, category: 1 });
  });

  it("treats undefined/null arguments as empty instead of throwing (old checkpoints may lack this field)", () => {
    expect(addInvalidReasonCounts({ tags: 2 }, undefined)).toEqual({ tags: 2 });
    expect(addInvalidReasonCounts(undefined, { tags: 2 })).toEqual({ tags: 2 });
    expect(addInvalidReasonCounts(null, null)).toEqual({});
  });
});

describe("validateProposedPlaces", () => {
  it("keeps valid items and collects invalid ones separately, without failing the whole batch", () => {
    const raw = [validRaw({ name: "A" }), validRaw({ name: "" }), validRaw({ name: "B", category: "bogus" })];
    const summary = validateProposedPlaces(raw);
    expect(summary.valid.map((p) => p.name)).toEqual(["A"]);
    expect(summary.invalidCount).toBe(2);
    expect(summary.invalid).toHaveLength(2);
  });

  it("returns an empty valid list for an empty batch", () => {
    const summary = validateProposedPlaces([]);
    expect(summary.valid).toEqual([]);
    expect(summary.invalidCount).toBe(0);
    expect(summary.invalidReasonCounts).toEqual({});
    expect(summary.invalidExamples).toEqual([]);
  });

  it("collects invalidReasonCounts and up to MAX_INVALID_EXAMPLES invalid examples with name + errors", () => {
    const raw = [validRaw({ name: "" }), validRaw({ name: "" }), validRaw({ name: "B", category: "bogus" })];
    const summary = validateProposedPlaces(raw);
    expect(summary.invalidReasonCounts.name).toBe(2);
    expect(summary.invalidReasonCounts.category).toBe(1);
    expect(summary.invalidExamples).toHaveLength(3);
    expect(summary.invalidExamples[0].name).toBe("(sem nome)");
    expect(summary.invalidExamples[2]).toEqual({ name: "B", errors: expect.arrayContaining([expect.stringContaining("category")]) });
  });

  it("caps invalidExamples at MAX_INVALID_EXAMPLES even with more invalid items", () => {
    const raw = Array.from({ length: 20 }, () => validRaw({ name: "" }));
    const summary = validateProposedPlaces(raw);
    expect(summary.invalidCount).toBe(20);
    expect(summary.invalidExamples).toHaveLength(8);
  });
});
