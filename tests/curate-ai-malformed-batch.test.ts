import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../server/_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

function mockContent(content: string) {
  return {
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

beforeEach(() => {
  vi.resetModules();
});

describe("redescribeBatch malformed responses", () => {
  it("accepts the normal { places: [...] } shape with no malformed diagnostic", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockContent(JSON.stringify({ places: [{ id: "1", pt: "x", en: "y", lowKnowledge: false }] })),
    );
    const ai = await import("../scripts/curate/ai");
    const result = await ai.redescribeBatch("Lisbon", "Portugal", [{ id: "1", name: "Place", category: "restaurant" }], ai.newAiCallStats());
    expect(result.items).toEqual([{ id: "1", pt: "x", en: "y", lowKnowledge: false }]);
    expect(result.malformed).toBeUndefined();
  });

  it("recovers an object keyed by id instead of an array, flagging it as malformed", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockContent(JSON.stringify({ places: { "1": { pt: "x", en: "y", lowKnowledge: false } } })),
    );
    const ai = await import("../scripts/curate/ai");
    const result = await ai.redescribeBatch("Lisbon", "Portugal", [{ id: "1", name: "Place", category: "restaurant" }], ai.newAiCallStats());
    expect(result.items).toEqual([{ pt: "x", en: "y", lowKnowledge: false, id: "1" }]);
    expect(result.malformed).toEqual({ shape: "object", sample: expect.any(String) });
  });

  it("recovers a doubly-JSON-encoded string response", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockContent(JSON.stringify(JSON.stringify({ places: [{ id: "1", pt: "x", en: "y", lowKnowledge: false }] }))),
    );
    const ai = await import("../scripts/curate/ai");
    const result = await ai.redescribeBatch("Lisbon", "Portugal", [{ id: "1", name: "Place", category: "restaurant" }], ai.newAiCallStats());
    expect(result.items).toEqual([{ id: "1", pt: "x", en: "y", lowKnowledge: false }]);
  });

  it("never throws on garbage content, returning items=[] with a shape diagnostic", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockContent(JSON.stringify({ places: 42 })));
    const ai = await import("../scripts/curate/ai");
    const result = await ai.redescribeBatch("Lisbon", "Portugal", [{ id: "1", name: "Place", category: "restaurant" }], ai.newAiCallStats());
    expect(result.items).toEqual([]);
    expect(result.malformed?.shape).toBe("number");
  });

  it("flags unparseable content as a string shape instead of throwing", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockContent("not valid json {{{"));
    const ai = await import("../scripts/curate/ai");
    const result = await ai.redescribeBatch("Lisbon", "Portugal", [{ id: "1", name: "Place", category: "restaurant" }], ai.newAiCallStats());
    expect(result.items).toEqual([]);
    expect(result.malformed).toEqual({ shape: "string", sample: "not valid json {{{" });
  });
});

describe("translateBatch malformed responses", () => {
  it("recovers an object keyed by id for translations, flagging it as malformed", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockContent(JSON.stringify({ translations: { "1": { es: "a", fr: "b", de: "c", it: "d" } } })),
    );
    const ai = await import("../scripts/curate/ai");
    const result = await ai.translateBatch("Lisbon", [{ id: "1", en: "hello" }], ai.newAiCallStats());
    expect(result.translations).toEqual([{ es: "a", fr: "b", de: "c", it: "d", id: "1" }]);
    expect(result.malformed?.shape).toBe("object");
  });
});
