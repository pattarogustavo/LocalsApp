import { describe, expect, it } from "vitest";
import { validateProposedPlace, validateProposedPlaces, type RawProposedPlace } from "../scripts/curate/validate-place";

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

  it("rejects an invalid category", () => {
    const result = validateProposedPlace(validRaw({ category: "landmark" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("category"))).toBe(true);
  });

  it("rejects a tags array with an invalid value", () => {
    const result = validateProposedPlace(validRaw({ tags: ["culture", "unknown-tag"] }));
    expect(result.valid).toBe(false);
  });

  it("rejects a non-boolean isLocalCuisine", () => {
    const result = validateProposedPlace(validRaw({ isLocalCuisine: "yes" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a missing description", () => {
    const result = validateProposedPlace(validRaw({ descriptionEn: "" }));
    expect(result.valid).toBe(false);
  });

  it("accepts a valid optional priceTier and meals, rejects an invalid one", () => {
    expect(validateProposedPlace(validRaw({ category: "restaurant", priceTier: "budget", meals: ["lunch"] })).valid).toBe(true);
    expect(validateProposedPlace(validRaw({ category: "restaurant", priceTier: "cheap" })).valid).toBe(false);
  });

  it("tolerates missing optional fields (neighborhood, cuisine, priceTier, meals)", () => {
    const result = validateProposedPlace(validRaw());
    expect(result.valid).toBe(true);
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
  });
});
