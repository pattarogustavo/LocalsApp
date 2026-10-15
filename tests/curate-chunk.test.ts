import { describe, expect, it } from "vitest";
import { chunkItems } from "../scripts/curate/chunk";

describe("chunkItems", () => {
  it("splits evenly when the total is a multiple of size", () => {
    expect(chunkItems([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("leaves a smaller final chunk when not evenly divisible", () => {
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when size >= length", () => {
    expect(chunkItems([1, 2], 15)).toEqual([[1, 2]]);
  });

  it("returns an empty array for an empty input", () => {
    expect(chunkItems([], 15)).toEqual([]);
  });

  it("throws for a non-positive size", () => {
    expect(() => chunkItems([1], 0)).toThrow();
  });
});
