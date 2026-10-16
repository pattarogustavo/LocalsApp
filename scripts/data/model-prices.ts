/** USD per million tokens, editable. Unknown models cost "n/d" (not available). */
export const MODEL_PRICES_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

export type ModelCostResult = { usd: number } | { usd: null };

export function estimateModelCostUsd(model: string, promptTokens: number, completionTokens: number): ModelCostResult {
  const prices = MODEL_PRICES_USD_PER_MILLION[model];
  if (!prices) return { usd: null };
  const usd = (promptTokens / 1_000_000) * prices.input + (completionTokens / 1_000_000) * prices.output;
  return { usd };
}

export function formatModelCostUsd(result: ModelCostResult): string {
  return result.usd === null ? "n/d" : `$${result.usd.toFixed(4)}`;
}

/** Sums the per-model cost of a { model -> { promptTokens, completionTokens } } usage map. `null` if any model's price is unknown. */
export function estimateTotalCostUsd(byModel: Record<string, { promptTokens: number; completionTokens: number }>): ModelCostResult {
  let total = 0;
  for (const [model, usage] of Object.entries(byModel)) {
    const result = estimateModelCostUsd(model, usage.promptTokens, usage.completionTokens);
    if (result.usd === null) return { usd: null };
    total += result.usd;
  }
  return { usd: total };
}

