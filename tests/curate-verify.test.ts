import { describe, expect, it } from "vitest";
import { verifyCandidate } from "../scripts/curate/verify";

const center = { lat: 48.8566, lng: 2.3522 };
const nearby = { lat: 48.86, lng: 2.35 };
const farAway = { lat: 51.5072, lng: -0.1276 };

describe("verifyCandidate", () => {
  it("accepts a nearby, open, name-matching place", () => {
    const result = verifyCandidate(
      { aiName: "Louvre Museum", googleName: "Louvre", googleLocation: nearby, businessStatus: "OPERATIONAL" },
      center,
      35,
    );
    expect(result.accepted).toBe(true);
  });

  it("accepts a place with no businessStatus (e.g. a park or monument)", () => {
    const result = verifyCandidate({ aiName: "Tuileries Garden", googleName: "Tuileries Garden", googleLocation: nearby }, center, 35);
    expect(result.accepted).toBe(true);
  });

  it("rejects a permanently closed place", () => {
    const result = verifyCandidate(
      { aiName: "Louvre Museum", googleName: "Louvre", googleLocation: nearby, businessStatus: "CLOSED_PERMANENTLY" },
      center,
      35,
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("closed");
  });

  it("rejects a place too far from the destination center", () => {
    const result = verifyCandidate(
      { aiName: "Louvre Museum", googleName: "Louvre", googleLocation: farAway, businessStatus: "OPERATIONAL" },
      center,
      35,
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("too_far");
  });

  it("rejects a name mismatch even when close and open", () => {
    const result = verifyCandidate(
      { aiName: "Louvre Museum", googleName: "Eiffel Tower", googleLocation: nearby, businessStatus: "OPERATIONAL" },
      center,
      35,
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("name_mismatch");
  });
});
