import { describe, it, expect } from "vitest";
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
        { id: "1", time: "10:00", placeId: "p1", placeName: "Louvre", placeCategory: "museum" },
        { id: "2", time: "16:00", placeId: "p1", placeName: "Louvre", placeCategory: "museum" },
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
        { id: "1", time: "15:10", placeId: "p1", placeName: "Eiffel Tower", placeCategory: "attraction" },
      ] },
    ];
    const { days: fixed } = await validateAndCorrectItinerary(days, { ...baseCtx, isLastDay: () => false, requireLunch: false, requireDinner: false });
    // arrival 15:00 + 90min buffer = 16:30
    expect(timeToMinutes(fixed[0].stops[0].time)).toBeGreaterThanOrEqual(timeToMinutes("16:30")!);
  });

  it("drops a trailing stop that would run past the departure buffer", async () => {
    const days = [
      { date: "2026-09-14", destination: "Paris", stops: [
        { id: "1", time: "10:00", placeId: "p1", placeName: "Museum", placeCategory: "museum" },
        { id: "2", time: "16:30", placeId: "p2", placeName: "Late Add-on", placeCategory: "attraction" },
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
        { id: "1", time: "10:00", placeId: "p1", placeName: "Some Cafe", placeCategory: "cafe" },
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
        { id: "1", time: "10:00", placeId: "p1", placeName: "Museum", placeCategory: "museum" },
        { id: "2", time: "16:00", placeId: "p2", placeName: "Park", placeCategory: "attraction" },
      ] },
    ];
    const { days: fixed, warnings } = await validateAndCorrectItinerary(days, {
      ...baseCtx,
      isFirstDay: () => false,
      isLastDay: () => false,
      requireDinner: false,
      fillerRestaurants: [{ placeId: "r1", name: "Bistro X", lat: 48.85, lng: 2.35 }],
    });
    const lunchStop = fixed[0].stops.find((s: any) => s.placeCategory === "restaurant");
    expect(lunchStop?.placeName).toBe("Bistro X");
    expect(warnings.some((w) => w.includes("Inserted fallback lunch"))).toBe(true);
  });

  it("never drops meals to satisfy an intense pace — lunch and dinner both survive a packed schedule", async () => {
    const days = [
      { date: "2026-09-14", destination: "Paris", stops: [
        { id: "1", time: "09:00", placeId: "p1", placeName: "Museum 1", placeCategory: "museum" },
        { id: "2", time: "13:00", placeId: "p2", placeName: "Lunch Spot", placeCategory: "restaurant" },
        { id: "3", time: "15:00", placeId: "p3", placeName: "Museum 2", placeCategory: "museum" },
        { id: "4", time: "20:00", placeId: "p4", placeName: "Dinner Spot", placeCategory: "restaurant" },
      ] },
    ];
    const { days: fixed } = await validateAndCorrectItinerary(days, { ...baseCtx, isFirstDay: () => false, isLastDay: () => false });
    const categories = fixed[0].stops.map((s: any) => s.placeCategory);
    expect(categories.filter((c: string) => c === "restaurant")).toHaveLength(2);
  });
});
