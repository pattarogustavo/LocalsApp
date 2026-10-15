import { describe, expect, it } from "vitest";
import { buildResearchPrompt, buildStructurePrompt, buildTranslatePrompt } from "../scripts/curate/prompts";
import { TIER_GOALS } from "../scripts/data/curation-config";

function baseParams(overrides: Partial<Parameters<typeof buildResearchPrompt>[0]> = {}) {
  return {
    destinationName: "Paris",
    country: "France",
    goals: TIER_GOALS.mega,
    group: "A" as const,
    groupLabel: "atrações, monumentos, museus e parques/mirantes",
    batchSize: 15,
    ...overrides,
  };
}

describe("buildResearchPrompt", () => {
  it("mentions the destination, country, group label and batch size for a normal batch", () => {
    const prompt = buildResearchPrompt(baseParams());
    expect(prompt).toContain("Paris");
    expect(prompt).toContain("France");
    expect(prompt).toContain("atrações, monumentos, museus e parques/mirantes");
    expect(prompt).toContain("15 lugares");
  });

  it("always requires currently-open places and excludes non-iconic chains", () => {
    const prompt = buildResearchPrompt(baseParams());
    expect(prompt).toMatch(/funcionamento HOJE/);
    expect(prompt).toMatch(/fast-food e franquias/);
  });

  it("adds price-tier/meal distribution rules only for the restaurant group (B)", () => {
    const restaurantPrompt = buildResearchPrompt(baseParams({ group: "B", groupLabel: "restaurantes" }));
    expect(restaurantPrompt).toContain("budget, moderate e luxury");
    expect(restaurantPrompt).toContain(String(TIER_GOALS.mega.perBudgetMin));

    const attractionPrompt = buildResearchPrompt(baseParams());
    expect(attractionPrompt).not.toContain("budget, moderate e luxury");
  });

  it("adds breakfast/snack coverage only for the cafe group (C)", () => {
    const cafePrompt = buildResearchPrompt(baseParams({ group: "C", groupLabel: "cafés, padarias e mercados" }));
    expect(cafePrompt).toMatch(/café da manhã.*lanche|lanche.*café da manhã/);

    const attractionPrompt = buildResearchPrompt(baseParams());
    expect(attractionPrompt).not.toMatch(/café da manhã/);
  });

  it("includes category caps when provided", () => {
    const prompt = buildResearchPrompt(baseParams({ categoryCaps: { museum: 15, attraction: 15 } }));
    expect(prompt).toContain("museum: no máximo 15");
    expect(prompt).toContain("attraction: no máximo 15");
  });

  it("switches to the complement framing and lists exclusions when provided", () => {
    const prompt = buildResearchPrompt(
      baseParams({
        onlyMissing: "mais 3 restaurantes locais",
        excludeNames: ["Le Comptoir", "Chez Fifi"],
      }),
    );
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
