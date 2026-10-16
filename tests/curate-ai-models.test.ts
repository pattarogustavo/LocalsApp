import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

const ENV_KEYS = ["CURATE_RESEARCH_MODEL", "CURATE_STRUCTURE_MODEL", "CURATE_TRANSLATE_MODEL"] as const;
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
    expect(ai.RESEARCH_MODEL).toBe("claude-sonnet-5");
    expect(ai.STRUCTURE_MODEL).toBe("claude-haiku-4-5-20251001");
    expect(ai.TRANSLATE_MODEL).toBe("claude-haiku-4-5-20251001");
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
