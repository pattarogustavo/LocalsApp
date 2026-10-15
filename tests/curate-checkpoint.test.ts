import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveCheckpoint, loadCheckpoint, hasCheckpoint, listCheckpointKeys, clearCheckpoints } from "../scripts/curate/checkpoint";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "curate-checkpoint-test-"));
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("checkpoint", () => {
  it("returns null when no checkpoint exists yet", () => {
    expect(loadCheckpoint(baseDir, "paris-fr", "A-1")).toBeNull();
    expect(hasCheckpoint(baseDir, "paris-fr", "A-1")).toBe(false);
  });

  it("round-trips saved data", () => {
    const data = { places: [{ name: "Louvre" }], truncated: false };
    saveCheckpoint(baseDir, "paris-fr", "A-1", data);
    expect(hasCheckpoint(baseDir, "paris-fr", "A-1")).toBe(true);
    expect(loadCheckpoint(baseDir, "paris-fr", "A-1")).toEqual(data);
  });

  it("keeps batches for different destinations separate", () => {
    saveCheckpoint(baseDir, "paris-fr", "A-1", { n: 1 });
    saveCheckpoint(baseDir, "london-gb", "A-1", { n: 2 });
    expect(loadCheckpoint(baseDir, "paris-fr", "A-1")).toEqual({ n: 1 });
    expect(loadCheckpoint(baseDir, "london-gb", "A-1")).toEqual({ n: 2 });
  });

  it("lists every saved batch key for a destination", () => {
    saveCheckpoint(baseDir, "paris-fr", "A-1", {});
    saveCheckpoint(baseDir, "paris-fr", "B-1", {});
    expect(listCheckpointKeys(baseDir, "paris-fr").sort()).toEqual(["A-1", "B-1"]);
  });

  it("returns an empty list for a destination with no checkpoints", () => {
    expect(listCheckpointKeys(baseDir, "nowhere")).toEqual([]);
  });

  it("clearCheckpoints removes every batch for that destination only", () => {
    saveCheckpoint(baseDir, "paris-fr", "A-1", {});
    saveCheckpoint(baseDir, "london-gb", "A-1", {});
    clearCheckpoints(baseDir, "paris-fr");
    expect(listCheckpointKeys(baseDir, "paris-fr")).toEqual([]);
    expect(listCheckpointKeys(baseDir, "london-gb")).toEqual(["A-1"]);
  });
});
