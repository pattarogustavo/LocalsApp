import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const redescribeBatchMock = vi.fn();
const translateBatchMock = vi.fn();
vi.mock("../scripts/curate/ai", () => ({
  redescribeBatch: (...args: unknown[]) => redescribeBatchMock(...args),
  translateBatch: (...args: unknown[]) => translateBatchMock(...args),
}));

import { checkpointedRewrite, checkpointedTranslate } from "../scripts/curate/redescribe-checkpoint";
import { AiCallBudget } from "../scripts/curate/redescribe-run";
import { checkpointPath } from "../scripts/curate/checkpoint";

let rootDir: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "curate-redescribe-checkpoint-"));
  redescribeBatchMock.mockReset();
  translateBatchMock.mockReset();
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true });
});

const ITEMS = [{ id: "1", name: "Place", category: "restaurant" }];

describe("checkpointedRewrite", () => {
  it("calls the model and saves a checkpoint on a cold run", async () => {
    redescribeBatchMock.mockResolvedValue({ items: [{ id: "1", pt: "p", en: "e", lowKnowledge: false }], truncated: false });
    const budget = new AiCallBudget(10);
    const issues: { kind: string }[] = [];
    const rewrite = checkpointedRewrite(rootDir, "lisbon-pt", "Lisbon", "Portugal", { calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} }, budget, issues as any);

    const result = await rewrite(ITEMS);

    expect(result).toEqual([{ id: "1", pt: "p", en: "e", lowKnowledge: false }]);
    expect(redescribeBatchMock).toHaveBeenCalledTimes(1);
    expect(budget.count).toBe(1);
    expect(fs.existsSync(checkpointPath(rootDir, "lisbon-pt", "redescribe-1"))).toBe(true);
  });

  it("reuses a normal checkpoint on resume without calling the model again", async () => {
    redescribeBatchMock.mockResolvedValue({ items: [{ id: "1", pt: "p", en: "e", lowKnowledge: false }], truncated: false });
    const budget = new AiCallBudget(10);
    const rewrite1 = checkpointedRewrite(rootDir, "lisbon-pt", "Lisbon", "Portugal", { calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} }, budget, []);
    await rewrite1(ITEMS);

    redescribeBatchMock.mockClear();
    const rewrite2 = checkpointedRewrite(rootDir, "lisbon-pt", "Lisbon", "Portugal", { calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} }, budget, []);
    const result = await rewrite2(ITEMS);

    expect(result).toEqual([{ id: "1", pt: "p", en: "e", lowKnowledge: false }]);
    expect(redescribeBatchMock).not.toHaveBeenCalled();
    expect(budget.count).toBe(1); // only the first (cold) call consumed budget
  });

  it("reuses a checkpoint written in the old, malformed JSON-string shape instead of re-calling the model", async () => {
    // Simulate a checkpoint saved by a pre-fix version of the script, where
    // the raw (malformed) model content was cached as-is: a JSON string
    // instead of an array.
    fs.mkdirSync(path.dirname(checkpointPath(rootDir, "lisbon-pt", "redescribe-1")), { recursive: true });
    fs.writeFileSync(
      checkpointPath(rootDir, "lisbon-pt", "redescribe-1"),
      JSON.stringify(JSON.stringify({ places: [{ id: "1", pt: "p", en: "e", lowKnowledge: false }] })),
    );

    const budget = new AiCallBudget(10);
    const rewrite = checkpointedRewrite(rootDir, "lisbon-pt", "Lisbon", "Portugal", { calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} }, budget, []);
    const result = await rewrite(ITEMS);

    expect(result).toEqual([{ id: "1", pt: "p", en: "e", lowKnowledge: false }]);
    expect(redescribeBatchMock).not.toHaveBeenCalled();
    expect(budget.count).toBe(0);
  });

  it("ignores a checkpoint that stays unusable even after normalization, and retries the call", async () => {
    fs.mkdirSync(path.dirname(checkpointPath(rootDir, "lisbon-pt", "redescribe-1")), { recursive: true });
    fs.writeFileSync(checkpointPath(rootDir, "lisbon-pt", "redescribe-1"), JSON.stringify(42));

    redescribeBatchMock.mockResolvedValue({ items: [{ id: "1", pt: "p", en: "e", lowKnowledge: false }], truncated: false });
    const budget = new AiCallBudget(10);
    const rewrite = checkpointedRewrite(rootDir, "lisbon-pt", "Lisbon", "Portugal", { calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} }, budget, []);
    const result = await rewrite(ITEMS);

    expect(redescribeBatchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ id: "1", pt: "p", en: "e", lowKnowledge: false }]);
  });

  it("never writes a checkpoint for a malformed/empty model response", async () => {
    redescribeBatchMock.mockResolvedValue({ items: [], truncated: false, malformed: { shape: "object", sample: "{}" } });
    const budget = new AiCallBudget(10);
    const issues: { kind: string }[] = [];
    const rewrite = checkpointedRewrite(rootDir, "lisbon-pt", "Lisbon", "Portugal", { calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} }, budget, issues as any);

    const result = await rewrite(ITEMS);

    expect(result).toEqual([]);
    expect(fs.existsSync(checkpointPath(rootDir, "lisbon-pt", "redescribe-1"))).toBe(false);
    expect(issues).toEqual([{ kind: "rewrite", ids: ["1"], shape: "object", sample: "{}" }]);
  });
});

describe("checkpointedTranslate", () => {
  it("reuses an old object-by-id checkpoint shape for translations", async () => {
    fs.mkdirSync(path.dirname(checkpointPath(rootDir, "lisbon-pt", "redescribe-translate-1")), { recursive: true });
    fs.writeFileSync(checkpointPath(rootDir, "lisbon-pt", "redescribe-translate-1"), JSON.stringify({ "1": { es: "a", fr: "b", de: "c", it: "d" } }));

    const budget = new AiCallBudget(10);
    const translate = checkpointedTranslate(rootDir, "lisbon-pt", "Lisbon", { calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} }, budget, []);
    const result = await translate([{ id: "1", en: "hello" }]);

    expect(result).toEqual([{ es: "a", fr: "b", de: "c", it: "d", id: "1" }]);
    expect(translateBatchMock).not.toHaveBeenCalled();
  });
});
