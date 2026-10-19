import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

const ENV_KEYS = ["CURATE_RESEARCH_MODEL", "CURATE_STRUCTURE_MODEL", "CURATE_TRANSLATE_MODEL", "CURATE_WEB_SEARCH_MAX_USES"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.resetModules();
});

describe("curate model configuration", () => {
  it("defaults to cheap models when no env vars are set", async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    vi.resetModules();
    const ai = await import("../scripts/curate/ai");
    expect(ai.RESEARCH_MODEL).toBe("gpt-6.1-sol");
    expect(ai.STRUCTURE_MODEL).toBe("gpt-5-mini");
    expect(ai.TRANSLATE_MODEL).toBe("gpt-5-mini");
  });

  it("honors CURATE_RESEARCH_MODEL / CURATE_STRUCTURE_MODEL / CURATE_TRANSLATE_MODEL overrides", async () => {
    process.env.CURATE_RESEARCH_MODEL = "custom-research-model";
    process.env.CURATE_STRUCTURE_MODEL = "custom-structure-model";
    process.env.CURATE_TRANSLATE_MODEL = "custom-translate-model";
    vi.resetModules();
    const ai = await import("../scripts/curate/ai");
    expect(ai.RESEARCH_MODEL).toBe("custom-research-model");
    expect(ai.STRUCTURE_MODEL).toBe("custom-structure-model");
    expect(ai.TRANSLATE_MODEL).toBe("custom-translate-model");
  });

  it("newAiCallStats starts with an empty per-model usage map", async () => {
    vi.resetModules();
    const ai = await import("../scripts/curate/ai");
    expect(ai.newAiCallStats()).toEqual({ calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} });
  });
});

describe("CURATE_WEB_SEARCH_MAX_USES", () => {
  it("defaults to 3 when unset", async () => {
    delete process.env.CURATE_WEB_SEARCH_MAX_USES;
    vi.resetModules();
    const ai = await import("../scripts/curate/ai");
    expect(ai.WEB_SEARCH_MAX_USES).toBe(3);
  });

  it("honors a valid override", async () => {
    process.env.CURATE_WEB_SEARCH_MAX_USES = "7";
    vi.resetModules();
    const ai = await import("../scripts/curate/ai");
    expect(ai.WEB_SEARCH_MAX_USES).toBe(7);
  });

  it("falls back to 3 for an invalid or non-positive value", async () => {
    for (const bad of ["0", "-1", "abc", ""]) {
      process.env.CURATE_WEB_SEARCH_MAX_USES = bad;
      vi.resetModules();
      const ai = await import("../scripts/curate/ai");
      expect(ai.WEB_SEARCH_MAX_USES).toBe(3);
    }
  });

  it("is passed as webSearchMaxUses on the web-search-enabled research call", async () => {
    process.env.CURATE_WEB_SEARCH_MAX_USES = "9";
    vi.resetModules();
    const llm = await import("../server/_core/llm");
    const invokeLLM = llm.invokeLLM as unknown as ReturnType<typeof vi.fn>;
    invokeLLM.mockResolvedValue({
      choices: [{ message: { content: "research text" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const ai = await import("../scripts/curate/ai");
    const stats = ai.newAiCallStats();
    await ai.researchBatch(
      { destinationName: "Paris", country: "France", goals: {} as any, group: "A", groupLabel: "x", batchSize: 5 },
      stats,
    );

    expect(invokeLLM).toHaveBeenCalledWith(expect.objectContaining({ webSearchMaxUses: 9 }));
  });
});

describe("structureManualPlaces", () => {
  it("never enables web search and forces confidence=high, priority=1 regardless of what the model returned", async () => {
    vi.resetModules();
    const llm = await import("../server/_core/llm");
    const invokeLLM = llm.invokeLLM as unknown as ReturnType<typeof vi.fn>;
    invokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              places: [
                {
                  name: "Buckingham Palace",
                  category: "attraction",
                  tags: ["culture"],
                  isLocalCuisine: false,
                  confidence: "low",
                  priority: 9,
                  descriptionPt: "Residência oficial da família real.",
                  descriptionEn: "Official residence of the royal family.",
                },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const ai = await import("../scripts/curate/ai");
    const stats = ai.newAiCallStats();
    const result = await ai.structureManualPlaces("London", "United Kingdom", ["Buckingham Palace"], stats);

    expect(invokeLLM).toHaveBeenCalledWith(expect.not.objectContaining({ enableWebSearch: true }));
    expect(result.places).toHaveLength(1);
    expect(result.places[0].confidence).toBe("high");
    expect(result.places[0].priority).toBe(1);
    expect(result.places[0].name).toBe("Buckingham Palace");
  });

  it("propagates invalid items the same way structureBatch does", async () => {
    vi.resetModules();
    const llm = await import("../server/_core/llm");
    const invokeLLM = llm.invokeLLM as unknown as ReturnType<typeof vi.fn>;
    invokeLLM.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ places: [{ name: "", category: "attraction" }] }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const ai = await import("../scripts/curate/ai");
    const stats = ai.newAiCallStats();
    const result = await ai.structureManualPlaces("London", "United Kingdom", ["Something"], stats);

    expect(result.places).toEqual([]);
    expect(result.invalidCount).toBe(1);
  });
});

describe("web search request counting", () => {
  it("sums usage.web_search_requests across calls into AiCallStats.webSearchRequests", async () => {
    vi.resetModules();
    const llm = await import("../server/_core/llm");
    const invokeLLM = llm.invokeLLM as unknown as ReturnType<typeof vi.fn>;
    invokeLLM
      .mockResolvedValueOnce({
        choices: [{ message: { content: "research text" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, web_search_requests: 3 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"places":[]}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      });

    const ai = await import("../scripts/curate/ai");
    const stats = ai.newAiCallStats();
    await ai.researchBatch(
      { destinationName: "Paris", country: "France", goals: {} as any, group: "A", groupLabel: "x", batchSize: 5 },
      stats,
    );
    await ai.structureBatch("some research text", stats);

    expect(stats.webSearchRequests).toBe(3);
    expect(stats.calls).toBe(2);
  });

  it("leaves webSearchRequests at 0 when usage never reports it", async () => {
    vi.resetModules();
    const llm = await import("../server/_core/llm");
    const invokeLLM = llm.invokeLLM as unknown as ReturnType<typeof vi.fn>;
    invokeLLM.mockResolvedValue({
      choices: [{ message: { content: '{"translations":[]}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const ai = await import("../scripts/curate/ai");
    const stats = ai.newAiCallStats();
    await ai.translateBatch("Paris", [{ id: "1", en: "A nice place" }], stats);

    expect(stats.webSearchRequests).toBe(0);
  });
});
