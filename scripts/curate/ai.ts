import { invokeLLM, type InvokeResult } from "../../server/_core/llm";
import { buildResearchPrompt, buildStructurePrompt, buildTranslatePrompt, type ResearchPromptParams, type TranslateBatchItem } from "./prompts";
import { withRetry, isRetryableAnthropicError, getAnthropicRetryAfterMs, isWebSearchUnsupportedError } from "./retry";
import { validateProposedPlaces, type RawProposedPlace, type ValidatedPlace } from "./validate-place";

export const RESEARCH_MODEL = process.env.CURATE_RESEARCH_MODEL || "claude-sonnet-5";
export const STRUCTURE_MODEL = process.env.CURATE_STRUCTURE_MODEL || "claude-haiku-4-5-20251001";
export const TRANSLATE_MODEL = process.env.CURATE_TRANSLATE_MODEL || "claude-haiku-4-5-20251001";

/** Max web_search tool uses per research call. Configurable since some destinations need more digging than others. */
export const WEB_SEARCH_MAX_USES = (() => {
  const raw = process.env.CURATE_WEB_SEARCH_MAX_USES;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
})();

/** Long timeout for the web-search-enabled research call, which can take several minutes. */
export const RESEARCH_TIMEOUT_MS = 5 * 60 * 1000;
export const STRUCTURE_TIMEOUT_MS = 2 * 60 * 1000;

/** Per-call retry budget: up to 4 attempts with exponential backoff, honoring Retry-After. */
const CALL_RETRY_OPTIONS = {
  maxAttempts: 4,
  baseDelayMs: 1000,
  isRetryable: isRetryableAnthropicError,
  getRetryAfterMs: getAnthropicRetryAfterMs,
};

export type ProposedPlace = ValidatedPlace;

const STRUCTURE_SCHEMA = {
  name: "proposed_places",
  schema: {
    type: "object",
    properties: {
      places: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            neighborhood: { type: "string" },
            category: { type: "string", enum: ["attraction", "restaurant", "cafe", "museum", "hidden_gem", "other"] },
            tags: {
              type: "array",
              items: { type: "string", enum: ["culture", "gastronomy", "nature", "adventure", "shopping", "relaxation", "nightlife", "art"] },
            },
            priceTier: { type: "string", enum: ["budget", "moderate", "luxury"] },
            meals: { type: "array", items: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] } },
            cuisine: { type: "string" },
            isLocalCuisine: { type: "boolean" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            priority: { type: "number" },
            descriptionPt: { type: "string" },
            descriptionEn: { type: "string" },
          },
          required: ["name", "category", "tags", "isLocalCuisine", "confidence", "priority", "descriptionPt", "descriptionEn"],
        },
      },
    },
    required: ["places"],
  },
} as const;

export interface ModelUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface AiCallStats {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  /** Total web_search tool invocations billed across all calls (server_tool_use.web_search_requests), not a count of calls. */
  webSearchRequests: number;
  byModel: Record<string, ModelUsage>;
}

export function newAiCallStats(): AiCallStats {
  return { calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} };
}

function trackUsage(
  stats: AiCallStats,
  model: string,
  usage: { prompt_tokens: number; completion_tokens: number; web_search_requests?: number } | undefined,
) {
  stats.calls += 1;
  stats.promptTokens += usage?.prompt_tokens ?? 0;
  stats.completionTokens += usage?.completion_tokens ?? 0;
  stats.webSearchRequests += usage?.web_search_requests ?? 0;
  const perModel = stats.byModel[model] ?? { calls: 0, promptTokens: 0, completionTokens: 0 };
  perModel.calls += 1;
  perModel.promptTokens += usage?.prompt_tokens ?? 0;
  perModel.completionTokens += usage?.completion_tokens ?? 0;
  stats.byModel[model] = perModel;
}

function isTruncated(result: InvokeResult): boolean {
  return result.choices[0]?.finish_reason === "length";
}

export interface ResearchBatchResult {
  text: string;
  truncated: boolean;
  usedWebSearch: boolean;
}

/**
 * Step 1: free-text research call for one small batch, with web search
 * enabled and retried on transient errors. If the web-search-enabled call
 * still fails after its retry budget, retries ONE more time without web
 * search — `usedWebSearch` reports which path actually produced the result.
 */
export async function researchBatch(params: ResearchPromptParams, stats: AiCallStats): Promise<ResearchBatchResult> {
  const prompt = buildResearchPrompt(params);

  async function callOnce(enableWebSearch: boolean): Promise<InvokeResult> {
    return withRetry(
      () =>
        invokeLLM({
          model: RESEARCH_MODEL,
          enableWebSearch,
          webSearchMaxUses: enableWebSearch ? WEB_SEARCH_MAX_USES : undefined,
          timeoutMs: RESEARCH_TIMEOUT_MS,
          maxTokens: 8192,
          messages: [{ role: "user", content: prompt }],
        }),
      CALL_RETRY_OPTIONS,
    );
  }

  try {
    const result = await callOnce(true);
    trackUsage(stats, RESEARCH_MODEL, result.usage);
    const content = result.choices[0]?.message.content;
    return { text: typeof content === "string" ? content : "", truncated: isTruncated(result), usedWebSearch: true };
  } catch (err) {
    if (isWebSearchUnsupportedError(err)) {
      throw new Error(
        `O modelo de pesquisa configurado (CURATE_RESEARCH_MODEL=${RESEARCH_MODEL}) não suporta a ferramenta de busca web. ` +
          `Escolha um modelo que suporte web search — não haverá troca automática de modelo.`,
      );
    }
    // Web search exhausted its retries for a transient reason — one last attempt without it.
    const result = await callOnce(false);
    trackUsage(stats, RESEARCH_MODEL, result.usage);
    const content = result.choices[0]?.message.content;
    return { text: typeof content === "string" ? content : "", truncated: isTruncated(result), usedWebSearch: false };
  }
}

export interface StructureBatchResult {
  places: ProposedPlace[];
  invalidCount: number;
  truncated: boolean;
}

/** Step 2: converts step-1 free text into a structured, schema-validated, individually-validated list. Never combined with web search in the same call. */
export async function structureBatch(researchText: string, stats: AiCallStats): Promise<StructureBatchResult> {
  const result = await withRetry(
    () =>
      invokeLLM({
        model: STRUCTURE_MODEL,
        outputSchema: STRUCTURE_SCHEMA,
        timeoutMs: STRUCTURE_TIMEOUT_MS,
        maxTokens: 8192,
        messages: [{ role: "user", content: buildStructurePrompt(researchText) }],
      }),
    CALL_RETRY_OPTIONS,
  );
  trackUsage(stats, STRUCTURE_MODEL, result.usage);

  const content = result.choices[0]?.message.content;
  const truncated = isTruncated(result);
  if (typeof content !== "string" || !content) return { places: [], invalidCount: 0, truncated };

  let raw: RawProposedPlace[];
  try {
    raw = (JSON.parse(content) as { places?: RawProposedPlace[] }).places ?? [];
  } catch {
    return { places: [], invalidCount: 0, truncated: true };
  }

  const { valid, invalidCount } = validateProposedPlaces(raw);
  return { places: valid, invalidCount, truncated };
}

const TRANSLATE_SCHEMA = {
  name: "translations",
  schema: {
    type: "object",
    properties: {
      translations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            es: { type: "string" },
            fr: { type: "string" },
            de: { type: "string" },
            it: { type: "string" },
          },
          required: ["id", "es", "fr", "de", "it"],
        },
      },
    },
    required: ["translations"],
  },
} as const;

export interface TranslatedBatchItem {
  id: string;
  es: string;
  fr: string;
  de: string;
  it: string;
}

export interface TranslateBatchResult {
  translations: TranslatedBatchItem[];
  truncated: boolean;
}

/** Batched es/fr/de/it translation for up to MAX_PLACES_PER_BATCH places, from their English description. */
export async function translateBatch(destinationName: string, items: TranslateBatchItem[], stats: AiCallStats): Promise<TranslateBatchResult> {
  if (items.length === 0) return { translations: [], truncated: false };
  const result = await withRetry(
    () =>
      invokeLLM({
        model: TRANSLATE_MODEL,
        outputSchema: TRANSLATE_SCHEMA,
        maxTokens: 8192,
        messages: [{ role: "user", content: buildTranslatePrompt(destinationName, items) }],
      }),
    CALL_RETRY_OPTIONS,
  );
  trackUsage(stats, TRANSLATE_MODEL, result.usage);
  const content = result.choices[0]?.message.content;
  const truncated = isTruncated(result);
  if (typeof content !== "string" || !content) return { translations: [], truncated };
  try {
    const parsed = JSON.parse(content) as { translations?: TranslatedBatchItem[] };
    return { translations: parsed.translations ?? [], truncated };
  } catch {
    return { translations: [], truncated: true };
  }
}
