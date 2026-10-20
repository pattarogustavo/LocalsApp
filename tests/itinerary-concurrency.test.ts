import { describe, expect, it, vi, afterEach } from "vitest";
import { mapWithConcurrency, fetchOpeningHoursForTopCandidates } from "../server/routers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── mapWithConcurrency (server/routers.ts) ─────────────────────────────────
// The same helper already used by trip.translateAllContent is now reused by
// fetchOpeningHoursForTopCandidates (previously an unbounded `Promise.all`
// over up to 40 Place Details calls at once).

describe("mapWithConcurrency", () => {
  it("never runs more than `limit` tasks concurrently, over a pool the size fetchOpeningHoursForTopCandidates actually uses (40)", async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency(Array.from({ length: 40 }, (_, i) => i), 6, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(6);
  });

  it("still runs in parallel, not sequentially, at the chosen limit", async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 6, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(maxActive).toBeGreaterThan(1);
  });

  it("preserves result order regardless of completion order", async () => {
    const delays = [30, 10, 20, 0];
    const result = await mapWithConcurrency(delays, 6, (ms) => new Promise((resolve) => setTimeout(() => resolve(ms), ms)));
    expect(result).toEqual(delays);
  });
});

// ─── fetchOpeningHoursForTopCandidates — bounded concurrency, same selection/result shape ──

function mockPlaceDetailsFetch(byPlaceId: Record<string, { ok?: boolean; status?: string; hours?: string[] } | "throw">) {
  return vi.fn(async (url: string) => {
    const placeId = new URL(url).searchParams.get("place_id") ?? "";
    const spec = byPlaceId[placeId];
    if (spec === "throw") throw new Error(`network down for ${placeId}`);
    if (!spec || spec.ok === false) {
      return { ok: false, json: async () => ({ status: "UNKNOWN_ERROR" }) } as any;
    }
    return {
      ok: true,
      json: async () => ({
        status: spec.status ?? "OK",
        result: spec.hours ? { opening_hours: { weekday_text: spec.hours } } : {},
      }),
    } as any;
  });
}

describe("fetchOpeningHoursForTopCandidates", () => {
  it("never issues more than 6 concurrent Place Details requests for a full 40-candidate shortlist", async () => {
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn(async (url: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      const placeId = new URL(url).searchParams.get("place_id");
      return { ok: true, json: async () => ({ status: "OK", result: { opening_hours: { weekday_text: [`hours-${placeId}`] } } }) } as any;
    });
    vi.stubGlobal("fetch", fetchMock);

    const candidates = Array.from({ length: 40 }, (_, i) => ({ placeId: `place-${i}` }));
    await fetchOpeningHoursForTopCandidates(candidates, 40, "pt-BR");

    expect(fetchMock).toHaveBeenCalledTimes(40);
    expect(maxActive).toBeLessThanOrEqual(6);
    expect(maxActive).toBeGreaterThan(1); // still parallel, not sequential
  });

  it("only queries the top `limit` candidates — same selection as before the concurrency change", async () => {
    const fetchMock = mockPlaceDetailsFetch({});
    vi.stubGlobal("fetch", fetchMock);

    const candidates = Array.from({ length: 10 }, (_, i) => ({ placeId: `place-${i}` }));
    await fetchOpeningHoursForTopCandidates(candidates, 4, "pt-BR");

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("backfills hoursText only where real opening_hours data came back, mutates the original array in place, and leaves candidates without data untouched — same result shape as before", async () => {
    const fetchMock = mockPlaceDetailsFetch({
      "place-1": { hours: ["Monday: 9AM–6PM"] },
      "place-0": { status: "ZERO_RESULTS" },
    });
    vi.stubGlobal("fetch", fetchMock);

    const candidates: { placeId: string; hoursText?: string }[] = [{ placeId: "place-0" }, { placeId: "place-1" }];
    const result = await fetchOpeningHoursForTopCandidates(candidates, 2, "pt-BR");

    expect(result).toBe(candidates); // same array reference — mutated in place, not replaced
    expect(result[0].hoursText).toBeUndefined();
    expect(result[1].hoursText).toBe("Monday: 9AM–6PM");
  });

  it("never throws and never corrupts other results when one Place Details request fails (concurrency change preserves existing failure handling)", async () => {
    const fetchMock = mockPlaceDetailsFetch({
      "place-0": { hours: ["Tuesday: 9AM–6PM"] },
      "place-1": "throw",
    });
    vi.stubGlobal("fetch", fetchMock);

    const candidates: { placeId: string; hoursText?: string }[] = [{ placeId: "place-0" }, { placeId: "place-1" }];
    await expect(fetchOpeningHoursForTopCandidates(candidates, 2, "pt-BR")).resolves.toBe(candidates);
    expect(candidates[0].hoursText).toBe("Tuesday: 9AM–6PM");
    expect(candidates[1].hoursText).toBeUndefined();
  });
});
