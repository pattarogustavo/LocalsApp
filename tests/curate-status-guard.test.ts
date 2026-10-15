import { describe, expect, it } from "vitest";
import { canOverwriteRow, partitionNewCandidates } from "../scripts/curate/status-guard";

describe("canOverwriteRow", () => {
  it("allows overwriting pending or closed rows, and rows that don't exist yet", () => {
    expect(canOverwriteRow("pending")).toBe(true);
    expect(canOverwriteRow("closed")).toBe(true);
    expect(canOverwriteRow(undefined)).toBe(true);
  });

  it("never allows overwriting approved or rejected rows", () => {
    expect(canOverwriteRow("approved")).toBe(false);
    expect(canOverwriteRow("rejected")).toBe(false);
  });
});

describe("partitionNewCandidates", () => {
  it("only inserts candidates whose place_id isn't already present for the destination", () => {
    const candidates = [{ googlePlaceId: "a" }, { googlePlaceId: "b" }, { googlePlaceId: "c" }];
    const existing = new Set(["a", "c"]);
    const { toInsert, toSkip } = partitionNewCandidates(candidates, existing);
    expect(toInsert.map((c) => c.googlePlaceId)).toEqual(["b"]);
    expect(toSkip.map((c) => c.googlePlaceId)).toEqual(["a", "c"]);
  });

  it("skips existing rows regardless of their status — approved or rejected included", () => {
    const candidates = [{ googlePlaceId: "approved-one" }];
    const existing = new Set(["approved-one"]);
    const { toInsert, toSkip } = partitionNewCandidates(candidates, existing);
    expect(toInsert).toEqual([]);
    expect(toSkip).toEqual(candidates);
  });
});
