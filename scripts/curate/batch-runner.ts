import { MAX_BATCH_SPLIT_LEVELS } from "../data/curation-config";

export interface BatchRunOutcome<T> {
  /** Items successfully produced across this batch and any sub-splits. */
  items: T[];
  /** True if at least one sub-batch had to fall back to no-web-search. */
  usedWebSearchFallback: boolean;
  /** True if at least one sub-batch was ultimately marked failed (couldn't be split further or kept truncating). */
  failed: boolean;
  /** Human-readable notes about what happened (splits, failures), for the report/log. */
  notes: string[];
}

export interface RunOneBatch<T> {
  /** Runs a single batch of the given size, returning its items and whether the response was truncated. */
  (size: number): Promise<{ items: T[]; truncated: boolean; usedWebSearchFallback?: boolean }>;
}

/**
 * Runs a batch of `size` places; if the underlying call reports truncation,
 * halves the batch and retries, up to MAX_BATCH_SPLIT_LEVELS deep. A batch
 * that still truncates at the deepest split is marked failed (its items are
 * dropped, never partially kept) and the run continues with everything else.
 */
export async function runBatchWithSplitting<T>(size: number, runOneBatch: RunOneBatch<T>, level = 0): Promise<BatchRunOutcome<T>> {
  const result = await runOneBatch(size);

  if (!result.truncated) {
    return {
      items: result.items,
      usedWebSearchFallback: !!result.usedWebSearchFallback,
      failed: false,
      notes: [],
    };
  }

  if (level >= MAX_BATCH_SPLIT_LEVELS || size <= 1) {
    return {
      items: [],
      usedWebSearchFallback: !!result.usedWebSearchFallback,
      failed: true,
      notes: [`batch of size ${size} truncated at split level ${level}, giving up`],
    };
  }

  const half = Math.ceil(size / 2);
  const otherHalf = size - half;
  const notes = [`batch of size ${size} truncated, splitting into ${half} + ${otherHalf} (level ${level + 1})`];

  // Sub-batches run in sequence, never in parallel — destinations and batches are always sequential.
  const first = await runBatchWithSplitting(half, runOneBatch, level + 1);
  const second =
    otherHalf > 0
      ? await runBatchWithSplitting(otherHalf, runOneBatch, level + 1)
      : { items: [] as T[], usedWebSearchFallback: false, failed: false, notes: [] as string[] };

  return {
    items: [...first.items, ...second.items],
    usedWebSearchFallback: first.usedWebSearchFallback || second.usedWebSearchFallback,
    failed: first.failed || second.failed,
    notes: [...notes, ...first.notes, ...second.notes],
  };
}
