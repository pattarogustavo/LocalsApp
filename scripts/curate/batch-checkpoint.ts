import { loadCheckpoint } from "./checkpoint";
import { newDiscardReasonCounts, type DiscardReasonCounts } from "./verify";
import type { InvalidPlaceExample } from "./validate-place";
import type { ProposedPlace } from "./ai";

export interface VerifiedPlace extends ProposedPlace {
  googlePlaceId: string;
}

/** `googleName` is set only for name_mismatch discards, kept locally (checkpoint only, never the database) to calibrate the matching threshold. */
export interface DiscardedEntry {
  name: string;
  reason: string;
  googleName?: string;
}

export interface BatchCheckpointData {
  verified: VerifiedPlace[];
  discarded: DiscardedEntry[];
  discardReasonCounts: DiscardReasonCounts;
  invalidCount: number;
  invalidReasonCounts: Record<string, number>;
  invalidExamples: InvalidPlaceExample[];
  failed: boolean;
  usedWebSearchFallback: boolean;
  notes: string[];
}

/**
 * Fills in every BatchCheckpointData field with its default. A checkpoint
 * file written by an older version of this script won't have fields added
 * since (e.g. invalidReasonCounts, invalidExamples, or the googleName on a
 * discarded entry) — reading it raw and handing it to code that expects the
 * current shape (e.g. addInvalidReasonCounts(..., data.invalidReasonCounts))
 * crashes on `undefined`. This is the single place that bridges old
 * checkpoints to the current shape; it never rewrites the file on disk.
 */
export function normalizeBatchCheckpoint(raw: Partial<BatchCheckpointData> | null | undefined): BatchCheckpointData {
  const r = raw ?? {};
  return {
    verified: r.verified ?? [],
    discarded: r.discarded ?? [],
    discardReasonCounts: r.discardReasonCounts ?? newDiscardReasonCounts(),
    invalidCount: r.invalidCount ?? 0,
    invalidReasonCounts: r.invalidReasonCounts ?? {},
    invalidExamples: r.invalidExamples ?? [],
    failed: r.failed ?? false,
    usedWebSearchFallback: r.usedWebSearchFallback ?? false,
    notes: r.notes ?? [],
  };
}

/** Loads a batch checkpoint (old or current shape) and normalizes it to the current BatchCheckpointData shape, or null if none exists yet. Never rewrites the file. */
export function loadBatchCheckpoint(baseDir: string, slug: string, batchKey: string): BatchCheckpointData | null {
  const cached = loadCheckpoint<Partial<BatchCheckpointData>>(baseDir, slug, batchKey);
  if (cached == null) return null;
  return normalizeBatchCheckpoint(cached);
}
