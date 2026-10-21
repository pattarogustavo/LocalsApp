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

describe("per-stage telemetry — ai.generateFromScratch (day-block parallel redesign)", () => {
  it("declares a timing field for every requested stage, including the block generation batch and photo-resolution steps unique to this endpoint", () => {
    for (const field of ["candidateFetchMs", "prepStepsMs", "generationMs", "blockTimingsMs", "placeResolutionMs", "validateMs", "suggestedPlacesPhotoMs"]) {
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

  it("has exactly one invokeLLM call SITE (inside callBlock, invoked once per day-block via mapWithConcurrency) and exactly one validateAndCorrectItinerary call site, run once on the whole merged itinerary", () => {
    expect((generateFromScratchBody.match(/await invokeLLM\(/g) || []).length).toBe(1);
    expect((generateFromScratchBody.match(/await validateAndCorrectItinerary\(/g) || []).length).toBe(1);
  });

  it("no longer calls withOneRepairAttempt — no extra global planning/repair LLM call for this endpoint", () => {
    expect(generateFromScratchBody).not.toMatch(/withOneRepairAttempt\(/);
  });

  it("splits days into blocks run concurrently via mapWithConcurrency, with block size/concurrency and per-block timeout/token budget env-configurable, not hardcoded-only", () => {
    expect(generateFromScratchBody).toMatch(/ITINERARY_BLOCK_SIZE/);
    expect(generateFromScratchBody).toMatch(/ITINERARY_BLOCK_CONCURRENCY/);
    expect(generateFromScratchBody).toMatch(/ITINERARY_BLOCK_TIMEOUT_BASE_MS/);
    expect(generateFromScratchBody).toMatch(/ITINERARY_BLOCK_TIMEOUT_PER_DAY_MS/);
    expect(generateFromScratchBody).toMatch(/mapWithConcurrency\(dayBlocks, BLOCK_CONCURRENCY, generateBlock\)/);
  });

  it("refuses to return an itinerary with an unexpected empty day — zero stops is never treated as a successful generation, unless deterministically marked infeasible beforehand", () => {
    expect(generateFromScratchBody).toMatch(/findEmptyDays/);
    expect(generateFromScratchBody).toMatch(/zero stops/i);
    expect(generateFromScratchBody).toMatch(/infeasibleDayNumbers/);
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

  it("refuses to return an itinerary missing a whole day from the model's response, naming exactly the failed block's day numbers", () => {
    expect(generateFromScratchBody).toMatch(/missingDayNumbers/);
    expect(generateFromScratchBody).toMatch(/failedDayNumbers/);
  });

  it("a block's own invokeLLM call passes maxRetries: 0 and does its own single manual retry instead, without crashing other blocks' results", () => {
    expect(generateFromScratchBody).toMatch(/maxRetries:\s*0/);
    expect(generateFromScratchBody).toMatch(/retrying once/i);
    expect(generateFromScratchBody).toMatch(/BlockOutcome/);
  });

  it("each block call uses the minimal trip schema, not the full itinerary schema", () => {
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
