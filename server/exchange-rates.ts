/**
 * Daily exchange rates for the multi-currency expenses feature
 * (server/routers.ts' `exchangeRates` router). Source: Frankfurter
 * (https://frankfurter.dev), a free wrapper around the European Central
 * Bank's official reference rates — no API key required.
 *
 * A rate for "today" is cached for 24h (the ECB publishes once a day); a
 * rate for a past date is cached much longer since it never changes. A
 * currency Frankfurter doesn't track (or any fetch failure) resolves to
 * `null` — the caller (the expense form) falls back to letting the user
 * enter the rate manually, which the feature already supports by design.
 */
import { LruTtlCache } from "./cache";

const TODAY_RATE_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const HISTORICAL_RATE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const rateCache = new LruTtlCache<number | null>(5000);

export interface RatePair {
  /** Any ISO date/datetime string — only the YYYY-MM-DD part is used. */
  date: string;
  from: string;
  to: string;
}

export interface RateResult extends RatePair {
  /** The from→to rate on that date, or null if unavailable (ask the user for a manual rate). */
  rate: number | null;
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchRate(dateOnly: string, from: string, to: string): Promise<number | null> {
  if (from === to) return 1;
  const key = `${dateOnly}|${from}|${to}`;
  const cached = rateCache.get(key);
  if (cached !== undefined) return cached;

  const ttl = dateOnly < todayDateString() ? HISTORICAL_RATE_CACHE_TTL_MS : TODAY_RATE_CACHE_TTL_MS;
  try {
    const url = `https://api.frankfurter.app/${dateOnly}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(url);
    if (!res.ok) {
      rateCache.set(key, null, ttl);
      return null;
    }
    const json = (await res.json()) as { rates?: Record<string, number> };
    const rate = json.rates?.[to] ?? null;
    rateCache.set(key, rate, ttl);
    return rate;
  } catch (err) {
    console.error("[exchangeRates] fetchRate failed:", err);
    // Don't cache a transient network failure — the next call should retry.
    return null;
  }
}

/** Resolves each (date, from, to) pair's rate in parallel. Callers should dedupe pairs first — this does no deduping of its own beyond the cache. */
export async function fetchRates(pairs: RatePair[]): Promise<RateResult[]> {
  return Promise.all(
    pairs.map(async (p) => {
      const dateOnly = p.date.slice(0, 10);
      const rate = await fetchRate(dateOnly, p.from, p.to);
      return { ...p, rate };
    })
  );
}
