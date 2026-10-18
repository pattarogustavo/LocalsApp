import { describe, expect, it, vi } from "vitest";

import {
  redescribeChunk,
  redescribeCity,
  assembleCompleteDescriptions,
  REDESCRIBE_CHUNK_SIZE,
  type RedescribeCandidate,
  type RewrittenItem,
} from "../scripts/curate/redescribe-run";

function candidate(id: number, name = `Place ${id}`): RedescribeCandidate {
  return {
    id,
    aiName: name,
    aiNeighborhood: "Centro",
    category: "restaurant",
    cuisine: "local",
    descriptions: { pt: "Conheça X e descubra seus encantos. Reserve um tempo sem pressa.", en: "old generic description" },
  };
}

function goodRewrite(id: number): RewrittenItem {
  return {
    id: String(id),
    pt: `Frase única número ${id} sobre este restaurante encantador, com uma dica prática específica para visitar bem.`,
    en: `Unique sentence number ${id} about this charming restaurant, with one specific, practical tip for visiting well.`,
    lowKnowledge: false,
  };
}

describe("redescribeChunk", () => {
  it("accepts every item on the first pass when all are valid and distinct", async () => {
    const candidates = [candidate(1), candidate(2)];
    const rewrite = vi.fn(async () => [goodRewrite(1), goodRewrite(2)]);

    const { accepted, stillInvalid } = await redescribeChunk(candidates, rewrite);

    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(accepted.size).toBe(2);
    expect(stillInvalid).toEqual([]);
  });

  it("retries exactly once for an item the model got wrong, and accepts it if the retry succeeds", async () => {
    const candidates = [candidate(1), candidate(2)];
    const rewrite = vi
      .fn()
      .mockResolvedValueOnce([goodRewrite(1), { id: "2", pt: "curto", en: "short", lowKnowledge: false }])
      .mockResolvedValueOnce([goodRewrite(2)]);

    const { accepted, stillInvalid } = await redescribeChunk(candidates, rewrite);

    expect(rewrite).toHaveBeenCalledTimes(2);
    expect(rewrite.mock.calls[1][0]).toEqual([expect.objectContaining({ id: "2" })]);
    expect(accepted.size).toBe(2);
    expect(stillInvalid).toEqual([]);
  });

  it("reports an item still invalid after the one retry, untouched", async () => {
    const candidates = [candidate(1)];
    const rewrite = vi.fn(async () => [{ id: "1", pt: "curto", en: "short", lowKnowledge: false }]);

    const { accepted, stillInvalid } = await redescribeChunk(candidates, rewrite);

    expect(rewrite).toHaveBeenCalledTimes(2);
    expect(accepted.size).toBe(0);
    expect(stillInvalid).toHaveLength(1);
    expect(stillInvalid[0].id).toBe(1);
  });

  it("invalidates the second of two items sharing the same opening sentence, and retries only that one", async () => {
    const candidates = [candidate(1), candidate(2)];
    const duplicate = { id: "2", pt: goodRewrite(1).pt, en: "A different english sentence that is long enough to pass validation here.", lowKnowledge: false };
    const rewrite = vi
      .fn()
      .mockResolvedValueOnce([goodRewrite(1), duplicate])
      .mockResolvedValueOnce([goodRewrite(2)]);

    const { accepted, stillInvalid } = await redescribeChunk(candidates, rewrite);

    expect(rewrite.mock.calls[1][0]).toEqual([expect.objectContaining({ id: "2" })]);
    expect(accepted.size).toBe(2);
    expect(stillInvalid).toEqual([]);
  });
});

describe("assembleCompleteDescriptions", () => {
  it("builds the full record when all four translations are present", () => {
    const result = assembleCompleteDescriptions("pt text", "en text", { es: "es text", fr: "fr text", de: "de text", it: "it text" });
    expect(result).toEqual({ pt: "pt text", en: "en text", es: "es text", fr: "fr text", de: "de text", it: "it text" });
  });

  it("returns null when any language is missing", () => {
    expect(assembleCompleteDescriptions("pt", "en", { es: "es", fr: "fr", de: "de" })).toBeNull();
    expect(assembleCompleteDescriptions("pt", "en", undefined)).toBeNull();
  });
});

describe("redescribeChunk tolerates a malformed rewrite return", () => {
  it("treats a non-array (object) return as 'no items returned', never throwing", async () => {
    const candidates = [candidate(1)];
    const rewrite = vi.fn().mockResolvedValue({ "1": goodRewrite(1) }); // malformed: object, not array
    const { accepted, stillInvalid } = await redescribeChunk(candidates, rewrite as any);
    expect(accepted.size).toBe(0);
    expect(stillInvalid).toHaveLength(1);
    expect(stillInvalid[0].errors[0]).toMatch(/no item/);
  });

  it("treats a thrown exception from rewrite as 'no items returned' for that attempt, never propagating", async () => {
    const candidates = [candidate(1)];
    const rewrite = vi.fn().mockRejectedValue(new Error("network exploded"));
    const { accepted, stillInvalid } = await redescribeChunk(candidates, rewrite);
    expect(accepted.size).toBe(0);
    expect(stillInvalid).toHaveLength(1);
    expect(rewrite).toHaveBeenCalledTimes(2); // first attempt + the one retry, both swallowed
  });

  it("filters out garbage array entries (null, a string) instead of crashing on them", async () => {
    const candidates = [candidate(1), candidate(2)];
    const rewrite = vi.fn().mockResolvedValue([null, "garbage", goodRewrite(2)]);
    const { accepted, stillInvalid } = await redescribeChunk(candidates, rewrite as any);
    expect(accepted.get(2)).toBeDefined();
    expect(stillInvalid.map((s) => s.id)).toContain(1);
  });
});

describe("redescribeCity isolates a bad batch from the rest of the city", () => {
  it("keeps processing later chunks when an earlier chunk's rewrite throws", async () => {
    const candidates = Array.from({ length: REDESCRIBE_CHUNK_SIZE + 1 }, (_, i) => candidate(i + 1));
    const rewrite = vi.fn(async (items: { id: string }[]) => {
      if (items.some((i) => i.id === "1")) throw new Error("boom");
      return items.map((i) => goodRewrite(Number(i.id)));
    });
    const translate = vi.fn(async (items: { id: string }[]) => items.map((i) => ({ id: i.id, es: "es", fr: "fr", de: "de", it: "it" })));
    const write = vi.fn(async () => {});

    const report = await redescribeCity(candidates, { rewrite, translate, write });

    // The first chunk (containing id=1) failed entirely (every rewrite/retry
    // attempt rejected), but the exception never escapes redescribeChunk —
    // it's swallowed per-attempt (see attemptRewrite) — so the second
    // chunk's single place still got rewritten and written.
    expect(report.rewritten).toBe(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(report.stillInvalid.some((s) => s.id === 1)).toBe(true);
  });

  it("keeps processing when the translate call for one chunk throws", async () => {
    const candidates = [candidate(1), candidate(2)];
    const rewrite = vi.fn(async () => [goodRewrite(1), goodRewrite(2)]);
    const translate = vi.fn().mockRejectedValue(new Error("translate down"));
    const write = vi.fn(async () => {});

    const report = await redescribeCity(candidates, { rewrite, translate, write, translateChunkSize: 15 });

    expect(write).not.toHaveBeenCalled();
    expect(report.stillInvalid).toHaveLength(2);
    expect(report.stillInvalid.every((s) => s.errors[0].includes("translation did not complete"))).toBe(true);
  });
});

describe("redescribeCity", () => {
  it("chunks candidates in groups of up to REDESCRIBE_CHUNK_SIZE", async () => {
    const candidates = Array.from({ length: REDESCRIBE_CHUNK_SIZE + 3 }, (_, i) => candidate(i + 1));
    const rewrite = vi.fn(async (items: { id: string }[]) => items.map((i) => goodRewrite(Number(i.id))));
    const translate = vi.fn(async (items: { id: string }[]) => items.map((i) => ({ id: i.id, es: "es", fr: "fr", de: "de", it: "it" })));
    const write = vi.fn(async () => {});

    await redescribeCity(candidates, { rewrite, translate, write });

    expect(rewrite).toHaveBeenCalledTimes(2);
    expect(rewrite.mock.calls[0][0]).toHaveLength(REDESCRIBE_CHUNK_SIZE);
    expect(rewrite.mock.calls[1][0]).toHaveLength(3);
  });

  it("writes the full descriptions atomically only after translation completes, and never for an incomplete translation", async () => {
    const candidates = [candidate(1), candidate(2)];
    const rewrite = vi.fn(async () => [goodRewrite(1), goodRewrite(2)]);
    const translate = vi.fn(async () => [
      { id: "1", es: "es", fr: "fr", de: "de", it: "it" },
      { id: "2", es: "es" }, // incomplete: fr/de/it missing
    ]);
    const write = vi.fn(async () => {});

    const report = await redescribeCity(candidates, { rewrite, translate, write });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(1, { pt: goodRewrite(1).pt, en: goodRewrite(1).en, es: "es", fr: "fr", de: "de", it: "it" });
    expect(report.rewritten).toBe(1);
    expect(report.stillInvalid).toHaveLength(1);
    expect(report.stillInvalid[0].id).toBe(2);
  });

  it("collects up to MAX_SAMPLES_PER_CITY before/after samples and lowKnowledge names", async () => {
    const candidates = [candidate(1)];
    const rewrite = vi.fn(async () => [{ ...goodRewrite(1), lowKnowledge: true }]);
    const translate = vi.fn(async () => [{ id: "1", es: "es", fr: "fr", de: "de", it: "it" }]);
    const write = vi.fn(async () => {});

    const report = await redescribeCity(candidates, { rewrite, translate, write });

    expect(report.lowKnowledge).toEqual([{ id: 1, name: "Place 1" }]);
    expect(report.samples).toHaveLength(1);
    expect(report.samples[0].before.pt).toContain("Conheça");
    expect(report.samples[0].after.pt).toBe(goodRewrite(1).pt);
  });

  it("never calls rewrite or write when given no candidates", async () => {
    const rewrite = vi.fn();
    const translate = vi.fn();
    const write = vi.fn();

    const report = await redescribeCity([], { rewrite, translate, write });

    expect(rewrite).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(report).toEqual({ selected: 0, rewritten: 0, stillInvalid: [], lowKnowledge: [], samples: [] });
  });
});
