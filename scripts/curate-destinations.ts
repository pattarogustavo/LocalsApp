import "./load-env.js";

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

import { parseArgs, SMOKE_DEFAULT_SLUG, type CurateOptions } from "./curate/cli-args";
import { DESTINATIONS, countryNameFor, getDestinationsBySlug, getPilotDestinations, type DestinationSeed } from "./data/destinations";
import {
  TIER_GOALS,
  MAX_COMPLEMENT_ROUNDS,
  MAX_AI_CALLS_PER_DESTINATION,
  VERIFICATION_CONCURRENCY,
  MAX_DISTANCE_FROM_CENTER_KM,
  categoryCapFor,
} from "./data/curation-config";
import { planBatches, batchKey, GROUP_LABELS, GROUP_CATEGORIES, type BatchPlan, type GroupKey } from "./curate/batches";
import { GoogleCallBudget, resolveCityCenter, findPlaceMatch, checkPlaceStatus } from "./curate/google";
import {
  newAiCallStats,
  researchBatch,
  structureBatch,
  translateBatch,
  RESEARCH_MODEL,
  STRUCTURE_MODEL,
  TRANSLATE_MODEL,
  type ProposedPlace,
  type AiCallStats,
} from "./curate/ai";
import { invokeLLM } from "../server/_core/llm";
import { estimateTotalCostUsd, formatModelCostUsd } from "./data/model-prices";
import { runBatchWithSplitting, type BatchRunOutcome } from "./curate/batch-runner";
import { verifyCandidate } from "./curate/verify";
import { dedupeByPlaceId } from "./curate/dedupe";
import { selectRestaurants, localCuisineRatio, type RestaurantCandidate } from "./curate/distribution";
import { applyCategoryCaps } from "./curate/caps";
import { computeShortfall } from "./curate/shortfall";
import { partitionNewCandidates } from "./curate/status-guard";
import { buildBaseDescriptions, mergeTranslations, isCompleteDescriptions, type Descriptions } from "./curate/descriptions";
import { buildExportMarkdown, type ExportPlace } from "./curate/export";
import { mapWithConcurrency } from "./curate/concurrency";
import { chunkItems } from "./curate/chunk";
import { saveCheckpoint, loadCheckpoint, hasCheckpoint, listCheckpointKeys, clearCheckpoints } from "./curate/checkpoint";
import { createLogger, formatBatchLine, type CurateLogger } from "./curate/logger";
import {
  getCurateDb,
  closeCurateDb,
  maskDatabaseHost,
  assertCuratedTablesExist,
  runPreflightWriteCheck,
  upsertDestinationMeta,
  getDestinationBySlug,
  getExistingPlaceIds,
  getPlacesForDestination,
  getApprovedPlaces,
  insertPendingPlaces,
  markDestinationGenerated,
  markDestinationVerified,
  markPlaceLastCheck,
  markPlacesClosed,
  updatePlaceDescriptions,
  type CurateDb,
} from "./curate/db";
import type { InsertCuratedPlace, CuratedPlace } from "../drizzle/schema";

const ROOT_DIR = process.cwd();
const EXPORTS_DIR = path.resolve(ROOT_DIR, "exports");

function resolveSelection(opts: CurateOptions): DestinationSeed[] {
  if (opts.only) return getDestinationsBySlug(opts.only);
  if (opts.pilot) return getPilotDestinations();
  return DESTINATIONS.filter((d) => (d.status ?? "active") === "active");
}

async function confirmDatabaseWrite(opts: CurateOptions): Promise<void> {
  if (opts.yes || opts.dryRun) return;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  console.log(`\nThis will write to database host: ${maskDatabaseHost(connectionString)}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "sim" to continue: ');
  rl.close();
  if (answer.trim().toLowerCase() !== "sim") {
    throw new Error("Aborted: confirmation not given.");
  }
}

// ─── batch execution (shared by generate and smoke) ────────────────────────

interface VerifiedPlace extends ProposedPlace {
  googlePlaceId: string;
}

interface BatchCheckpointData {
  verified: VerifiedPlace[];
  discarded: { name: string; reason: string }[];
  invalidCount: number;
  failed: boolean;
  usedWebSearchFallback: boolean;
  notes: string[];
}

async function verifyProposedPlaces(
  proposed: ProposedPlace[],
  destination: Pick<DestinationSeed, "nameEn">,
  center: { lat: number; lng: number },
  budget: GoogleCallBudget,
  discarded: { name: string; reason: string }[],
): Promise<VerifiedPlace[]> {
  const matches = await mapWithConcurrency(proposed, VERIFICATION_CONCURRENCY, async (place) => {
    const match = await findPlaceMatch(place.name, place.neighborhood, destination.nameEn, center, budget);
    if (!match) {
      discarded.push({ name: place.name, reason: "no Google match found" });
      return null;
    }
    const verification = verifyCandidate(
      { aiName: place.name, googleName: match.name, googleLocation: { lat: match.lat, lng: match.lng }, businessStatus: match.businessStatus },
      center,
      MAX_DISTANCE_FROM_CENTER_KM,
    );
    if (!verification.accepted) {
      discarded.push({ name: place.name, reason: verification.reason ?? "rejected" });
      return null;
    }
    return { ...place, googlePlaceId: match.placeId } as VerifiedPlace;
  });

  return dedupeByPlaceId(matches.filter((m): m is VerifiedPlace => m != null));
}

/** Runs one research+structure+verify batch (with truncation splitting), checkpointing the result BEFORE any DB write. */
async function runAndCheckpointBatch(
  slug: string,
  key: string,
  plan: Pick<BatchPlan, "group" | "categories">,
  size: number,
  promptExtra: { groupLabel: string; categoryCaps?: Record<string, number>; excludeNames: string[]; onlyMissing?: string },
  destination: DestinationSeed,
  country: string,
  goals: (typeof TIER_GOALS)[keyof typeof TIER_GOALS],
  center: { lat: number; lng: number },
  budget: GoogleCallBudget,
  aiStats: AiCallStats,
  opts: CurateOptions,
  logger: CurateLogger,
  batchLabel: string,
): Promise<BatchCheckpointData> {
  if (!opts.refresh && hasCheckpoint(ROOT_DIR, slug, key)) {
    const cached = loadCheckpoint<BatchCheckpointData>(ROOT_DIR, slug, key);
    if (cached) {
      logger.info(`${batchLabel}: reused checkpoint (${cached.verified.length} lugares)`);
      return cached;
    }
  }

  const start = Date.now();
  const discarded: { name: string; reason: string }[] = [];
  let invalidCount = 0;

  const outcome: BatchRunOutcome<ProposedPlace> = await runBatchWithSplitting(size, async (size) => {
    if (size <= 0) return { items: [], truncated: false };
    if (aiStats.calls + 2 > MAX_AI_CALLS_PER_DESTINATION) {
      logger.info(`${batchLabel}: AI call budget exhausted, skipping`);
      return { items: [], truncated: false };
    }
    const research = await researchBatch(
      {
        destinationName: destination.nameEn,
        country,
        goals,
        group: plan.group,
        groupLabel: promptExtra.groupLabel,
        batchSize: size,
        categoryCaps: promptExtra.categoryCaps,
        excludeNames: promptExtra.excludeNames,
        onlyMissing: promptExtra.onlyMissing,
      },
      aiStats,
    );
    const structured = await structureBatch(research.text, aiStats);
    invalidCount += structured.invalidCount;
    return {
      items: structured.places,
      truncated: research.truncated || structured.truncated,
      usedWebSearchFallback: !research.usedWebSearch,
    };
  });

  const verified = await verifyProposedPlaces(outcome.items, destination, center, budget, discarded);
  const elapsedSec = Math.round((Date.now() - start) / 1000);

  const status = outcome.failed ? "falhou" : outcome.usedWebSearchFallback ? "ok (sem pesquisa web)" : "ok";
  logger.info(`${batchLabel}: ${formatBatchLine(1, 1, status, verified.length, elapsedSec).replace(/^lote 1\/1: /, "")}`);
  for (const note of outcome.notes) logger.log(`  ${batchLabel}: ${note}`);

  const data: BatchCheckpointData = {
    verified,
    discarded,
    invalidCount,
    failed: outcome.failed,
    usedWebSearchFallback: outcome.usedWebSearchFallback,
    notes: outcome.notes,
  };
  // Always checkpoint, even in --dry-run — it's local disk, not the database.
  saveCheckpoint(ROOT_DIR, slug, key, data);
  return data;
}

// ─── curate:generate ───────────────────────────────────────────────────────

interface GenerateReport {
  slug: string;
  proposed: number;
  verified: number;
  invalidCount: number;
  discarded: { name: string; reason: string }[];
  failedBatches: string[];
  webSearchFallbackBatches: string[];
  inserted: number;
  skippedExisting: number;
  missingGoals: string[];
  elapsedMs: number;
  aiStats: AiCallStats;
  googleCalls: number;
}

async function runGenerateForDestination(
  destination: DestinationSeed,
  opts: CurateOptions,
  db: CurateDb | null,
  budget: GoogleCallBudget,
  logger: CurateLogger,
): Promise<GenerateReport> {
  const start = Date.now();
  const goals = TIER_GOALS[destination.tier];
  const country = countryNameFor(destination.countryCode);
  const aiStats = newAiCallStats();
  const googleCallsBefore = budget.count;

  if (opts.refresh) clearCheckpoints(ROOT_DIR, destination.slug);

  const center = await resolveCityCenter(destination.nameEn, country, budget);
  if (!center) throw new Error(`Could not resolve a center point for "${destination.nameEn}, ${country}"`);

  const plans = planBatches(goals, destination.tier);
  const proposedNames = new Set<string>();
  const failedBatches: string[] = [];
  const webSearchFallbackBatches: string[] = [];
  let invalidCount = 0;
  const allDiscarded: { name: string; reason: string }[] = [];
  const batchKeysRun: string[] = [];

  // Destinations and batches always run in sequence — never in parallel.
  for (const plan of plans) {
    const key = batchKey(plan);
    batchKeysRun.push(key);
    const caps = Object.fromEntries(plan.categories.map((c) => [c, categoryCapFor(c, destination.tier)]).filter(([, v]) => v != null)) as Record<string, number>;
    const data = await runAndCheckpointBatch(
      destination.slug,
      key,
      plan,
      plan.size,
      { groupLabel: GROUP_LABELS[plan.group], categoryCaps: Object.keys(caps).length ? caps : undefined, excludeNames: [...proposedNames] },
      destination,
      country,
      goals,
      center,
      budget,
      aiStats,
      opts,
      logger,
      `[${destination.slug}] lote ${key}`,
    );
    for (const v of data.verified) proposedNames.add(v.name);
    if (data.failed) failedBatches.push(key);
    if (data.usedWebSearchFallback) webSearchFallbackBatches.push(key);
    invalidCount += data.invalidCount;
    allDiscarded.push(...data.discarded);
  }

  // At most one complement round — restaurants first, then anything else needed, each its own small batch.
  let verifiedSoFar = dedupeByPlaceId(batchKeysRun.flatMap((k) => loadCheckpoint<BatchCheckpointData>(ROOT_DIR, destination.slug, k)?.verified ?? []));
  for (let round = 0; round < MAX_COMPLEMENT_ROUNDS; round++) {
    const restaurants = verifiedSoFar.filter((v) => v.category === "restaurant");
    const shortfall = computeShortfall({ total: verifiedSoFar.length, restaurants: restaurants.length }, goals);
    if (shortfall.meetsGoals) break;
    if (aiStats.calls + 4 > MAX_AI_CALLS_PER_DESTINATION) break;

    const complementPlans: { group: GroupKey; size: number; onlyMissing: string }[] = [];
    if (shortfall.needsMoreRestaurants) {
      complementPlans.push({ group: "B", size: Math.min(15, shortfall.missingRestaurants + 2), onlyMissing: `${shortfall.missingRestaurants} restaurantes de culinária local adicionais` });
    }
    if (shortfall.needsMoreTotal) {
      complementPlans.push({ group: "D", size: Math.min(15, shortfall.missingTotal), onlyMissing: `${shortfall.missingTotal} lugares adicionais (segredos de morador, bairros, vida noturna ou compras)` });
    }

    try {
      for (const cp of complementPlans) {
        const key = `complement-${cp.group}-${round + 1}`;
        batchKeysRun.push(key);
        const caps = Object.fromEntries(GROUP_CATEGORIES[cp.group].map((c) => [c, categoryCapFor(c, destination.tier)]).filter(([, v]) => v != null)) as Record<string, number>;
        const data = await runAndCheckpointBatch(
          destination.slug,
          key,
          { group: cp.group, categories: GROUP_CATEGORIES[cp.group] },
          cp.size,
          { groupLabel: GROUP_LABELS[cp.group], categoryCaps: Object.keys(caps).length ? caps : undefined, excludeNames: [...proposedNames], onlyMissing: cp.onlyMissing },
          destination,
          country,
          goals,
          center,
          budget,
          aiStats,
          opts,
          logger,
          `[${destination.slug}] lote ${key}`,
        );
        for (const v of data.verified) proposedNames.add(v.name);
        if (data.failed) failedBatches.push(key);
        if (data.usedWebSearchFallback) webSearchFallbackBatches.push(key);
        invalidCount += data.invalidCount;
        allDiscarded.push(...data.discarded);
      }
    } catch (err) {
      logger.info(`[${destination.slug}] complementação falhou, seguindo sem ela: ${(err as Error).message}`);
      break;
    }

    verifiedSoFar = dedupeByPlaceId(batchKeysRun.flatMap((k) => loadCheckpoint<BatchCheckpointData>(ROOT_DIR, destination.slug, k)?.verified ?? []));
  }

  // Assembly happens from the checkpoints (fresh or reused), never from partial in-memory state alone.
  const allVerified = dedupeByPlaceId(batchKeysRun.flatMap((k) => loadCheckpoint<BatchCheckpointData>(ROOT_DIR, destination.slug, k)?.verified ?? []));

  const restaurantCandidates: RestaurantCandidate[] = allVerified
    .filter((v) => v.category === "restaurant")
    .map((v) => ({
      id: v.googlePlaceId,
      priceTier: v.priceTier ?? "moderate",
      isLocalCuisine: v.isLocalCuisine,
      neighborhood: v.neighborhood,
      meals: v.meals ?? [],
      priority: v.priority,
    }));
  const selectedRestaurantIds = new Set(selectRestaurants(restaurantCandidates, goals).map((r) => r.id));
  const keptRestaurants = allVerified.filter((v) => v.category === "restaurant" && selectedRestaurantIds.has(v.googlePlaceId));
  for (const v of allVerified.filter((v) => v.category === "restaurant" && !selectedRestaurantIds.has(v.googlePlaceId))) {
    allDiscarded.push({ name: v.name, reason: "restaurant selection: over restaurantsMax or not needed for distribution" });
  }

  const others = allVerified.filter((v) => v.category !== "restaurant");
  const cappedOthers = applyCategoryCaps(others, destination.tier);
  for (const o of others) {
    if (!cappedOthers.includes(o)) allDiscarded.push({ name: o.name, reason: `category cap reached (${o.category})` });
  }

  const finalPlaces = [...keptRestaurants, ...cappedOthers];

  const missingGoals: string[] = [];
  const finalRestaurants = finalPlaces.filter((p) => p.category === "restaurant");
  if (finalRestaurants.length < goals.restaurantsMin) missingGoals.push(`restaurantsMin not met: ${finalRestaurants.length}/${goals.restaurantsMin}`);
  const finalCafes = finalPlaces.filter((p) => p.category === "cafe");
  if (finalCafes.length < goals.cafesMin) missingGoals.push(`cafesMin not met: ${finalCafes.length}/${goals.cafesMin}`);
  if (finalPlaces.length < goals.total) missingGoals.push(`total not met: ${finalPlaces.length}/${goals.total}`);
  const localRatio = localCuisineRatio(finalRestaurants.map((r) => ({ isLocalCuisine: r.isLocalCuisine })));
  if (localRatio * 100 < goals.localCuisineMinPct) missingGoals.push(`localCuisineMinPct not met: ${Math.round(localRatio * 100)}%/${goals.localCuisineMinPct}%`);

  let inserted = 0;
  let skippedExisting = 0;

  if (opts.dryRun) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    const outPath = path.join(EXPORTS_DIR, `dry-run-${destination.slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ destination, goals, center, places: finalPlaces, discarded: allDiscarded, missingGoals }, null, 2));
    inserted = finalPlaces.length;
  } else if (db) {
    const destinationRow = await upsertDestinationMeta(db, {
      slug: destination.slug,
      nameEn: destination.nameEn,
      namePt: destination.namePt,
      country,
      countryCode: destination.countryCode,
      tier: destination.tier,
      googlePlaceId: center.placeId,
      status: destination.status ?? "active",
    });

    const existingIds = await getExistingPlaceIds(db, destinationRow.id);
    const { toInsert, toSkip } = partitionNewCandidates(finalPlaces, existingIds);
    skippedExisting = toSkip.length;

    const rows: InsertCuratedPlace[] = toInsert.map((p) => ({
      destinationId: destinationRow.id,
      destinationSlug: destination.slug,
      googlePlaceId: p.googlePlaceId,
      aiName: p.name,
      aiNeighborhood: p.neighborhood,
      category: p.category,
      tags: p.tags,
      priceTier: p.priceTier,
      meals: p.meals,
      cuisine: p.cuisine,
      confidence: p.confidence,
      rank: p.priority,
      status: "pending",
      source: "ai",
      descriptions: buildBaseDescriptions(p.descriptionPt, p.descriptionEn),
    }));
    await insertPendingPlaces(db, rows); // idempotent (onConflictDoNothing)
    await markDestinationGenerated(db, destinationRow.id);
    inserted = rows.length;
  }

  return {
    slug: destination.slug,
    proposed: proposedNames.size,
    verified: allVerified.length,
    invalidCount,
    discarded: allDiscarded,
    failedBatches,
    webSearchFallbackBatches,
    inserted,
    skippedExisting,
    missingGoals,
    elapsedMs: Date.now() - start,
    aiStats,
    googleCalls: budget.count - googleCallsBefore,
  };
}

function printPlan(selection: DestinationSeed[]) {
  console.log(`Modelos: pesquisa=${RESEARCH_MODEL} estruturação=${STRUCTURE_MODEL} tradução=${TRANSLATE_MODEL}`);
  let totalGoogleEstimate = 0;
  let totalAiCallsEstimate = 0;
  for (const d of selection) {
    const goals = TIER_GOALS[d.tier];
    const plans = planBatches(goals, d.tier);
    const candidateCount = plans.reduce((sum, p) => sum + p.size, 0);
    const googleEstimate = 1 + candidateCount; // city center + one findPlaceFromText per candidate
    const aiEstimate = plans.length * 2; // research + structure per batch
    totalGoogleEstimate += googleEstimate;
    totalAiCallsEstimate += aiEstimate;
    console.log(`${d.slug} [${d.tier}] goals: total=${goals.total} restaurants=${goals.restaurantsMin}-${goals.restaurantsMax} cafes>=${goals.cafesMin}`);
    for (const p of plans) {
      console.log(`  lote ${batchKey(p)} (${p.of} no grupo): ${p.size} lugares [${p.categories.join(", ")}]`);
    }
    console.log(`  | est. AI calls: ${aiEstimate} (+ até 4 de complementação) | est. Google calls: ${googleEstimate}`);
  }
  console.log(`\nTotal estimado para ${selection.length} destino(s): ~${totalAiCallsEstimate} chamadas de IA, ~${totalGoogleEstimate} chamadas ao Google.`);
}

async function runGenerate(opts: CurateOptions, selection: DestinationSeed[], logger: CurateLogger): Promise<void> {
  if (opts.plan) {
    printPlan(selection);
    return;
  }

  await confirmDatabaseWrite(opts);

  const db = opts.dryRun ? null : getCurateDb();
  if (db) await assertCuratedTablesExist(db);

  const budget = new GoogleCallBudget(opts.maxGoogleCalls);
  const failedDestinations: string[] = [];
  const totalByModel: Record<string, { promptTokens: number; completionTokens: number }> = {};

  for (const destination of selection) {
    logger.info(`\n=== ${destination.slug} ===`);
    try {
      const report = await runGenerateForDestination(destination, opts, db, budget, logger);
      const destCost = estimateTotalCostUsd(report.aiStats.byModel);
      logger.info(
        `proposed=${report.proposed} verified=${report.verified} invalid=${report.invalidCount} discarded=${report.discarded.length} ` +
          `inserted=${report.inserted} skippedExisting=${report.skippedExisting} elapsedMs=${report.elapsedMs} ` +
          `aiCalls=${report.aiStats.calls} promptTokens=${report.aiStats.promptTokens} completionTokens=${report.aiStats.completionTokens} ` +
          `googleCalls=${report.googleCalls}`,
      );
      logger.info(`  custo estimado (apenas tokens, NÃO inclui busca web nem Google): ${formatModelCostUsd(destCost)}`);
      for (const [model, usage] of Object.entries(report.aiStats.byModel)) {
        const acc = totalByModel[model] ?? { promptTokens: 0, completionTokens: 0 };
        acc.promptTokens += usage.promptTokens;
        acc.completionTokens += usage.completionTokens;
        totalByModel[model] = acc;
      }
      if (report.failedBatches.length) logger.info(`  failed batches: ${report.failedBatches.join(", ")}`);
      if (report.webSearchFallbackBatches.length) logger.info(`  batches without web search: ${report.webSearchFallbackBatches.join(", ")}`);
      if (report.missingGoals.length) logger.info(`  missing goals: ${report.missingGoals.join("; ")}`);
      if (report.discarded.length) {
        for (const d of report.discarded.slice(0, 20)) logger.log(`  discarded "${d.name}": ${d.reason}`);
        if (report.discarded.length > 20) logger.log(`  ...and ${report.discarded.length - 20} more`);
      }
    } catch (err) {
      failedDestinations.push(destination.slug);
      logger.info(`[${destination.slug}] generation failed: ${(err as Error).message}`);
    }
  }

  if (db) await closeCurateDb();

  const totalCost = estimateTotalCostUsd(totalByModel);
  logger.info(`\nCusto total estimado (apenas tokens, NÃO inclui busca web nem Google): ${formatModelCostUsd(totalCost)}`);

  if (failedDestinations.length) {
    logger.info(`\nDestinos que falharam: ${failedDestinations.join(", ")}`);
    process.exitCode = 1;
  }
}

// ─── curate:smoke ──────────────────────────────────────────────────────────

async function runSmoke(opts: CurateOptions, logger: CurateLogger): Promise<void> {
  const slug = opts.only?.[0] ?? SMOKE_DEFAULT_SLUG;
  const [destination] = getDestinationsBySlug([slug]);
  const goals = TIER_GOALS[destination.tier];
  const country = countryNameFor(destination.countryCode);
  const aiStats = newAiCallStats();
  const budget = new GoogleCallBudget(opts.maxGoogleCalls);
  const start = Date.now();

  logger.info(`Smoke test: ${destination.slug}, 1 lote de 8 lugares (grupo A), sem gravar no banco.`);

  const center = await resolveCityCenter(destination.nameEn, country, budget);
  if (!center) throw new Error(`Could not resolve a center point for "${destination.nameEn}, ${country}"`);

  const plan: Pick<BatchPlan, "group" | "categories"> = { group: "A", categories: GROUP_CATEGORIES.A };
  const data = await runAndCheckpointBatch(
    destination.slug,
    "smoke",
    plan,
    8,
    { groupLabel: GROUP_LABELS.A, excludeNames: [] },
    destination,
    country,
    goals,
    center,
    budget,
    aiStats,
    { ...opts, refresh: true }, // smoke always runs fresh
    logger,
    `[smoke:${destination.slug}]`,
  );

  const elapsedSec = Math.round((Date.now() - start) / 1000);
  logger.info(`\nResultado: ${data.verified.length} lugares verificados em ${elapsedSec}s`);
  for (const place of data.verified) {
    logger.info(`  - ${place.name} (${place.category}, ${place.confidence}) [${place.googlePlaceId}]`);
  }
  logger.info(`aiCalls=${aiStats.calls} promptTokens=${aiStats.promptTokens} completionTokens=${aiStats.completionTokens} googleCalls=${budget.count}`);
}

// ─── curate:check (preflight) ───────────────────────────────────────────────

async function checkItem(logger: CurateLogger, label: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    logger.info(`OK: ${label}`);
    return true;
  } catch (err) {
    logger.info(`FALHOU: ${label} — ${(err as Error).message}`);
    return false;
  }
}

async function runCheck(logger: CurateLogger): Promise<void> {
  let allOk = true;

  allOk =
    (await checkItem(logger, "variáveis de ambiente (DATABASE_URL, GOOGLE_PLACES_API_KEY, ANTHROPIC_API_KEY)", async () => {
      const missing = ["DATABASE_URL", "GOOGLE_PLACES_API_KEY", "ANTHROPIC_API_KEY"].filter((k) => !process.env[k]);
      if (missing.length) throw new Error(`faltando: ${missing.join(", ")}`);
    })) && allOk;

  let db: CurateDb | null = null;
  allOk =
    (await checkItem(logger, "conexão com o banco e tabelas curated_*", async () => {
      db = getCurateDb();
      await assertCuratedTablesExist(db);
    })) && allOk;

  if (db) {
    allOk =
      (await checkItem(logger, "escrita de teste (insert + ROLLBACK)", async () => {
        await runPreflightWriteCheck(db!);
      })) && allOk;
  }

  allOk =
    (await checkItem(logger, "chamada ao Google Places (busca de cidade)", async () => {
      const budget = new GoogleCallBudget(1);
      const center = await resolveCityCenter("Paris", "France", budget);
      if (!center) throw new Error("sem resultado");
    })) && allOk;

  const modelsToTest: { label: string; model: string }[] = [
    { label: "pesquisa", model: RESEARCH_MODEL },
    { label: "estruturação", model: STRUCTURE_MODEL },
    { label: "tradução", model: TRANSLATE_MODEL },
  ];
  for (const { label, model } of modelsToTest) {
    allOk =
      (await checkItem(logger, `chamada mínima à Anthropic (modelo de ${label}: ${model})`, async () => {
        await invokeLLM({ model, maxTokens: 20, messages: [{ role: "user", content: "Responda apenas: ok" }] });
      })) && allOk;
  }

  allOk =
    (await checkItem(logger, `chamada mínima à Anthropic COM busca web habilitada (modelo de pesquisa: ${RESEARCH_MODEL})`, async () => {
      await invokeLLM({
        model: RESEARCH_MODEL,
        maxTokens: 200,
        enableWebSearch: true,
        messages: [{ role: "user", content: "Pesquise na web a capital da França e responda em uma palavra." }],
      });
    })) && allOk;

  if (db) await closeCurateDb();

  if (!allOk) {
    console.log("\nPré-voo encontrou falhas — veja acima.");
    process.exitCode = 1;
  } else {
    console.log("\nPré-voo OK.");
  }
}

// ─── curate:verify ─────────────────────────────────────────────────────────

async function runVerify(opts: CurateOptions, selection: DestinationSeed[], logger: CurateLogger): Promise<void> {
  const db = getCurateDb();
  await assertCuratedTablesExist(db);
  const budget = new GoogleCallBudget(opts.maxGoogleCalls);

  for (const destination of selection) {
    const destinationRow = await getDestinationBySlug(db, destination.slug);
    if (!destinationRow) {
      logger.info(`${destination.slug}: no destination row yet, skipping`);
      continue;
    }
    const approved = await getApprovedPlaces(db, destinationRow.id);
    let closed = 0;
    const toClose: number[] = [];
    await mapWithConcurrency(approved, VERIFICATION_CONCURRENCY, async (place) => {
      const status = await checkPlaceStatus(place.googlePlaceId, budget);
      if (status === "closed" || status === "not_found") {
        toClose.push(place.id);
        closed++;
      } else {
        await markPlaceLastCheck(db, place.id, "ok");
      }
    });
    await markPlacesClosed(db, toClose);
    await markDestinationVerified(db, destinationRow.id);
    logger.info(`${destination.slug}: checked ${approved.length} approved places, ${closed} now closed/not found`);
  }

  await closeCurateDb();
}

// ─── curate:translate ──────────────────────────────────────────────────────

const TRANSLATE_CHUNK_SIZE = 15;

async function runTranslate(_opts: CurateOptions, selection: DestinationSeed[], logger: CurateLogger): Promise<void> {
  const db = getCurateDb();
  await assertCuratedTablesExist(db);

  for (const destination of selection) {
    const destinationRow = await getDestinationBySlug(db, destination.slug);
    if (!destinationRow) {
      logger.info(`${destination.slug}: no destination row yet, skipping`);
      continue;
    }
    const approved = await getApprovedPlaces(db, destinationRow.id);
    const needing = approved.filter((p) => p.descriptions?.en && !isCompleteDescriptions((p.descriptions ?? {}) as Descriptions));
    if (needing.length === 0) {
      logger.info(`${destination.slug}: nothing to translate`);
      continue;
    }

    const stats = newAiCallStats();
    let translatedCount = 0;
    const chunks = chunkItems(needing, TRANSLATE_CHUNK_SIZE);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const outcome = await runBatchWithSplitting(chunk.length, async (size) => {
        const subset = chunk.slice(0, size);
        const result = await translateBatch(destination.nameEn, subset.map((p) => ({ id: String(p.id), en: p.descriptions!.en! })), stats);
        return { items: result.translations, truncated: result.truncated };
      });

      const byId = new Map(outcome.items.map((b) => [b.id, b]));
      for (const place of chunk) {
        const translated = byId.get(String(place.id));
        if (!translated) continue;
        const merged = mergeTranslations((place.descriptions ?? {}) as Descriptions, {
          es: translated.es,
          fr: translated.fr,
          de: translated.de,
          it: translated.it,
        });
        await updatePlaceDescriptions(db, place.id, merged);
        translatedCount++;
      }
      logger.info(`${destination.slug}: ${formatBatchLine(i + 1, chunks.length, outcome.failed ? "falhou" : "ok", outcome.items.length, 0)}`);
    }
    logger.info(`${destination.slug}: translated ${translatedCount}/${needing.length} places`);
  }

  await closeCurateDb();
}

// ─── curate:export ─────────────────────────────────────────────────────────

function toExportPlace(place: CuratedPlace): ExportPlace {
  return {
    googlePlaceId: place.googlePlaceId,
    aiName: place.aiName,
    aiNeighborhood: place.aiNeighborhood ?? undefined,
    category: place.category,
    tags: (place.tags as string[] | null) ?? [],
    priceTier: place.priceTier ?? undefined,
    cuisine: place.cuisine ?? undefined,
    confidence: place.confidence,
    descriptionPt: (place.descriptions as Descriptions | null)?.pt,
    status: place.status,
  };
}

async function runExport(_opts: CurateOptions, selection: DestinationSeed[], logger: CurateLogger): Promise<void> {
  const db = getCurateDb();
  await assertCuratedTablesExist(db);
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });

  for (const destination of selection) {
    const destinationRow = await getDestinationBySlug(db, destination.slug);
    if (!destinationRow) {
      logger.info(`${destination.slug}: no destination row yet, skipping`);
      continue;
    }
    const places = await getPlacesForDestination(db, destinationRow.id);
    const goals = TIER_GOALS[destination.tier];
    const markdown = buildExportMarkdown(`${destination.nameEn} (${destination.namePt})`, places.map(toExportPlace), goals);
    const outPath = path.join(EXPORTS_DIR, `${destination.slug}.md`);
    fs.writeFileSync(outPath, markdown);
    logger.info(`${destination.slug}: wrote ${outPath} (${places.length} places)`);
  }

  await closeCurateDb();
}

// ─── entrypoint ─────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const logger = createLogger(ROOT_DIR);

  if (opts.command === "check") {
    await runCheck(logger);
    return;
  }
  if (opts.command === "smoke") {
    await runSmoke(opts, logger);
    return;
  }

  const selection = resolveSelection(opts);

  if (opts.command === "generate") {
    await runGenerate(opts, selection, logger);
  } else if (opts.command === "verify") {
    await runVerify(opts, selection, logger);
  } else if (opts.command === "translate") {
    await runTranslate(opts, selection, logger);
  } else {
    await runExport(opts, selection, logger);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
