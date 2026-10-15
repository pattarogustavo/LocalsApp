import { describe, expect, it, vi } from "vitest";
import { runBatchWithSplitting } from "../scripts/curate/batch-runner";

describe("runBatchWithSplitting", () => {
  it("returns the items directly when the batch isn't truncated", async () => {
    const runOneBatch = vi.fn().mockResolvedValue({ items: ["a", "b"], truncated: false });
    const result = await runBatchWithSplitting(2, runOneBatch);
    expect(result).toEqual({ items: ["a", "b"], usedWebSearchFallback: false, failed: false, notes: [] });
    expect(runOneBatch).toHaveBeenCalledTimes(1);
  });

  it("halves a truncated batch and retries each half", async () => {
    const runOneBatch = vi.fn().mockImplementation(async (size: number) => {
      if (size === 10) return { items: [], truncated: true };
      return { items: Array.from({ length: size }, (_, i) => `item-${size}-${i}`), truncated: false };
    });
    const result = await runBatchWithSplitting(10, runOneBatch);
    expect(result.failed).toBe(false);
    expect(result.items).toHaveLength(10);
    expect(runOneBatch).toHaveBeenCalledWith(10);
    expect(runOneBatch).toHaveBeenCalledWith(5);
  });

  it("runs sub-batches in sequence, never concurrently", async () => {
    const active: number[] = [];
    let maxConcurrent = 0;
    const runOneBatch = vi.fn().mockImplementation(async (size: number) => {
      active.push(size);
      maxConcurrent = Math.max(maxConcurrent, active.length);
      await new Promise((r) => setTimeout(r, 5));
      active.pop();
      if (size === 8) return { items: [], truncated: true };
      return { items: [size], truncated: false };
    });
    await runBatchWithSplitting(8, runOneBatch);
    expect(maxConcurrent).toBe(1);
  });

  it("gives up and marks the batch failed after MAX_BATCH_SPLIT_LEVELS", async () => {
    const runOneBatch = vi.fn().mockResolvedValue({ items: [], truncated: true });
    const result = await runBatchWithSplitting(8, runOneBatch);
    expect(result.failed).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.notes.some((n) => n.includes("giving up"))).toBe(true);
  });

  it("propagates a web-search fallback flag from any sub-batch", async () => {
    const runOneBatch = vi.fn().mockImplementation(async (size: number) => {
      if (size === 4) return { items: [], truncated: true };
      return { items: [size], truncated: false, usedWebSearchFallback: size === 2 };
    });
    const result = await runBatchWithSplitting(4, runOneBatch);
    expect(result.usedWebSearchFallback).toBe(true);
  });

  it("marks a batch of size 1 that keeps truncating as failed without infinite recursion", async () => {
    const runOneBatch = vi.fn().mockResolvedValue({ items: [], truncated: true });
    const result = await runBatchWithSplitting(1, runOneBatch);
    expect(result.failed).toBe(true);
  });
});
