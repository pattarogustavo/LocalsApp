import { describe, expect, it } from "vitest";

import { validateRedescribed, firstSentence, findBatchRepetitionIds, MIN_DESCRIPTION_LENGTH, MAX_DESCRIPTION_LENGTH } from "../scripts/curate/redescribe-validate";

const GOOD_PT = "Pequeno café de bairro famoso pelo pão de queijo quentinho; vá antes das 9h, porque costuma acabar rápido.";
const GOOD_EN = "Tiny neighborhood bakery famous for its warm cheese bread; go before 9am since it tends to sell out fast.";

describe("validateRedescribed", () => {
  it("accepts a valid, non-generic pt/en pair within length bounds", () => {
    const result = validateRedescribed(GOOD_PT, GOOD_EN);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("rejects missing or empty pt/en", () => {
    expect(validateRedescribed(undefined, GOOD_EN).valid).toBe(false);
    expect(validateRedescribed("  ", GOOD_EN).valid).toBe(false);
    expect(validateRedescribed(GOOD_PT, "").valid).toBe(false);
  });

  it(`rejects a description shorter than ${MIN_DESCRIPTION_LENGTH} characters`, () => {
    const result = validateRedescribed("Muito curto.", GOOD_EN);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("pt length"))).toBe(true);
  });

  it(`rejects a description longer than ${MAX_DESCRIPTION_LENGTH} characters`, () => {
    const tooLong = GOOD_EN + " ".repeat(10) + "x".repeat(MAX_DESCRIPTION_LENGTH);
    const result = validateRedescribed(GOOD_PT, tooLong);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("en length"))).toBe(true);
  });

  it("rejects a rewrite that still matches the generic template", () => {
    const genericPt = "Conheça este lugar incrível e descubra seus encantos escondidos. Reserve um tempo para passear sem pressa por aqui.";
    const result = validateRedescribed(genericPt, GOOD_EN);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("generic template"))).toBe(true);
  });
});

describe("firstSentence", () => {
  it("extracts and normalizes the opening sentence", () => {
    expect(firstSentence("Ótimo lugar para visitar. Vá de manhã.")).toBe("ótimo lugar para visitar");
  });

  it("lowercases and trims punctuation", () => {
    expect(firstSentence("  Great Spot!  More text here.")).toBe("great spot");
  });

  it("falls back to the whole string when there's no sentence terminator", () => {
    expect(firstSentence("no punctuation here")).toBe("no punctuation here");
  });
});

describe("findBatchRepetitionIds", () => {
  it("flags the second item sharing the same opening pt sentence, keeping the first", () => {
    const items = [
      { id: "1", pt: "Ótimo lugar para visitar. Vá de manhã.", en: "Great place to visit. Go in the morning." },
      { id: "2", pt: "Ótimo lugar para visitar. Mas à tarde.", en: "A totally different opening sentence here." },
    ];
    const repeated = findBatchRepetitionIds(items);
    expect(repeated.has("2")).toBe(true);
    expect(repeated.has("1")).toBe(false);
  });

  it("flags a repeated en opening sentence even when pt differs", () => {
    const items = [
      { id: "1", pt: "Frase em português A.", en: "Great place to visit. Go in the morning." },
      { id: "2", pt: "Frase em português B.", en: "Great place to visit. But in the afternoon." },
    ];
    const repeated = findBatchRepetitionIds(items);
    expect(repeated.has("2")).toBe(true);
  });

  it("flags nothing when every opening sentence is distinct", () => {
    const items = [
      { id: "1", pt: "Primeira frase única.", en: "First unique sentence." },
      { id: "2", pt: "Segunda frase única.", en: "Second unique sentence." },
      { id: "3", pt: "Terceira frase única.", en: "Third unique sentence." },
    ];
    expect(findBatchRepetitionIds(items).size).toBe(0);
  });
});
