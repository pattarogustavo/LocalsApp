import { describe, expect, it, vi } from "vitest";

const translateBatchMock = vi.fn();
vi.mock("../scripts/curate/ai", () => ({
  translateBatch: (...args: unknown[]) => translateBatchMock(...args),
  newAiCallStats: () => ({ calls: 0, promptTokens: 0, completionTokens: 0, webSearchRequests: 0, byModel: {} }),
}));

import { fillMissingTranslations, translateMissingDescriptions, IMPORT_TRANSLATE_CHUNK_SIZE } from "../scripts/curate/import-translate";
import { newAiCallStats } from "../scripts/curate/ai";

describe("fillMissingTranslations", () => {
  it("fills only the missing es/fr/de/it fields", () => {
    const result = fillMissingTranslations({ pt: "p", en: "e", es: "existing-es" }, { es: "new-es", fr: "f", de: "d", it: "i" });
    expect(result).toEqual({ pt: "p", en: "e", es: "existing-es", fr: "f", de: "d", it: "i" });
  });

  it("never touches pt/en", () => {
    const result = fillMissingTranslations({ pt: "p", en: "e" }, { es: "s" } as any);
    expect(result.pt).toBe("p");
    expect(result.en).toBe("e");
  });
});

describe("translateMissingDescriptions", () => {
  it("skips a place that already has every language", async () => {
    translateBatchMock.mockClear();
    const items = [{ id: "1", descriptions: { pt: "p", en: "e", es: "s", fr: "f", de: "d", it: "i" } }];
    const result = await translateMissingDescriptions("Lisbon", items, newAiCallStats());
    expect(translateBatchMock).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it("translates a place missing es/fr/de/it from its en description", async () => {
    translateBatchMock.mockClear();
    translateBatchMock.mockResolvedValue({ translations: [{ id: "1", es: "s", fr: "f", de: "d", it: "i" }], truncated: false });
    const items = [{ id: "1", descriptions: { pt: "p", en: "e" } }];
    const result = await translateMissingDescriptions("Lisbon", items, newAiCallStats());
    expect(translateBatchMock).toHaveBeenCalledWith("Lisbon", [{ id: "1", en: "e" }], expect.anything());
    expect(result.get("1")).toEqual({ pt: "p", en: "e", es: "s", fr: "f", de: "d", it: "i" });
  });

  it("falls back to pt when en is absent", async () => {
    translateBatchMock.mockClear();
    translateBatchMock.mockResolvedValue({ translations: [{ id: "1", es: "s", fr: "f", de: "d", it: "i" }], truncated: false });
    const items = [{ id: "1", descriptions: { pt: "p" } }];
    await translateMissingDescriptions("Lisbon", items, newAiCallStats());
    expect(translateBatchMock).toHaveBeenCalledWith("Lisbon", [{ id: "1", en: "p" }], expect.anything());
  });

  it("batches in groups of IMPORT_TRANSLATE_CHUNK_SIZE", async () => {
    translateBatchMock.mockClear();
    translateBatchMock.mockResolvedValue({ translations: [], truncated: false });
    const items = Array.from({ length: IMPORT_TRANSLATE_CHUNK_SIZE + 5 }, (_, i) => ({ id: String(i), descriptions: { pt: "p" } }));
    await translateMissingDescriptions("Lisbon", items, newAiCallStats());
    expect(translateBatchMock).toHaveBeenCalledTimes(2);
    expect((translateBatchMock.mock.calls[0][1] as unknown[]).length).toBe(IMPORT_TRANSLATE_CHUNK_SIZE);
    expect((translateBatchMock.mock.calls[1][1] as unknown[]).length).toBe(5);
  });

  it("never overwrites a translation already supplied in the file", async () => {
    translateBatchMock.mockClear();
    translateBatchMock.mockResolvedValue({ translations: [{ id: "1", es: "from-model", fr: "f", de: "d", it: "i" }], truncated: false });
    const items = [{ id: "1", descriptions: { pt: "p", en: "e", es: "from-file" } }];
    const result = await translateMissingDescriptions("Lisbon", items, newAiCallStats());
    expect(result.get("1")?.es).toBe("from-file");
  });
});
