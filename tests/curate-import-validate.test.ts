import { describe, expect, it } from "vitest";
import { validateImportPlace } from "../scripts/curate/import-validate";
import type { ImportRawPlace } from "../scripts/curate/import-json";

function raw(overrides: Partial<ImportRawPlace> = {}): ImportRawPlace {
  return {
    name: "Livraria Lello",
    category: "attraction",
    tags: ["culture", "art"],
    confidence: "high",
    descriptions: { pt: "Uma livraria.", en: "A bookstore." },
    ...overrides,
  };
}

describe("validateImportPlace", () => {
  it("accepts a fully valid place", () => {
    const result = validateImportPlace(raw());
    expect(result.valid).toBe(true);
    expect(result.place?.name).toBe("Livraria Lello");
    expect(result.place?.category).toBe("attraction");
  });

  it("rejects a missing name", () => {
    const result = validateImportPlace(raw({ name: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("accepts a place with no category at all, leaving it undefined for later Google-type inference", () => {
    const result = validateImportPlace(raw({ category: undefined }));
    expect(result.valid).toBe(true);
    expect(result.place?.category).toBeUndefined();
  });

  it("maps a category synonym onto the stored enum (same mapping as curate:add/generate)", () => {
    const result = validateImportPlace(raw({ category: "landmark" }));
    expect(result.valid).toBe(true);
    expect(result.place?.category).toBe("attraction");
  });

  it("falls back a given-but-unrecognized category to 'other' instead of rejecting the place (same leniency as curate:add)", () => {
    const result = validateImportPlace(raw({ category: "spaceship" }));
    expect(result.valid).toBe(true);
    expect(result.place?.category).toBe("other");
  });

  it("rejects a category that isn't even a string", () => {
    const result = validateImportPlace(raw({ category: 42 as unknown as string }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("category"))).toBe(true);
  });

  it("accepts descriptions with only pt", () => {
    const result = validateImportPlace(raw({ descriptions: { pt: "Só em português." } }));
    expect(result.valid).toBe(true);
    expect(result.place?.descriptions).toEqual({ pt: "Só em português." });
  });

  it("accepts descriptions with only en", () => {
    const result = validateImportPlace(raw({ descriptions: { en: "English only." } }));
    expect(result.valid).toBe(true);
  });

  it("rejects descriptions with neither pt nor en", () => {
    const result = validateImportPlace(raw({ descriptions: { es: "Solo en español." } }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("pt or en"))).toBe(true);
  });

  it("rejects a missing descriptions object entirely", () => {
    const result = validateImportPlace(raw({ descriptions: undefined }));
    expect(result.valid).toBe(false);
  });

  it("carries through es/fr/de/it when already supplied", () => {
    const result = validateImportPlace(raw({ descriptions: { pt: "x", en: "y", es: "z", fr: "f", de: "d", it: "i" } }));
    expect(result.valid).toBe(true);
    expect(result.place?.descriptions).toEqual({ pt: "x", en: "y", es: "z", fr: "f", de: "d", it: "i" });
  });

  it("drops an invented tag instead of invalidating the place, falling back to [culture]", () => {
    const result = validateImportPlace(raw({ tags: ["not-a-tag"] }));
    expect(result.valid).toBe(true);
    expect(result.place?.tags).toEqual(["culture"]);
  });

  it("defaults tags to an empty-ish fallback and confidence to medium when absent", () => {
    const result = validateImportPlace(raw({ tags: undefined, confidence: undefined }));
    expect(result.valid).toBe(true);
    expect(result.place?.confidence).toBe("medium");
  });

  it("rejects a non-string neighborhood", () => {
    const result = validateImportPlace(raw({ neighborhood: 42 as unknown as string }));
    expect(result.valid).toBe(false);
  });

  it("keeps priceTier/meals/cuisine when valid", () => {
    const result = validateImportPlace(
      raw({ category: "restaurant", priceTier: "moderate", meals: ["lunch", "dinner"], cuisine: "Portuguese" }),
    );
    expect(result.valid).toBe(true);
    expect(result.place?.priceTier).toBe("moderate");
    expect(result.place?.meals).toEqual(["lunch", "dinner"]);
    expect(result.place?.cuisine).toBe("Portuguese");
  });
});
