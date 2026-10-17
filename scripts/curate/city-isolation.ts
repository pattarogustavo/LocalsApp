import { acquireLock } from "./lock";

/**
 * Runs `fn` under a per-destination lock (see scripts/curate/lock.ts),
 * catching ANY failure — acquiring the lock itself (a concurrent run, or a
 * bad slug that blows up checkpointDir), a network error, anything `fn`
 * throws — and handing it to `onError` instead of letting it escape. This
 * is what makes curate:import's per-city loop (and curate:add's
 * per-destination run) resilient: one city's failure never takes down the
 * rest of the batch, and the lock is always released.
 */
export async function runIsolated<T>(baseDir: string, slug: string, fn: () => Promise<T>, onError: (err: Error) => T): Promise<T> {
  let lock: ReturnType<typeof acquireLock> | undefined;
  try {
    lock = acquireLock(baseDir, slug);
    return await fn();
  } catch (err) {
    return onError(err as Error);
  } finally {
    lock?.release();
  }
}
