import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveCheckpoint } from "../scripts/curate/checkpoint";
import { normalizeBatchCheckpoint, loadBatchCheckpoint, type BatchCheckpointData } from "../scripts/curate/batch-checkpoint";
import { newDiscardReasonCounts } from "../scripts/curate/verify";
import { addInvalidReasonCounts } from "../scripts/curate/validate-place";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "curate-batch-checkpoint-test-"));
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

function fullCheckpoint(overrides: Partial<BatchCheckpointData> = {}): BatchCheckpointData {
  return {
    verified: [{ name: "Louvre", googlePlaceId: "ChIJ123", category: "museum" } as any],
    discarded: [{ name: "Fake Place", reason: "no Google match found" }],
    discardReasonCounts: newDiscardReasonCounts(),
    invalidCount: 0,
    invalidReasonCounts: {},
    invalidExamples: [],
    failed: false,
    usedWebSearchFallback: false,
    notes: [],
    ...overrides,
  };
}

describe("normalizeBatchCheckpoint", () => {
  it("fills in every field with its default for a pre-cbe6cfc checkpoint (no invalidReasonCounts/invalidExamples)", () => {
    const oldShape = {
      verified: [{ name: "Big Ben", googlePlaceId: "ChIJ456", category: "attraction" }],
      discarded: [{ name: "Some Pub", reason: "nome não confere" }], // old discarded shape: no googleName
      discardReasonCounts: { addressId: 1, addressType: 0, idTooLong: 0, nameMismatch: 1 },
      invalidCount: 3,
      failed: false,
      usedWebSearchFallback: true,
      notes: ["something happened"],
      // invalidReasonCounts and invalidExamples are absent, as in checkpoints saved before they existed
    };

    const normalized = normalizeBatchCheckpoint(oldShape as any);

    expect(normalized.verified).toEqual(oldShape.verified);
    expect(normalized.discarded).toEqual(oldShape.discarded);
    expect(normalized.discardReasonCounts).toEqual(oldShape.discardReasonCounts);
    expect(normalized.invalidCount).toBe(3);
    expect(normalized.invalidReasonCounts).toEqual({});
    expect(normalized.invalidExamples).toEqual([]);
    expect(normalized.failed).toBe(false);
    expect(normalized.usedWebSearchFallback).toBe(true);
    expect(normalized.notes).toEqual(["something happened"]);

    // the result is safe to feed into the aggregation that used to crash on undefined
    expect(() => addInvalidReasonCounts({}, normalized.invalidReasonCounts)).not.toThrow();
  });

  it("defaults every field for a completely empty object", () => {
    expect(normalizeBatchCheckpoint({})).toEqual({
      verified: [],
      discarded: [],
      discardReasonCounts: newDiscardReasonCounts(),
      invalidCount: 0,
      invalidReasonCounts: {},
      invalidExamples: [],
      failed: false,
      usedWebSearchFallback: false,
      notes: [],
    });
  });

  it("defaults every field for null/undefined input", () => {
    const defaults = normalizeBatchCheckpoint({});
    expect(normalizeBatchCheckpoint(null)).toEqual(defaults);
    expect(normalizeBatchCheckpoint(undefined)).toEqual(defaults);
  });

  it("leaves a fully-populated current-shape checkpoint unchanged", () => {
    const current = fullCheckpoint({ invalidCount: 2, invalidReasonCounts: { tags: 2 }, invalidExamples: [{ name: "X", errors: ["tags ..."] }] });
    expect(normalizeBatchCheckpoint(current)).toEqual(current);
  });

  it("accepts a discarded entry in the new shape (with googleName) unchanged", () => {
    const current = fullCheckpoint({ discarded: [{ name: "Some Pub", reason: "nome não confere", googleName: "The Pub Ltd" }] });
    expect(normalizeBatchCheckpoint(current).discarded).toEqual(current.discarded);
  });
});

describe("loadBatchCheckpoint", () => {
  it("returns null when no checkpoint exists", () => {
    expect(loadBatchCheckpoint(baseDir, "london-gb", "A-1")).toBeNull();
  });

  it("reads an old-shape checkpoint from disk and normalizes it without crashing", () => {
    const oldShape = {
      verified: [],
      discarded: [{ name: "Some Pub", reason: "nome não confere" }],
      discardReasonCounts: newDiscardReasonCounts(),
      invalidCount: 11,
      failed: false,
      usedWebSearchFallback: false,
      notes: [],
    };
    saveCheckpoint(baseDir, "london-gb", "I-1", oldShape);

    const loaded = loadBatchCheckpoint(baseDir, "london-gb", "I-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.invalidCount).toBe(11);
    expect(loaded!.invalidReasonCounts).toEqual({});
    expect(loaded!.invalidExamples).toEqual([]);
  });

  it("round-trips a current-shape checkpoint unchanged", () => {
    const current = fullCheckpoint({ invalidCount: 1, invalidReasonCounts: { name: 1 }, invalidExamples: [{ name: "(sem nome)", errors: ["name is missing or empty"] }] });
    saveCheckpoint(baseDir, "paris-fr", "A-1", current);
    expect(loadBatchCheckpoint(baseDir, "paris-fr", "A-1")).toEqual(current);
  });

  it("never rewrites the checkpoint file on disk when loading an old-shape one", () => {
    const oldShape = { verified: [], discarded: [], discardReasonCounts: newDiscardReasonCounts(), invalidCount: 0, failed: false, usedWebSearchFallback: false, notes: [] };
    saveCheckpoint(baseDir, "london-gb", "I-1", oldShape);
    const before = fs.readFileSync(path.join(baseDir, ".curate-cache", "london-gb", "I-1.json"), "utf8");

    loadBatchCheckpoint(baseDir, "london-gb", "I-1");

    const after = fs.readFileSync(path.join(baseDir, ".curate-cache", "london-gb", "I-1.json"), "utf8");
    expect(after).toBe(before);
  });
});

describe("reusing a mix of old and new checkpoints for one destination (integration)", () => {
  it("sums invalidReasonCounts across an old checkpoint (missing the field) and a new one, without throwing", () => {
    saveCheckpoint(baseDir, "london-gb", "I-1", {
      verified: [],
      discarded: [],
      discardReasonCounts: newDiscardReasonCounts(),
      invalidCount: 11,
      failed: false,
      usedWebSearchFallback: false,
      notes: [],
      // no invalidReasonCounts / invalidExamples — pre-cbe6cfc shape
    });
    saveCheckpoint(
      baseDir,
      "london-gb",
      "A-1",
      fullCheckpoint({ invalidCount: 2, invalidReasonCounts: { tags: 2 }, invalidExamples: [{ name: "Y", errors: ["tags contains an invalid value"] }] }),
    );

    let totalInvalid = 0;
    let totalReasonCounts: Record<string, number> = {};
    for (const key of ["I-1", "A-1"]) {
      const data = loadBatchCheckpoint(baseDir, "london-gb", key)!;
      totalInvalid += data.invalidCount;
      totalReasonCounts = addInvalidReasonCounts(totalReasonCounts, data.invalidReasonCounts);
    }

    expect(totalInvalid).toBe(13);
    expect(totalReasonCounts).toEqual({ tags: 2 });
  });
});
