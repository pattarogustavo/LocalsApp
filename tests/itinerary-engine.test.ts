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
  classifyStopType,
  buildDailySummary,
  findEmptyDays,
  isMeal,
} from "../server/itinerary/validate";
import { withOneRepairAttempt, extractRepairableConflicts, buildRepairPromptBlock } from "../server/itinerary/repair";
import { diversifyRestaurantLikeOrder } from "../server/itinerary/scoring";

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

  it("[regression — FASE 1] 'arte' is a real, scorable travel style, not silently dropped (it used to not exist in STYLE_TYPE_MAP at all, so `s in STYLE_TYPE_MAP` filtered it out and selecting ONLY 'arte' behaved identically to selecting nothing)", () => {
    const candidates: ScorableCandidate[] = [
      { name: "Art Gallery", placeId: "ag1", rating: 4.3, userRatingsTotal: 400, types: ["art_gallery"] },
      { name: "Generic Shop", placeId: "shop1", rating: 4.3, userRatingsTotal: 400, types: ["store"] },
    ];
    const ranked = rankCandidates(candidates, { travelStyles: ["arte"] });
    expect(ranked[0].candidate.placeId).toBe("ag1");
    expect(ranked[0].interestScore).toBeGreaterThan(ranked[1].interestScore); // a real interest-score gap, not both landing on the neutral 50 baseline
  });

  it("[regression — FASE 6: Compras vs Cultura+Arte produce genuinely different rankings, same candidate pool] 'Compras' alone ranks a shopping mall above a museum; Cultura+Arte ranks the museum above the mall", () => {
    const candidates: ScorableCandidate[] = [
      { name: "City Mall", placeId: "mall1", rating: 4.2, userRatingsTotal: 2000, types: ["shopping_mall"] },
      { name: "National Museum", placeId: "mus1", rating: 4.2, userRatingsTotal: 2000, types: ["museum"] },
    ];
    const shoppingTrip = rankCandidates(candidates, { travelStyles: ["compras"] });
    const cultureArtTrip = rankCandidates(candidates, { travelStyles: ["cultura", "arte"] });
    expect(shoppingTrip[0].candidate.placeId).toBe("mall1");
    expect(cultureArtTrip[0].candidate.placeId).toBe("mus1");
  });

  it("combining a secondary style with a primary one never lets the secondary eliminate the primary's top pick (multi-style selection respects the combination)", () => {
    const candidates: ScorableCandidate[] = [
      { name: "Art Museum", placeId: "art1", rating: 4.5, userRatingsTotal: 1000, types: ["museum", "art_gallery"] }, // matches both styles
      { name: "Random Shop", placeId: "shop1", rating: 4.5, userRatingsTotal: 1000, types: ["store"] }, // matches neither
    ];
    const ranked = rankCandidates(candidates, { travelStyles: ["cultura", "compras"] });
    expect(ranked[0].candidate.placeId).toBe("art1"); // matches one of the two selected styles — still beats a candidate matching neither
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

// isMeal is exported (not just used internally by validateAndCorrectItinerary's
// own meal-presence check) specifically so ai.generateFromScratch can run the
// identical "is this day missing a required meal?" check itself, BEFORE
// deciding whether to pay for the fallback-restaurant Google Places fetch at
// all (AI-first architecture — the fetch is now lazy/on-demand, only run when
// this check finds a real gap in the model's own output).
describe("isMeal (AI-first architecture: gates the lazy fallback-restaurant fetch)", () => {
  it("is true for a restaurant/cafe stop inside the given time window", () => {
    expect(isMeal({ time: "13:00", placeCategory: "restaurant" }, 12 * 60, 14 * 60 + 30)).toBe(true);
    expect(isMeal({ time: "12:00", placeCategory: "cafe" }, 12 * 60, 14 * 60 + 30)).toBe(true);
  });

  it("is false outside the window, even for a restaurant/cafe stop", () => {
    expect(isMeal({ time: "09:00", placeCategory: "restaurant" }, 12 * 60, 14 * 60 + 30)).toBe(false);
  });

  it("is false for a non-food category, even inside the window", () => {
    expect(isMeal({ time: "13:00", placeCategory: "attraction" }, 12 * 60, 14 * 60 + 30)).toBe(false);
  });

  it("is false for a stop with no parsable time", () => {
    expect(isMeal({ time: undefined, placeCategory: "restaurant" }, 12 * 60, 14 * 60 + 30)).toBe(false);
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

  it("extends typical/max for 'relaxado' pace, tightens it for 'intenso', and never compresses below the minimum either way", () => {
    const base = estimateDurationRange("restaurant", ["restaurant"]);
    const relaxed = estimateDurationRange("restaurant", ["restaurant"], { pace: "relaxado" });
    const intense = estimateDurationRange("restaurant", ["restaurant"], { pace: "intenso" });
    expect(relaxed.typicalMinutes).toBeGreaterThan(base.typicalMinutes);
    expect(intense.typicalMinutes).toBeLessThan(base.typicalMinutes); // real, measurable difference from "moderado" — fits more into the same day
    expect(intense.minMinutes).toBe(base.minMinutes); // the absolute floor is still never touched
    expect(intense.typicalMinutes).toBeGreaterThanOrEqual(intense.minMinutes);
  });

  it("never lets 'intenso' compress a short-minimum category below its own floor even with a large pool of multipliers stacked", () => {
    // museum: min 90 — close to its own typical (120), so a naive 0.85x
    // compound multiplier (pace × interest × editorial) could in principle
    // dip under 90 if it weren't clamped.
    const intense = estimateDurationRange("museum", ["museum"], { pace: "intenso", travelStyles: [], editorialPriority: 0 });
    expect(intense.typicalMinutes).toBeGreaterThanOrEqual(intense.minMinutes);
    expect(intense.maxMinutes).toBeGreaterThanOrEqual(intense.minMinutes);
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

// ─── Chinatown-style description/schedule contradiction (regression) ───────

describe("validateAndCorrectItinerary — description vs. schedule reconciliation", () => {
  it("rewrites an explicit contradictory clock-time range in the description to match the validated schedule (the reported Chinatown bug)", async () => {
    const days = [
      { date: "2026-09-14", destination: "London", stops: [
        { id: "1", time: "21:30", googlePlaceId: "ct1", placeName: "Chinatown", placeCategory: "neighborhood",
          description: "Passeio noturno por Chinatown — melhor das 19:30 às 20:15, quando as luzes dos letreiros ficam mais bonitas." },
      ] },
    ];
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx,
      bedtime: "23:59",
      isFirstDay: () => false,
      isLastDay: () => false,
      requireLunch: false,
      requireDinner: false,
    });
    const stop = fixed[0].stops[0];
    expect(stop.time).toBe("21:30"); // schedule is authoritative — never silently moved for this
    expect(stop.description).toContain("21:30");
    expect(stop.description).not.toContain("19:30");
    expect(warnings.some((w: string) => w.includes("Rewrote a contradictory explicit time"))).toBe(true);
  });

  it("correctly reconciles a description's explicit time range across a midnight boundary (never corrupts the digits)", async () => {
    const days = [
      { date: "2026-09-14", destination: "London", stops: [
        { id: "1", time: "00:20", googlePlaceId: "bar1", placeName: "Late Bar", placeCategory: "other",
          description: "Aberto até tarde — ótimo das 22:00 às 23:00." },
      ] },
    ];
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx,
      wakeUpTime: "00:00",
      bedtime: "23:59",
      isFirstDay: () => false,
      isLastDay: () => false,
      requireLunch: false,
      requireDinner: false,
    });
    const stop = fixed[0].stops[0];
    expect(stop.time).toBe("00:20"); // schedule untouched
    expect(stop.description).toContain("00:20");
    expect(stop.description).toContain("01:20"); // 60min implied duration carried across midnight correctly
    expect(stop.description).not.toContain("22:00");
    expect(warnings.some((w: string) => w.includes("Rewrote a contradictory explicit time"))).toBe(true);
  });

  it("leaves a description's time mention alone when it's close enough to the scheduled time (not the bug this guards against)", async () => {
    const days = [
      { date: "2026-09-14", destination: "London", stops: [
        { id: "1", time: "20:10", googlePlaceId: "r1", placeName: "Dinner Spot", placeCategory: "restaurant",
          description: "Jantar tranquilo, ótimo das 19:50 às 21:00." },
      ] },
    ];
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx,
      isFirstDay: () => false,
      isLastDay: () => false,
      requireLunch: false,
      requireDinner: false,
    });
    expect(fixed[0].stops[0].description).toContain("19:50");
    expect(warnings.some((w: string) => w.includes("Rewrote a contradictory explicit time"))).toBe(false);
  });

  it("never crashes on a malformed/unparsable time value in a stop", async () => {
    const days = [
      { date: "2026-09-14", destination: "London", stops: [
        { id: "1", time: "not-a-time", googlePlaceId: "x1", placeName: "Mystery Stop", placeCategory: "attraction", description: "" },
      ] },
    ];
    await expect(
      validateAndCorrectItinerary(days, { ...baseCtx, isFirstDay: () => false, isLastDay: () => false, requireLunch: false, requireDinner: false }),
    ).resolves.toBeTruthy();
  });
});

// ─── Stop classification + guaranteed non-empty descriptions ───────────────

describe("classifyStopType / ensureStopDescriptionAndType", () => {
  it("classifies a station-named stop as logistics, never as an unexplained recommendation", () => {
    expect(classifyStopType({ placeName: "Earls Court Station", placeCategory: "attraction" }, undefined)).toBe("logistics");
  });

  it("classifies the traveler's own accommodation by placeId match", () => {
    const type = classifyStopType(
      { placeName: "Some Hotel", placeCategory: "other", googlePlaceId: "hotel-123" },
      { placeId: "hotel-123" },
    );
    expect(type).toBe("accommodation");
  });

  it("fills in a non-empty description for a logistics stop left blank by the LLM", async () => {
    const days = [
      { date: "2026-09-14", destination: "London", stops: [
        { id: "1", time: "16:00", googlePlaceId: "s1", placeName: "Earls Court Station", placeCategory: "attraction", description: "" },
      ] },
    ];
    const { days: fixed } = await validateAndCorrectItinerary(days, {
      ...baseCtx,
      isFirstDay: () => false,
      isLastDay: () => false,
      requireLunch: false,
      requireDinner: false,
    });
    const stop = fixed[0].stops[0];
    expect(stop.stopType).toBe("logistics");
    expect(stop.description).toBeTruthy();
    expect(stop.description.length).toBeGreaterThan(0);
  });

  it("never leaves an ordinary attraction stop with an empty description", async () => {
    const days = [
      { date: "2026-09-14", destination: "Rome", stops: [
        { id: "1", time: "10:00", googlePlaceId: "a1", placeName: "Colosseum", placeCategory: "attraction", description: undefined },
      ] },
    ];
    const { days: fixed } = await validateAndCorrectItinerary(days, {
      ...baseCtx,
      isFirstDay: () => false,
      isLastDay: () => false,
      requireLunch: false,
      requireDinner: false,
    });
    expect(fixed[0].stops[0].description).toBeTruthy();
    expect(fixed[0].stops[0].stopType).toBe("attraction");
  });
});

// ─── Final mandatory opening-hours enforcement (regression: Barcelona/La Colmena) ─

const FULL_WEEK_SUNDAY_9_TO_21 = [
  "Monday: 9:00 AM – 6:00 PM",
  "Tuesday: 9:00 AM – 6:00 PM",
  "Wednesday: 9:00 AM – 6:00 PM",
  "Thursday: 9:00 AM – 6:00 PM",
  "Friday: 9:00 AM – 6:00 PM",
  "Saturday: 9:00 AM – 6:00 PM",
  "Sunday: 9:00 AM – 9:00 PM",
].join("\n");

describe("enforceOpeningHours (final mandatory check, runs after every time-shifting step)", () => {
  it("[fixture 5] maps a YYYY-MM-DD local date to the correct weekday regardless of process TZ (2026-10-18 is a Sunday)", () => {
    expect(dateToGoogleWeekdayIndex("2026-10-18")).toBe(6); // Monday-first index: Sunday = 6
    expect(dateToGoogleWeekdayIndex("2026-10-17")).toBe(5); // Saturday
  });

  it("[fixture 9 — exact Barcelona/La Colmena regression] rejects/reschedules a stop scheduled after its own self-reported closing time, even with no backend-verified hours on file", async () => {
    const days = [
      { date: "2026-10-18", destination: "Barcelona", stops: [
        { id: "1", time: "22:00", googlePlaceId: "colmena-1", placeName: "La Colmena", placeCategory: "restaurant",
          description: "Doces tradicionais catalães.", hours: "Domingo: 09:00–21:00" },
      ] },
    ];
    // Deliberately NOT in hoursByPlaceId — this candidate wasn't in the
    // bounded top-N backfill, same as the reported production case; only
    // its own self-reported `hours` field (what the user actually saw) is
    // available.
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx, bedtime: "23:59", isFirstDay: () => false, isLastDay: () => false, requireLunch: false, requireDinner: false,
    });
    const stop = fixed[0].stops.find((s: any) => s.placeName === "La Colmena");
    expect(stop).toBeTruthy();
    expect(stop.time).not.toBe("22:00"); // never left as a confirmed visit past its own stated close
    expect(stop.time).toBe("09:00"); // deterministic reschedule into the stated 09:00–21:00 window
    expect(warnings.some((w: string) => w.includes("Rescheduled") && w.includes("its own displayed opening hours"))).toBe(true);
  });

  it("[fixture 1] rejects/reschedules a visit starting at or after a verified (backend) Sunday 21:00 close", async () => {
    const days = [
      { date: "2026-10-18", destination: "Barcelona", stops: [
        { id: "1", time: "22:00", googlePlaceId: "p1", placeName: "Some Bakery", placeCategory: "restaurant", description: "x" },
      ] },
    ];
    const hoursByPlaceId = new Map([["p1", FULL_WEEK_SUNDAY_9_TO_21]]);
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx, bedtime: "23:59", hoursByPlaceId, isFirstDay: () => false, isLastDay: () => false, requireLunch: false, requireDinner: false,
    });
    const stop = fixed[0].stops.find((s: any) => s.placeName === "Some Bakery");
    expect(stop).toBeTruthy();
    expect(stop.time).not.toBe("22:00");
    expect(warnings.some((w: string) => w.includes("Rescheduled") && w.includes("verified Google Places hours"))).toBe(true);
  });

  it("[fixture 2] catches a visit that starts before closing but whose duration would extend past it (not just a start-time check)", async () => {
    const days = [
      { date: "2026-10-18", destination: "Barcelona", stops: [
        // 20:30 start is itself before 21:00 close, but +75min typical restaurant duration ends at 21:45 — must still be flagged.
        { id: "1", time: "20:30", googlePlaceId: "p1", placeName: "Some Bakery", placeCategory: "restaurant", description: "x" },
      ] },
    ];
    const hoursByPlaceId = new Map([["p1", FULL_WEEK_SUNDAY_9_TO_21]]);
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx, hoursByPlaceId, isFirstDay: () => false, isLastDay: () => false, requireLunch: false, requireDinner: false,
    });
    const stop = fixed[0].stops.find((s: any) => s.placeName === "Some Bakery");
    expect(stop.time).not.toBe("20:30"); // caught even though the START time alone looked fine
    expect(warnings.some((w: string) => w.includes("Bakery"))).toBe(true);
  });

  it("[fixture 3] handles multiple opening intervals in a day (lunch/dinner split)", async () => {
    const hoursByPlaceId = new Map([["p1",
      ["Monday: 9:00 AM – 1:00 PM", "Tuesday: 9:00 AM – 1:00 PM", "Wednesday: 9:00 AM – 1:00 PM", "Thursday: 9:00 AM – 1:00 PM",
       "Friday: 9:00 AM – 1:00 PM", "Saturday: 9:00 AM – 1:00 PM", "Sunday: 9:00 AM – 1:00 PM, 5:00 PM – 9:00 PM"].join("\n"),
    ]]);
    const days = [
      { date: "2026-10-18", destination: "Barcelona", stops: [
        // 3pm falls in the closed gap between the two intervals.
        { id: "1", time: "15:00", googlePlaceId: "p1", placeName: "Split Hours Cafe", placeCategory: "cafe", description: "x" },
      ] },
    ];
    const { days: fixed } = await validateAndCorrectItinerary(days, {
      ...baseCtx, hoursByPlaceId, isFirstDay: () => false, isLastDay: () => false, requireLunch: false, requireDinner: false,
    });
    const stop = fixed[0].stops.find((s: any) => s.placeName === "Split Hours Cafe");
    expect(stop).toBeTruthy();
    const t = timeToMinutes(stop.time)!;
    const inMorning = t >= 9 * 60 && t <= 13 * 60;
    const inEvening = t >= 17 * 60 && t <= 21 * 60;
    expect(inMorning || inEvening).toBe(true); // moved into ONE of the two valid windows, not left in the gap
  });

  it("[fixture 4] removes a stop closed on the requested weekday when no reschedule/move is possible (single-day trip)", async () => {
    const hoursByPlaceId = new Map([["p1",
      ["Monday: 9:00 AM – 6:00 PM", "Tuesday: 9:00 AM – 6:00 PM", "Wednesday: 9:00 AM – 6:00 PM", "Thursday: 9:00 AM – 6:00 PM",
       "Friday: 9:00 AM – 6:00 PM", "Saturday: 9:00 AM – 6:00 PM", "Sunday: Closed"].join("\n"),
    ]]);
    const days = [
      { date: "2026-10-18", destination: "Barcelona", stops: [
        { id: "1", time: "11:00", googlePlaceId: "p1", placeName: "Sunday-Closed Shop", placeCategory: "attraction", description: "x" },
      ] },
    ];
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx, hoursByPlaceId, isFirstDay: () => false, isLastDay: () => false, requireLunch: false, requireDinner: false,
    });
    expect(fixed[0].stops.find((s: any) => s.placeName === "Sunday-Closed Shop")).toBeUndefined();
    expect(warnings.some((w: string) => w.includes("CONFLICT") && w.includes("Sunday-Closed Shop"))).toBe(true);
  });

  it("[fixture 6] correctly fits a visit inside an overnight interval that crosses midnight", async () => {
    const hoursByPlaceId = new Map([["p1",
      ["Monday: 9:00 AM – 6:00 PM", "Tuesday: 9:00 AM – 6:00 PM", "Wednesday: 9:00 AM – 6:00 PM", "Thursday: 9:00 AM – 6:00 PM",
       "Friday: 9:00 AM – 6:00 PM", "Saturday: 10:00 PM – 2:00 AM", "Sunday: 9:00 AM – 6:00 PM"].join("\n"),
    ]]);
    const days = [
      { date: "2026-10-17", destination: "Barcelona", stops: [ // Saturday
        { id: "1", time: "22:30", googlePlaceId: "p1", placeName: "Late Night Bar", placeCategory: "other", description: "x" },
      ] },
    ];
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx, bedtime: "23:59", hoursByPlaceId, isFirstDay: () => false, isLastDay: () => false, requireLunch: false, requireDinner: false,
    });
    const stop = fixed[0].stops.find((s: any) => s.placeName === "Late Night Bar");
    expect(stop).toBeTruthy();
    expect(stop.time).toBe("22:30"); // fits the overnight 22:00–02:00 window — left untouched
    expect(warnings.some((w: string) => w.includes("Late Night Bar"))).toBe(false);
  });

  it("[fixture 7] never blocks or removes a stop when opening-hours data is genuinely unavailable", async () => {
    const days = [
      { date: "2026-10-18", destination: "Barcelona", stops: [
        { id: "1", time: "14:00", googlePlaceId: "unknown-1", placeName: "No Data Place", placeCategory: "attraction", description: "x" },
      ] },
    ];
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx, isFirstDay: () => false, isLastDay: () => false, requireLunch: false, requireDinner: false,
    });
    const stop = fixed[0].stops.find((s: any) => s.placeName === "No Data Place");
    expect(stop).toBeTruthy();
    expect(stop.time).toBe("14:00"); // never touched — unknown hours are never treated as "closed" or "open"
    expect(warnings.some((w: string) => w.includes("No Data Place"))).toBe(false);
  });

  it("[fixture 8] catches a conflict introduced by an EARLIER step (arrival-buffer shift) — the actual root cause of the reported bug", async () => {
    // Originally-proposed time (20:15) is well within the 09:00–21:00 window —
    // an opening-hours check running BEFORE the arrival-buffer shift (the old,
    // buggy ordering) would have passed it. The arrival buffer then pushes the
    // whole day's first stop to 21:30 (arrival 20:00 + 90min buffer), which is
    // now past the 21:00 close — only a check that runs LAST can catch this.
    const hoursByPlaceId = new Map([["p1", FULL_WEEK_SUNDAY_9_TO_21]]);
    const days = [
      { date: "2026-10-18", destination: "Barcelona", stops: [
        { id: "1", time: "20:15", googlePlaceId: "p1", placeName: "Arrival-Day Spot", placeCategory: "restaurant", description: "x" },
      ] },
    ];
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx, hoursByPlaceId, arrivalTime: "20:00", isFirstDay: () => true, isLastDay: () => false, requireLunch: false, requireDinner: false,
    });
    expect(fixed[0].stops.find((s: any) => s.placeName === "Arrival-Day Spot")).toBeUndefined();
    expect(warnings.some((w: string) => w.includes("CONFLICT") && w.includes("Arrival-Day Spot"))).toBe(true);
  });
});

// ─── Deterministic daily summary (backend-only field) ──────────────────────

describe("buildDailySummary", () => {
  it("never invents a place — only mentions stops actually present in the validated day", () => {
    const day = {
      stops: [
        { placeName: "Tower of London", placeCategory: "attraction", stopType: "attraction" },
        { placeName: "A Local Pub", placeCategory: "restaurant", stopType: "restaurant" },
      ],
    };
    const summary = buildDailySummary(day, "moderado", "en");
    expect(summary).toContain("Tower of London");
    expect(summary).not.toContain("London Eye"); // not in this day's stops — must not appear
  });

  it("excludes logistics/accommodation stops from the summary's highlights", () => {
    const day = {
      stops: [
        { placeName: "Earls Court Station", placeCategory: "attraction", stopType: "logistics" },
        { placeName: "British Museum", placeCategory: "museum", stopType: "attraction" },
      ],
    };
    const summary = buildDailySummary(day, "moderado", "en");
    expect(summary).toContain("British Museum");
    expect(summary).not.toContain("Earls Court Station");
  });

  it("returns an empty string for a day with only logistics stops (never a generic repeated filler)", () => {
    const day = { stops: [{ placeName: "Airport", placeCategory: "attraction", stopType: "logistics" }] };
    expect(buildDailySummary(day, "moderado", "en")).toBe("");
  });

  it("[FASE 4 — full pipeline] day.summary is computed AFTER opening-hours enforcement removes a stop — never mentions a stop that didn't survive final validation", async () => {
    const hoursByPlaceId = new Map([["p1",
      ["Monday: 9:00 AM – 6:00 PM", "Tuesday: 9:00 AM – 6:00 PM", "Wednesday: 9:00 AM – 6:00 PM", "Thursday: 9:00 AM – 6:00 PM",
       "Friday: 9:00 AM – 6:00 PM", "Saturday: 9:00 AM – 6:00 PM", "Sunday: Closed"].join("\n"),
    ]]);
    const days = [
      { date: "2026-10-18", destination: "Barcelona", stops: [ // Sunday
        { id: "1", time: "10:00", googlePlaceId: "ok1", placeName: "Sagrada Família", placeCategory: "attraction", description: "x" },
        { id: "2", time: "14:00", googlePlaceId: "p1", placeName: "Sunday-Closed Shop", placeCategory: "attraction", description: "x" },
      ] },
    ];
    const { days: fixed } = await validateAndCorrectItinerary(days, {
      ...baseCtx, hoursByPlaceId, isFirstDay: () => false, isLastDay: () => false, requireLunch: false, requireDinner: false,
    });
    expect(fixed[0].stops.some((s: any) => s.placeName === "Sunday-Closed Shop")).toBe(false); // removed by opening-hours enforcement
    expect(fixed[0].summary).toContain("Sagrada Família");
    expect(fixed[0].summary).not.toContain("Sunday-Closed Shop"); // the summary must reflect the FINAL schedule, not the LLM's original proposal
  });
});

// ─── Restaurant/cuisine diversity in ranking ────────────────────────────────

describe("diversifyRestaurantLikeOrder", () => {
  it("spreads out a dominant cuisine cluster instead of letting it occupy every top slot", () => {
    const ranked: (ScorableCandidate & { category?: string; cuisine?: string })[] = [
      { name: "Thai A", placeId: "t1", userRatingsTotal: 9000, types: ["restaurant"], category: "restaurant", cuisine: "thai" },
      { name: "Thai B", placeId: "t2", userRatingsTotal: 8000, types: ["restaurant"], category: "restaurant", cuisine: "thai" },
      { name: "Thai C", placeId: "t3", userRatingsTotal: 7000, types: ["restaurant"], category: "restaurant", cuisine: "thai" },
      { name: "Traditional Pub", placeId: "p1", userRatingsTotal: 500, types: ["bar"], category: "restaurant", cuisine: "british_pub" },
    ];
    const diversified = diversifyRestaurantLikeOrder(ranked);
    const pubIndex = diversified.findIndex((c) => c.placeId === "p1");
    expect(pubIndex).toBeLessThan(3); // no longer stuck behind every single Thai option
  });

  it("leaves non-restaurant candidates in their original rank position untouched", () => {
    const ranked: (ScorableCandidate & { category?: string })[] = [
      { name: "Museum", placeId: "m1", userRatingsTotal: 100, types: ["museum"], category: "attraction" },
      { name: "Thai A", placeId: "t1", userRatingsTotal: 9000, types: ["restaurant"], category: "restaurant" },
      { name: "Thai B", placeId: "t2", userRatingsTotal: 8000, types: ["restaurant"], category: "restaurant" },
      { name: "Pub", placeId: "p1", userRatingsTotal: 500, types: ["bar"], category: "restaurant" },
    ];
    const diversified = diversifyRestaurantLikeOrder(ranked);
    expect(diversified[0].placeId).toBe("m1"); // untouched — not a restaurant-like slot
  });
});

// ─── Final chronological ordering (regression: real 3-day test produced day 1
// with stops at 15:30, 18:30, 10:00, 10:00, 21:30 — out of order) ────────────
// Root cause: enforceOpeningHours' same-day reschedule branch changes a
// stop's `.time` to fit an earlier open gap, but never re-sorted `day.stops`
// afterward (unlike its own tryMoveToAnotherDay branch and the must-visit/
// meal-insertion steps, which already did). Fixed with one final
// chronological sort after every time-mutating step.

const NARROW_MORNING_HOURS = [
  "Monday: 10:00 AM – 11:30 AM", "Tuesday: 10:00 AM – 11:30 AM", "Wednesday: 10:00 AM – 11:30 AM",
  "Thursday: 10:00 AM – 11:30 AM", "Friday: 10:00 AM – 11:30 AM", "Saturday: 10:00 AM – 11:30 AM",
  "Sunday: 10:00 AM – 11:30 AM",
].join("\n");

function expectChronological(stops: any[]) {
  const times = stops.map((s) => timeToMinutes(s.time)!);
  for (let i = 0; i < times.length - 1; i++) {
    expect(times[i]).toBeLessThanOrEqual(times[i + 1]);
  }
}

describe("validateAndCorrectItinerary — final chronological re-sort", () => {
  it("[regression] re-sorts a stop that enforceOpeningHours rescheduled to an earlier time than its original array neighbors", async () => {
    const hoursByPlaceId = new Map([["p3", NARROW_MORNING_HOURS]]);
    const days = [
      { date: "2026-10-18", destination: "Barcelona", stops: [ // Sunday
        { id: "1", time: "09:05", googlePlaceId: "p1", placeName: "Midmorning Museum", placeCategory: "museum", description: "x" },
        { id: "2", time: "14:00", googlePlaceId: "p2", placeName: "Afternoon Walk", placeCategory: "attraction", description: "x" },
        // Scheduled for 20:00, but only open 10:00-11:30 — enforceOpeningHours
        // must reschedule it earlier than BOTH stops above, even though it's
        // last in the original (pre-fix) array order.
        { id: "3", time: "20:00", googlePlaceId: "p3", placeName: "Evening-Scheduled Morning Spot", placeCategory: "restaurant", description: "x" },
      ] },
    ];
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx, hoursByPlaceId, isFirstDay: () => false, isLastDay: () => false, requireLunch: false, requireDinner: false,
    });

    const stop = fixed[0].stops.find((s: any) => s.placeName === "Evening-Scheduled Morning Spot");
    expect(stop).toBeTruthy();
    expect(stop.time).not.toBe("20:00"); // confirms the reschedule actually happened
    expect(warnings.some((w: string) => w.includes("Rescheduled") && w.includes("Evening-Scheduled Morning Spot"))).toBe(true);

    // The actual regression: the rescheduled stop must end up in the RIGHT
    // array position, not just have the right `.time` while still sitting
    // at its old (now wrong) index.
    expectChronological(fixed[0].stops);
    expect(fixed[0].stops[fixed[0].stops.length - 1].placeName).not.toBe("Evening-Scheduled Morning Spot");
  });

  it("[regression] stays chronological even when must-visit insertion, fallback meal insertion, and an hours reschedule all happen on the same day", async () => {
    const hoursByPlaceId = new Map([["p3", NARROW_MORNING_HOURS]]);
    const days = [
      { date: "2026-10-18", destination: "Barcelona", stops: [
        { id: "1", time: "09:00", googlePlaceId: "p1", placeName: "Morning Stop", placeCategory: "attraction", description: "x" },
        { id: "2", time: "16:00", googlePlaceId: "p2", placeName: "Late Afternoon Stop", placeCategory: "attraction", description: "x" },
        { id: "3", time: "20:30", googlePlaceId: "p3", placeName: "Evening-Scheduled Morning Spot", placeCategory: "restaurant", description: "x" },
      ] },
    ];
    const { days: fixed } = await validateAndCorrectItinerary(days, {
      ...baseCtx,
      hoursByPlaceId,
      isFirstDay: () => false,
      isLastDay: () => false,
      requireLunch: true,
      requireDinner: false,
      mustVisit: [{ name: "Must-See Landmark", category: "attraction", lat: 41.38, lng: 2.17 }],
      fillerRestaurants: [{ googlePlaceId: "filler-1", name: "Fallback Bistro", lat: 41.38, lng: 2.17 }],
    });

    const names = fixed[0].stops.map((s: any) => s.placeName);
    expect(names).toContain("Must-See Landmark");
    expect(names).toContain("Fallback Bistro");
    expectChronological(fixed[0].stops);
  });

  it("preserves each day's own date/destination — stops only ever reorder WITHIN their day, days don't get relabeled", async () => {
    const days = [
      { date: "2026-10-18", destination: "Barcelona", dayNumber: 1, stops: [
        { id: "1", time: "18:00", googlePlaceId: "p1", placeName: "A", placeCategory: "attraction", description: "x" },
        { id: "2", time: "09:00", googlePlaceId: "p2", placeName: "B", placeCategory: "attraction", description: "x" },
      ] },
      { date: "2026-10-19", destination: "Barcelona", dayNumber: 2, stops: [
        { id: "3", time: "10:00", googlePlaceId: "p3", placeName: "C", placeCategory: "attraction", description: "x" },
      ] },
    ];
    const { days: fixed } = await validateAndCorrectItinerary(days, {
      ...baseCtx, isFirstDay: () => false, isLastDay: () => false, requireLunch: false, requireDinner: false,
    });
    expect(fixed[0].date).toBe("2026-10-18");
    expect(fixed[0].dayNumber).toBe(1);
    expect(fixed[0].stops.map((s: any) => s.placeName)).toEqual(["B", "A"]); // re-sorted within day 1 only
    expect(fixed[1].date).toBe("2026-10-19");
    expect(fixed[1].stops.map((s: any) => s.placeName)).toEqual(["C"]);
  });
});

// ─── findEmptyDays — "zero stops is never a successful generation" guard ────

describe("findEmptyDays", () => {
  it("returns an empty list when every day has at least one stop", () => {
    const days = [{ dayNumber: 1, stops: [{ placeName: "X" }] }, { dayNumber: 2, stops: [{ placeName: "Y" }] }];
    expect(findEmptyDays(days)).toEqual([]);
  });

  it("flags a day whose stops array is empty", () => {
    const days = [{ dayNumber: 1, stops: [{ placeName: "X" }] }, { dayNumber: 2, stops: [] }];
    expect(findEmptyDays(days)).toEqual([2]);
  });

  it("flags a day with a missing/malformed stops field the same as an empty array", () => {
    const days = [{ dayNumber: 1, stops: undefined }];
    expect(findEmptyDays(days)).toEqual([1]);
  });

  it("falls back to the 1-based array index when dayNumber is absent", () => {
    const days = [{ stops: [{ placeName: "X" }] }, { stops: [] }];
    expect(findEmptyDays(days)).toEqual([2]);
  });

  it("[integration] a stop that can never fit (closed all week, no other day to move to) leaves its day empty, and findEmptyDays catches it", async () => {
    const ALWAYS_CLOSED = Array(7).fill("Closed").map((c, i) => `Day${i}: ${c}`).join("\n");
    const hoursByPlaceId = new Map([["p1", ALWAYS_CLOSED]]);
    const days = [
      { date: "2026-10-18", destination: "Barcelona", dayNumber: 1, stops: [
        { id: "1", time: "11:00", googlePlaceId: "p1", placeName: "Always Closed Shop", placeCategory: "attraction", description: "x" },
      ] },
    ];
    const { days: fixed } = await validateAndCorrectItinerary(days, {
      ...baseCtx, hoursByPlaceId, isFirstDay: () => true, isLastDay: () => true, requireLunch: false, requireDinner: false,
    });
    expect(findEmptyDays(fixed)).toEqual([1]);
  });
});
