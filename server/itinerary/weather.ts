/**
 * Weather/daylight context for itinerary generation (spec "Stage 7").
 *
 * Reuses the EXISTING OpenWeatherMap integration/key — the same 5-day/3-hour
 * forecast endpoint already used by the `weather.forecast` tRPC procedure in
 * server/routers.ts for the UI's weather widget. This module is the first
 * place that feeds it into GENERATION itself; previously the itinerary
 * engine had no weather awareness at all, so descriptions were written from
 * generic seasonal knowledge rather than the actual forecast
 * (docs/itinerary-audit.md section 7.2/8).
 *
 * Sunrise/sunset uses a deterministic astronomical formula (the standard
 * NOAA/Spencer solar-position approximation), not a new paid API, per the
 * brief ("don't add a new paid API unless truly needed"). KNOWN LIMITATION:
 * local time is approximated from longitude (`round(lng / 15)` hours from
 * UTC) since this codebase has no IANA timezone database — accurate to
 * within about an hour in the common case, but can be off near timezone
 * boundaries or during DST. Good enough for "the sun sets around N" framing
 * in a travel description, not precise enough to assert as exact.
 */

const OPENWEATHER_KEY = process.env.OPENWEATHERMAP_API_KEY || "";

export interface DayForecast {
  date: string; // YYYY-MM-DD
  tempMinC: number;
  tempMaxC: number;
  description: string;
  /** 0-1 probability of precipitation, max across the day's 3-hour entries. */
  rainProbability: number;
}

/**
 * Forecast summary per requested date, using OpenWeatherMap's 5-day/3-hour
 * endpoint — its only real forecast range. A date beyond that window is
 * simply ABSENT from the returned map; callers must treat a missing date
 * as "no verified forecast available", never assume clear/mild weather by
 * default. Never throws — a failure just means an empty/partial map.
 */
export async function fetchForecastSummary(
  lat: number,
  lng: number,
  dates: string[],
): Promise<Map<string, DayForecast>> {
  const result = new Map<string, DayForecast>();
  if (!OPENWEATHER_KEY || dates.length === 0) return result;
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_KEY}&units=metric&cnt=40`;
    const res = await fetch(url);
    if (!res.ok) return result;
    const json = (await res.json()) as any;
    const byDay: Record<string, any[]> = {};
    for (const item of json.list ?? []) {
      const day = typeof item?.dt_txt === "string" ? item.dt_txt.split(" ")[0] : undefined;
      if (!day) continue;
      (byDay[day] ??= []).push(item);
    }
    const wanted = new Set(dates);
    for (const [date, items] of Object.entries(byDay)) {
      if (!wanted.has(date)) continue;
      const temps = items.map((i: any) => i?.main?.temp).filter((t: unknown): t is number => typeof t === "number");
      const rains = items.map((i: any) => (typeof i?.pop === "number" ? i.pop : 0));
      const midday = items.find((i: any) => typeof i?.dt_txt === "string" && i.dt_txt.includes("12:00")) ?? items[0];
      const description = midday?.weather?.[0]?.description;
      if (temps.length === 0 || typeof description !== "string") continue;
      result.set(date, {
        date,
        tempMinC: Math.round(Math.min(...temps)),
        tempMaxC: Math.round(Math.max(...temps)),
        description,
        rainProbability: rains.length > 0 ? Math.max(...rains) : 0,
      });
    }
  } catch (err) {
    console.error("[itinerary.weather] forecast fetch failed:", err);
  }
  return result;
}

export interface SunTimes {
  /** HH:MM, approximate LOCAL time (see module-level longitude-based timezone caveat). */
  sunriseLocal: string;
  sunsetLocal: string;
  /** True when the latitude/date combination has no real sunrise/sunset (polar day or night) — times are clamped to the horizon transit and should be treated as unreliable in that case. */
  polarExtreme: boolean;
}

function dayOfYear(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const start = new Date(`${dateStr.slice(0, 4)}-01-01T00:00:00Z`);
  return Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
}

function hoursToHHMM(hours: number): string {
  const normalized = ((hours % 24) + 24) % 24;
  let h = Math.floor(normalized);
  let m = Math.round((normalized - h) * 60);
  if (m === 60) {
    m = 0;
    h = (h + 1) % 24;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Standard NOAA/Spencer solar-position approximation for sunrise/sunset,
 * accurate to within a few minutes of solar time. See the module doc
 * comment for the local-time caveat (longitude-based timezone estimate).
 */
export function computeApproxSunTimes(lat: number, lng: number, dateStr: string): SunTimes {
  const N = dayOfYear(dateStr);
  const rad = Math.PI / 180;
  const B = ((360 / 365) * (N - 81)) * rad;
  const eotMinutes = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const declinationRad = 23.44 * rad * Math.sin(B);
  const latRad = lat * rad;

  const cosH = -Math.tan(latRad) * Math.tan(declinationRad);
  const polarExtreme = cosH < -1 || cosH > 1;
  const hourAngleDeg = (Math.acos(Math.min(1, Math.max(-1, cosH))) * 180) / Math.PI;

  const solarNoonUtcHours = 12 - lng / 15 - eotMinutes / 60;
  const sunriseUtcHours = solarNoonUtcHours - hourAngleDeg / 15;
  const sunsetUtcHours = solarNoonUtcHours + hourAngleDeg / 15;

  // Longitude-based timezone APPROXIMATION — see module doc comment.
  const tzOffsetHours = Math.round(lng / 15);

  return {
    sunriseLocal: hoursToHHMM(sunriseUtcHours + tzOffsetHours),
    sunsetLocal: hoursToHHMM(sunsetUtcHours + tzOffsetHours),
    polarExtreme,
  };
}
