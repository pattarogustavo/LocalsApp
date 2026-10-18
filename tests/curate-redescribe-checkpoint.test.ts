import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const redescribeBatchMock = vi.fn();
const translateBatchMock = vi.fn();
const shortenRedescribedTextMock = vi.fn();
vi.mock("../scripts/curate/ai", () => ({
  redescribeBatch: (...args: unknown[]) => redescribeBatchMock(...args),
  translateBatch: (...args: unknown[]) => translateBatchMock(...args),
  shortenRedescribedText: (...args: unknown[]) => shortenRedescribedTextMock(...args),
}));

import { checkpointedRewrite, checkpointedTranslate, checkpointedShorten } from "../scripts/curate/redescribe-checkpoint";
import { AiCallBudget } from "../scripts/curate/redescribe-run";
import { checkpointPath } from "../scripts/curate/checkpoint";

let rootDir: string;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "curate-redescribe-checkpoint-"));
  redescribeBatchMock.mockReset();
  translateBatchMock.mockReset();
  shortenRedescribedTextMock.mockReset();
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

  it("caches a partial batch result (some ids missing), and a resumed run with the same id set reuses it without re-calling the model", async () => {
    const twoItems = [{ id: "1", name: "Place 1", category: "restaurant" }, { id: "2", name: "Place 2", category: "restaurant" }];
    // Only id "1" came back from the model — a partial result, still cached.
    redescribeBatchMock.mockResolvedValue({ items: [{ id: "1", pt: "p", en: "e", lowKnowledge: false }], truncated: false });
    const budget = new AiCallBudget(10);
    const stats = { calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} };
    const rewrite1 = checkpointedRewrite(rootDir, "lisbon-pt", "Lisbon", "Portugal", stats, budget, []);
    const result1 = await rewrite1(twoItems);
    expect(result1).toEqual([{ id: "1", pt: "p", en: "e", lowKnowledge: false }]);

    redescribeBatchMock.mockClear();
    const rewrite2 = checkpointedRewrite(rootDir, "lisbon-pt", "Lisbon", "Portugal", stats, budget, []);
    const result2 = await rewrite2(twoItems);

    expect(result2).toEqual([{ id: "1", pt: "p", en: "e", lowKnowledge: false }]);
    expect(redescribeBatchMock).not.toHaveBeenCalled(); // id "1" never re-paid for
  });
});

describe("checkpointedShorten", () => {
  it("calls the model and saves a checkpoint keyed by text+lang on a cold run", async () => {
    shortenRedescribedTextMock.mockResolvedValue("shortened text");
    const budget = new AiCallBudget(10);
    const shorten = checkpointedShorten(rootDir, "lisbon-pt", { calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} }, budget);

    const result = await shorten("a long text that needs shortening", "en");

    expect(result).toBe("shortened text");
    expect(shortenRedescribedTextMock).toHaveBeenCalledTimes(1);
    expect(budget.count).toBe(1);
  });

  it("reuses the cached shortened text on resume without calling the model again", async () => {
    shortenRedescribedTextMock.mockResolvedValue("shortened text");
    const budget = new AiCallBudget(10);
    const stats = { calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} };
    const shorten1 = checkpointedShorten(rootDir, "lisbon-pt", stats, budget);
    await shorten1("a long text that needs shortening", "en");

    shortenRedescribedTextMock.mockClear();
    const shorten2 = checkpointedShorten(rootDir, "lisbon-pt", stats, budget);
    const result = await shorten2("a long text that needs shortening", "en");

    expect(result).toBe("shortened text");
    expect(shortenRedescribedTextMock).not.toHaveBeenCalled();
  });

  it("never caches a failed (null) shortening attempt", async () => {
    shortenRedescribedTextMock.mockResolvedValue(null);
    const budget = new AiCallBudget(10);
    const stats = { calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} };
    const shorten1 = checkpointedShorten(rootDir, "lisbon-pt", stats, budget);
    await shorten1("some text", "pt");

    const shorten2 = checkpointedShorten(rootDir, "lisbon-pt", stats, budget);
    await shorten2("some text", "pt");

    expect(shortenRedescribedTextMock).toHaveBeenCalledTimes(2); // never cached, retried both times
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
