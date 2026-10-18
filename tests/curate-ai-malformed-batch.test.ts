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
  it("parses the normal JSON Lines response with no malformed diagnostic", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockContent('{"id":"1","pt":"x","en":"y","lowKnowledge":false}'));
    const ai = await import("../scripts/curate/ai");
    const result = await ai.redescribeBatch("Lisbon", "Portugal", [{ id: "1", name: "Place", category: "restaurant" }], ai.newAiCallStats());
    expect(result.items).toEqual([{ id: "1", pt: "x", en: "y", lowKnowledge: false }]);
    expect(result.malformed).toBeUndefined();
    expect(llm.invokeLLM).toHaveBeenCalledWith(expect.not.objectContaining({ outputSchema: expect.anything() }));
  });

  it("parses multiple JSON Lines, one per place", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockContent(['{"id":"1","pt":"x","en":"y","lowKnowledge":false}', '{"id":"2","pt":"p","en":"q","lowKnowledge":true}'].join("\n")),
    );
    const ai = await import("../scripts/curate/ai");
    const result = await ai.redescribeBatch(
      "Lisbon",
      "Portugal",
      [
        { id: "1", name: "Place 1", category: "restaurant" },
        { id: "2", name: "Place 2", category: "museum" },
      ],
      ai.newAiCallStats(),
    );
    expect(result.items).toEqual([
      { id: "1", pt: "x", en: "y", lowKnowledge: false },
      { id: "2", pt: "p", en: "q", lowKnowledge: true },
    ]);
  });

  it("tolerates a bad line in the middle of the JSON Lines response, keeping the others and flagging the batch as partially malformed", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockContent(['{"id":"1","pt":"x","en":"y","lowKnowledge":false}', '{"id":"2","pt":broken}', '{"id":"3","pt":"p","en":"q","lowKnowledge":false}'].join("\n")),
    );
    const ai = await import("../scripts/curate/ai");
    const result = await ai.redescribeBatch("Lisbon", "Portugal", [{ id: "1", name: "P1", category: "restaurant" }], ai.newAiCallStats());
    expect(result.items.map((i) => i.id)).toEqual(["1", "3"]);
    expect(result.malformed?.shape).toBe("jsonl-partial");
  });

  it("tolerates markdown fences and prose around the JSON Lines", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockContent(["Here you go:", "```json", '{"id":"1","pt":"x","en":"y","lowKnowledge":false}', "```", "Hope that helps!"].join("\n")),
    );
    const ai = await import("../scripts/curate/ai");
    const result = await ai.redescribeBatch("Lisbon", "Portugal", [{ id: "1", name: "P1", category: "restaurant" }], ai.newAiCallStats());
    expect(result.items).toEqual([{ id: "1", pt: "x", en: "y", lowKnowledge: false }]);
  });

  it("falls back to normalizeBatchArray when the model ignores JSON Lines and answers with a single JSON blob", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockContent(JSON.stringify({ places: [{ id: "1", pt: "x", en: "y", lowKnowledge: false }] })),
    );
    const ai = await import("../scripts/curate/ai");
    const result = await ai.redescribeBatch("Lisbon", "Portugal", [{ id: "1", name: "Place", category: "restaurant" }], ai.newAiCallStats());
    expect(result.items).toEqual([{ id: "1", pt: "x", en: "y", lowKnowledge: false }]);
  });

  it("recovers the real-world double-encoded bug: {\"places\": \"<json string>\"}", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockContent(JSON.stringify({ places: JSON.stringify({ places: [{ id: "1", pt: "x", en: "y", lowKnowledge: false }] }) })),
    );
    const ai = await import("../scripts/curate/ai");
    const result = await ai.redescribeBatch("Lisbon", "Portugal", [{ id: "1", name: "Place", category: "restaurant" }], ai.newAiCallStats());
    expect(result.items).toEqual([{ id: "1", pt: "x", en: "y", lowKnowledge: false }]);
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

describe("shortenRedescribedText", () => {
  it("returns the model's plain-text response, trimmed", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockContent("  A much shorter version of the text.  "));
    const ai = await import("../scripts/curate/ai");
    const result = await ai.shortenRedescribedText("Some long text here", "en", ai.newAiCallStats());
    expect(result).toBe("A much shorter version of the text.");
  });

  it("strips a wrapping pair of quotes the model added despite being asked not to", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockContent('"Texto encurtado aqui."'));
    const ai = await import("../scripts/curate/ai");
    const result = await ai.shortenRedescribedText("Texto longo aqui", "pt", ai.newAiCallStats());
    expect(result).toBe("Texto encurtado aqui.");
  });

  it("returns null (never throws) when the call rejects", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    const ai = await import("../scripts/curate/ai");
    const result = await ai.shortenRedescribedText("text", "en", ai.newAiCallStats());
    expect(result).toBeNull();
  });

  it("returns null for an empty response", async () => {
    const llm = await import("../server/_core/llm");
    (llm.invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockContent(""));
    const ai = await import("../scripts/curate/ai");
    const result = await ai.shortenRedescribedText("text", "en", ai.newAiCallStats());
    expect(result).toBeNull();
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
