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
  /** Traveler pace — fed into estimateDurationRange's personalization (duration.ts) so a "relaxado" trip's fit/realism checks use correspondingly longer expected durations, instead of the flat generic table. */
  pace?: "relaxado" | "moderado" | "intenso";
  /** Opening hours text (weekday_text), keyed by googlePlaceId, for real AI-picked candidates. */
  hoursByPlaceId: Map<string, string>;
  /** Small pool of real, unused restaurant candidates to insert if a required meal is missing. */
  fillerRestaurants: FillerRestaurantCandidate[];
  /** Real travel-time lookup, reusing the app's existing Google Directions integration. */
  fetchTravel?: (originLat: number, originLng: number, destLat: number, destLng: number) => Promise<{ durationText: string; durationMinutes: number; mode: "walking" | "driving" | "transit"; mapsUrl: string } | null>;
  /** The traveler's own accommodation, when known — used to classify a stop that's actually just "where I'm staying" as logistics rather than an unexplained recommendation. */
  accommodation?: { name?: string; address?: string; placeId?: string };
  /** BCP-47-ish app language code (e.g. "pt", "en", "es"), for generated fallback copy (never for scheduling logic). Defaults to "pt". */
  language?: string;
}

export interface ValidationResult {
  days: any[];
  warnings: string[];
}

const ARRIVAL_BUFFER_MIN = 90;
const DEPARTURE_BUFFER_MIN = 120;

/**
 * `\b` in JS regex only recognizes ASCII word chars, so it silently fails
 * around accented letters (e.g. "à tarde", "manhã") — this builds an
 * accent-safe word-boundary pattern instead, using Unicode property escapes.
 */
function buildTimeHintPattern(alternatives: string[]): RegExp {
  const boundary = "(?<![\\p{L}\\p{N}_])";
  const boundaryEnd = "(?![\\p{L}\\p{N}_])";
  return new RegExp(`${boundary}(?:${alternatives.join("|")})${boundaryEnd}`, "iu");
}

/**
 * Time-of-day keywords (across the app's supported languages: pt/en/es/fr/de/it)
 * that a stop's own AI-written description might use to recommend a specific
 * window — paired with a conservative, season/latitude-agnostic minute range.
 * Checked in order; the first pattern to match a description wins.
 */
const TIME_OF_DAY_HINTS: { label: string; min: number; max: number; pattern: RegExp }[] = [
  {
    label: "sunset/entardecer",
    min: 16 * 60,
    max: 21 * 60,
    pattern: buildTimeHintPattern([
      "entardecer",
      "p[oô]r[\\s-]do[\\s-]sol",
      "sunset",
      "dusk",
      "atardecer",
      "puesta de sol",
      "coucher du soleil",
      "tramonto",
      "sonnenuntergang",
    ]),
  },
  {
    label: "morning/manhã",
    min: 5 * 60,
    max: 12 * 60,
    pattern: buildTimeHintPattern([
      "de manh[ãa]",
      "pela manh[ãa]",
      "manh[ãa] cedo",
      "in the morning",
      "early morning",
      "por la ma[nñ]ana",
      "en la ma[nñ]ana",
      "temprano en la ma[nñ]ana",
      "le matin",
      "au petit matin",
      "di mattina",
      "al mattino",
      "presto al mattino",
      "am morgen",
      "fr[uü]h am morgen",
    ]),
  },
  {
    label: "afternoon/tarde",
    min: 12 * 60,
    max: 18 * 60 + 30,
    pattern: buildTimeHintPattern([
      "[àa] tarde",
      "de tarde",
      "pela tarde",
      "in the afternoon",
      "por la tarde",
      "en la tarde",
      "l'apr[eè]s-midi",
      "nel pomeriggio",
      "di pomeriggio",
      "am nachmittag",
    ]),
  },
  {
    label: "evening/night",
    min: 18 * 60,
    max: 23 * 60 + 59,
    pattern: buildTimeHintPattern([
      "[àa] noite",
      "de noite",
      "pela noite",
      "in the evening",
      "at night",
      "por la noche",
      "en la noche",
      "le soir",
      "la nuit",
      "di sera",
      "di notte",
      "am abend",
      "in der nacht",
    ]),
  },
];

function isMeal(stop: any, windowStart: number, windowEnd: number): boolean {
  const t = timeToMinutes(stop.time);
  if (t == null) return false;
  const category = (stop.placeCategory || "").toLowerCase();
  const isFoodCategory = category === "restaurant" || category === "cafe";
  return isFoodCategory && t >= windowStart && t < windowEnd;
}

// ─── Stop classification (logistics/accommodation vs. a real recommendation) ─

export type StopType = "attraction" | "restaurant" | "accommodation" | "logistics";

/**
 * Keywords (across pt/en/es/fr/de/it) for stations/airports/transit hubs that
 * sometimes get listed as a "stop" (e.g. the airport/station a traveler
 * arrives through) without actually being a place to visit. Matched against
 * the stop's own name — never against unrelated candidate data — so a place
 * that's genuinely named e.g. "Estação da Luz Museum" isn't mis-tagged by a
 * single keyword alone (the regex requires the transit word to be the
 * dominant noun, i.e. appear right after/before the place name boundary).
 */
const TRANSIT_HUB_PATTERN = /\b(station|estação|estacion|gare|bahnhof|stazione|airport|aeroporto|aeropuerto|flughafen|aeroporto|rodoviária|rodoviaria|bus terminal|terminal rodoviário|metro\s*stop|subway\s*stop)\b/i;

function normalizeForMatch(s: string | undefined): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/**
 * Classifies a stop as a real recommendation (attraction/restaurant) or a
 * purely logistical reference (the traveler's own hotel, or a station/
 * airport listed only because it's where the day starts/ends) — so the UI
 * never has to guess from an icon alone whether a stop is "come visit this"
 * or "this is just where you're staying/arriving".
 */
export function classifyStopType(
  stop: any,
  accommodation: { name?: string; address?: string; placeId?: string } | undefined,
): StopType {
  const stopKey = normalizeForMatch(stop.placeName);
  const stopAddr = normalizeForMatch(stop.address);

  if (accommodation) {
    const accPlaceId = accommodation.placeId;
    const accName = normalizeForMatch(accommodation.name);
    const accAddr = normalizeForMatch(accommodation.address);
    if (
      (accPlaceId && stop.googlePlaceId && accPlaceId === stop.googlePlaceId) ||
      (accName && accName.length >= 4 && (stopKey.includes(accName) || accName.includes(stopKey))) ||
      (accAddr && accAddr.length >= 6 && stopAddr && (stopAddr.includes(accAddr) || accAddr.includes(stopAddr)))
    ) {
      return "accommodation";
    }
  }

  if (TRANSIT_HUB_PATTERN.test(stop.placeName || "")) return "logistics";

  const category = (stop.placeCategory || "").toLowerCase();
  if (category === "restaurant" || category === "cafe") return "restaurant";
  return "attraction";
}

const LOGISTICS_FALLBACK_DESCRIPTION: Record<string, (name: string) => string> = {
  pt: (name) => `Referência logística do dia (${name}) — não é uma recomendação de visita, apenas o ponto de partida/chegada considerado no planejamento do deslocamento.`,
  en: (name) => `Logistical reference for the day (${name}) — not a recommendation to visit, just the start/end point used to plan travel time.`,
  es: (name) => `Referencia logística del día (${name}) — no es una recomendación para visitar, solo el punto de partida/llegada usado para planear el desplazamiento.`,
  fr: (name) => `Référence logistique de la journée (${name}) — pas une recommandation de visite, juste le point de départ/arrivée utilisé pour planifier le trajet.`,
  de: (name) => `Logistischer Bezugspunkt des Tages (${name}) — keine Besuchsempfehlung, sondern nur der für die Wegplanung berücksichtigte Start-/Endpunkt.`,
  it: (name) => `Riferimento logistico della giornata (${name}) — non è un consiglio di visita, solo il punto di partenza/arrivo usato per pianificare lo spostamento.`,
};

const ACCOMMODATION_FALLBACK_DESCRIPTION: Record<string, (name: string) => string> = {
  pt: (name) => `Sua hospedagem (${name}) — incluída aqui apenas como referência de rota, não como passeio.`,
  en: (name) => `Your accommodation (${name}) — included here only as a route reference, not as something to visit.`,
  es: (name) => `Tu alojamiento (${name}) — incluido aquí solo como referencia de ruta, no como visita.`,
  fr: (name) => `Votre hébergement (${name}) — inclus ici seulement comme repère d'itinéraire, pas comme visite.`,
  de: (name) => `Ihre Unterkunft (${name}) — hier nur als Routenreferenz enthalten, kein Besuchsziel.`,
  it: (name) => `Il tuo alloggio (${name}) — incluso qui solo come riferimento di percorso, non come visita.`,
};

const GENERIC_FALLBACK_DESCRIPTION: Record<string, (name: string, category: string) => string> = {
  pt: (name) => `Parada recomendada em ${name} — vale reservar um tempo para conhecer com calma.`,
  en: (name) => `Recommended stop at ${name} — worth taking some time to explore.`,
  es: (name) => `Parada recomendada en ${name} — vale la pena tomarse un tiempo para recorrerla.`,
  fr: (name) => `Arrêt recommandé à ${name} — ça vaut la peine d'y consacrer un peu de temps.`,
  de: (name) => `Empfohlener Halt bei ${name} — es lohnt sich, sich etwas Zeit dafür zu nehmen.`,
  it: (name) => `Tappa consigliata a ${name} — vale la pena dedicarci un po' di tempo.`,
};

function pickLang(language: string | undefined, table: Record<string, any>): any {
  const short = (language || "pt").slice(0, 2).toLowerCase();
  return table[short] || table.pt;
}

/**
 * Guarantees every stop has a useful, non-empty description — never an
 * ordinary-looking recommendation with blank text. Logistical/accommodation
 * stops get an explicit "this is just a reference point" description instead
 * of a made-up reason to visit; real stops missing a description (the LLM
 * sometimes leaves this blank for the very first stop of a day) get a short,
 * honest generic fallback rather than empty text — never invented facts
 * (ratings, history, etc.), just an acknowledgement the place is worth the
 * visit.
 */
function ensureStopDescriptionAndType(stop: any, accommodation: ValidateContext["accommodation"], language: string | undefined): void {
  const stopType = classifyStopType(stop, accommodation);
  stop.stopType = stopType;
  const hasDescription = typeof stop.description === "string" && stop.description.trim().length > 0;
  if (hasDescription) return;

  if (stopType === "logistics") {
    stop.description = pickLang(language, LOGISTICS_FALLBACK_DESCRIPTION)(stop.placeName);
  } else if (stopType === "accommodation") {
    stop.description = pickLang(language, ACCOMMODATION_FALLBACK_DESCRIPTION)(stop.placeName);
  } else {
    stop.description = pickLang(language, GENERIC_FALLBACK_DESCRIPTION)(stop.placeName, stop.placeCategory);
  }
}

// ─── Description ↔ schedule explicit-time reconciliation ───────────────────

/**
 * Matches an explicit clock-time (or time range) literally written into a
 * stop's own description — e.g. "das 20:55 às 21:40", "20h55-21h40",
 * "from 8:30pm to 9:40pm" — as opposed to the vaguer TIME_OF_DAY_HINTS
 * above. This is the Chinatown-bug pattern: the model wrote a specific,
 * internally-reasoned time range into prose that a later deterministic shift
 * (arrival buffer, duration-realism correction, etc.) never touches, so the
 * two can silently diverge. Captures group 1/2 as HH:MM (24h or 12h+ampm).
 */
const EXPLICIT_TIME_RANGE_PATTERN =
  /(\d{1,2})[:h](\d{2})\s*(am|pm)?(\s*(?:-|–|a|às|as|to|até|bis|au)\s*)(\d{1,2})[:h](\d{2})\s*(am|pm)?/i;

function to24h(h: number, m: number, ampm?: string): number {
  let hour = h;
  if (ampm) {
    const isPM = ampm.toLowerCase() === "pm";
    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
  }
  return hour * 60 + m;
}

/**
 * If a stop's description literally states a clock-time window that
 * contradicts its own scheduled `time` by more than a generous 90-minute
 * tolerance, deterministically rewrites just the numbers in that sentence to
 * match the validated schedule — never regenerating the whole description,
 * just fixing the now-provably-wrong digits — and records a warning. This
 * runs AFTER every other time-shifting step, so it always reconciles against
 * the final, authoritative schedule rather than a time that might still
 * move.
 */
function reconcileExplicitDescriptionTimes(day: any, dayIndex: number, warnings: string[]): void {
  for (const stop of day.stops) {
    const desc = String(stop.description || "");
    const match = desc.match(EXPLICIT_TIME_RANGE_PATTERN);
    if (!match) continue;

    const startMin = to24h(parseInt(match[1], 10), parseInt(match[2], 10), match[3]);
    const scheduledMin = timeToMinutes(stop.time);
    if (scheduledMin == null) continue;

    let diff = Math.abs(startMin - scheduledMin);
    diff = Math.min(diff, 1440 - diff); // shortest distance across midnight
    if (diff <= 90) continue; // close enough — not the bug this guards against

    const endMin = to24h(parseInt(match[5], 10), parseInt(match[6], 10), match[7]);
    const impliedDurationMin = ((endMin - startMin) % 1440 + 1440) % 1440;
    const newStart = scheduledMin;
    const newEnd = (newStart + (impliedDurationMin || 60)) % 1440;
    const newStartText = minutesToTime(newStart);
    const newEndText = minutesToTime(newEnd);

    // Rebuilt from scratch (never a content-based .replace chain, which can
    // corrupt the string when a new digit happens to equal an old one still
    // pending replacement elsewhere in the clause) — reuses only the
    // original separator text (group 4, e.g. " às ", " to ") between the two
    // freshly-formatted HH:MM values.
    const matchStart = match.index ?? 0;
    const separator = match[4];
    const rewrittenClause = `${newStartText}${separator}${newEndText}`;
    stop.description = desc.slice(0, matchStart) + rewrittenClause + desc.slice(matchStart + match[0].length);

    warnings.push(
      `Rewrote a contradictory explicit time mention in "${stop.placeName}"'s description on day ${dayIndex + 1} (said ${minutesToTime(startMin)}, scheduled at ${stop.time}) to match the validated schedule (${newStartText}–${newEndText})`,
    );
  }
}

// ─── Deterministic daily summary (backend-only; not yet rendered by the app) ─

const SUMMARY_TEMPLATES: Record<string, (highlights: string[], mealsCount: number, pace: string) => string> = {
  pt: (h, m, pace) => `Dia dedicado a ${h.join(", ")}${m > 0 ? `, com parada${m > 1 ? "s" : ""} para refeição` : ""} — ${pace}.`,
  en: (h, m, pace) => `A day centered on ${h.join(", ")}${m > 0 ? `, with a stop for a meal` : ""} — ${pace}.`,
  es: (h, m, pace) => `Un día centrado en ${h.join(", ")}${m > 0 ? `, con parada para comer` : ""} — ${pace}.`,
  fr: (h, m, pace) => `Une journée centrée sur ${h.join(", ")}${m > 0 ? `, avec un arrêt repas` : ""} — ${pace}.`,
  de: (h, m, pace) => `Ein Tag rund um ${h.join(", ")}${m > 0 ? `, mit einem Essens-Stopp` : ""} — ${pace}.`,
  it: (h, m, pace) => `Una giornata dedicata a ${h.join(", ")}${m > 0 ? `, con una sosta per mangiare` : ""} — ${pace}.`,
};

const PACE_LABEL: Record<string, Record<string, string>> = {
  pt: { relaxado: "ritmo tranquilo, sem pressa", intenso: "ritmo intenso, com várias paradas", moderado: "ritmo equilibrado" },
  en: { relaxado: "relaxed pace", intenso: "fast pace, with several stops", moderado: "balanced pace" },
  es: { relaxado: "ritmo tranquilo", intenso: "ritmo intenso, con varias paradas", moderado: "ritmo equilibrado" },
  fr: { relaxado: "rythme tranquille", intenso: "rythme soutenu, avec plusieurs arrêts", moderado: "rythme équilibré" },
  de: { relaxado: "entspanntes Tempo", intenso: "zügiges Tempo mit mehreren Stopps", moderado: "ausgewogenes Tempo" },
  it: { relaxado: "ritmo rilassato", intenso: "ritmo intenso, con varie tappe", moderado: "ritmo equilibrato" },
};

/**
 * Composes a short, factual daily summary purely from the already-validated
 * `day.stops` — never from a fresh LLM call, so it can never mention a place
 * that isn't actually in the (validated) itinerary. Intentionally NOT wired
 * into the UI yet (see docs/itinerary-audit.md and the itinerary-quality
 * report): stored on `day.summary` as an additive, backward-compatible field
 * for a future release to render below the weather block.
 */
export function buildDailySummary(day: any, pace: string | undefined, language: string | undefined): string {
  const realStops = (day.stops || []).filter((s: any) => s.stopType !== "logistics" && s.stopType !== "accommodation");
  if (realStops.length === 0) return "";

  const highlightCategories = new Set(["attraction", "museum", "hidden_gem", "park", "beach", "market", "neighborhood"]);
  const highlightStops = realStops.filter((s: any) => highlightCategories.has((s.placeCategory || "").toLowerCase()));
  const mealStops = realStops.filter((s: any) => ["restaurant", "cafe"].includes((s.placeCategory || "").toLowerCase()));
  const source = highlightStops.length > 0 ? highlightStops : realStops;
  const highlightNames = source.slice(0, 3).map((s: any) => s.placeName);

  const paceKey = pace === "relaxado" || pace === "intenso" ? pace : "moderado";
  const paceLabel = pickLang(language, PACE_LABEL)[paceKey];
  return pickLang(language, SUMMARY_TEMPLATES)(highlightNames, mealStops.length, paceLabel);
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
    const durationRange = estimateDurationRange(must.category, undefined, { pace: ctx.pace });
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
      const dur = estimateDurationRange(last.placeCategory, undefined, { pace: ctx.pace }).typicalMinutes;
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
      const range = estimateDurationRange(cur.placeCategory, undefined, { pace: ctx.pace });
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
  // Bounded-concurrency fan-out instead of one sequential `await` per leg —
  // for a 7-day/5-stops-per-day trip this was previously up to ~30
  // sequential Directions calls (docs/itinerary-audit.md section 1, item 7).
  // Order of completion doesn't matter: each leg only ever writes onto its
  // own `cur` stop object, so concurrent writes never collide.
  if (ctx.fetchTravel) {
    const legs: { cur: any; next: any }[] = [];
    for (const day of days) {
      for (let i = 0; i < day.stops.length - 1; i++) {
        const cur = day.stops[i];
        const next = day.stops[i + 1];
        if (cur.lat == null || cur.lng == null || next.lat == null || next.lng == null) continue;
        legs.push({ cur, next });
      }
    }
    const TRAVEL_FETCH_CONCURRENCY = 6;
    let nextLegIdx = 0;
    const worker = async () => {
      while (nextLegIdx < legs.length) {
        const { cur, next } = legs[nextLegIdx++];
        const result = await ctx.fetchTravel!(cur.lat, cur.lng, next.lat, next.lng);
        if (result) {
          cur.travelTimeToNext = result.durationText;
          cur.travelModeToNext = result.mode;
          cur.mapsUrlToNext = result.mapsUrl;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(TRAVEL_FETCH_CONCURRENCY, legs.length) }, worker));
  }

  // ── 10) Description ↔ scheduled-time self-consistency (best-effort) ────────
  // Catches cases where the LLM's own description recommends a time of day
  // (e.g. "visite ao entardecer para ver o sol nos vitrais") that its
  // scheduled time then contradicts. Ranges are deliberately wide/conservative
  // since they can't account for season or latitude.
  days.forEach((day: any, dIdx: number) => {
    day.stops.forEach((stop: any, sIdx: number) => {
      const desc = String(stop.description || "");
      if (!desc) return;
      const hint = TIME_OF_DAY_HINTS.find((h) => h.pattern.test(desc));
      if (!hint) return;
      const t = timeToMinutes(stop.time);
      if (t == null) return;
      if (t >= hint.min && t <= hint.max) return; // already consistent

      warnings.push(
        `Stop "${stop.placeName}" on day ${dIdx + 1} is scheduled at ${stop.time} but its own description suggests ${hint.label} (${minutesToTime(hint.min)}–${minutesToTime(hint.max)})`,
      );

      // Only auto-adjust if it fits cleanly between its neighbors — never
      // introduce an overlap to chase the description's suggested window.
      const prev = day.stops[sIdx - 1];
      const next = day.stops[sIdx + 1];
      const prevEnd = prev
        ? (timeToMinutes(prev.time) ?? hint.min) +
          estimateDurationRange(prev.placeCategory, undefined, { pace: ctx.pace }).typicalMinutes +
          parseTravelMinutes(prev.travelTimeToNext)
        : hint.min;
      const nextStart = next ? timeToMinutes(next.time) ?? hint.max : hint.max;
      const lowerBound = Math.max(hint.min, prevEnd);
      const upperBound = Math.min(hint.max, nextStart);
      if (lowerBound > upperBound) return; // no safe slot — leave the warning as-is

      const target = Math.min(Math.max(t, lowerBound), upperBound);
      if (target !== t) {
        stop.time = minutesToTime(target);
        warnings.push(
          `Adjusted "${stop.placeName}" on day ${dIdx + 1} to ${stop.time} to match its own description's time-of-day hint (${hint.label})`,
        );
      }
    });
  });

  // ── 11) Explicit clock-time mentions in descriptions must match the final
  // schedule (the Chinatown-bug pattern — see reconcileExplicitDescriptionTimes
  // above). Runs after every other time-shifting step so it always compares
  // against the truly final, authoritative `time` field.
  days.forEach((day: any, dIdx: number) => reconcileExplicitDescriptionTimes(day, dIdx, warnings));

  // ── 12) Classify every stop (attraction/restaurant/accommodation/logistics)
  // and guarantee a non-empty, honest description — never an unexplained
  // "recommendation" with blank text (see classifyStopType/
  // ensureStopDescriptionAndType above). Additive `stopType` field only;
  // existing `placeCategory`/`description` fields are unchanged in shape.
  days.forEach((day: any) => {
    day.stops.forEach((stop: any) => ensureStopDescriptionAndType(stop, ctx.accommodation, ctx.language));
  });

  // ── 13) Deterministic daily summary (backend-only; see buildDailySummary).
  // Additive `summary` field — not read by the current app UI, reserved for
  // the next mobile release that renders it below the weather block.
  days.forEach((day: any) => {
    day.summary = buildDailySummary(day, ctx.pace, ctx.language);
  });

  return { days, warnings };
}
