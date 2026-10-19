import { describe, it, expect, vi } from "vitest";
import { rankCandidates, filterExcludedCandidates, type ScorableCandidate } from "../server/itinerary/scoring";
import { estimateDurationRange } from "../server/itinerary/duration";
import {
  validateAndCorrectItinerary,
  timeToMinutes,
  minutesToTime,
  minutesBetween,
  parseWeekdayHours,
  dateToGoogleWeekdayIndex,
} from "../server/itinerary/validate";
import { withOneRepairAttempt, extractRepairableConflicts, buildRepairPromptBlock } from "../server/itinerary/repair";

// ─── Scoring / ranking ───────────────────────────────────────────────────────

describe("rankCandidates", () => {
  it("ranks a relevant art museum above a popular but irrelevant aquarium for an Art+Gastronomy traveler", () => {
    const candidates: ScorableCandidate[] = [
      { name: "Sea Life Aquarium", placeId: "aq1", rating: 4.5, userRatingsTotal: 50000, types: ["aquarium", "tourist_attraction"] },
      { name: "National Art Gallery", placeId: "ga1", rating: 4.6, userRatingsTotal: 8000, types: ["art_gallery", "museum"] },
    ];
    const ranked = rankCandidates(candidates, { travelStyles: ["cultura", "gastronomia"] });
    expect(ranked[0].candidate.placeId).toBe("ga1");
  });

  it("uses popularity only as a tie-breaker among equally relevant candidates", () => {
    const candidates: ScorableCandidate[] = [
      { name: "Museum A", placeId: "a", rating: 4.5, userRatingsTotal: 100, types: ["museum"] },
      { name: "Museum B", placeId: "b", rating: 4.5, userRatingsTotal: 10000, types: ["museum"] },
    ];
    const ranked = rankCandidates(candidates, { travelStyles: ["cultura"] });
    expect(ranked[0].candidate.placeId).toBe("b"); // same interest+quality, more reviews wins
  });

  it("never lets popularity override a poor interest match", () => {
    const candidates: ScorableCandidate[] = [
      { name: "Giant Amusement Park", placeId: "amuse", rating: 4.8, userRatingsTotal: 200000, types: ["amusement_park"] },
      { name: "Small Local Gallery", placeId: "gal", rating: 4.0, userRatingsTotal: 30, types: ["art_gallery"] },
    ];
    const ranked = rankCandidates(candidates, { travelStyles: ["cultura"] });
    expect(ranked[0].candidate.placeId).toBe("gal");
  });

  it("demotes (but does not exclude) a budget-mismatched candidate", () => {
    const candidates: ScorableCandidate[] = [
      { name: "Budget Museum", placeId: "cheap", rating: 4.2, userRatingsTotal: 500, types: ["museum"], priceLevel: 0 },
      { name: "Luxury Museum", placeId: "lux", rating: 4.2, userRatingsTotal: 500, types: ["museum"], priceLevel: 4 },
    ];
    const ranked = rankCandidates(candidates, { travelStyles: ["cultura"], attractionsBudget: "econômico" });
    expect(ranked[0].candidate.placeId).toBe("cheap");
    expect(ranked.map((r) => r.candidate.placeId)).toContain("lux"); // demoted, not dropped
  });
});

describe("filterExcludedCandidates", () => {
  it("hard-excludes an aquarium when the user says they don't like aquariums, regardless of rating", () => {
    const candidates: ScorableCandidate[] = [
      { name: "Sea Life Aquarium", placeId: "aq1", rating: 4.9, userRatingsTotal: 90000, types: ["aquarium"] },
      { name: "Art Museum", placeId: "art1", rating: 4.5, userRatingsTotal: 1000, types: ["museum"] },
    ];
    const { kept, excludedCount } = filterExcludedCandidates(candidates, "não gosto de aquário");
    expect(excludedCount).toBe(1);
    expect(kept.find((c) => c.placeId === "aq1")).toBeUndefined();
    expect(kept.find((c) => c.placeId === "art1")).toBeDefined();
  });

  it("passes everything through when no avoid text is given", () => {
    const candidates: ScorableCandidate[] = [{ name: "X", placeId: "x", rating: 4, userRatingsTotal: 1, types: ["museum"] }];
    const { kept, excludedCount } = filterExcludedCandidates(candidates, undefined);
    expect(excludedCount).toBe(0);
    expect(kept).toHaveLength(1);
  });
});

// ─── Duration modeling ───────────────────────────────────────────────────────

describe("estimateDurationRange", () => {
  it("gives a major museum a realistic multi-hour range, not a fixed 1 hour", () => {
    const range = estimateDurationRange("museum", ["museum"]);
    expect(range.minMinutes).toBeGreaterThanOrEqual(90);
    expect(range.maxMinutes).toBeGreaterThanOrEqual(150);
  });

  it("gives a quick landmark visit a much shorter range than a museum", () => {
    const landmark = estimateDurationRange("attraction", ["landmark"]);
    const museum = estimateDurationRange("museum", ["museum"]);
    expect(landmark.typicalMinutes).toBeLessThan(museum.typicalMinutes);
  });
});

// ─── Time helpers ────────────────────────────────────────────────────────────

describe("time helpers", () => {
  it("converts and reformats HH:MM correctly", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(minutesToTime(570)).toBe("09:30");
  });

  it("computes minutes between two times, wrapping past midnight", () => {
    expect(minutesBetween("09:00", "10:30")).toBe(90);
    expect(minutesBetween("23:30", "00:30")).toBe(60);
  });

  it("maps a date string to Google's Monday-first weekday index", () => {
    // 2026-09-14 is a Monday
    expect(dateToGoogleWeekdayIndex("2026-09-14")).toBe(0);
    // 2026-09-20 is a Sunday
    expect(dateToGoogleWeekdayIndex("2026-09-20")).toBe(6);
  });
});

describe("parseWeekdayHours", () => {
  it("parses a standard 7-line weekday_text block", () => {
    const text = [
      "Monday: 9:00 AM – 6:00 PM",
      "Tuesday: 9:00 AM – 6:00 PM",
      "Wednesday: 9:00 AM – 6:00 PM",
      "Thursday: 9:00 AM – 6:00 PM",
      "Friday: 9:00 AM – 6:00 PM",
      "Saturday: 10:00 AM – 4:00 PM",
      "Sunday: Closed",
    ].join("\n");
    const parsed = parseWeekdayHours(text);
    expect(parsed[0]).toEqual({ open: 9 * 60, close: 18 * 60 });
    expect(parsed[6]).toBeNull();
  });

  it("leaves unparsable lines as unknown rather than guessing", () => {
    const parsed = parseWeekdayHours("Monday: hours vary");
    expect(parsed[0]).toBeUndefined();
  });
});

// ─── Full validate/correct pipeline ─────────────────────────────────────────

const baseCtx = {
  wakeUpTime: "08:00",
  bedtime: "23:00",
  arrivalTime: "15:00",
  departureTime: "18:00",
  isFirstDay: (i: number) => i === 0,
  isLastDay: (i: number) => i === 0,
  mustVisit: [],
  requireLunch: true,
  requireDinner: true,
  hoursByPlaceId: new Map<string, string>(),
  fillerRestaurants: [],
};

describe("validateAndCorrectItinerary", () => {
  it("removes duplicate stops across the trip", async () => {
    const days = [
      { date: "2026-09-14", destination: "Paris", stops: [
        { id: "1", time: "10:00", googlePlaceId: "p1", placeName: "Louvre", placeCategory: "museum" },
        { id: "2", time: "16:00", googlePlaceId: "p1", placeName: "Louvre", placeCategory: "museum" },
      ] },
    ];
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx,
      isFirstDay: () => false,
      isLastDay: () => false,
      requireLunch: false,
      requireDinner: false,
    });
    expect(fixed[0].stops).toHaveLength(1);
    expect(warnings.some((w) => w.includes("duplicate"))).toBe(true);
  });

  it("shifts the arrival day's stops later when the first stop starts too soon after arrival", async () => {
    const days = [
      { date: "2026-09-14", destination: "Paris", stops: [
        { id: "1", time: "15:10", googlePlaceId: "p1", placeName: "Eiffel Tower", placeCategory: "attraction" },
      ] },
    ];
    const { days: fixed } = await validateAndCorrectItinerary(days, { ...baseCtx, isLastDay: () => false, requireLunch: false, requireDinner: false });
    // arrival 15:00 + 90min buffer = 16:30
    expect(timeToMinutes(fixed[0].stops[0].time)).toBeGreaterThanOrEqual(timeToMinutes("16:30")!);
  });

  it("drops a trailing stop that would run past the departure buffer", async () => {
    const days = [
      { date: "2026-09-14", destination: "Paris", stops: [
        { id: "1", time: "10:00", googlePlaceId: "p1", placeName: "Museum", placeCategory: "museum" },
        { id: "2", time: "16:30", googlePlaceId: "p2", placeName: "Late Add-on", placeCategory: "attraction" },
      ] },
    ];
    // departure 18:00 - 120min buffer = 16:00 last-allowed start for a ~75min stop
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, { ...baseCtx, isFirstDay: () => false, isLastDay: () => true, requireLunch: false, requireDinner: false });
    expect(fixed[0].stops.find((s: any) => s.placeName === "Late Add-on")).toBeUndefined();
    expect(warnings.some((w) => w.includes("did not fit"))).toBe(true);
  });

  it("inserts a must-visit place that the LLM omitted, when there's enough free time", async () => {
    const days = [
      { date: "2026-09-14", destination: "Paris", stops: [
        { id: "1", time: "10:00", googlePlaceId: "p1", placeName: "Some Cafe", placeCategory: "cafe" },
      ] },
    ];
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx,
      isFirstDay: () => false,
      isLastDay: () => false,
      requireLunch: false,
      requireDinner: false,
      mustVisit: [{ name: "Louvre Museum", category: "museum", lat: 48.86, lng: 2.33 }],
    });
    const names = fixed[0].stops.map((s: any) => s.placeName);
    expect(names).toContain("Louvre Museum");
    expect(warnings.some((w) => w.includes("Inserted missing must-visit"))).toBe(true);
  });

  it("inserts a fallback lunch stop when none was scheduled and a candidate restaurant is available", async () => {
    const days = [
      { date: "2026-09-14", destination: "Paris", stops: [
        { id: "1", time: "10:00", googlePlaceId: "p1", placeName: "Museum", placeCategory: "museum" },
        { id: "2", time: "16:00", googlePlaceId: "p2", placeName: "Park", placeCategory: "attraction" },
      ] },
    ];
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx,
      isFirstDay: () => false,
      isLastDay: () => false,
      requireDinner: false,
      fillerRestaurants: [{ googlePlaceId: "r1", name: "Bistro X", lat: 48.85, lng: 2.35 }],
    });
    const lunchStop = fixed[0].stops.find((s: any) => s.placeCategory === "restaurant");
    expect(lunchStop?.placeName).toBe("Bistro X");
    expect(warnings.some((w) => w.includes("Inserted fallback lunch"))).toBe(true);
  });

  it("never drops meals to satisfy an intense pace — lunch and dinner both survive a packed schedule", async () => {
    const days = [
      { date: "2026-09-14", destination: "Paris", stops: [
        { id: "1", time: "09:00", googlePlaceId: "p1", placeName: "Museum 1", placeCategory: "museum" },
        { id: "2", time: "13:00", googlePlaceId: "p2", placeName: "Lunch Spot", placeCategory: "restaurant" },
        { id: "3", time: "15:00", googlePlaceId: "p3", placeName: "Museum 2", placeCategory: "museum" },
        { id: "4", time: "20:00", googlePlaceId: "p4", placeName: "Dinner Spot", placeCategory: "restaurant" },
      ] },
    ];
    const { days: fixed } = await validateAndCorrectItinerary(days, { ...baseCtx, isFirstDay: () => false, isLastDay: () => false });
    const categories = fixed[0].stops.map((s: any) => s.placeCategory);
    expect(categories.filter((c: string) => c === "restaurant")).toHaveLength(2);
  });
});

// ─── Editorial-affinity ranking (curated catalog → scoring.ts) ─────────────

describe("rankCandidates — editorialPriority (curated-catalog affinity)", () => {
  it("ranks a curated-catalog pick above an equally-relevant, equally-rated non-curated candidate", () => {
    const candidates: ScorableCandidate[] = [
      { name: "Catalog Pick", placeId: "cat", rating: 4.3, userRatingsTotal: 40, types: ["museum"], editorialPriority: 100 },
      { name: "Generic Museum", placeId: "gen", rating: 4.3, userRatingsTotal: 40, types: ["museum"] },
    ];
    const ranked = rankCandidates(candidates, { travelStyles: ["cultura"] });
    expect(ranked[0].candidate.placeId).toBe("cat");
  });

  it("never lets editorial affinity override a poor interest match — interest is still primary", () => {
    const candidates: ScorableCandidate[] = [
      { name: "Curated Amusement Park", placeId: "amuse", rating: 4.8, userRatingsTotal: 200000, types: ["amusement_park"], editorialPriority: 100 },
      { name: "Small Local Gallery", placeId: "gal", rating: 4.0, userRatingsTotal: 30, types: ["art_gallery"] },
    ];
    const ranked = rankCandidates(candidates, { travelStyles: ["cultura"] });
    expect(ranked[0].candidate.placeId).toBe("gal");
  });

  it("treats an absent editorialPriority as 0 — identical behavior to before the field existed", () => {
    const withField: ScorableCandidate[] = [{ name: "A", placeId: "a", rating: 4, userRatingsTotal: 10, types: ["museum"], editorialPriority: 0 }];
    const withoutField: ScorableCandidate[] = [{ name: "A", placeId: "a", rating: 4, userRatingsTotal: 10, types: ["museum"] }];
    expect(rankCandidates(withField, { travelStyles: ["cultura"] })[0].editorialScore).toBe(
      rankCandidates(withoutField, { travelStyles: ["cultura"] })[0].editorialScore,
    );
  });
});

// ─── Personalized duration (duration.ts) ────────────────────────────────────

describe("estimateDurationRange — personalization (Stage 5)", () => {
  it("is unchanged when no personalization is given (backward compatible)", () => {
    const withoutOpts = estimateDurationRange("museum", ["museum"]);
    const withEmptyOpts = estimateDurationRange("museum", ["museum"], undefined);
    expect(withEmptyOpts).toEqual(withoutOpts);
  });

  it("extends typical/max duration when the place matches a declared travel-style interest, but never lowers the minimum", () => {
    const base = estimateDurationRange("museum", ["museum"]);
    const personalized = estimateDurationRange("museum", ["museum"], { travelStyles: ["cultura"] });
    expect(personalized.minMinutes).toBe(base.minMinutes);
    expect(personalized.typicalMinutes).toBeGreaterThan(base.typicalMinutes);
    expect(personalized.maxMinutes).toBeGreaterThan(base.maxMinutes);
  });

  it("does not extend duration for an interest that doesn't match the place's type", () => {
    const base = estimateDurationRange("museum", ["museum"]);
    const personalized = estimateDurationRange("museum", ["museum"], { travelStyles: ["praia"] });
    expect(personalized).toEqual(base);
  });

  it("extends typical/max for 'relaxado' pace, and never compresses below the minimum for 'intenso'", () => {
    const base = estimateDurationRange("restaurant", ["restaurant"]);
    const relaxed = estimateDurationRange("restaurant", ["restaurant"], { pace: "relaxado" });
    const intense = estimateDurationRange("restaurant", ["restaurant"], { pace: "intenso" });
    expect(relaxed.typicalMinutes).toBeGreaterThan(base.typicalMinutes);
    expect(intense.minMinutes).toBe(base.minMinutes);
    expect(intense.typicalMinutes).toBe(base.typicalMinutes); // "intenso" applies no multiplier — never compresses
  });

  it("gives a high-confidence editorial pick a small extra allowance", () => {
    const base = estimateDurationRange("restaurant", ["restaurant"]);
    const highConfidence = estimateDurationRange("restaurant", ["restaurant"], { editorialPriority: 100 });
    const lowConfidence = estimateDurationRange("restaurant", ["restaurant"], { editorialPriority: 10 });
    expect(highConfidence.typicalMinutes).toBeGreaterThan(base.typicalMinutes);
    expect(lowConfidence).toEqual(base);
  });

  it("combines multipliers (interest + pace) multiplicatively, still never breaching the absolute minimum", () => {
    const combined = estimateDurationRange("museum", ["museum"], { travelStyles: ["cultura"], pace: "relaxado" });
    const interestOnly = estimateDurationRange("museum", ["museum"], { travelStyles: ["cultura"] });
    expect(combined.typicalMinutes).toBeGreaterThan(interestOnly.typicalMinutes);
    expect(combined.minMinutes).toBe(estimateDurationRange("museum", ["museum"]).minMinutes);
  });
});

// ─── Bounded one-shot repair loop (repair.ts, spec "Stage 10") ─────────────

describe("extractRepairableConflicts / buildRepairPromptBlock", () => {
  it("only flags CONFLICT-prefixed and specific unresolved-meal warnings as repairable", () => {
    const warnings = [
      "Removed duplicate stop \"X\"",
      "Shifted day 1 stops later by 30min",
      "CONFLICT: could not fit must-visit place \"Louvre\" into any day within available time",
      "Missing lunch on day 2 — no fallback restaurant candidate available",
    ];
    expect(extractRepairableConflicts(warnings)).toEqual([
      "CONFLICT: could not fit must-visit place \"Louvre\" into any day within available time",
      "Missing lunch on day 2 — no fallback restaurant candidate available",
    ]);
  });

  it("builds a prompt block that lists every conflict verbatim", () => {
    const block = buildRepairPromptBlock(["CONFLICT: A", "CONFLICT: B"]);
    expect(block).toContain("CONFLICT: A");
    expect(block).toContain("CONFLICT: B");
  });
});

describe("withOneRepairAttempt", () => {
  it("does not call generate a second time when there are no repairable conflicts", async () => {
    const generate = vi.fn().mockResolvedValue({ result: "days-v1", warnings: ["Removed duplicate stop \"X\""] });
    const outcome = await withOneRepairAttempt(generate);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ result: "days-v1", warnings: ["Removed duplicate stop \"X\""], repairAttempted: false, repairUsed: false });
  });

  it("calls generate exactly ONE more time (never more) when a conflict is present, and uses the repaired result if it strictly improves", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ result: "days-v1", warnings: ["CONFLICT: could not fit X"] })
      .mockResolvedValueOnce({ result: "days-v2", warnings: [] });
    const outcome = await withOneRepairAttempt(generate);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0][0]).toBeUndefined(); // first call: no repair block
    expect(generate.mock.calls[1][0]).toContain("CONFLICT: could not fit X"); // second call: told exactly what to fix
    expect(outcome).toEqual({ result: "days-v2", warnings: [], repairAttempted: true, repairUsed: true });
  });

  it("keeps the ORIGINAL result when the repair attempt does not strictly reduce the conflict count (never regresses silently)", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ result: "days-v1", warnings: ["CONFLICT: A"] })
      .mockResolvedValueOnce({ result: "days-v2", warnings: ["CONFLICT: A", "CONFLICT: B"] }); // worse, not better
    const outcome = await withOneRepairAttempt(generate);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(outcome.result).toBe("days-v1");
    expect(outcome.repairUsed).toBe(false);
  });

  it("never calls generate a third time even if the repaired result still has conflicts", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ result: "days-v1", warnings: ["CONFLICT: A", "CONFLICT: B"] })
      .mockResolvedValueOnce({ result: "days-v2", warnings: ["CONFLICT: A"] }); // improved but not perfect
    const outcome = await withOneRepairAttempt(generate);
    expect(generate).toHaveBeenCalledTimes(2); // bounded — no third attempt even though a conflict remains
    expect(outcome.result).toBe("days-v2");
    expect(outcome.repairUsed).toBe(true);
    expect(outcome.warnings).toEqual(["CONFLICT: A"]); // unresolved conflict still surfaced, not hidden
  });

  it("falls back to the original result if the repair call itself throws", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ result: "days-v1", warnings: ["CONFLICT: A"] })
      .mockRejectedValueOnce(new Error("provider timeout"));
    const outcome = await withOneRepairAttempt(generate);
    expect(outcome.result).toBe("days-v1");
    expect(outcome.repairAttempted).toBe(true);
    expect(outcome.repairUsed).toBe(false);
  });
});
