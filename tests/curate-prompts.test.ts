import { describe, expect, it } from "vitest";
import { buildResearchPrompt, buildStructurePrompt, buildTranslatePrompt } from "../scripts/curate/prompts";
import { TIER_GOALS } from "../scripts/data/curation-config";

describe("buildResearchPrompt", () => {
  it("mentions the destination, country and the over-generated totals for a normal round", () => {
    const prompt = buildResearchPrompt({ destinationName: "Paris", country: "France", goals: TIER_GOALS.mega });
    expect(prompt).toContain("Paris");
    expect(prompt).toContain("France");
    expect(prompt).toContain("105"); // ceil(75 * 1.4)
    expect(prompt).toContain("21"); // ceil(15 * 1.4)
  });

  it("switches to the complement framing and lists exclusions when provided", () => {
    const prompt = buildResearchPrompt({
      destinationName: "Paris",
      country: "France",
      goals: TIER_GOALS.mega,
      onlyMissing: "mais 3 restaurantes locais",
      excludeNames: ["Le Comptoir", "Chez Fifi"],
    });
    expect(prompt).toContain("rodada de complementação");
    expect(prompt).toContain("mais 3 restaurantes locais");
    expect(prompt).toContain("Le Comptoir");
    expect(prompt).toContain("Chez Fifi");
  });
});

describe("buildStructurePrompt", () => {
  it("embeds the research text verbatim", () => {
    const prompt = buildStructurePrompt("some free-text research output");
    expect(prompt).toContain("some free-text research output");
  });
});

describe("buildTranslatePrompt", () => {
  it("lists every item by id with its English text", () => {
    const prompt = buildTranslatePrompt("Paris", [
      { id: 1, en: "A lovely bistro." },
      { id: 2, en: "A hidden garden." },
    ]);
    expect(prompt).toContain("1: A lovely bistro.");
    expect(prompt).toContain("2: A hidden garden.");
    expect(prompt).toContain("Paris");
  });
});
