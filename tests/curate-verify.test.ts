import { describe, expect, it } from "vitest";
import { verifyCandidate, checkPlaceIdAndTypes, newDiscardReasonCounts, trackPlaceIdRejection, trackNameMismatch, addDiscardReasonCounts } from "../scripts/curate/verify";

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

describe("checkPlaceIdAndTypes", () => {
  const A_REAL_PLACE_ID = "ChIJqRLoW-PfyUcRqsW-OPfnWSc";

  it("rejects an address/intersection-shaped id (Ej...) even with plausible types", () => {
    const result = checkPlaceIdAndTypes("EjBLZW5zaW5ndG9uIFJkICYgSHlkZSBQYXJrIEdhdGUsIExvbmRvbg", ["park"], false);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("address_id");
  });

  it("accepts a real ChIJ place id with a point-of-interest type", () => {
    const result = checkPlaceIdAndTypes(A_REAL_PLACE_ID, ["park", "point_of_interest", "establishment"], false);
    expect(result.accepted).toBe(true);
  });

  it("accepts a real GhIJ place id", () => {
    const result = checkPlaceIdAndTypes("GhIJQWDl0CIeQUARxks3icF8U8A", ["museum", "point_of_interest"], false);
    expect(result.accepted).toBe(true);
  });

  it("rejects address-only types (route, intersection, street_address, ...)", () => {
    for (const types of [["route"], ["intersection"], ["street_address"], ["premise"], ["postal_code"]]) {
      const result = checkPlaceIdAndTypes(A_REAL_PLACE_ID, types, false);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe("address_type");
    }
  });

  it("rejects a neighborhood/sublocality result outside group D", () => {
    const result = checkPlaceIdAndTypes(A_REAL_PLACE_ID, ["neighborhood", "political"], false);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("address_type");
  });

  it("accepts a neighborhood/sublocality result only for group D", () => {
    const neighborhood = checkPlaceIdAndTypes(A_REAL_PLACE_ID, ["neighborhood", "political"], true);
    expect(neighborhood.accepted).toBe(true);
    const sublocality = checkPlaceIdAndTypes(A_REAL_PLACE_ID, ["sublocality"], true);
    expect(sublocality.accepted).toBe(true);
  });

  it("rejects a place_id longer than 250 characters", () => {
    const tooLong = "ChIJ" + "a".repeat(250);
    const result = checkPlaceIdAndTypes(tooLong, ["park"], false);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("id_too_long");
  });
});

describe("discard reason counts", () => {
  it("sums counts across multiple destinations/batches", () => {
    const a = newDiscardReasonCounts();
    trackPlaceIdRejection(a, "address_id");
    trackPlaceIdRejection(a, "address_type");
    trackNameMismatch(a);

    const b = newDiscardReasonCounts();
    trackPlaceIdRejection(b, "address_id");
    trackPlaceIdRejection(b, "id_too_long");

    const total = addDiscardReasonCounts(a, b);
    expect(total).toEqual({ addressId: 2, addressType: 1, idTooLong: 1, nameMismatch: 1 });
  });
});
