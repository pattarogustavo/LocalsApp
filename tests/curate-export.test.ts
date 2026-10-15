import { describe, expect, it } from "vitest";
import { buildExportMarkdown, buildSummaryLines, formatCountLine, googleMapsLink, type ExportPlace } from "../scripts/curate/export";
import { TIER_GOALS } from "../scripts/data/curation-config";

function place(partial: Partial<ExportPlace> & { googlePlaceId: string; aiName: string }): ExportPlace {
  return {
    category: "attraction",
    tags: [],
    confidence: "high",
    status: "pending",
    ...partial,
  };
}

describe("googleMapsLink", () => {
  it("builds a maps link from the place_id alone", () => {
    expect(googleMapsLink("ChIJD7fiBh9u5kcRYJSMaMOCCwQ")).toBe(
      "https://www.google.com/maps/place/?q=place_id:ChIJD7fiBh9u5kcRYJSMaMOCCwQ",
    );
  });
});

describe("formatCountLine", () => {
  it("formats with bounds and flags when over max", () => {
    expect(formatCountLine("restaurantes", 12, 9, 11)).toBe("restaurantes: 12 (mín 9, máx 11) ⚠️ acima do máximo");
    expect(formatCountLine("restaurantes", 10, 9, 11)).toBe("restaurantes: 10 (mín 9, máx 11)");
  });

  it("formats without bounds", () => {
    expect(formatCountLine("total", 42)).toBe("total: 42");
  });
});

describe("buildSummaryLines / buildExportMarkdown", () => {
  const places: ExportPlace[] = [
    place({ googlePlaceId: "r1", aiName: "Bistrô do Zé", category: "restaurant", priceTier: "budget", confidence: "low" }),
    place({ googlePlaceId: "r2", aiName: "Casa Grande", category: "restaurant", priceTier: "luxury", confidence: "high" }),
    place({ googlePlaceId: "m1", aiName: "Museu X", category: "museum", confidence: "medium" }),
  ];

  it("includes a restaurants line with the tier's min/max", () => {
    const lines = buildSummaryLines(places, TIER_GOALS.small);
    expect(lines.some((l) => l.startsWith("restaurantes: 2"))).toBe(true);
  });

  it("never leaks Google-sourced fields — only place_id-based links", () => {
    const markdown = buildExportMarkdown("Paris", places, TIER_GOALS.small);
    expect(markdown).toContain("place_id:r1");
    expect(markdown).not.toMatch(/endereço|address|rating|nota/i);
  });

  it("groups places by category and sorts low-confidence first within each group", () => {
    const markdown = buildExportMarkdown("Paris", places, TIER_GOALS.small);
    const restaurantSection = markdown.split("## restaurant")[1].split("## ")[0];
    const zeIdx = restaurantSection.indexOf("Bistrô do Zé");
    const grandeIdx = restaurantSection.indexOf("Casa Grande");
    expect(zeIdx).toBeGreaterThan(-1);
    expect(grandeIdx).toBeGreaterThan(-1);
    expect(zeIdx).toBeLessThan(grandeIdx);
  });
});
