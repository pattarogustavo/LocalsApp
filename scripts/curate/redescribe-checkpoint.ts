/**
 * Checkpointed rewrite/translate calls for curate:redescribe: each batch is
 * keyed by its sorted candidate ids, saved to disk BEFORE the next batch
 * runs, and reused on resume instead of re-paying for the same AI call. A
 * checkpoint loaded from disk — including one written by an older,
 * unguarded version of this script, which could itself hold a malformed
 * (non-array) shape — is run back through normalizeBatchArray; if that still
 * doesn't yield a usable list, the checkpoint is ignored (not used) and the
 * call is retried instead of getting stuck on a bad file forever. A
 * checkpoint is only ever written when the normalized result is a non-empty
 * list, so a malformed or empty response is never cached.
 */

import { redescribeBatch, translateBatch, type AiCallStats } from "./ai";
import { normalizeBatchArray } from "./normalize-batch";
import { saveCheckpoint, loadCheckpoint } from "./checkpoint";
import { AiCallBudget, type RewrittenItem } from "./redescribe-run";
import type { RedescribeItem } from "./prompts";

export interface BatchIssue {
  kind: "rewrite" | "translate";
  ids: string[];
  shape: string;
  sample?: string;
}

export type TranslatedItem = { id: string; es?: string; fr?: string; de?: string; it?: string };

function batchKey(prefix: string, items: { id: string }[]): string {
  return `${prefix}-${items.map((i) => i.id).sort((a, b) => Number(a) - Number(b)).join("_")}`;
}

/** A checkpointed rewrite call bound to one city/destination, for passing as RedescribeCityDeps.rewrite. */
export function checkpointedRewrite(
  rootDir: string,
  slug: string,
  destinationName: string,
  country: string,
  stats: AiCallStats,
  budget: AiCallBudget,
  batchIssues: BatchIssue[],
) {
  return async (items: RedescribeItem[]): Promise<RewrittenItem[]> => {
    const key = batchKey("redescribe", items);
    const cachedRaw = loadCheckpoint<unknown>(rootDir, slug, key);
    if (cachedRaw != null) {
      // "places" matches redescribeBatch's own schema key — an old
      // checkpoint may hold the raw (possibly malformed) model content as-is
      // from before this shape was normalized at the source.
      const normalized = normalizeBatchArray<RewrittenItem>(cachedRaw, "places");
      if (normalized.items.length > 0) return normalized.items;
    }

    budget.consume(1);
    const result = await redescribeBatch(destinationName, country, items, stats);
    if (result.malformed) {
      batchIssues.push({ kind: "rewrite", ids: items.map((i) => i.id), shape: result.malformed.shape ?? "unknown", sample: result.malformed.sample });
    }
    if (result.items.length > 0) saveCheckpoint(rootDir, slug, key, result.items);
    return result.items;
  };
}

/** A checkpointed translate call bound to one city/destination, for passing as RedescribeCityDeps.translate. */
export function checkpointedTranslate(rootDir: string, slug: string, destinationName: string, stats: AiCallStats, budget: AiCallBudget, batchIssues: BatchIssue[]) {
  return async (items: { id: string; en: string }[]): Promise<TranslatedItem[]> => {
    const key = batchKey("redescribe-translate", items);
    const cachedRaw = loadCheckpoint<unknown>(rootDir, slug, key);
    if (cachedRaw != null) {
      const normalized = normalizeBatchArray<TranslatedItem>(cachedRaw, "translations");
      if (normalized.items.length > 0) return normalized.items;
    }

    budget.consume(1);
    const result = await translateBatch(destinationName, items, stats);
    if (result.malformed) {
      batchIssues.push({ kind: "translate", ids: items.map((i) => i.id), shape: result.malformed.shape ?? "unknown", sample: result.malformed.sample });
    }
    if (result.translations.length > 0) saveCheckpoint(rootDir, slug, key, result.translations);
    return result.translations;
  };
}
