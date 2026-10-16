import { describe, expect, it } from "vitest";
import { buildResearchPrompt, buildStructurePrompt, buildManualStructurePrompt, buildTranslatePrompt } from "../scripts/curate/prompts";
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
    expect(prompt).toContain("até 15 lugares");
  });

  it("never forces a category quota — asks to reflect what the city actually has and return fewer if needed", () => {
    const prompt = buildResearchPrompt(baseParams());
    expect(prompt).toMatch(/nunca force uma distribuição por categoria/);
    expect(prompt).toMatch(/devolva menos do que foi pedido/);
    expect(prompt).toMatch(/park \(parque ou jardim\)/);
    expect(prompt).toMatch(/beach \(praia\)/);
    expect(prompt).toMatch(/market \(mercado de comida, flores, antiguidades ou de rua\)/);
    expect(prompt).toMatch(/neighborhood \(bairro ou região para passear\)/);
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
    const cafePrompt = buildResearchPrompt(baseParams({ group: "C", groupLabel: "cafés e mercados" }));
    expect(cafePrompt).toMatch(/café da manhã.*lanche|lanche.*café da manhã/);

    const attractionPrompt = buildResearchPrompt(baseParams());
    expect(attractionPrompt).not.toMatch(/café da manhã/);
  });

  it("frames the icon batch around the city's biggest icons instead of the normal batch ask", () => {
    const prompt = buildResearchPrompt(baseParams({ isIconBatch: true, batchSize: 12 }));
    expect(prompt).toMatch(/MAIORES ÍCONES/);
    expect(prompt).toContain("12");
    expect(prompt).not.toContain("Proponha 12 lugares do grupo");
  });

  it("restricts restaurants to places whose main activity is serving meals", () => {
    const prompt = buildResearchPrompt(baseParams({ group: "B", groupLabel: "restaurantes" }));
    expect(prompt).toMatch(/atividade principal é servir refeições/);
    expect(prompt).toMatch(/casas de show, bares sem cozinha ou clubes/);
  });

  it("tells group C to split cafeterias/bakeries (cafe) from food/flower/antiques/street markets (market)", () => {
    const prompt = buildResearchPrompt(baseParams({ group: "C", groupLabel: "cafés e mercados" }));
    expect(prompt).toMatch(/Cafeterias e padarias são categoria cafe/);
    expect(prompt).toMatch(/mercados de comida, flores, antiguidades ou de rua são categoria market/);
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

describe("buildManualStructurePrompt", () => {
  it("lists every given name and asks the model to keep them exactly as given", () => {
    const prompt = buildManualStructurePrompt("London", "United Kingdom", ["Buckingham Palace", "Big Ben", "Covent Garden Market"]);
    expect(prompt).toContain("London");
    expect(prompt).toContain("United Kingdom");
    expect(prompt).toContain("- Buckingham Palace");
    expect(prompt).toContain("- Big Ben");
    expect(prompt).toContain("- Covent Garden Market");
    expect(prompt).toMatch(/escolhidos manualmente/);
    expect(prompt).toMatch(/EXATAMENTE/);
  });

  it("asks for confidence high and priority 1", () => {
    const prompt = buildManualStructurePrompt("Paris", "France", ["Louvre"]);
    expect(prompt).toContain('confidence (sempre "high")');
    expect(prompt).toContain("priority (sempre 1)");
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
