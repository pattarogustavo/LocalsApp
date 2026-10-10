/**
 * In-memory LRU cache with per-entry TTL. No persistence, no database
 * involvement — just a process-local speedup for expensive, cacheable AI
 * calls. Entries are evicted either when they expire or when the cache
 * grows past `maxSize` (oldest-inserted/accessed entry first).
 */
export class LruTtlCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly maxSize: number) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency: re-inserting moves this key to the end of the Map's
    // iteration order, which is what makes `.keys().next()` below the LRU one.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

export const AI_SUGGEST_PLACES_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h
export const AI_DESTINATION_INFO_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export const suggestPlacesCache = new LruTtlCache<unknown>(300);
export const destinationInfoCache = new LruTtlCache<unknown>(300);

/** Lowercases/trims/collapses-whitespace so near-identical inputs share a cache key. */
export function normalizeCacheKeyPart(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
