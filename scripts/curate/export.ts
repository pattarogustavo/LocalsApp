import type { TierGoals } from "../data/curation-config";

export type Confidence = "high" | "medium" | "low";

export interface ExportPlace {
  googlePlaceId: string;
  aiName: string;
  aiNeighborhood?: string;
  category: string;
  tags: string[];
  priceTier?: string;
  cuisine?: string;
  confidence: Confidence;
  descriptionPt?: string;
  status: string;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** We only ever store the place_id — this is the one Google-derived link we're allowed to construct. */
export function googleMapsLink(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
}

export interface CountSummaryLine {
  label: string;
  count: number;
  min?: number;
  max?: number;
  overMax: boolean;
}

/**
 * "restaurantes: X (mín M, máx N)" style line, flagged when count exceeds
 * max. Only ever called with min/max for restaurants — no category has a
 * ceiling, so every other count is plain (see buildSummaryLines).
 */
export function formatCountLine(label: string, count: number, min?: number, max?: number): string {
  const bounds = min != null && max != null ? ` (mín ${min}, máx ${max})` : "";
  const warning = max != null && count > max ? " ⚠️ acima do máximo" : "";
  return `${label}: ${count}${bounds}${warning}`;
}

/**
 * Summary lines for the export markdown/report: total, a restaurants line
 * (the only category with a min/max and an out-of-bounds warning — no
 * category is ever capped), a plain count for every other category present
 * (reflecting whatever the city actually has, e.g. many beaches or few
 * markets), then price-tier and confidence breakdowns.
 */
export function buildSummaryLines(places: ExportPlace[], goals: TierGoals): string[] {
  const restaurants = places.filter((p) => p.category === "restaurant");
  const total = places.length;

  const byCategory: Record<string, number> = {};
  for (const p of places) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;

  const byPriceTier: Record<string, number> = {};
  for (const p of restaurants) {
    if (!p.priceTier) continue;
    byPriceTier[p.priceTier] = (byPriceTier[p.priceTier] ?? 0) + 1;
  }
  const byConfidence: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  for (const p of places) byConfidence[p.confidence]++;

  const categoryLines = Object.entries(byCategory)
    .filter(([category]) => category !== "restaurant")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, count]) => formatCountLine(category, count));

  const lines = [
    formatCountLine("total", total),
    formatCountLine("restaurantes", restaurants.length, goals.restaurantsMin, goals.restaurantsMax),
    ...categoryLines,
    ...Object.entries(byPriceTier).map(([tier, count]) => formatCountLine(`preço: ${tier}`, count)),
    ...Object.entries(byConfidence).map(([level, count]) => formatCountLine(`confiança: ${level}`, count)),
  ];
  return lines;
}

function sortByConfidenceThenName(places: ExportPlace[]): ExportPlace[] {
  return [...places].sort((a, b) => {
    const diff = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    if (diff !== 0) return diff;
    return a.aiName.localeCompare(b.aiName);
  });
}

function formatPlaceLine(place: ExportPlace): string {
  const parts = [`**${place.aiName}**`];
  if (place.aiNeighborhood) parts.push(`(${place.aiNeighborhood})`);
  const meta = [place.tags.join(", "), place.priceTier, place.cuisine].filter(Boolean).join(" · ");
  const lines = [parts.join(" "), meta, place.descriptionPt ?? "", `status: ${place.status}`, googleMapsLink(place.googlePlaceId)];
  return lines.filter((l) => l.length > 0).join("\n  ");
}

/**
 * Builds the review Markdown for a destination export: a goals-vs-actual
 * summary at the top, followed by places grouped by category (categories in
 * alphabetical order, places within each sorted by confidence — low first).
 * Never includes Google-sourced content beyond the place_id link.
 */
export function buildExportMarkdown(destinationLabel: string, places: ExportPlace[], goals: TierGoals): string {
  const summary = buildSummaryLines(places, goals);
  const byCategory = new Map<string, ExportPlace[]>();
  for (const place of places) {
    const list = byCategory.get(place.category) ?? [];
    list.push(place);
    byCategory.set(place.category, list);
  }

  const sections = [...byCategory.keys()].sort().map((category) => {
    const items = sortByConfidenceThenName(byCategory.get(category)!);
    const body = items.map((p) => `- ${formatPlaceLine(p)}`).join("\n");
    return `## ${category}\n\n${body}`;
  });

  return [`# ${destinationLabel}`, "", "## Resumo", "", summary.map((l) => `- ${l}`).join("\n"), "", ...sections].join("\n\n");
}
