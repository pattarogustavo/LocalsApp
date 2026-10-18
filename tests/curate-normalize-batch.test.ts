import { describe, expect, it } from "vitest";

import { normalizeBatchArray } from "../scripts/curate/normalize-batch";

describe("normalizeBatchArray", () => {
  it("passes through an already-clean array with no shape diagnostic", () => {
    const result = normalizeBatchArray([{ id: "1" }, { id: "2" }], "places");
    expect(result).toEqual({ items: [{ id: "1" }, { id: "2" }] });
  });

  it("unwraps a { places: [...] } object", () => {
    const result = normalizeBatchArray({ places: [{ id: "1" }] }, "places");
    expect(result.items).toEqual([{ id: "1" }]);
    expect(result.shape).toBeUndefined();
  });

  it("parses a JSON string and unwraps its array key", () => {
    const result = normalizeBatchArray(JSON.stringify({ places: [{ id: "1" }, { id: "2" }] }), "places");
    expect(result.items).toEqual([{ id: "1" }, { id: "2" }]);
  });

  it("parses a JSON string that is itself a bare array", () => {
    const result = normalizeBatchArray(JSON.stringify([{ id: "1" }]), "places");
    expect(result.items).toEqual([{ id: "1" }]);
  });

  it("flags an unparseable string, with a shape and a 300-char sample", () => {
    const result = normalizeBatchArray("not json at all {{{", "places");
    expect(result.items).toEqual([]);
    expect(result.shape).toBe("string");
    expect(result.sample).toBe("not json at all {{{");
  });

  it("coerces an object keyed by id into an array, stamping id from the key when missing, and flags it as a shape deviation", () => {
    const result = normalizeBatchArray({ "1": { pt: "a", en: "b" }, "2": { id: "two", pt: "c", en: "d" } }, "places");
    expect(result.items).toEqual([
      { pt: "a", en: "b", id: "1" },
      { id: "two", pt: "c", en: "d" },
    ]);
    expect(result.shape).toBe("object");
  });

  it("flags an empty array distinctly from other malformed shapes", () => {
    const result = normalizeBatchArray([], "places");
    expect(result.items).toEqual([]);
    expect(result.shape).toBe("empty array");
  });

  it("flags garbage (a number, a boolean, null) with items=[] and a shape", () => {
    expect(normalizeBatchArray(42, "places")).toEqual({ items: [], shape: "number", sample: "42" });
    expect(normalizeBatchArray(null, "places")).toEqual({ items: [], shape: "null", sample: "null" });
    expect(normalizeBatchArray(true, "places")).toEqual({ items: [], shape: "boolean", sample: "true" });
  });

  it("flags an object with no usable entries (e.g. {} or all-primitive values)", () => {
    expect(normalizeBatchArray({}, "places")).toMatchObject({ items: [], shape: "object" });
    expect(normalizeBatchArray({ a: 1, b: "x" }, "places")).toMatchObject({ items: [], shape: "object" });
  });

  it("truncates the sample to 300 characters", () => {
    const long = "x".repeat(500);
    const result = normalizeBatchArray(long, "places");
    expect(result.sample).toHaveLength(300);
  });
});
