import { describe, expect, it } from "vitest";
import { dedupeByPlaceId } from "../scripts/curate/dedupe";

describe("dedupeByPlaceId", () => {
  it("keeps the first occurrence of each place_id", () => {
    const input = [
      { googlePlaceId: "a", label: "first" },
      { googlePlaceId: "b", label: "only" },
      { googlePlaceId: "a", label: "duplicate" },
    ];
    expect(dedupeByPlaceId(input)).toEqual([
      { googlePlaceId: "a", label: "first" },
      { googlePlaceId: "b", label: "only" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(dedupeByPlaceId([])).toEqual([]);
  });
});
