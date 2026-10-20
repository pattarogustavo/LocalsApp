/**
 * Runs the itinerary-generation prep steps that don't depend on each other's
 * output concurrently instead of one after another. Before this, routers.ts
 * ran opening-hours backfill, must-see resolution, and weather/daylight
 * lookup as three sequential `await`s (plus a fourth, now-removed web-search
 * pre-screen call) even though none of them reads another's result — see
 * docs/itinerary-audit.md's latency findings. Pulled out into its own module
 * so the concurrency behavior itself is unit-testable without standing up a
 * full tRPC procedure.
 */

export interface IndependentPreparationTasks<MustSee> {
  /** Backfills opening hours onto the candidate pool IN PLACE (mutates its own list); the return value is discarded here. */
  fetchOpeningHours: () => Promise<unknown>;
  resolveMustSee: () => Promise<MustSee>;
  buildWeatherBlock: () => Promise<string>;
}

export interface IndependentPreparationResult<MustSee> {
  resolvedMustSee: MustSee;
  weatherBlock: string;
}

export async function runIndependentPreparationSteps<MustSee>(
  tasks: IndependentPreparationTasks<MustSee>,
): Promise<IndependentPreparationResult<MustSee>> {
  const [, resolvedMustSee, weatherBlock] = await Promise.all([
    tasks.fetchOpeningHours(),
    tasks.resolveMustSee(),
    tasks.buildWeatherBlock(),
  ]);
  return { resolvedMustSee, weatherBlock };
}
