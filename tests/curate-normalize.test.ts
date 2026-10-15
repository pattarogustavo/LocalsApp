import { describe, expect, it } from "vitest";
import { normalizeName, nameSimilarity, namesReasonablyMatch } from "../scripts/curate/normalize";

describe("normalizeName", () => {
  it("lowercases, strips diacritics and punctuation, collapses whitespace", () => {
    expect(normalizeName("Café  de l'Été!")).toBe("cafe de l ete");
  });
});

describe("nameSimilarity", () => {
  it("is 1 for identical normalized names", () => {
    expect(nameSimilarity("Louvre Museum", "louvre museum")).toBe(1);
  });

  it("is high when one name contains the other", () => {
    expect(nameSimilarity("Louvre", "Louvre Museum")).toBeGreaterThanOrEqual(0.9);
  });

  it("is low for unrelated names", () => {
    expect(nameSimilarity("Louvre Museum", "Eiffel Tower")).toBeLessThan(0.2);
  });

  it("is partial for overlapping but distinct names", () => {
    const score = nameSimilarity("Café de Paris", "Café de Flore");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("namesReasonablyMatch", () => {
  it("accepts a strong match", () => {
    expect(namesReasonablyMatch("Notre-Dame Cathedral", "Notre Dame")).toBe(true);
  });

  it("rejects unrelated names", () => {
    expect(namesReasonablyMatch("Louvre Museum", "Eiffel Tower")).toBe(false);
  });
});
