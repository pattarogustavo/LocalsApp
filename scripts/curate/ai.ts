import { invokeLLM } from "../../server/_core/llm";
import { buildResearchPrompt, buildStructurePrompt, buildTranslatePrompt, type ResearchPromptParams, type TranslateBatchItem } from "./prompts";

export const RESEARCH_MODEL = "claude-opus-5-5";
export const TRANSLATE_MODEL = "claude-haiku-4-5-20251001";

/** Long timeout for the web-search-enabled research call, which can take several minutes. */
export const RESEARCH_TIMEOUT_MS = 5 * 60 * 1000;

export const PROPOSED_PLACE_CATEGORIES = ["attraction", "restaurant", "cafe", "museum", "hidden_gem", "other"] as const;
export const PROPOSED_PLACE_TAGS = ["culture", "gastronomy", "nature", "adventure", "shopping", "relaxation", "nightlife", "art"] as const;
export const PROPOSED_PLACE_PRICE_TIERS = ["budget", "moderate", "luxury"] as const;
export const PROPOSED_PLACE_MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export const PROPOSED_PLACE_CONFIDENCE = ["high", "medium", "low"] as const;

export interface ProposedPlace {
  name: string;
  neighborhood?: string;
  category: (typeof PROPOSED_PLACE_CATEGORIES)[number];
  tags: (typeof PROPOSED_PLACE_TAGS)[number][];
  priceTier?: (typeof PROPOSED_PLACE_PRICE_TIERS)[number];
  meals?: (typeof PROPOSED_PLACE_MEALS)[number][];
  cuisine?: string;
  isLocalCuisine: boolean;
  confidence: (typeof PROPOSED_PLACE_CONFIDENCE)[number];
  priority: number;
  descriptionPt: string;
  descriptionEn: string;
}

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
            category: { type: "string", enum: PROPOSED_PLACE_CATEGORIES },
            tags: { type: "array", items: { type: "string", enum: PROPOSED_PLACE_TAGS } },
            priceTier: { type: "string", enum: PROPOSED_PLACE_PRICE_TIERS },
            meals: { type: "array", items: { type: "string", enum: PROPOSED_PLACE_MEALS } },
            cuisine: { type: "string" },
            isLocalCuisine: { type: "boolean" },
            confidence: { type: "string", enum: PROPOSED_PLACE_CONFIDENCE },
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

export interface AiCallStats {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

function newStats(): AiCallStats {
  return { calls: 0, promptTokens: 0, completionTokens: 0 };
}

function trackUsage(stats: AiCallStats, usage: { prompt_tokens: number; completion_tokens: number } | undefined) {
  stats.calls += 1;
  stats.promptTokens += usage?.prompt_tokens ?? 0;
  stats.completionTokens += usage?.completion_tokens ?? 0;
}

/** Step 1: free-text research call with web search enabled, no forced schema. */
export async function researchPlaces(params: ResearchPromptParams, stats: AiCallStats): Promise<string> {
  const result = await invokeLLM({
    model: RESEARCH_MODEL,
    enableWebSearch: true,
    timeoutMs: RESEARCH_TIMEOUT_MS,
    maxTokens: 8192,
    messages: [{ role: "user", content: buildResearchPrompt(params) }],
  });
  trackUsage(stats, result.usage);
  const content = result.choices[0]?.message.content;
  return typeof content === "string" ? content : "";
}

/** Step 2: converts step-1 free text into a structured, schema-validated list. Never combined with web search in the same call. */
export async function structurePlaces(researchText: string, stats: AiCallStats): Promise<ProposedPlace[]> {
  const result = await invokeLLM({
    outputSchema: STRUCTURE_SCHEMA,
    maxTokens: 8192,
    messages: [{ role: "user", content: buildStructurePrompt(researchText) }],
  });
  trackUsage(stats, result.usage);
  const content = result.choices[0]?.message.content;
  if (typeof content !== "string" || !content) return [];
  const parsed = JSON.parse(content) as { places?: ProposedPlace[] };
  return parsed.places ?? [];
}

export function newAiCallStats(): AiCallStats {
  return newStats();
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

/** Batched es/fr/de/it translation for a destination's approved places, from their English description. */
export async function translateBatch(
  destinationName: string,
  items: TranslateBatchItem[],
  stats: AiCallStats,
): Promise<TranslatedBatchItem[]> {
  if (items.length === 0) return [];
  const result = await invokeLLM({
    model: TRANSLATE_MODEL,
    outputSchema: TRANSLATE_SCHEMA,
    maxTokens: 8192,
    messages: [{ role: "user", content: buildTranslatePrompt(destinationName, items) }],
  });
  trackUsage(stats, result.usage);
  const content = result.choices[0]?.message.content;
  if (typeof content !== "string" || !content) return [];
  const parsed = JSON.parse(content) as { translations?: TranslatedBatchItem[] };
  return parsed.translations ?? [];
}
