import { describe, expect, it } from "vitest";
import { buildConsecutiveLegs, chunkLegs, type LegDay } from "../utils/route-legs";

describe("buildConsecutiveLegs", () => {
  it("builds one leg per consecutive stop pair within a day, not every pair", () => {
    const days: LegDay[] = [
      {
        destination: "Lisbon",
        stops: [
          { id: "s1", placeName: "Hotel" },
          { id: "s2", placeName: "Castle" },
          { id: "s3", placeName: "Museum" },
        ],
      },
    ];
    const legs = buildConsecutiveLegs(days, "driving");
    expect(legs).toHaveLength(2); // s1->s2, s2->s3 — never s1->s3
    expect(legs[0]).toMatchObject({ dayIdx: 0, stopId: "s1", origin: "Hotel, Lisbon", destination: "Castle, Lisbon" });
    expect(legs[1]).toMatchObject({ dayIdx: 0, stopId: "s2", origin: "Castle, Lisbon", destination: "Museum, Lisbon" });
  });

  it("locates unresolved stops by name + destination city when there is no address/lat-lng yet", () => {
    const days: LegDay[] = [
      { destination: "Porto", stops: [{ id: "a", placeName: "Cafe A" }, { id: "b", placeName: "Cafe B" }] },
    ];
    const legs = buildConsecutiveLegs(days, "walking");
    expect(legs[0].origin).toBe("Cafe A, Porto");
    expect(legs[0].destination).toBe("Cafe B, Porto");
  });

  it("prefers coordinates/address over the name+city fallback once resolved", () => {
    const days: LegDay[] = [
      {
        destination: "Porto",
        stops: [
          { id: "a", placeName: "Cafe A", lat: 41.1, lng: -8.6 },
          { id: "b", placeName: "Cafe B", address: "Rua X, 123" },
        ],
      },
    ];
    const legs = buildConsecutiveLegs(days, "walking");
    expect(legs[0].origin).toBe("41.1,-8.6");
    expect(legs[0].destination).toBe("Rua X, 123");
  });

  it("skips a leg whose origin already has a duration resolved for the same mode", () => {
    const days: LegDay[] = [
      {
        destination: "Rome",
        stops: [
          { id: "a", placeName: "A", travelTimeToNext: "10 min", travelModeToNext: "driving" },
          { id: "b", placeName: "B" },
        ],
      },
    ];
    expect(buildConsecutiveLegs(days, "driving")).toHaveLength(0);
  });

  it("re-requests a leg when the travel mode changed since it was last resolved", () => {
    const days: LegDay[] = [
      {
        destination: "Rome",
        stops: [
          { id: "a", placeName: "A", travelTimeToNext: "10 min", travelModeToNext: "driving" },
          { id: "b", placeName: "B" },
        ],
      },
    ];
    expect(buildConsecutiveLegs(days, "walking")).toHaveLength(1);
  });

  it("skips a stop with no stable id (nothing to persist the result against)", () => {
    const days: LegDay[] = [{ destination: "Rome", stops: [{ placeName: "A" }, { id: "b", placeName: "B" }] }];
    expect(buildConsecutiveLegs(days, "driving")).toHaveLength(0);
  });

  it("never builds a leg across different days", () => {
    const days: LegDay[] = [
      { destination: "Rome", stops: [{ id: "a", placeName: "A" }] },
      { destination: "Florence", stops: [{ id: "b", placeName: "B" }] },
    ];
    expect(buildConsecutiveLegs(days, "driving")).toHaveLength(0);
  });
});

describe("chunkLegs", () => {
  it("splits legs into groups no larger than the given size", () => {
    const legs = Array.from({ length: 45 }, (_, i) => ({
      dayIdx: 0,
      stopId: `s${i}`,
      origin: "o",
      destination: "d",
      mode: "driving" as const,
    }));
    const chunks = chunkLegs(legs, 20);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(20);
    expect(chunks[1]).toHaveLength(20);
    expect(chunks[2]).toHaveLength(5);
  });

  it("returns no chunks for an empty leg list", () => {
    expect(chunkLegs([], 20)).toHaveLength(0);
  });
});
