import { describe, expect, it } from "vitest";
import { DESTINATIONS, getPilotDestinations, PILOT_SIZE } from "../scripts/data/destinations";

const EUROPE_CODES = new Set(["GB", "FR", "TR", "IT", "ES", "NL", "PT", "AT", "CZ", "DE", "GR", "IE", "HU", "CH"]);
const AMERICAS_CODES = new Set(["US", "CA", "MX", "DO", "PR", "BR", "AR"]);

function activeDestinations() {
  return DESTINATIONS.filter((d) => (d.status ?? "active") === "active");
}

describe("DESTINATIONS", () => {
  it("has exactly 35 active destinations: 20 in Europe (including Istanbul) and 15 in the Americas", () => {
    const active = activeDestinations();
    expect(active).toHaveLength(35);

    const europe = active.filter((d) => EUROPE_CODES.has(d.countryCode));
    const americas = active.filter((d) => AMERICAS_CODES.has(d.countryCode));
    expect(europe).toHaveLength(20);
    expect(americas).toHaveLength(15);
    expect(europe.map((d) => d.slug)).toContain("istanbul-tr");
    expect(europe.length + americas.length).toBe(active.length);
  });

  it("has no active destination outside Europe or the Americas", () => {
    const active = activeDestinations();
    for (const d of active) {
      expect(EUROPE_CODES.has(d.countryCode) || AMERICAS_CODES.has(d.countryCode)).toBe(true);
    }
  });

  it("marks the Middle East/Africa/Asia destinations as inactive without removing them", () => {
    const inactiveSlugs = [
      "mecca-sa",
      "antalya-tr",
      "dubai-ae",
      "abu-dhabi-ae",
      "riyadh-sa",
      "cairo-eg",
      "marrakech-ma",
      "cape-town-za",
      "johannesburg-za",
      "doha-qa",
      "bangkok-th",
      "hong-kong-hk",
      "macau-mo",
      "tokyo-jp",
      "singapore-sg",
    ];
    const bySlug = new Map(DESTINATIONS.map((d) => [d.slug, d]));
    for (const slug of inactiveSlugs) {
      const entry = bySlug.get(slug);
      expect(entry, `expected "${slug}" to still be in DESTINATIONS`).toBeDefined();
      expect(entry!.status).toBe("inactive");
    }
  });
});

describe("getPilotDestinations", () => {
  it("returns the first 5 active destinations: london, paris, istanbul, rome, madrid", () => {
    const pilot = getPilotDestinations();
    expect(pilot).toHaveLength(PILOT_SIZE);
    expect(pilot.map((d) => d.slug)).toEqual(["london-gb", "paris-fr", "istanbul-tr", "rome-it", "madrid-es"]);
    expect(pilot.every((d) => (d.status ?? "active") === "active")).toBe(true);
  });
});
