import { describe, expect, it } from "vitest";
import { estimateModelCostUsd, estimateTotalCostUsd, formatModelCostUsd, MODEL_PRICES_USD_PER_MILLION } from "../scripts/data/model-prices";

describe("estimateModelCostUsd", () => {
  it("computes cost from known per-million input/output prices", () => {
    const result = estimateModelCostUsd("claude-sonnet-5", 1_000_000, 1_000_000);
    expect(result).toEqual({ usd: MODEL_PRICES_USD_PER_MILLION["claude-sonnet-5"].input + MODEL_PRICES_USD_PER_MILLION["claude-sonnet-5"].output });
  });

  it("scales linearly with token counts", () => {
    const result = estimateModelCostUsd("claude-haiku-4-5-20251001", 500_000, 0);
    expect(result.usd).toBeCloseTo(0.5, 6);
  });

  it("returns usd: null for an unknown model", () => {
    const result = estimateModelCostUsd("some-unknown-model", 1000, 1000);
    expect(result.usd).toBeNull();
  });

  it("recognizes the actual OpenAI models the app calls today (gpt-6.1-sol, gpt-5-mini) instead of returning n/d", () => {
    expect(estimateModelCostUsd("gpt-6.1-sol", 1_000_000, 1_000_000)).toEqual({
      usd: MODEL_PRICES_USD_PER_MILLION["gpt-6.1-sol"].input + MODEL_PRICES_USD_PER_MILLION["gpt-6.1-sol"].output,
    });
    expect(estimateModelCostUsd("gpt-5-mini", 1_000_000, 1_000_000)).toEqual({
      usd: MODEL_PRICES_USD_PER_MILLION["gpt-5-mini"].input + MODEL_PRICES_USD_PER_MILLION["gpt-5-mini"].output,
    });
  });
});

describe("formatModelCostUsd", () => {
  it("formats a known cost as a dollar string", () => {
    expect(formatModelCostUsd({ usd: 1.23456 })).toBe("$1.2346");
  });

  it("formats an unknown cost as n/d", () => {
    expect(formatModelCostUsd({ usd: null })).toBe("n/d");
  });
});

describe("estimateTotalCostUsd", () => {
  it("sums costs across multiple known models", () => {
    const result = estimateTotalCostUsd({
      "claude-sonnet-5": { promptTokens: 1_000_000, completionTokens: 0 },
      "claude-haiku-4-5-20251001": { promptTokens: 0, completionTokens: 1_000_000 },
    });
    expect(result.usd).toBeCloseTo(
      MODEL_PRICES_USD_PER_MILLION["claude-sonnet-5"].input + MODEL_PRICES_USD_PER_MILLION["claude-haiku-4-5-20251001"].output,
      6,
    );
  });

  it("returns usd: null if any model in the map is unknown", () => {
    const result = estimateTotalCostUsd({
      "claude-sonnet-5": { promptTokens: 1000, completionTokens: 1000 },
      "some-unknown-model": { promptTokens: 1000, completionTokens: 1000 },
    });
    expect(result.usd).toBeNull();
  });

  it("returns 0 for an empty usage map", () => {
    expect(estimateTotalCostUsd({})).toEqual({ usd: 0 });
  });
});
