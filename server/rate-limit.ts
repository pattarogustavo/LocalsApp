/**
 * Minimal in-memory, process-local rate limiter — there's no shared/
 * distributed rate-limiting infra in this app yet. Good enough for the
 * username-availability and user-search endpoints (cheap DB lookups, not
 * something worth a Redis dependency for), but note its real limits:
 * - Resets on every server restart/deploy.
 * - Independent per server instance if the backend ever runs more than one
 *   (no shared state across instances).
 * Revisit with a shared store if those gaps become a real problem.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Cheap cleanup so `buckets` doesn't grow unbounded — runs on an occasional
// hit rather than a dedicated timer, since this module has no lifecycle hook.
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 1000 * 60 * 10;
function sweepExpired() {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Returns true if `key` is still within its `max`-per-`windowMs` budget
 * (and consumes one unit of it); false if the limit is already hit.
 */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  sweepExpired();
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}
