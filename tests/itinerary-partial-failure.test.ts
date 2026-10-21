import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveAndVerifyStopsWithSubstitution } from "../server/routers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Mocks the three Google Places endpoints resolveAndVerifyStopsWithSubstitution
 * can call per stop: Find Place From Text (verification), Place Details
 * (hydrating a resolved/substituted place), and Nearby Search (the
 * same-category substitution search for a stop that fails verification).
 */
function mockGooglePlacesFetch(opts: {
  byName?: Record<string, { placeId: string; lat: number; lng: number; address?: string; hours?: string[] } | "unresolvable">;
  nearbyResults?: { placeId: string; name: string; rating?: number; userRatingsTotal?: number; lat: number; lng: number }[];
}) {
  const byName = opts.byName ?? {};
  const nearbyResults = opts.nearbyResults ?? [];
  const byPlaceId = new Map<string, { placeId: string; lat: number; lng: number; address?: string; hours?: string[] }>();
  for (const spec of Object.values(byName)) {
    if (spec !== "unresolvable") byPlaceId.set(spec.placeId, spec);
  }
  for (const r of nearbyResults) byPlaceId.set(r.placeId, { placeId: r.placeId, lat: r.lat, lng: r.lng });

  return vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname.includes("findplacefromtext")) {
      const input = u.searchParams.get("input") ?? "";
      const spec = byName[input];
      if (!spec || spec === "unresolvable") return { ok: true, json: async () => ({ candidates: [] }) } as any;
      return { ok: true, json: async () => ({ candidates: [{ place_id: spec.placeId }] }) } as any;
    }
    if (u.pathname.includes("nearbysearch")) {
      return {
        ok: true,
        json: async () => ({
          status: nearbyResults.length > 0 ? "OK" : "ZERO_RESULTS",
          results: nearbyResults.map((r) => ({
            place_id: r.placeId,
            name: r.name,
            rating: r.rating ?? 4.5,
            user_ratings_total: r.userRatingsTotal ?? 100,
            types: [],
            geometry: { location: { lat: r.lat, lng: r.lng } },
          })),
        }),
      } as any;
    }
    if (u.pathname.includes("details")) {
      const placeId = u.searchParams.get("place_id") ?? "";
      const spec = byPlaceId.get(placeId);
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

describe("resolveAndVerifyStopsWithSubstitution — per-place failure isolation", () => {
  it("resolves a genuinely real place exactly like resolveAndVerifyStops, without attempting substitution", async () => {
    vi.stubGlobal(
      "fetch",
      mockGooglePlacesFetch({ byName: { "Sagrada Família": { placeId: "real-1", lat: 41.4036, lng: 2.1744 } } }),
    );

    const days = [{ dayNumber: 1, destination: "Barcelona", stops: [{ placeName: "Sagrada Família", placeCategory: "attraction" }] }];
    const result = await resolveAndVerifyStopsWithSubstitution(days, { trustedNamesLower: new Set(), language: "pt-BR" });

    expect(result.resolvedCount).toBe(1);
    expect(result.substitutedCount).toBe(0);
    expect(result.droppedCount).toBe(0);
    expect(result.days[0].stops[0]).toMatchObject({ googlePlaceId: "real-1", placeName: "Sagrada Família" });
    expect(result.warnings).toHaveLength(0);
  });

  it("substitutes a real same-category place for a stop that cannot be verified, instead of dropping it", async () => {
    vi.stubGlobal(
      "fetch",
      mockGooglePlacesFetch({
        byName: { "Totally Made Up Museum": "unresolvable" },
        nearbyResults: [{ placeId: "subst-1", name: "Real Nearby Museum", lat: 41.4, lng: 2.17, rating: 4.6, userRatingsTotal: 500 }],
      }),
    );

    const days = [{ dayNumber: 1, destination: "Barcelona", stops: [{ placeName: "Totally Made Up Museum", placeCategory: "museum" }] }];
    const result = await resolveAndVerifyStopsWithSubstitution(days, {
      trustedNamesLower: new Set(),
      biasLat: 41.39,
      biasLng: 2.16,
      language: "pt-BR",
    });

    expect(result.resolvedCount).toBe(0);
    expect(result.substitutedCount).toBe(1);
    expect(result.droppedCount).toBe(0);
    expect(result.days[0].stops).toHaveLength(1);
    expect(result.days[0].stops[0]).toMatchObject({ placeName: "Real Nearby Museum", googlePlaceId: "subst-1" });
    expect(result.warnings.some((w) => w.includes("Substituted") && w.includes("Totally Made Up Museum") && w.includes("Real Nearby Museum"))).toBe(true);
  });

  it("drops a stop WITH an explicit warning (not silently) when both verification and substitution fail", async () => {
    vi.stubGlobal(
      "fetch",
      mockGooglePlacesFetch({ byName: { "Totally Made Up Place": "unresolvable" }, nearbyResults: [] }),
    );

    const days = [{ dayNumber: 2, destination: "Barcelona", stops: [{ placeName: "Totally Made Up Place", placeCategory: "attraction" }] }];
    const result = await resolveAndVerifyStopsWithSubstitution(days, {
      trustedNamesLower: new Set(),
      biasLat: 41.39,
      biasLng: 2.16,
      language: "pt-BR",
    });

    expect(result.resolvedCount).toBe(0);
    expect(result.substitutedCount).toBe(0);
    expect(result.droppedCount).toBe(1);
    expect(result.days[0].stops).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("Totally Made Up Place") && /day 2/.test(w))).toBe(true);
  });

  it("never substitutes with a place already used elsewhere in the trip", async () => {
    vi.stubGlobal(
      "fetch",
      mockGooglePlacesFetch({
        byName: { "Fake Place": "unresolvable" },
        nearbyResults: [{ placeId: "already-used-1", name: "Already Used Place", lat: 41.4, lng: 2.17 }],
      }),
    );

    const days = [
      { dayNumber: 1, destination: "Barcelona", stops: [{ placeName: "Already Used Place", placeCategory: "attraction", googlePlaceId: "already-used-1" }] },
      { dayNumber: 2, destination: "Barcelona", stops: [{ placeName: "Fake Place", placeCategory: "attraction" }] },
    ];
    const result = await resolveAndVerifyStopsWithSubstitution(days, {
      trustedNamesLower: new Set(["already used place"]),
      biasLat: 41.39,
      biasLng: 2.16,
      language: "pt-BR",
    });

    // The only nearby candidate is already used elsewhere in the trip, so
    // substitution must find nothing and the stop must be dropped, not
    // duplicated across two days.
    expect(result.substitutedCount).toBe(0);
    expect(result.droppedCount).toBe(1);
    expect(result.days[1].stops).toHaveLength(0);
  });

  it("passes through a trusted (user-selected/must-see) stop untouched, without attempting resolution or substitution", async () => {
    const fetchMock = mockGooglePlacesFetch({});
    vi.stubGlobal("fetch", fetchMock);

    const days = [{ dayNumber: 1, destination: "Barcelona", stops: [{ placeName: "Hotel Arts Barcelona", lat: 41.386, lng: 2.196 }] }];
    const result = await resolveAndVerifyStopsWithSubstitution(days, { trustedNamesLower: new Set(["hotel arts barcelona"]), language: "pt-BR" });

    expect(result.droppedCount).toBe(0);
    expect(result.substitutedCount).toBe(0);
    expect(result.days[0].stops[0]).toEqual({ placeName: "Hotel Arts Barcelona", lat: 41.386, lng: 2.196 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when Google Places is unreachable — treats every stop as unverifiable/unsubstitutable instead of crashing generation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const days = [{ dayNumber: 1, destination: "Barcelona", stops: [{ placeName: "Some Place", placeCategory: "attraction" }] }];
    await expect(
      resolveAndVerifyStopsWithSubstitution(days, { trustedNamesLower: new Set(), biasLat: 41.39, biasLng: 2.16 }),
    ).resolves.toMatchObject({ droppedCount: 1, resolvedCount: 0, substitutedCount: 0 });
  });
});
