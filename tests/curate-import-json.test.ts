import { describe, expect, it } from "vitest";
import {
  extractJsonObject,
  parseImportFileContent,
  resolveCityDestination,
  ImportParseError,
  type DestinationSeedForSlugMatch,
} from "../scripts/curate/import-json";

const SINGLE_CITY = `{
  "destination": { "slug": "porto-pt", "nameEn": "Porto", "namePt": "Porto", "country": "Portugal", "countryCode": "PT", "tier": "medium" },
  "places": [ { "name": "Livraria Lello", "descriptions": { "pt": "desc", "en": "desc" } } ]
}`;

describe("extractJsonObject", () => {
  it("extracts a bare JSON object as-is", () => {
    expect(JSON.parse(extractJsonObject(SINGLE_CITY)!)).toMatchObject({ destination: { slug: "porto-pt" } });
  });

  it("extracts JSON from a fenced ```json block", () => {
    const text = "Aqui está:\n```json\n" + SINGLE_CITY + "\n```\nEspero que ajude!";
    expect(JSON.parse(extractJsonObject(text)!)).toMatchObject({ destination: { slug: "porto-pt" } });
  });

  it("extracts JSON from a fenced block with no language tag", () => {
    const text = "```\n" + SINGLE_CITY + "\n```";
    expect(JSON.parse(extractJsonObject(text)!)).toMatchObject({ destination: { slug: "porto-pt" } });
  });

  it("extracts JSON embedded in surrounding prose with no fences at all", () => {
    const text = "Segue o resultado: " + SINGLE_CITY + " Fim.";
    expect(JSON.parse(extractJsonObject(text)!)).toMatchObject({ destination: { slug: "porto-pt" } });
  });

  it("ignores braces inside string values when balancing", () => {
    const text = `{ "destination": { "slug": "x" }, "places": [{ "name": "A { B } C", "descriptions": {} }] }`;
    const extracted = extractJsonObject(text);
    expect(() => JSON.parse(extracted!)).not.toThrow();
    expect(JSON.parse(extracted!).places[0].name).toBe("A { B } C");
  });

  it("returns null when there's no JSON object at all", () => {
    expect(extractJsonObject("no json here")).toBeNull();
  });
});

describe("parseImportFileContent", () => {
  it("parses a single-city file into one city block", () => {
    const parsed = parseImportFileContent(SINGLE_CITY);
    expect(parsed.cities).toHaveLength(1);
    expect(parsed.cities[0].destination.slug).toBe("porto-pt");
    expect(parsed.cities[0].places).toHaveLength(1);
  });

  it("parses a { cities: [...] } file into several city blocks", () => {
    const text = `{ "cities": [ ${SINGLE_CITY}, ${SINGLE_CITY} ] }`;
    const parsed = parseImportFileContent(text);
    expect(parsed.cities).toHaveLength(2);
  });

  it("tolerates a fenced block with surrounding chat text", () => {
    const text = "Aqui está a lista:\n```json\n" + SINGLE_CITY + "\n```\n";
    const parsed = parseImportFileContent(text);
    expect(parsed.cities[0].destination.slug).toBe("porto-pt");
  });

  it("throws ImportParseError with a line number for invalid JSON (braces balanced, but a trailing comma)", () => {
    const broken = `{\n  "destination": { "slug": "x" },\n  "places": [ { "name": "A", } ]\n}`;
    expect(() => parseImportFileContent(broken)).toThrow(ImportParseError);
    try {
      parseImportFileContent(broken);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ImportParseError);
      expect((err as ImportParseError).line).toBeGreaterThan(0);
    }
  });

  it("rejects a shape that is neither a single city nor { cities: [...] }", () => {
    expect(() => parseImportFileContent(`{ "foo": "bar" }`)).toThrow(/destination.*places|cities/);
  });

  it("rejects a city block missing destination or places", () => {
    expect(() => parseImportFileContent(`{ "cities": [ { "places": [] } ] }`)).toThrow(ImportParseError);
  });
});

const SEEDS: DestinationSeedForSlugMatch[] = [
  { slug: "lisbon-pt", nameEn: "Lisbon", namePt: "Lisboa", countryCode: "PT", tier: "large" },
  { slug: "porto-pt", nameEn: "Porto", namePt: "Porto", countryCode: "PT", tier: "medium" },
];

describe("resolveCityDestination", () => {
  it("uses a given non-empty slug as-is", () => {
    const result = resolveCityDestination({ slug: "lisbon-pt", nameEn: "Lisbon", namePt: "Lisboa", country: "Portugal", countryCode: "PT", tier: "large" }, SEEDS);
    expect(result).toEqual({
      ok: true,
      destination: { slug: "lisbon-pt", nameEn: "Lisbon", namePt: "Lisboa", country: "Portugal", countryCode: "PT", tier: "large", slugInferred: false },
    });
  });

  it("fails cleanly (not a crash) when slug is missing and there's nothing to infer it from", () => {
    const result = resolveCityDestination({ country: "Nowhere" }, SEEDS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/slug is missing/);
  });

  it("fails cleanly when slug is explicitly undefined (the real-world crash trigger)", () => {
    const result = resolveCityDestination({ slug: undefined, nameEn: undefined }, SEEDS);
    expect(result.ok).toBe(false);
  });

  it("infers the slug by matching nameEn + countryCode against known destinations", () => {
    const result = resolveCityDestination({ nameEn: "Lisbon", country: "Portugal", countryCode: "PT", tier: "large" }, SEEDS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.destination.slug).toBe("lisbon-pt");
      expect(result.destination.slugInferred).toBe(true);
    }
  });

  it("infers the slug by matching namePt, ignoring accents/case", () => {
    const result = resolveCityDestination({ namePt: "LISBOA", countryCode: "pt" }, SEEDS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.destination.slug).toBe("lisbon-pt");
  });

  it("infers the slug from the generic 'name' field", () => {
    const result = resolveCityDestination({ name: "Porto", countryCode: "PT" }, SEEDS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.destination.slug).toBe("porto-pt");
  });

  it("fails when name+country match no known destination", () => {
    const result = resolveCityDestination({ nameEn: "Nowhereville", countryCode: "ZZ" }, SEEDS);
    expect(result.ok).toBe(false);
  });

  it("fails when name alone (no countryCode) matches ambiguously is not the case here, but a name mismatch across countries must not false-match", () => {
    const result = resolveCityDestination({ nameEn: "Lisbon", countryCode: "ZZ" }, SEEDS);
    expect(result.ok).toBe(false);
  });

  it("falls back the tier to the matched seed's tier when the given tier is invalid", () => {
    const result = resolveCityDestination({ slug: "lisbon-pt", tier: "gigantic" }, SEEDS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.destination.tier).toBe("large");
  });

  it("falls back the tier to 'large' for a brand-new destination with an invalid tier", () => {
    const result = resolveCityDestination({ slug: "new-city-xx", nameEn: "New City", country: "Nowhere", countryCode: "XX", tier: "bogus" }, SEEDS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.destination.tier).toBe("large");
  });

  it("keeps a valid given tier for a brand-new destination", () => {
    const result = resolveCityDestination({ slug: "new-city-xx", nameEn: "New City", country: "Nowhere", countryCode: "XX", tier: "small" }, SEEDS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.destination.tier).toBe("small");
  });
});
