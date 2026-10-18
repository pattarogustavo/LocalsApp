import { describe, expect, it } from "vitest";

import { parseJsonLines } from "../scripts/curate/jsonl";

describe("parseJsonLines", () => {
  it("parses one JSON object per line", () => {
    const content = ['{"id":"1","pt":"a","en":"b","lowKnowledge":false}', '{"id":"2","pt":"c","en":"d","lowKnowledge":true}'].join("\n");
    const result = parseJsonLines(content);
    expect(result.items).toEqual([
      { id: "1", pt: "a", en: "b", lowKnowledge: false },
      { id: "2", pt: "c", en: "d", lowKnowledge: true },
    ]);
    expect(result.malformedLines).toEqual([]);
  });

  it("skips a bad line in the middle without losing the lines around it", () => {
    const content = [
      '{"id":"1","pt":"a","en":"b","lowKnowledge":false}',
      '{"id":"2","pt":"broken, unterminated string,"en":"f"}',
      '{"id":"3","pt":"e","en":"f","lowKnowledge":false}',
    ].join("\n");
    const result = parseJsonLines(content);
    expect(result.items.map((i: any) => i.id)).toEqual(["1", "3"]);
    expect(result.malformedLines).toHaveLength(1);
    expect(result.malformedLines[0].idGuess).toBe("2");
  });

  it("ignores markdown code fences", () => {
    const content = [
      "```json",
      '{"id":"1","pt":"a","en":"b","lowKnowledge":false}',
      '{"id":"2","pt":"c","en":"d","lowKnowledge":false}',
      "```",
    ].join("\n");
    const result = parseJsonLines(content);
    expect(result.items.map((i: any) => i.id)).toEqual(["1", "2"]);
    expect(result.malformedLines).toEqual([]);
  });

  it("ignores prose before and after the JSON lines", () => {
    const content = [
      "Here are the rewritten descriptions:",
      "",
      '{"id":"1","pt":"a","en":"b","lowKnowledge":false}',
      "",
      "Let me know if you need anything else!",
    ].join("\n");
    const result = parseJsonLines(content);
    expect(result.items).toEqual([{ id: "1", pt: "a", en: "b", lowKnowledge: false }]);
  });

  it("does not mistake a single-line full JSON blob (no id key) for one line item", () => {
    const content = JSON.stringify({ places: [{ id: "1", pt: "a", en: "b", lowKnowledge: false }] });
    const result = parseJsonLines(content);
    expect(result.items).toEqual([]);
    expect(result.malformedLines).toHaveLength(1);
  });

  it("returns empty results for empty or whitespace-only content", () => {
    expect(parseJsonLines("").items).toEqual([]);
    expect(parseJsonLines("   \n\n  ").items).toEqual([]);
  });
});
