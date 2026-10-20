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

describe("per-stage telemetry — ai.generateFromScratch (parallel-by-day redesign)", () => {
  it("declares a timing field for every requested stage, including the per-day generation and photo-resolution steps unique to this endpoint", () => {
    for (const field of ["candidateFetchMs", "prepStepsMs", "dayGenerationMs", "dayTimingsMs", "placeResolutionMs", "validateMs", "suggestedPlacesPhotoMs"]) {
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

  it("has exactly one invokeLLM call SITE (inside generateSingleDay, invoked once per day at runtime via mapWithConcurrency) and exactly one validateAndCorrectItinerary call site, run once on the whole merged itinerary", () => {
    expect((generateFromScratchBody.match(/await invokeLLM\(/g) || []).length).toBe(1);
    expect((generateFromScratchBody.match(/await validateAndCorrectItinerary\(/g) || []).length).toBe(1);
  });

  it("no longer calls withOneRepairAttempt — no extra global planning/repair LLM call for this endpoint", () => {
    expect(generateFromScratchBody).not.toMatch(/withOneRepairAttempt\(/);
  });

  it("day-generation concurrency and timeout are configurable via env, not hardcoded-only (investigation finding: the earlier 30000ms value was too low for the real per-day prompt, confirmed by an isolated benchmark — not a concurrency/rate-limit bug)", () => {
    expect(generateFromScratchBody).toMatch(/ITINERARY_DAY_GENERATION_CONCURRENCY/);
    expect(generateFromScratchBody).toMatch(/ITINERARY_DAY_GENERATION_TIMEOUT_MS/);
  });

  it("refuses to return an itinerary with an empty day — zero stops is never treated as a successful generation", () => {
    expect(generateFromScratchBody).toMatch(/findEmptyDays/);
    expect(generateFromScratchBody).toMatch(/zero stops/i);
  });

  it("passes maxRetries: 0 to each day's invokeLLM call and does its own single manual retry instead", () => {
    expect(generateFromScratchBody).toMatch(/maxRetries:\s*0/);
    expect(generateFromScratchBody).toMatch(/retrying once/i);
  });

  it("a day call uses the minimal per-day schema, not the full itinerary schema", () => {
    expect(generateFromScratchBody).toContain("buildMinimalDaySchema()");
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
