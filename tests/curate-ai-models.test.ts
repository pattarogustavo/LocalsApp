import { afterEach, describe, expect, it, vi } from "vitest";

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
    expect(ai.newAiCallStats()).toEqual({ calls: 0, promptTokens: 0, completionTokens: 0, byModel: {} });
  });
});
