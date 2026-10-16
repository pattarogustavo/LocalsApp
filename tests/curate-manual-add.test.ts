import { describe, expect, it } from "vitest";
import { matchManualNames, pairStructuredWithMatches } from "../scripts/curate/manual-add";
import { newDiscardReasonCounts } from "../scripts/curate/verify";
import type { GoogleMatch } from "../scripts/curate/google";
import type { ValidatedPlace } from "../scripts/curate/validate-place";

const center = { lat: 51.5072, lng: -0.1276 };

function match(overrides: Partial<GoogleMatch> = {}): GoogleMatch {
  return {
    placeId: "ChIJqRLoW-PfyUcRqsW-OPfnWSc",
    name: "Buckingham Palace",
    lat: center.lat,
    lng: center.lng,
    types: ["tourist_attraction", "point_of_interest"],
    ...overrides,
  };
}

function place(overrides: Partial<ValidatedPlace> = {}): ValidatedPlace {
  return {
    name: "Buckingham Palace",
    category: "attraction",
    tags: ["culture"],
    isLocalCuisine: false,
    confidence: "high",
    priority: 1,
    descriptionPt: "Residência oficial da família real.",
    descriptionEn: "Official residence of the royal family.",
    ...overrides,
  };
}

describe("matchManualNames", () => {
  it("accepts a name whose Google match passes every check, always allowing neighborhood/sublocality", () => {
    const counts = newDiscardReasonCounts();
    const findMatches = async (name: string) => [match({ name, types: ["neighborhood", "political"] })];
    return matchManualNames(["Covent Garden Market"], findMatches, center, 35, counts).then((summary) => {
      expect(summary.accepted).toEqual([{ name: "Covent Garden Market", googlePlaceId: "ChIJqRLoW-PfyUcRqsW-OPfnWSc", googleName: "Covent Garden Market" }]);
      expect(summary.rejected).toEqual([]);
    });
  });

  it("rejects a name with no Google match", async () => {
    const counts = newDiscardReasonCounts();
    const summary = await matchManualNames(["Not A Real Place"], async () => [], center, 35, counts);
    expect(summary.accepted).toEqual([]);
    expect(summary.rejected).toEqual([{ name: "Not A Real Place", reason: "no Google match found" }]);
  });

  it("rejects a name mismatch and reports the Google name returned", async () => {
    const counts = newDiscardReasonCounts();
    const findMatches = async () => [match({ name: "Completely Different Pub" })];
    const summary = await matchManualNames(["Buckingham Palace"], findMatches, center, 35, counts);
    expect(summary.accepted).toEqual([]);
    expect(summary.rejected).toEqual([{ name: "Buckingham Palace", reason: "nome não confere", googleName: "Completely Different Pub" }]);
  });

  it("processes every name independently, in order", async () => {
    const counts = newDiscardReasonCounts();
    const findMatches = async (name: string) => (name === "Big Ben" ? [match({ name: "Big Ben" })] : []);
    const summary = await matchManualNames(["Big Ben", "Nonexistent Place"], findMatches, center, 35, counts);
    expect(summary.accepted.map((a) => a.name)).toEqual(["Big Ben"]);
    expect(summary.rejected.map((r) => r.name)).toEqual(["Nonexistent Place"]);
  });
});

describe("pairStructuredWithMatches", () => {
  it("pairs a structured place back to its Google match by name similarity", () => {
    const matched = [{ name: "Buckingham Palace", googlePlaceId: "id-1", googleName: "Buckingham Palace" }];
    const { finalized, unmatched } = pairStructuredWithMatches([place()], matched);
    expect(finalized).toEqual([{ place: place(), googlePlaceId: "id-1", googleName: "Buckingham Palace" }]);
    expect(unmatched).toEqual([]);
  });

  it("pairs even when the model slightly reformats the name", () => {
    const matched = [{ name: "Big Ben", googlePlaceId: "id-2", googleName: "Big Ben" }];
    const structured = [place({ name: "Big Ben (Elizabeth Tower)" })];
    const { finalized, unmatched } = pairStructuredWithMatches(structured, matched);
    expect(finalized).toHaveLength(1);
    expect(finalized[0].googlePlaceId).toBe("id-2");
    expect(unmatched).toEqual([]);
  });

  it("reports a Google match the structuring call never returned a place for", () => {
    const matched = [
      { name: "Big Ben", googlePlaceId: "id-2", googleName: "Big Ben" },
      { name: "Trafalgar Square", googlePlaceId: "id-3", googleName: "Trafalgar Square" },
    ];
    const structured = [place({ name: "Big Ben" })];
    const { finalized, unmatched } = pairStructuredWithMatches(structured, matched);
    expect(finalized).toHaveLength(1);
    expect(unmatched).toEqual([{ name: "Trafalgar Square", googlePlaceId: "id-3", googleName: "Trafalgar Square" }]);
  });

  it("never pairs the same Google match to two structured places", () => {
    const matched = [{ name: "Big Ben", googlePlaceId: "id-2", googleName: "Big Ben" }];
    const structured = [place({ name: "Big Ben" }), place({ name: "Big Ben" })];
    const { finalized, unmatched } = pairStructuredWithMatches(structured, matched);
    expect(finalized).toHaveLength(1);
    expect(unmatched).toEqual([]);
  });
});
