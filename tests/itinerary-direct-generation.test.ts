import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveAndVerifyStops } from "../server/routers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Mocks both Google Places calls resolveAndVerifyStop makes per stop:
 * Find Place From Text (findplacefromtext) → place_id, then
 * Place Details (details) → lat/lng/address/hours.
 * `byName` maps a place NAME (not place_id) to its resolution outcome.
 */
function mockGooglePlacesFetch(byName: Record<string, { placeId: string; lat: number; lng: number; address?: string; hours?: string[] } | "unresolvable">) {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname.includes("findplacefromtext")) {
      const input = u.searchParams.get("input") ?? "";
      const spec = byName[input];
      if (!spec || spec === "unresolvable") {
        return { ok: true, json: async () => ({ candidates: [] }) } as any;
      }
      return { ok: true, json: async () => ({ candidates: [{ place_id: spec.placeId }] }) } as any;
    }
    if (u.pathname.includes("details")) {
      const placeId = u.searchParams.get("place_id") ?? "";
      const spec = Object.values(byName).find((s) => s !== "unresolvable" && (s as any).placeId === placeId) as
        | { placeId: string; lat: number; lng: number; address?: string; hours?: string[] }
        | undefined;
      if (!spec) return { ok: true, json: async () => ({ status: "NOT_FOUND" }) } as any;
      return {
        ok: true,
        json: async () => ({
          status: "OK",
          result: {
            formatted_address: spec.address,
            geometry: { location: { lat: spec.lat, lng: spec.lng } },
            opening_hours: spec.hours ? { weekday_text: spec.hours } : undefined,
          },
        }),
      } as any;
    }
    return { ok: false, json: async () => ({}) } as any;
  });
}

describe("resolveAndVerifyStops — ai.generateFromScratch's post-generation grounding", () => {
  it("resolves a genuinely real place and backfills googlePlaceId/lat/lng/address/hours onto the stop", async () => {
    vi.stubGlobal(
      "fetch",
      mockGooglePlacesFetch({
        "Sagrada Família": { placeId: "real-1", lat: 41.4036, lng: 2.1744, address: "Carrer de Mallorca, 401", hours: ["Monday: 9AM–6PM"] },
      }),
    );

    const days = [{ stops: [{ placeName: "Sagrada Família", lat: 0, lng: 0 }] }];
    const result = await resolveAndVerifyStops(days, { trustedNamesLower: new Set(), language: "pt-BR" });

    expect(result.droppedCount).toBe(0);
    expect(result.resolvedCount).toBe(1);
    expect(result.days[0].stops[0]).toMatchObject({
      googlePlaceId: "real-1",
      lat: 41.4036,
      lng: 2.1744,
      address: "Carrer de Mallorca, 401",
      hours: "Monday: 9AM–6PM",
    });
    expect(result.hoursByPlaceId.get("real-1")).toBe("Monday: 9AM–6PM");
  });

  it("drops a stop that cannot be verified against real Google Places data (no invented place kept)", async () => {
    vi.stubGlobal("fetch", mockGooglePlacesFetch({ "Totally Made Up Place": "unresolvable" }));

    const days = [{ stops: [{ placeName: "Totally Made Up Place" }] }];
    const result = await resolveAndVerifyStops(days, { trustedNamesLower: new Set(), language: "pt-BR" });

    expect(result.droppedCount).toBe(1);
    expect(result.resolvedCount).toBe(0);
    expect(result.days[0].stops).toHaveLength(0);
  });

  it("passes through a user-selected/must-see stop untouched, without even attempting to resolve it", async () => {
    const fetchMock = mockGooglePlacesFetch({});
    vi.stubGlobal("fetch", fetchMock);

    const days = [{ stops: [{ placeName: "Hotel Arts Barcelona", lat: 41.386, lng: 2.196 }] }];
    const result = await resolveAndVerifyStops(days, { trustedNamesLower: new Set(["hotel arts barcelona"]), language: "pt-BR" });

    expect(result.droppedCount).toBe(0);
    expect(result.days[0].stops[0]).toEqual({ placeName: "Hotel Arts Barcelona", lat: 41.386, lng: 2.196 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles a mix of resolvable, unresolvable, and trusted stops correctly in the same itinerary", async () => {
    vi.stubGlobal(
      "fetch",
      mockGooglePlacesFetch({
        "Park Güell": { placeId: "real-2", lat: 41.4145, lng: 2.1527 },
        "Fake Museum Of Nothing": "unresolvable",
      }),
    );

    const days = [
      {
        stops: [
          { placeName: "Park Güell" },
          { placeName: "Fake Museum Of Nothing" },
          { placeName: "User Selected Restaurant" },
        ],
      },
    ];
    const result = await resolveAndVerifyStops(days, { trustedNamesLower: new Set(["user selected restaurant"]) });

    expect(result.resolvedCount).toBe(1);
    expect(result.droppedCount).toBe(1);
    const survivingNames = result.days[0].stops.map((s: any) => s.placeName);
    expect(survivingNames).toEqual(["Park Güell", "User Selected Restaurant"]);
  });

  it("never throws when Google Places is unreachable — treats every stop as unverifiable instead of crashing the generation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const days = [{ stops: [{ placeName: "Some Place" }] }];
    await expect(resolveAndVerifyStops(days, { trustedNamesLower: new Set() })).resolves.toMatchObject({ droppedCount: 1, resolvedCount: 0 });
  });
});
