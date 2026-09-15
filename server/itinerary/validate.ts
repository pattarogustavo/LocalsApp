/**
 * Deterministic GENERATE → VALIDATE → CORRECT layer for AI-generated
 * itineraries. Runs entirely in code (no extra LLM call) against the exact
 * same `days`/`stops` shape the UI already consumes (types/voyage.ts
 * DayItinerary/ItineraryStop) — it only ever reorders, shifts times on,
 * drops, or inserts stops using data already available server-side (real
 * Google Places/Directions data, or the user's own selected places).
 *
 * Constraint priority implemented here (Level 1 hard constraints always win):
 *   1) Hard: opening hours, must-visit inclusion, exclusions, meal presence,
 *      wake/bed bounds, arrival/departure buffers, no duplicates/overlaps.
 *   2) Soft: everything else (left to the LLM's own ordering/selection).
 *
 * A hard-constraint fix is always a *targeted* edit (shift, drop, insert one
 * stop) — never a full regeneration — keeping this a cheap, deterministic
 * pass rather than a second expensive LLM call.
 */

import { estimateDurationRange, estimateMealDurationRange } from "./duration";

// ─── Time helpers (pure arithmetic, no Date object — avoids timezone bugs) ──

export function timeToMinutes(hhmm: string | undefined): number | null {
  if (!hhmm) return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return ((h * 60 + min) % 1440 + 1440) % 1440;
}

export function minutesToTime(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Minutes from `a` to `b`, treating `b` as later in the same "day span" (wraps past midnight for late bedtimes). */
export function minutesBetween(a: string | undefined, b: string | undefined): number | null {
  const am = timeToMinutes(a);
  const bm = timeToMinutes(b);
  if (am == null || bm == null) return null;
  let diff = bm - am;
  if (diff < 0) diff += 1440;
  return diff;
}

export function parseTravelMinutes(travelTimeToNext: string | undefined): number {
  if (!travelTimeToNext) return 0;
  const hMatch = travelTimeToNext.match(/(\d+)\s*h/i);
  const mMatch = travelTimeToNext.match(/(\d+)\s*min/i);
  return (hMatch ? parseInt(hMatch[1], 10) * 60 : 0) + (mMatch ? parseInt(mMatch[1], 10) : 0);
}

// ─── Opening-hours parsing (best-effort; skip silently if unparsable) ───────

const CLOSED_WORDS = /closed|fechado|cerrado|chiuso|geschlossen|fermé/i;

/**
 * Parses a Google Places `opening_hours.weekday_text` block (7 lines,
 * Monday-first) into {open, close} minute-of-day per weekday. Any line that
 * doesn't clearly contain two time tokens is left `undefined` (unknown) —
 * never guessed — so the caller must treat "unknown" as "can't validate,
 * don't block on it", per the no-hallucination requirement.
 */
export function parseWeekdayHours(weekdayText: string | undefined): (null | { open: number; close: number })[] {
  const result: (null | { open: number; close: number } | undefined)[] = new Array(7).fill(undefined);
  if (!weekdayText) return result as any;
  const lines = weekdayText.split("\n").filter(Boolean);
  lines.forEach((line, idx) => {
    if (idx > 6) return;
    if (CLOSED_WORDS.test(line)) {
      result[idx] = null; // explicitly closed
      return;
    }
    const timeTokens = [...line.matchAll(/(\d{1,2}):(\d{2})\s*(AM|PM)?/gi)];
    if (timeTokens.length < 2) return; // unparsable — leave as unknown
    const toMinutes = (h: number, m: number, ampm?: string) => {
      let hour = h;
      if (ampm) {
        const isPM = ampm.toUpperCase() === "PM";
        if (isPM && hour !== 12) hour += 12;
        if (!isPM && hour === 12) hour = 0;
      }
      return hour * 60 + m;
    };
    const open = toMinutes(parseInt(timeTokens[0][1], 10), parseInt(timeTokens[0][2], 10), timeTokens[0][3]);
    const close = toMinutes(parseInt(timeTokens[1][1], 10), parseInt(timeTokens[1][2], 10), timeTokens[1][3]);
    result[idx] = { open, close };
  });
  return result as any;
}

/** Maps a YYYY-MM-DD date string to Google's Monday-first weekday index (0=Mon..6=Sun). */
export function dateToGoogleWeekdayIndex(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const jsDay = d.getDay(); // 0=Sun..6=Sat
  return (jsDay + 6) % 7;
}

// ─── Validation context / types ─────────────────────────────────────────────

export interface MustVisitPlace {
  name: string;
  googlePlaceId?: string;
  category?: string;
  address?: string;
  lat?: number;
  lng?: number;
  hours?: string; // weekday_text block, if known
}

export interface FillerRestaurantCandidate {
  googlePlaceId: string;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export interface ValidateContext {
  wakeUpTime: string;
  bedtime: string;
  arrivalTime: string;
  departureTime: string;
  isFirstDay: (dayIndex: number) => boolean;
  isLastDay: (dayIndex: number) => boolean;
  avoidText?: string;
  mustVisit: MustVisitPlace[];
  requireLunch: boolean;
  requireDinner: boolean;
  lunchMode?: "quick" | "restaurant" | "none";
  dinnerMode?: "quick" | "restaurant" | "none";
  /** Opening hours text (weekday_text), keyed by googlePlaceId, for real AI-picked candidates. */
  hoursByPlaceId: Map<string, string>;
  /** Small pool of real, unused restaurant candidates to insert if a required meal is missing. */
  fillerRestaurants: FillerRestaurantCandidate[];
  /** Real travel-time lookup, reusing the app's existing Google Directions integration. */
  fetchTravel?: (originLat: number, originLng: number, destLat: number, destLng: number) => Promise<{ durationText: string; durationMinutes: number; mode: "walking" | "driving" | "transit"; mapsUrl: string } | null>;
}

export interface ValidationResult {
  days: any[];
  warnings: string[];
}

const ARRIVAL_BUFFER_MIN = 90;
const DEPARTURE_BUFFER_MIN = 120;

function isMeal(stop: any, windowStart: number, windowEnd: number): boolean {
  const t = timeToMinutes(stop.time);
  if (t == null) return false;
  const category = (stop.placeCategory || "").toLowerCase();
  const isFoodCategory = category === "restaurant" || category === "cafe";
  return isFoodCategory && t >= windowStart && t < windowEnd;
}

function matchesAvoid(stop: any, avoidText: string | undefined): boolean {
  if (!avoidText) return false;
  const normalized = avoidText.toLowerCase();
  const name = (stop.placeName || "").toLowerCase();
  const terms = normalized.split(/[,.;\n]/).map((t) => t.trim()).filter((t) => t.length >= 3);
  return terms.some((term) => name.includes(term));
}

/**
 * Runs the full validate → correct pass over the LLM's parsed `days` output.
 * Mutates a deep-cloned copy; the original parsed object is left untouched.
 */
export async function validateAndCorrectItinerary(
  rawDays: any[],
  ctx: ValidateContext,
): Promise<ValidationResult> {
  const warnings: string[] = [];
  const days: any[] = JSON.parse(JSON.stringify(rawDays || []));

  // ── 1) Sort stops chronologically within each day ─────────────────────────
  for (const day of days) {
    if (Array.isArray(day.stops)) {
      day.stops.sort((a: any, b: any) => (timeToMinutes(a.time) ?? 0) - (timeToMinutes(b.time) ?? 0));
    } else {
      day.stops = [];
    }
  }

  // ── 2) Drop duplicates across the whole trip (same googlePlaceId or same name) ──
  const seenKeys = new Set<string>();
  for (const day of days) {
    day.stops = day.stops.filter((stop: any) => {
      const key = (stop.googlePlaceId || stop.placeName || "").toLowerCase();
      if (!key) return true;
      if (seenKeys.has(key)) {
        warnings.push(`Removed duplicate stop "${stop.placeName}"`);
        return false;
      }
      seenKeys.add(key);
      return true;
    });
  }

  // ── 3) Defense-in-depth: drop anything matching the avoid list ────────────
  for (const day of days) {
    day.stops = day.stops.filter((stop: any) => {
      if (matchesAvoid(stop, ctx.avoidText)) {
        warnings.push(`Removed excluded stop "${stop.placeName}" (matched avoid list)`);
        return false;
      }
      return true;
    });
  }

  // ── 4) Opening-hours hard constraint (best-effort; skip if unparsable) ────
  for (const day of days) {
    const weekdayIdx = dateToGoogleWeekdayIndex(day.date);
    day.stops = day.stops.filter((stop: any) => {
      const hoursText = stop.googlePlaceId ? ctx.hoursByPlaceId.get(stop.googlePlaceId) : undefined;
      if (!hoursText || weekdayIdx == null) return true;
      const perWeekday = parseWeekdayHours(hoursText);
      const today = perWeekday[weekdayIdx];
      if (today === undefined) return true; // unparsable — don't block on it
      if (today === null) {
        warnings.push(`Removed "${stop.placeName}" — closed on this weekday`);
        return false;
      }
      const t = timeToMinutes(stop.time);
      if (t == null) return true;
      // Allow entry up to close time (last admission isn't separately known).
      if (t < today.open || t > today.close) {
        warnings.push(`Removed "${stop.placeName}" — scheduled outside known opening hours`);
        return false;
      }
      return true;
    });
  }

  // ── 5) Must-visit hard inclusion ───────────────────────────────────────────
  const allStopKeys = () => {
    const keys = new Set<string>();
    for (const day of days) {
      for (const stop of day.stops) {
        if (stop.googlePlaceId) keys.add(String(stop.googlePlaceId).toLowerCase());
        if (stop.placeName) keys.add(String(stop.placeName).toLowerCase());
      }
    }
    return keys;
  };

  for (const must of ctx.mustVisit) {
    const present = allStopKeys();
    const key1 = must.googlePlaceId?.toLowerCase();
    const key2 = must.name.toLowerCase();
    if ((key1 && present.has(key1)) || present.has(key2)) continue;

    // Not present — insert into the day with the most free time, at the
    // largest available gap, respecting wake-up/bedtime bounds.
    const durationRange = estimateDurationRange(must.category, undefined);
    let bestDay = -1, bestGapStart = -1, bestGapSize = -1;
    days.forEach((day, dIdx) => {
      const dayWake = ctx.isFirstDay(dIdx) ? (timeToMinutes(ctx.arrivalTime) ?? 0) + ARRIVAL_BUFFER_MIN : (timeToMinutes(ctx.wakeUpTime) ?? 480);
      const dayBed = ctx.isLastDay(dIdx) ? (timeToMinutes(ctx.departureTime) ?? 1080) - DEPARTURE_BUFFER_MIN : (timeToMinutes(ctx.bedtime) ?? 1380);
      const times = [dayWake, ...day.stops.map((s: any) => timeToMinutes(s.time) ?? dayWake), dayBed];
      for (let i = 0; i < times.length - 1; i++) {
        const gap = times[i + 1] - times[i];
        if (gap > bestGapSize) {
          bestGapSize = gap;
          bestGapStart = times[i];
          bestDay = dIdx;
        }
      }
    });

    if (bestDay >= 0 && bestGapSize >= durationRange.minMinutes) {
      const insertTime = minutesToTime(bestGapStart + 15);
      days[bestDay].stops.push({
        id: `must-${must.googlePlaceId || must.name}`.slice(0, 60),
        time: insertTime,
        googlePlaceId: must.googlePlaceId,
        placeName: must.name,
        placeCategory: must.category || "attraction",
        address: must.address,
        lat: must.lat,
        lng: must.lng,
        hours: must.hours,
      });
      days[bestDay].stops.sort((a: any, b: any) => (timeToMinutes(a.time) ?? 0) - (timeToMinutes(b.time) ?? 0));
      warnings.push(`Inserted missing must-visit place "${must.name}" into day ${bestDay + 1}`);
    } else {
      warnings.push(`CONFLICT: could not fit must-visit place "${must.name}" into any day within available time`);
    }
  }

  // ── 6) Required meals must be present ──────────────────────────────────────
  const insertMealIfMissing = (windowStart: number, windowEnd: number, insertAt: number, label: string) => {
    days.forEach((day, dIdx) => {
      if (day.stops.some((s: any) => isMeal(s, windowStart, windowEnd))) return;
      const filler = ctx.fillerRestaurants.find((r) => !allStopKeys().has(r.googlePlaceId.toLowerCase()));
      if (!filler) {
        warnings.push(`Missing ${label} on day ${dIdx + 1} — no fallback restaurant candidate available`);
        return;
      }
      // Only fits if the day actually has room — check nearest neighbors don't collide within the meal duration.
      const mealDuration = estimateMealDurationRange(label === "lunch" ? ctx.lunchMode : ctx.dinnerMode).typicalMinutes;
      const time = minutesToTime(insertAt);
      const conflicting = day.stops.some((s: any) => {
        const diff = Math.abs((timeToMinutes(s.time) ?? 0) - insertAt);
        return diff < mealDuration / 2;
      });
      if (conflicting) {
        warnings.push(`Missing ${label} on day ${dIdx + 1} — no free slot to insert a fallback`);
        return;
      }
      day.stops.push({
        id: `${label}-${filler.googlePlaceId}`,
        time,
        googlePlaceId: filler.googlePlaceId,
        placeName: filler.name,
        placeCategory: "restaurant",
        address: filler.address,
        lat: filler.lat,
        lng: filler.lng,
      });
      day.stops.sort((a: any, b: any) => (timeToMinutes(a.time) ?? 0) - (timeToMinutes(b.time) ?? 0));
      warnings.push(`Inserted fallback ${label} "${filler.name}" on day ${dIdx + 1}`);
    });
  };

  if (ctx.requireLunch && ctx.lunchMode !== "none") insertMealIfMissing(12 * 60, 14 * 60 + 30, 13 * 60, "lunch");
  if (ctx.requireDinner && ctx.dinnerMode !== "none") insertMealIfMissing(19 * 60, 21 * 60 + 30, 20 * 60, "dinner");

  // ── 7) Arrival/departure logistics + wake/bed bounds ────────────────────────
  days.forEach((day, dIdx) => {
    if (day.stops.length === 0) return;
    const minStart = ctx.isFirstDay(dIdx)
      ? (timeToMinutes(ctx.arrivalTime) ?? 0) + ARRIVAL_BUFFER_MIN
      : timeToMinutes(ctx.wakeUpTime) ?? 480;
    const maxEnd = ctx.isLastDay(dIdx)
      ? (timeToMinutes(ctx.departureTime) ?? 1080) - DEPARTURE_BUFFER_MIN
      : timeToMinutes(ctx.bedtime) ?? 1380;

    const firstStart = timeToMinutes(day.stops[0].time) ?? minStart;
    if (firstStart < minStart) {
      const shift = minStart - firstStart;
      day.stops.forEach((s: any) => {
        const t = timeToMinutes(s.time);
        if (t != null) s.time = minutesToTime(t + shift);
      });
      warnings.push(`Shifted day ${dIdx + 1} stops later by ${shift}min to respect arrival/wake-up buffer`);
    }

    // Drop trailing stops (lowest priority: last chronologically) that can't fit before maxEnd.
    while (day.stops.length > 0) {
      const last = day.stops[day.stops.length - 1];
      const lastStart = timeToMinutes(last.time) ?? 0;
      const dur = estimateDurationRange(last.placeCategory).typicalMinutes;
      if (lastStart + dur > maxEnd) {
        warnings.push(`Removed "${last.placeName}" from day ${dIdx + 1} — did not fit before departure/bedtime`);
        day.stops.pop();
      } else {
        break;
      }
    }
  });

  // ── 8) Duration realism: push back stops compressed unrealistically ────────
  days.forEach((day, dIdx) => {
    const maxEnd = ctx.isLastDay(dIdx)
      ? (timeToMinutes(ctx.departureTime) ?? 1080) - DEPARTURE_BUFFER_MIN
      : timeToMinutes(ctx.bedtime) ?? 1380;
    for (let i = 0; i < day.stops.length - 1; i++) {
      const cur = day.stops[i];
      const next = day.stops[i + 1];
      const gap = minutesBetween(cur.time, next.time);
      if (gap == null) continue;
      const travel = parseTravelMinutes(cur.travelTimeToNext);
      const implied = gap - travel;
      const range = estimateDurationRange(cur.placeCategory);
      if (implied < range.minMinutes * 0.5) {
        const deficit = Math.round(range.minMinutes * 0.75) - implied;
        for (let j = i + 1; j < day.stops.length; j++) {
          const t = timeToMinutes(day.stops[j].time);
          if (t != null) day.stops[j].time = minutesToTime(Math.min(t + deficit, maxEnd));
        }
        warnings.push(`Adjusted timing after "${cur.placeName}" on day ${dIdx + 1} — original duration was unrealistically short`);
      }
    }
  });

  // ── 9) Real travel time between consecutive stops (replaces LLM guesses) ───
  if (ctx.fetchTravel) {
    for (const day of days) {
      for (let i = 0; i < day.stops.length - 1; i++) {
        const cur = day.stops[i];
        const next = day.stops[i + 1];
        if (cur.lat == null || cur.lng == null || next.lat == null || next.lng == null) continue;
        const result = await ctx.fetchTravel(cur.lat, cur.lng, next.lat, next.lng);
        if (result) {
          cur.travelTimeToNext = result.durationText;
          cur.travelModeToNext = result.mode;
          cur.mapsUrlToNext = result.mapsUrl;
        }
      }
    }
  }

  return { days, warnings };
}
