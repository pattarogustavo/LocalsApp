import { describe, expect, it } from "vitest";
import { extractJsonObject, parseImportFileContent, ImportParseError } from "../scripts/curate/import-json";

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
