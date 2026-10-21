import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// server/routers.ts pulls in live db/storage/Supabase clients at module load
// (lazily initialized, so importing it is safe — see
// tests/itinerary-concurrency.test.ts, which does import it directly — but
// the telemetry/timing wiring itself is easiest to verify by reading the
// source: it's additive instrumentation around existing calls, not a new
// code path worth mocking a whole tRPC procedure invocation for).
const routersSource = readFileSync(join(__dirname, "../server/routers.ts"), "utf8");

function extractProcedureBody(source: string, markerStart: string, markerEnd: string): string {
  const startIdx = source.indexOf(markerStart);
  if (startIdx === -1) throw new Error(`Could not find "${markerStart}" in server/routers.ts`);
  const endIdx = source.indexOf(markerEnd, startIdx);
  if (endIdx === -1) throw new Error(`Could not find "${markerEnd}" after "${markerStart}" in server/routers.ts`);
  return source.slice(startIdx, endIdx);
}

const generateItineraryBody = extractProcedureBody(
  routersSource,
  "generateItinerary: protectedProcedure",
  "generateFromScratch: protectedProcedure",
);
const generateFromScratchBody = extractProcedureBody(
  routersSource,
  "generateFromScratch: protectedProcedure",
  "suggestPlaces: protectedProcedure",
);

describe("per-stage telemetry — ai.generateItinerary", () => {
  it("declares a timing field for every requested stage", () => {
    for (const field of ["candidateFetchMs", "prepStepsMs", "llmMainCallMs", "repairCallMs", "validateMs"]) {
      expect(generateItineraryBody).toContain(field);
    }
  });

  it("logs a single structured timings line including totalMs", () => {
    expect(generateItineraryBody).toMatch(/\[ai\.generateItinerary\] timings: \$\{JSON\.stringify\(\{/);
    expect(generateItineraryBody).toContain("totalMs,");
  });

  it("still calls invokeLLM exactly twice (main call site + repair reuses the same one) — timing wraps the call, doesn't add a new one", () => {
    const occurrences = generateItineraryBody.match(/await invokeLLM\(/g) || [];
    expect(occurrences.length).toBe(1); // one call site; withOneRepairAttempt re-invokes the same closure for the repair attempt
  });

  it("still calls validateAndCorrectItinerary exactly once (one call site, reused for both the first attempt and the repair attempt)", () => {
    const occurrences = generateItineraryBody.match(/await validateAndCorrectItinerary\(/g) || [];
    expect(occurrences.length).toBe(1);
  });
});

describe("per-stage telemetry — ai.generateFromScratch (whole-trip call + per-day fallback redesign)", () => {
  it("declares a timing field for every requested stage, including the planning call and photo-resolution steps unique to this endpoint", () => {
    for (const field of ["candidateFetchMs", "prepStepsMs", "generationMs", "planningCallMs", "fallbackCallsMs", "placeResolutionMs", "validateMs", "suggestedPlacesPhotoMs"]) {
      expect(generateFromScratchBody).toContain(field);
    }
  });

  it("logs a single structured timings line, measured AFTER photo resolution so totalMs reflects the whole endpoint", () => {
    expect(generateFromScratchBody).toMatch(/\[ai\.generateFromScratch\] timings: \$\{JSON\.stringify\(\{/);
    const timingsLogIdx = generateFromScratchBody.indexOf("[ai.generateFromScratch] timings:");
    const photoResolutionIdx = generateFromScratchBody.indexOf("suggestedPlacesPhotoStartedAt");
    expect(photoResolutionIdx).toBeGreaterThan(-1);
    expect(timingsLogIdx).toBeGreaterThan(photoResolutionIdx);
  });

  it("has exactly one invokeLLM call SITE (inside callBlock, reused for the whole-trip call, the per-day fallback, and the empty-day repair) and exactly two validateAndCorrectItinerary call sites (initial pass + the one re-validation after an empty-day repair)", () => {
    expect((generateFromScratchBody.match(/await invokeLLM\(/g) || []).length).toBe(1);
    expect((generateFromScratchBody.match(/await validateAndCorrectItinerary\(/g) || []).length).toBe(2);
  });

  it("no longer calls withOneRepairAttempt — no extra global planning/repair LLM call for this endpoint", () => {
    expect(generateFromScratchBody).not.toMatch(/withOneRepairAttempt\(/);
  });

  it("no longer chunks the trip into fixed-size day-blocks — one call covers the whole trip, with per-day fallback only for whatever that call didn't produce", () => {
    expect(generateFromScratchBody).not.toMatch(/ITINERARY_BLOCK_SIZE/);
    expect(generateFromScratchBody).not.toMatch(/ITINERARY_BLOCK_CONCURRENCY/);
    expect(generateFromScratchBody).toMatch(/ITINERARY_FALLBACK_CONCURRENCY/);
    expect(generateFromScratchBody).toMatch(/await generateBlock\(feasibleDescriptors\)/);
    expect(generateFromScratchBody).toMatch(/mapWithConcurrency\(descriptorsNeedingFallback, FALLBACK_CONCURRENCY, \(d\) => generateBlock\(\[d\]\)\)/);
  });

  it("never throws out of the mutation for a day-level failure — a block/day/place failure degrades to a warning instead of discarding the whole trip (the all-or-nothing bug this redesign replaces)", () => {
    expect(generateFromScratchBody).not.toMatch(/throw new TRPCError/);
  });

  it("isolates a day that fails even after its per-day fallback retry as a specific warning, not a thrown error", () => {
    expect(generateFromScratchBody).toMatch(/generationFailedDayNumbers/);
    expect(generateFromScratchBody).toMatch(/não pôde ser gerado/);
  });

  it("gives a day that ends up with zero stops after validation exactly one targeted repair regeneration before it, too, degrades to a warning", () => {
    expect(generateFromScratchBody).toMatch(/findEmptyDays/);
    expect(generateFromScratchBody).toMatch(/repairOutcome/);
    expect(generateFromScratchBody).toMatch(/repairedDaysCount/);
    expect(generateFromScratchBody).toMatch(/não pôde ser montado/);
  });

  it("substitutes a same-category real place for a stop that can't be verified, instead of only dropping it", () => {
    expect(generateFromScratchBody).toMatch(/resolveAndVerifyStopsWithSubstitution/);
    expect(generateFromScratchBody).toMatch(/stopsSubstituted/);
  });

  it("deterministically computes each day's feasible time window BEFORE calling the model, and never sends an infeasible day to the LLM", () => {
    expect(generateFromScratchBody).toMatch(/computeDayWindowMinutes/);
    expect(generateFromScratchBody).toMatch(/MIN_FEASIBLE_WINDOW_MINUTES/);
    expect(generateFromScratchBody).toMatch(/feasibleDescriptors/);
  });

  it("surfaces an explicit plain-language warning for a day with no feasible time window, instead of a silent empty day or a hard failure", () => {
    expect(generateFromScratchBody).toMatch(/warningsFromInfeasibleDays/);
    expect(generateFromScratchBody).toMatch(/não teve nenhuma parada/);
  });

  it("the whole-trip/per-day/repair calls all pass maxRetries: 0 and do their own single manual retry instead, without crashing other days' results", () => {
    expect(generateFromScratchBody).toMatch(/maxRetries:\s*0/);
    expect(generateFromScratchBody).toMatch(/retrying once/i);
    expect(generateFromScratchBody).toMatch(/BlockOutcome/);
  });

  it("the planning/fallback/repair calls use the minimal trip schema, not the full itinerary schema", () => {
    expect(generateFromScratchBody).toContain("buildMinimalTripSchema()");
    expect(generateFromScratchBody).not.toContain("buildItineraryDaysSchema(");
  });
});

describe("telemetry/timing logs never include secrets or sensitive content", () => {
  const forbiddenPatterns = [
    /apiKey/i,
    /OPENAI_API_KEY/,
    /GOOGLE_PLACES_API_KEY/,
    /GOOGLE_DIRECTIONS_API_KEY/,
    /DATABASE_URL/,
    /Authorization/i,
    /Bearer /,
  ];

  for (const [label, body] of [
    ["generateItinerary", generateItineraryBody],
    ["generateFromScratch", generateFromScratchBody],
  ] as const) {
    it(`${label}'s timings/telemetry console.log lines don't reference secret-shaped identifiers`, () => {
      const timingsLineMatch = body.match(/console\.log\(\s*`\[ai\.\w+\] timings:[\s\S]*?\);/);
      expect(timingsLineMatch).not.toBeNull();
      const timingsLine = timingsLineMatch![0];
      for (const pattern of forbiddenPatterns) {
        expect(timingsLine).not.toMatch(pattern);
      }
    });
  }
});

describe("mapWithConcurrency reuse — no duplicate concurrency helper introduced", () => {
  it("fetchOpeningHoursForTopCandidates calls the existing mapWithConcurrency helper instead of an unbounded Promise.all", () => {
    const fnBody = extractProcedureBody(routersSource, "export async function fetchOpeningHoursForTopCandidates", "async function resolvePlaceIdByName");
    expect(fnBody).toContain("mapWithConcurrency(top, OPENING_HOURS_FETCH_CONCURRENCY");
    expect(fnBody).not.toMatch(/await Promise\.all\(\s*top\.map/);
  });

  it("only one mapWithConcurrency implementation is defined in server/routers.ts", () => {
    const occurrences = routersSource.match(/async function mapWithConcurrency</g) || [];
    expect(occurrences.length).toBe(1);
  });
});
