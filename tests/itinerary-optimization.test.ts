import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runIndependentPreparationSteps } from "../server/itinerary/prepare";
import { filterHallucinatedStops, type GuardCandidate } from "../server/itinerary/guard";
import { buildItineraryDaysSchema } from "../server/itinerary/schema";

// server/routers.ts pulls in live db/storage/Supabase clients at module load
// (not safe to import in a unit test, and no existing test in this repo does
// — see tests/itinerary-engine.test.ts, which only imports pure itinerary/*
// modules). The judgment-guidance text and the pre-screen-removal checks
// below read the source file as text instead, same as any other
// regression-guard-by-source-inspection test.
const routersSource = readFileSync(join(__dirname, "../server/routers.ts"), "utf8");

function extractConstBlock(source: string, constName: string): string {
  const match = source.match(new RegExp(`const ${constName} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Could not find template-literal const "${constName}" in server/routers.ts`);
  return match[1];
}

// ─── Parallelization of independent prep I/O ────────────────────────────────

describe("runIndependentPreparationSteps", () => {
  it("runs all three tasks concurrently, not sequentially", async () => {
    vi.useFakeTimers();
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const order: string[] = [];

    const promise = runIndependentPreparationSteps({
      fetchOpeningHours: async () => {
        await delay(30);
        order.push("hours");
      },
      resolveMustSee: async () => {
        await delay(20);
        order.push("mustSee");
        return "resolved-must-see";
      },
      buildWeatherBlock: async () => {
        await delay(10);
        order.push("weather");
        return "weather-block";
      },
    });

    // If these ran sequentially (30 + 20 + 10 = 60ms), advancing only 30ms
    // would resolve just the first task. Concurrently, the slowest task (30ms)
    // gates the whole Promise.all, so advancing exactly 30ms resolves all three.
    await vi.advanceTimersByTimeAsync(30);
    const result = await promise;

    expect(order).toEqual(["weather", "mustSee", "hours"]); // completion order = each task's own delay, shortest first
    expect(result.resolvedMustSee).toBe("resolved-must-see");
    expect(result.weatherBlock).toBe("weather-block");
    vi.useRealTimers();
  });

  it("does not change the resolved values vs. running the same tasks sequentially", async () => {
    const result = await runIndependentPreparationSteps({
      fetchOpeningHours: async () => undefined,
      resolveMustSee: async () => ({ name: "Louvre" }),
      buildWeatherBlock: async () => "\nClima: ...",
    });
    expect(result.resolvedMustSee).toEqual({ name: "Louvre" });
    expect(result.weatherBlock).toBe("\nClima: ...");
  });

  it("still surfaces a rejection if one of the independent tasks fails", async () => {
    await expect(
      runIndependentPreparationSteps({
        fetchOpeningHours: async () => undefined,
        resolveMustSee: async () => {
          throw new Error("boom");
        },
        buildWeatherBlock: async () => "",
      }),
    ).rejects.toThrow("boom");
  });
});

// ─── Hallucination guard (shared between generateItinerary / generateFromScratch) ──

describe("filterHallucinatedStops", () => {
  const candidatesByPlaceId = new Map<string, GuardCandidate>([
    ["real-1", { placeId: "real-1", name: "Real Museum", lat: 1, lng: 2 }],
  ]);

  it("keeps a stop whose googlePlaceId matches a real candidate, and backfills its name/lat/lng", () => {
    const { days, droppedCount } = filterHallucinatedStops(
      [{ stops: [{ placeName: "Slightly Different Name", googlePlaceId: "real-1", lat: 999, lng: 999 }] }],
      { candidatesByPlaceId, allowedNamesLower: new Set(), hasCandidatePool: true },
    );
    expect(droppedCount).toBe(0);
    expect(days[0].stops[0]).toMatchObject({ placeName: "Real Museum", lat: 1, lng: 2, googlePlaceId: "real-1" });
  });

  it("keeps a stop matching a user-selected place even without a googlePlaceId", () => {
    const { days, droppedCount } = filterHallucinatedStops(
      [{ stops: [{ placeName: "My Hotel" }] }],
      { candidatesByPlaceId, allowedNamesLower: new Set(["my hotel"]), hasCandidatePool: true },
    );
    expect(droppedCount).toBe(0);
    expect(days[0].stops).toHaveLength(1);
  });

  it("keeps a stop matching a resolved must-see place (regression: generateFromScratch used to only check selected places, not must-see)", () => {
    const { days, droppedCount } = filterHallucinatedStops(
      [{ stops: [{ placeName: "Eiffel Tower" }] }],
      { candidatesByPlaceId, allowedNamesLower: new Set(["eiffel tower"]), hasCandidatePool: true },
    );
    expect(droppedCount).toBe(0);
    expect(days[0].stops).toHaveLength(1);
  });

  it("drops a stop that references a place outside the real candidates / selected / must-see lists", () => {
    const { days, droppedCount } = filterHallucinatedStops(
      [{ stops: [{ placeName: "Invented Place That Does Not Exist", googlePlaceId: "fake-id" }] }],
      { candidatesByPlaceId, allowedNamesLower: new Set(), hasCandidatePool: true },
    );
    expect(droppedCount).toBe(1);
    expect(days[0].stops).toHaveLength(0);
  });

  it("keeps everything unchanged when there is no candidate pool to ground against", () => {
    const { days, droppedCount } = filterHallucinatedStops(
      [{ stops: [{ placeName: "Anything", googlePlaceId: "whatever" }] }],
      { candidatesByPlaceId: new Map(), allowedNamesLower: new Set(), hasCandidatePool: false },
    );
    expect(droppedCount).toBe(0);
    expect(days[0].stops[0].placeName).toBe("Anything");
  });

  it("drops a stop with no placeName at all", () => {
    const { days, droppedCount } = filterHallucinatedStops(
      [{ stops: [{ placeName: "" }] }],
      { candidatesByPlaceId, allowedNamesLower: new Set(), hasCandidatePool: true },
    );
    expect(droppedCount).toBe(0); // not counted as a hallucination, just an empty stop
    expect(days[0].stops).toHaveLength(0);
  });
});

// ─── Web-search pre-screen call removed ─────────────────────────────────────

describe("web-search pre-screen call removal", () => {
  it("server/routers.ts no longer defines or calls the extra pre-screen LLM pass", () => {
    expect(routersSource).not.toContain("preScreenRecommendedCandidates");
    expect(routersSource).not.toContain("WEB_SEARCH_PRESCREEN_MODEL");
  });

  it("the itinerary-generation prompts no longer reference a pre-screen block", () => {
    expect(routersSource).not.toContain("preScreenBlock");
    expect(routersSource).not.toContain("preScreenedPlaces");
  });
});

// ─── Judgment guidance — candidate order is a signal, not a mandate ─────────

describe("CANDIDATE_JUDGMENT_GUIDANCE_BLOCK", () => {
  const judgmentBlock = extractConstBlock(routersSource, "CANDIDATE_JUDGMENT_GUIDANCE_BLOCK");

  it("explicitly tells the model the candidate order is not a mandate", () => {
    expect(judgmentBlock).toMatch(/não é um ranking de qualidade real/i);
    expect(judgmentBlock).toMatch(/nunca escolha um lugar só porque está no topo da lista/i);
  });

  it("still requires grounding in the real/must-visit candidate lists (no invented establishments, ratings, prices or hours)", () => {
    expect(judgmentBlock).toMatch(/nunca invente nomes de estabelecimentos, avaliações, preços ou horários/i);
  });

  it("is wired into ai.generateItinerary's prompt (the candidate-list-based flow — ai.generateFromScratch no longer uses a candidate list at all, see DIRECT_GENERATION_GROUNDING_BLOCK below)", () => {
    const occurrences = routersSource.match(/\$\{CANDIDATE_JUDGMENT_GUIDANCE_BLOCK\}/g) || [];
    expect(occurrences.length).toBe(1);
  });

  it("the old order-forcing phrase is gone", () => {
    expect(routersSource).not.toContain("prefira os primeiros da lista");
  });
});

// ─── ai.generateFromScratch's "direct generation" redesign ──────────────────

describe("DIRECT_GENERATION_GROUNDING_BLOCK", () => {
  const groundingBlock = extractConstBlock(routersSource, "DIRECT_GENERATION_GROUNDING_BLOCK");

  it("tells the model it has no pre-fetched candidate list and must rely on its own knowledge", () => {
    expect(groundingBlock).toMatch(/liberdade total/i);
    expect(groundingBlock).toMatch(/não existe uma lista de candidatos pré-selecionada/i);
  });

  it("forbids inventing place names and asserting unverified facts (hours/price/rating)", () => {
    expect(groundingBlock).toMatch(/nunca invente o nome de um lugar/i);
    expect(groundingBlock).toMatch(/não afirme horário de funcionamento, preço, nota\/avaliação/i);
  });

  it("is wired into ai.generateFromScratch's prompt exactly once", () => {
    const occurrences = routersSource.match(/\$\{DIRECT_GENERATION_GROUNDING_BLOCK\}/g) || [];
    expect(occurrences.length).toBe(1);
  });
});

describe("ai.generateFromScratch no longer pre-fetches/sends a candidate list to the model", () => {
  it("doesn't call prepareCandidatePool or inject a candidate list into its prompt", () => {
    const body = (() => {
      const start = routersSource.indexOf("generateFromScratch: protectedProcedure");
      const end = routersSource.indexOf("suggestPlaces: protectedProcedure", start);
      return routersSource.slice(start, end);
    })();
    expect(body).not.toContain("prepareCandidatePool");
    expect(body).not.toContain("realCandidatesSummary");
    expect(body).not.toContain("buildClusteringBlockForDestinations");
  });
});

// ─── Output contract preserved (app frontend compatibility) ─────────────────

describe("buildItineraryDaysSchema — app contract unchanged", () => {
  it("still requires exactly the same stop fields the app (types/voyage.ts ItineraryStop) depends on", () => {
    const schema = buildItineraryDaysSchema({ dayTipField: "tips" }) as any;
    const stopSchema = schema.properties.days.items.properties.stops.items;
    expect(stopSchema.required.sort()).toEqual(
      [
        "time", "googlePlaceId", "placeName", "placeCategory", "description",
        "hours", "address", "lat", "lng", "travelTimeToNext", "travelModeToNext",
      ].sort(),
    );
    // travelTimeToNext/travelModeToNext stay nullable (not removed from the
    // schema) — the optimization just tells the model not to spend effort on
    // them, since they're a fallback for when Google Routes itself fails.
    expect(stopSchema.properties.travelTimeToNext.type).toContain("null");
    expect(stopSchema.properties.travelModeToNext.type).toContain("null");
  });

  it("still requires exactly the same day-level fields for both dayTipField variants", () => {
    const tipsSchema = buildItineraryDaysSchema({ dayTipField: "tips" }) as any;
    const tipSchema = buildItineraryDaysSchema({ dayTipField: "tip" }) as any;
    expect(tipsSchema.properties.days.items.required).toContain("tips");
    expect(tipSchema.properties.days.items.required).toContain("tip");
  });
});
