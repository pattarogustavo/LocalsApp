import { describe, expect, it } from "vitest";
import { DESTINATIONS, PILOT_SIZE, getPilotDestinations, getDestinationsBySlug, countryNameFor } from "../scripts/data/destinations";
import {
  TIER_GOALS,
  categoryCapFor,
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

  it("category caps scale down from mega to small", () => {
    const mega = categoryCapFor("museum", "mega")!;
    const large = categoryCapFor("museum", "large")!;
    const medium = categoryCapFor("museum", "medium")!;
    const small = categoryCapFor("museum", "small")!;
    expect(mega).toBeGreaterThanOrEqual(large);
    expect(large).toBeGreaterThanOrEqual(medium);
    expect(medium).toBeGreaterThanOrEqual(small);
  });

  it("returns undefined for an unknown category", () => {
    expect(categoryCapFor("not_a_category", "mega")).toBeUndefined();
  });

  it("over-generates candidate counts via ceil(target * overGenerate)", () => {
    const goals = TIER_GOALS.mega;
    expect(restaurantCandidateTarget(goals)).toBe(Math.ceil(goals.restaurantsMin * goals.overGenerate));
    expect(totalCandidateTarget(goals)).toBe(Math.ceil(goals.total * goals.overGenerate));
  });
});
