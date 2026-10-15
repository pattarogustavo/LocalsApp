import { describe, expect, it } from "vitest";
import { haversineDistanceKm, isWithinRadius } from "../scripts/curate/distance";

describe("haversineDistanceKm", () => {
  it("is 0 for the same point", () => {
    expect(haversineDistanceKm({ lat: 48.8566, lng: 2.3522 }, { lat: 48.8566, lng: 2.3522 })).toBeCloseTo(0, 5);
  });

  it("matches the known Paris-London distance (~344 km) within a small margin", () => {
    const paris = { lat: 48.8566, lng: 2.3522 };
    const london = { lat: 51.5072, lng: -0.1276 };
    expect(haversineDistanceKm(paris, london)).toBeGreaterThan(330);
    expect(haversineDistanceKm(paris, london)).toBeLessThan(360);
  });
});

describe("isWithinRadius", () => {
  const center = { lat: 48.8566, lng: 2.3522 };

  it("accepts a nearby point within maxKm", () => {
    const nearby = { lat: 48.86, lng: 2.35 };
    expect(isWithinRadius(nearby, center, 35)).toBe(true);
  });

  it("rejects a far point beyond maxKm", () => {
    const london = { lat: 51.5072, lng: -0.1276 };
    expect(isWithinRadius(london, center, 35)).toBe(false);
  });
});
