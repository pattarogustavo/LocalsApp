/**
 * USD per million tokens, editable. Unknown models cost "n/d" (not
 * available) — never a guessed/interpolated figure.
 *
 * OpenAI figures below are the STANDARD tier rate (≤272K input tokens, the
 * only tier this codebase's calls can realistically hit) as published on
 * https://developers.openai.com/api/docs/pricing, verified 2026-10-18 — not
 * third-party-aggregator figures, which disagreed with each other and with
 * this page for the "Sol"-tier models. If OpenAI ever changes these rates,
 * or a caller starts sending >272K input tokens (a separate, higher-priced
 * long-context tier), this table needs a matching update — it is not
 * self-updating.
 *
 * claude-* entries are kept only so `byModel` cost stats already recorded
 * from before the OpenAI migration (e.g. in old checkpoint files) still
 * resolve to a real cost instead of "n/d" — no runtime code calls these
 * models anymore (see server/_core/llm.ts).
 */
export const MODEL_PRICES_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  // Current runtime AI provider (server/_core/llm.ts, scripts/curate/ai.ts).
  "gpt-6.1-sol": { input: 2, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  // Not a default anywhere today, but documented in server/_core/env.ts as
  // the flagship alternative OPENAI_MODEL can be set to — included so that
  // choice doesn't silently cost "n/d" if someone does set it.
  "gpt-6-astra": { input: 10, output: 50 },
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

