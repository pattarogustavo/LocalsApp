import { describe, expect, it } from "vitest";
import { buildBaseDescriptions, mergeTranslations, isCompleteDescriptions } from "../scripts/curate/descriptions";

describe("buildBaseDescriptions", () => {
  it("includes only the non-empty pt/en values", () => {
    expect(buildBaseDescriptions(" Um museu. ", "A museum.")).toEqual({ pt: "Um museu.", en: "A museum." });
    expect(buildBaseDescriptions(undefined, "A museum.")).toEqual({ en: "A museum." });
    expect(buildBaseDescriptions("", "   ")).toEqual({});
  });
});

describe("mergeTranslations", () => {
  it("adds es/fr/de/it without touching the existing pt/en", () => {
    const base = { pt: "Um museu.", en: "A museum." };
    const result = mergeTranslations(base, { es: "Un museo.", fr: "Un musée.", de: "Ein Museum.", it: "Un museo." });
    expect(result).toEqual({
      pt: "Um museu.",
      en: "A museum.",
      es: "Un museo.",
      fr: "Un musée.",
      de: "Ein Museum.",
      it: "Un museo.",
    });
  });

  it("ignores keys outside the allowed language set and empty values", () => {
    const base = { pt: "Um museu.", en: "A museum." };
    const result = mergeTranslations(base, { es: "", xx: "should be ignored" } as any);
    expect(result).toEqual(base);
  });

  it("never overwrites pt/en even if passed in translations", () => {
    const base = { pt: "Um museu.", en: "A museum." };
    const result = mergeTranslations(base, { pt: "overwritten?", en: "overwritten?" });
    expect(result).toEqual(base);
  });
});

describe("isCompleteDescriptions", () => {
  it("is true only when all six languages are present", () => {
    const complete = { pt: "a", en: "b", es: "c", fr: "d", de: "e", it: "f" };
    expect(isCompleteDescriptions(complete)).toBe(true);
    expect(isCompleteDescriptions({ pt: "a", en: "b" })).toBe(false);
  });
});
