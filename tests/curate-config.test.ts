import { describe, expect, it } from "vitest";
import { DESTINATIONS, PILOT_SIZE, getPilotDestinations, getDestinationsBySlug, countryNameFor } from "../scripts/data/destinations";
import {
  TIER_GOALS,
  NON_FOOD_SPLIT_A,
  NON_FOOD_SPLIT_D,
  restaurantCandidateTarget,
  totalCandidateTarget,
} from "../scripts/data/curation-config";

describe("destinations seed list", () => {
  it("has unique slugs", () => {
    const slugs = DESTINATIONS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("pilot returns the first PILOT_SIZE entries, in order", () => {
    const pilot = getPilotDestinations();
    expect(pilot.length).toBe(PILOT_SIZE);
    expect(pilot.map((d) => d.slug)).toEqual(DESTINATIONS.slice(0, PILOT_SIZE).map((d) => d.slug));
  });

  it("resolves destinations by slug, preserving the requested order", () => {
    const result = getDestinationsBySlug(["paris-fr", "london-gb"]);
    expect(result.map((d) => d.slug)).toEqual(["paris-fr", "london-gb"]);
  });

  it("throws on an unknown slug", () => {
    expect(() => getDestinationsBySlug(["nowhere-xx"])).toThrow();
  });

  it("resolves country names from ISO codes", () => {
    expect(countryNameFor("FR")).toBe("France");
    expect(countryNameFor("ZZ")).toBe("ZZ");
  });

  it("marks mecca-sa as inactive", () => {
    const mecca = DESTINATIONS.find((d) => d.slug === "mecca-sa");
    expect(mecca?.status).toBe("inactive");
  });

  it("every destination not explicitly marked inactive defaults to active", () => {
    const explicitlyInactive = new Set(DESTINATIONS.filter((d) => d.status === "inactive").map((d) => d.slug));
    const others = DESTINATIONS.filter((d) => !explicitlyInactive.has(d.slug));
    expect(others.every((d) => d.status === undefined)).toBe(true);
  });
});

describe("curation-config", () => {
  it("every tier has restaurantsMin <= restaurantsMax", () => {
    for (const goals of Object.values(TIER_GOALS)) {
      expect(goals.restaurantsMin).toBeLessThanOrEqual(goals.restaurantsMax);
    }
  });

  it("the non-food A/D split is a complete, non-negative fraction", () => {
    expect(NON_FOOD_SPLIT_A).toBeGreaterThan(0);
    expect(NON_FOOD_SPLIT_D).toBeGreaterThan(0);
    expect(NON_FOOD_SPLIT_A + NON_FOOD_SPLIT_D).toBeCloseTo(1);
  });

  it("over-generates candidate counts via ceil(target * overGenerate)", () => {
    const goals = TIER_GOALS.mega;
    expect(restaurantCandidateTarget(goals)).toBe(Math.ceil(goals.restaurantsMin * goals.overGenerate));
    expect(totalCandidateTarget(goals)).toBe(Math.ceil(goals.total * goals.overGenerate));
  });
});
