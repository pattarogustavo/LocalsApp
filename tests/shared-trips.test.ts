import { describe, expect, it } from "vitest";
import { mergeTripsWithShared, type SharedTripRow } from "../utils/shared-trips";
import type { Trip } from "../types/voyage";

function makeTrip(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id,
    name: `Trip ${id}`,
    destinations: [],
    startDate: "2026-01-01",
    endDate: "2026-01-05",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Trip;
}

function makeRow(id: string, shareId: number, overrides: Partial<Trip> = {}): SharedTripRow {
  return {
    shareId,
    shareRole: "viewer",
    tripData: makeTrip(id, overrides),
  };
}

describe("mergeTripsWithShared", () => {
  it("appends a shared trip not present locally", () => {
    const base = [makeTrip("own-1")];
    const result = mergeTripsWithShared(base, [makeRow("shared-1", 10)]);
    expect(result.map((t) => t.id)).toEqual(["own-1", "shared-1"]);
    expect(result[1].shareId).toBe(10);
    expect(result[1].shareRole).toBe("viewer");
  });

  it("dedupes by id, preferring the query's copy but keeping shareId/shareRole", () => {
    const stale = makeTrip("shared-1", { name: "Stale name", shareId: 10, shareRole: "viewer" });
    const base = [makeTrip("own-1"), stale];
    const fresh = makeRow("shared-1", 10, { name: "Fresh name" });
    const result = mergeTripsWithShared(base, [fresh]);
    expect(result).toHaveLength(2);
    const merged = result.find((t) => t.id === "shared-1")!;
    expect(merged.name).toBe("Fresh name");
    expect(merged.shareId).toBe(10);
  });

  it("drops shared trips no longer returned by the server (revoked/hidden) when the caller filters them out", () => {
    const base = [makeTrip("own-1")];
    const result = mergeTripsWithShared(base, []);
    expect(result).toEqual(base);
  });

  it("never touches trips the user owns", () => {
    const own = makeTrip("own-1", { name: "My own trip" });
    const result = mergeTripsWithShared([own], [makeRow("shared-1", 5)]);
    const untouchedOwn = result.find((t) => t.id === "own-1")!;
    expect(untouchedOwn).toEqual(own);
  });

  it("produces unique ids suitable for list keyExtractors", () => {
    const base = [makeTrip("a"), makeTrip("b")];
    const rows = [makeRow("b", 1), makeRow("c", 2)];
    const result = mergeTripsWithShared(base, rows);
    const ids = result.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});
