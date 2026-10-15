import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../scripts/curate/concurrency";

describe("mapWithConcurrency", () => {
  it("preserves result order regardless of completion order", async () => {
    const delays = [30, 10, 20, 0];
    const result = await mapWithConcurrency(delays, 2, (ms) => new Promise((resolve) => setTimeout(() => resolve(ms), ms)));
    expect(result).toEqual(delays);
  });

  it("never runs more than `limit` tasks concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("handles an empty list", async () => {
    const result = await mapWithConcurrency([], 3, async (x) => x);
    expect(result).toEqual([]);
  });
});
