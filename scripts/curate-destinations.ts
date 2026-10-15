import "./load-env.js";

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

import { parseArgs, type CurateOptions } from "./curate/cli-args";
import { DESTINATIONS, countryNameFor, getDestinationsBySlug, getPilotDestinations, type DestinationSeed } from "./data/destinations";
import { TIER_GOALS, DEFAULT_MAX_GOOGLE_CALLS, MAX_COMPLEMENT_ROUNDS, MAX_AI_CALLS_PER_DESTINATION, VERIFICATION_CONCURRENCY, MAX_DISTANCE_FROM_CENTER_KM, restaurantCandidateTarget, totalCandidateTarget } from "./data/curation-config";
import { GoogleCallBudget, resolveCityCenter, findPlaceMatch, checkPlaceStatus } from "./curate/google";
import { newAiCallStats, researchPlaces, structurePlaces, translateBatch, type ProposedPlace, type AiCallStats } from "./curate/ai";
import { verifyCandidate } from "./curate/verify";
import { dedupeByPlaceId } from "./curate/dedupe";
import { selectRestaurants, localCuisineRatio, type RestaurantCandidate } from "./curate/distribution";
import { applyCategoryCaps } from "./curate/caps";
import { computeShortfall, remainingRestaurantRoom } from "./curate/shortfall";
import { partitionNewCandidates } from "./curate/status-guard";
import { buildBaseDescriptions, mergeTranslations, isCompleteDescriptions, type Descriptions } from "./curate/descriptions";
import { buildExportMarkdown, type ExportPlace } from "./curate/export";
import { mapWithConcurrency } from "./curate/concurrency";
import {
  getCurateDb,
  closeCurateDb,
  maskDatabaseHost,
  assertCuratedTablesExist,
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

const EXPORTS_DIR = path.resolve(process.cwd(), "exports");

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

// ─── curate:generate ───────────────────────────────────────────────────────

interface VerifiedPlace extends ProposedPlace {
  googlePlaceId: string;
}

async function verifyProposedPlaces(
  proposed: ProposedPlace[],
  destination: DestinationSeed,
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

interface GenerateReport {
  slug: string;
  proposed: number;
  verified: number;
  discarded: { name: string; reason: string }[];
  inserted: number;
  skippedExisting: number;
  missingGoals: string[];
  elapsedMs: number;
  aiStats: AiCallStats;
  googleCalls: number;
}

async function runGenerateForDestination(destination: DestinationSeed, opts: CurateOptions, db: CurateDb | null, budget: GoogleCallBudget): Promise<GenerateReport> {
  const start = Date.now();
  const goals = TIER_GOALS[destination.tier];
  const country = countryNameFor(destination.countryCode);
  const aiStats = newAiCallStats();
  const discarded: { name: string; reason: string }[] = [];
  const googleCallsBefore = budget.count;

  const center = await resolveCityCenter(destination.nameEn, country, budget);
  if (!center) {
    throw new Error(`Could not resolve a center point for "${destination.nameEn}, ${country}"`);
  }

  const researchText = await researchPlaces({ destinationName: destination.nameEn, country, goals }, aiStats);
  const proposed = await structurePlaces(researchText, aiStats);

  let verified = await verifyProposedPlaces(proposed, destination, center, budget, discarded);
  const proposedNames = new Set(proposed.map((p) => p.name));

  for (let round = 0; round < MAX_COMPLEMENT_ROUNDS; round++) {
    const restaurants = verified.filter((v) => v.category === "restaurant");
    const shortfall = computeShortfall({ total: verified.length, restaurants: restaurants.length }, goals);
    if (shortfall.meetsGoals) break;
    if (aiStats.calls + 2 > MAX_AI_CALLS_PER_DESTINATION) break;

    const missingParts = [
      shortfall.needsMoreRestaurants ? `${shortfall.missingRestaurants} restaurantes de culinária local` : null,
      shortfall.needsMoreTotal ? `${shortfall.missingTotal} lugares adicionais (qualquer categoria elegível)` : null,
    ].filter(Boolean);

    const complementText = await researchPlaces(
      {
        destinationName: destination.nameEn,
        country,
        goals,
        onlyMissing: missingParts.join(" e "),
        excludeNames: [...proposedNames],
      },
      aiStats,
    );
    const complementProposed = await structurePlaces(complementText, aiStats);
    for (const p of complementProposed) proposedNames.add(p.name);

    const complementVerified = await verifyProposedPlaces(complementProposed, destination, center, budget, discarded);
    verified = dedupeByPlaceId([...verified, ...complementVerified]);
  }

  const restaurantCandidates: RestaurantCandidate[] = verified
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
  const keptRestaurants = verified.filter((v) => v.category === "restaurant" && selectedRestaurantIds.has(v.googlePlaceId));
  for (const v of verified.filter((v) => v.category === "restaurant" && !selectedRestaurantIds.has(v.googlePlaceId))) {
    discarded.push({ name: v.name, reason: "restaurant selection: over restaurantsMax or not needed for distribution" });
  }

  const others = verified.filter((v) => v.category !== "restaurant");
  const cappedOthers = applyCategoryCaps(
    others.map((o) => ({ ...o, category: o.category, priority: o.priority })),
    destination.tier,
  );
  for (const o of others) {
    if (!cappedOthers.includes(o)) discarded.push({ name: o.name, reason: `category cap reached (${o.category})` });
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
    fs.writeFileSync(
      outPath,
      JSON.stringify({ destination, goals, center, places: finalPlaces, discarded, missingGoals }, null, 2),
    );
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
    const { toInsert, toSkip } = partitionNewCandidates(finalPlaces.map((p) => ({ ...p, googlePlaceId: p.googlePlaceId })), existingIds);
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
    await insertPendingPlaces(db, rows);
    await markDestinationGenerated(db, destinationRow.id);
    inserted = rows.length;
  }

  return {
    slug: destination.slug,
    proposed: proposed.length + (proposedNames.size - proposed.length),
    verified: verified.length,
    discarded,
    inserted,
    skippedExisting,
    missingGoals,
    elapsedMs: Date.now() - start,
    aiStats,
    googleCalls: budget.count - googleCallsBefore,
  };
}

function printPlan(selection: DestinationSeed[]) {
  let totalGoogleEstimate = 0;
  for (const d of selection) {
    const goals = TIER_GOALS[d.tier];
    const candidateCount = totalCandidateTarget(goals);
    const googleEstimate = 1 + candidateCount; // city center + one findPlaceFromText per candidate
    totalGoogleEstimate += googleEstimate;
    console.log(
      `${d.slug} [${d.tier}] goals: total=${goals.total} restaurants=${goals.restaurantsMin}-${goals.restaurantsMax} cafes>=${goals.cafesMin} ` +
        `| candidates requested: total=${candidateCount} restaurants=${restaurantCandidateTarget(goals)} | est. Google calls: ${googleEstimate}`,
    );
  }
  console.log(`\nTotal estimated Google calls across ${selection.length} destination(s): ${totalGoogleEstimate}`);
}

async function runGenerate(opts: CurateOptions, selection: DestinationSeed[]): Promise<void> {
  if (opts.plan) {
    printPlan(selection);
    return;
  }

  await confirmDatabaseWrite(opts);

  const db = opts.dryRun ? null : getCurateDb();
  if (db) await assertCuratedTablesExist(db);

  const budget = new GoogleCallBudget(opts.maxGoogleCalls);

  for (const destination of selection) {
    console.log(`\n=== ${destination.slug} ===`);
    try {
      const report = await runGenerateForDestination(destination, opts, db, budget);
      console.log(
        `proposed=${report.proposed} verified=${report.verified} discarded=${report.discarded.length} ` +
          `inserted=${report.inserted} skippedExisting=${report.skippedExisting} elapsedMs=${report.elapsedMs} ` +
          `aiCalls=${report.aiStats.calls} promptTokens=${report.aiStats.promptTokens} completionTokens=${report.aiStats.completionTokens} ` +
          `googleCalls=${report.googleCalls}`,
      );
      if (report.missingGoals.length) console.log(`  missing goals: ${report.missingGoals.join("; ")}`);
      if (report.discarded.length) {
        for (const d of report.discarded.slice(0, 20)) console.log(`  discarded "${d.name}": ${d.reason}`);
        if (report.discarded.length > 20) console.log(`  ...and ${report.discarded.length - 20} more`);
      }
    } catch (err) {
      console.error(`[${destination.slug}] generation failed:`, err);
    }
  }

  if (db) await closeCurateDb();
}

// ─── curate:verify ─────────────────────────────────────────────────────────

async function runVerify(opts: CurateOptions, selection: DestinationSeed[]): Promise<void> {
  const db = getCurateDb();
  await assertCuratedTablesExist(db);
  const budget = new GoogleCallBudget(opts.maxGoogleCalls);

  for (const destination of selection) {
    const destinationRow = await getDestinationBySlug(db, destination.slug);
    if (!destinationRow) {
      console.log(`${destination.slug}: no destination row yet, skipping`);
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
    console.log(`${destination.slug}: checked ${approved.length} approved places, ${closed} now closed/not found`);
  }

  await closeCurateDb();
}

// ─── curate:translate ──────────────────────────────────────────────────────

async function runTranslate(_opts: CurateOptions, selection: DestinationSeed[]): Promise<void> {
  const db = getCurateDb();
  await assertCuratedTablesExist(db);

  for (const destination of selection) {
    const destinationRow = await getDestinationBySlug(db, destination.slug);
    if (!destinationRow) {
      console.log(`${destination.slug}: no destination row yet, skipping`);
      continue;
    }
    const approved = await getApprovedPlaces(db, destinationRow.id);
    const needing = approved.filter((p) => p.descriptions?.en && !isCompleteDescriptions((p.descriptions ?? {}) as Descriptions));
    if (needing.length === 0) {
      console.log(`${destination.slug}: nothing to translate`);
      continue;
    }

    const stats = newAiCallStats();
    const batch = await translateBatch(
      destination.nameEn,
      needing.map((p) => ({ id: String(p.id), en: p.descriptions!.en! })),
      stats,
    );
    const byId = new Map(batch.map((b) => [b.id, b]));
    for (const place of needing) {
      const translated = byId.get(String(place.id));
      if (!translated) continue;
      const merged = mergeTranslations((place.descriptions ?? {}) as Descriptions, {
        es: translated.es,
        fr: translated.fr,
        de: translated.de,
        it: translated.it,
      });
      await updatePlaceDescriptions(db, place.id, merged);
    }
    console.log(`${destination.slug}: translated ${batch.length}/${needing.length} places`);
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

async function runExport(_opts: CurateOptions, selection: DestinationSeed[]): Promise<void> {
  const db = getCurateDb();
  await assertCuratedTablesExist(db);
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });

  for (const destination of selection) {
    const destinationRow = await getDestinationBySlug(db, destination.slug);
    if (!destinationRow) {
      console.log(`${destination.slug}: no destination row yet, skipping`);
      continue;
    }
    const places = await getPlacesForDestination(db, destinationRow.id);
    const goals = TIER_GOALS[destination.tier];
    const markdown = buildExportMarkdown(`${destination.nameEn} (${destination.namePt})`, places.map(toExportPlace), goals);
    const outPath = path.join(EXPORTS_DIR, `${destination.slug}.md`);
    fs.writeFileSync(outPath, markdown);
    console.log(`${destination.slug}: wrote ${outPath} (${places.length} places)`);
  }

  await closeCurateDb();
}

// ─── entrypoint ─────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const selection = resolveSelection(opts);

  if (opts.command === "generate") {
    await runGenerate(opts, selection);
  } else if (opts.command === "verify") {
    await runVerify(opts, selection);
  } else if (opts.command === "translate") {
    await runTranslate(opts, selection);
  } else {
    await runExport(opts, selection);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
