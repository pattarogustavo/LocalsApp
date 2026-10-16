import { describe, expect, it } from "vitest";
import { pickVerifiedCandidate } from "../scripts/curate/match-google";
import { newDiscardReasonCounts } from "../scripts/curate/verify";
import type { GoogleMatch } from "../scripts/curate/google";

const center = { lat: 51.5072, lng: -0.1276 };
const nearby = { lat: 51.51, lng: -0.128 };
const farAway = { lat: 48.8566, lng: 2.3522 };

function match(overrides: Partial<GoogleMatch> = {}): GoogleMatch {
  return {
    placeId: "ChIJqRLoW-PfyUcRqsW-OPfnWSc",
    name: "Big Ben",
    lat: nearby.lat,
    lng: nearby.lng,
    types: ["tourist_attraction", "point_of_interest"],
    ...overrides,
  };
}

describe("pickVerifiedCandidate", () => {
  it("returns no_google_match when there are no candidates", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate("Big Ben", [], center, 35, false, counts);
    expect(outcome.accepted).toBe(false);
    expect((outcome as any).reason).toBe("no Google match found");
  });

  it("accepts the only candidate when it passes every check", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate("Big Ben", [match()], center, 35, false, counts);
    expect(outcome.accepted).toBe(true);
    expect((outcome as any).googlePlaceId).toBe("ChIJqRLoW-PfyUcRqsW-OPfnWSc");
    expect((outcome as any).googleName).toBe("Big Ben");
  });

  it("rejects a neighborhood/sublocality result unless allowNeighborhood is true", () => {
    const counts = newDiscardReasonCounts();
    const rejected = pickVerifiedCandidate("Covent Garden", [match({ types: ["neighborhood", "political"] })], center, 35, false, counts);
    expect(rejected.accepted).toBe(false);
    expect(counts.addressType).toBe(1);

    const accepted = pickVerifiedCandidate(
      "Covent Garden",
      [match({ name: "Covent Garden", types: ["neighborhood", "political"] })],
      center,
      35,
      true,
      newDiscardReasonCounts(),
    );
    expect(accepted.accepted).toBe(true);
  });

  it("rejects an address-shaped place_id", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate("Big Ben", [match({ placeId: "EjBLZW5zaW5ndG9uIFJkICYgSHlkZSBQYXJrIEdhdGUsIExvbmRvbg" })], center, 35, false, counts);
    expect(outcome.accepted).toBe(false);
    expect(counts.addressId).toBe(1);
  });

  it("rejects a candidate too far from the destination center", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate("Big Ben", [match({ lat: farAway.lat, lng: farAway.lng })], center, 35, false, counts);
    expect(outcome.accepted).toBe(false);
    expect((outcome as any).reason).toBe("too_far");
  });

  it("rejects a name mismatch and reports the Google name it saw", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate("Big Ben", [match({ name: "Some Unrelated Pub" })], center, 35, false, counts);
    expect(outcome.accepted).toBe(false);
    expect((outcome as any).reason).toBe("nome não confere");
    expect((outcome as any).googleName).toBe("Some Unrelated Pub");
    expect(counts.nameMismatch).toBe(1);
  });

  it("rejects a closed place", () => {
    const counts = newDiscardReasonCounts();
    const outcome = pickVerifiedCandidate("Big Ben", [match({ businessStatus: "CLOSED_PERMANENTLY" })], center, 35, false, counts);
    expect(outcome.accepted).toBe(false);
    expect((outcome as any).reason).toBe("closed");
  });

  it("falls through to the next candidate when the first is rejected", () => {
    const counts = newDiscardReasonCounts();
    const candidates = [
      match({ placeId: "EjSomeAddressId", types: ["route"] }),
      match({ placeId: "ChIJanotherRealId000000000000000000", name: "Big Ben" }),
    ];
    const outcome = pickVerifiedCandidate("Big Ben", candidates, center, 35, false, counts);
    expect(outcome.accepted).toBe(true);
    expect((outcome as any).googlePlaceId).toBe("ChIJanotherRealId000000000000000000");
  });
});
