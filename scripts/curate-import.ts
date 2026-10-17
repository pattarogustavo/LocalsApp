import "./load-env.js";

import fs from "node:fs";
import path from "node:path";

import { parseImportArgs, type ImportOptions } from "./curate/import-cli";
import {
  parseImportFileContent,
  resolveCityDestination,
  ImportParseError,
  type ImportCityBlock,
  type ResolvedCityDestination,
} from "./curate/import-json";
import { resolveDestinationForCity, planCityPlaces, type ImportPlaceResolved, type ImportPlaceRejection, type ImportInvalidInput } from "./curate/import-run";
import { translateMissingDescriptions } from "./curate/import-translate";
import { buildBaseDescriptions } from "./curate/descriptions";
import type { Descriptions } from "./curate/descriptions";
import { newAiCallStats, type AiCallStats } from "./curate/ai";
import { GoogleCallBudget, resolveCityCenter, findPlaceMatches, findPlaceMatchesByTextSearch } from "./curate/google";
import { newDiscardReasonCounts } from "./curate/verify";
import { runIsolated } from "./curate/city-isolation";
import { confirmDatabaseWrite } from "./curate/confirm";
import { estimateTotalCostUsd, formatModelCostUsd } from "./data/model-prices";
import { DESTINATIONS, countryNameFor } from "./data/destinations";
import { MAX_DISTANCE_FROM_CENTER_KM } from "./data/curation-config";
import {
  getCurateDb,
  closeCurateDb,
  assertCuratedTablesExist,
  upsertDestinationMeta,
  getDestinationBySlug,
  getExistingPlaceIds,
  insertPendingPlaces,
  type CurateDb,
} from "./curate/db";
import type { InsertCuratedDestination, InsertCuratedPlace } from "../drizzle/schema";

const ROOT_DIR = process.cwd();

const DESTINATION_SEEDS_FOR_SLUG_MATCH = DESTINATIONS.map((d) => ({ slug: d.slug, nameEn: d.nameEn, namePt: d.namePt, countryCode: d.countryCode, tier: d.tier }));

// ─── gathering input files ──────────────────────────────────────────────────

interface LoadedFile {
  path: string;
  cities: ImportCityBlock[];
}

interface FailedFile {
  path: string;
  message: string;
  line?: number;
}

function listImportFiles(opts: ImportOptions): string[] {
  if (opts.file) return [path.resolve(ROOT_DIR, opts.file)];
  const dir = path.resolve(ROOT_DIR, opts.dir!);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Parses every input file, tolerating a bad one: it's reported as failed and the rest still run. */
function loadImportFiles(filePaths: string[]): { loaded: LoadedFile[]; failed: FailedFile[] } {
  const loaded: LoadedFile[] = [];
  const failed: FailedFile[] = [];
  for (const filePath of filePaths) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = parseImportFileContent(raw);
      loaded.push({ path: filePath, cities: parsed.cities });
    } catch (err) {
      const line = err instanceof ImportParseError ? err.line : undefined;
      failed.push({ path: filePath, message: (err as Error).message, line });
    }
  }
  return { loaded, failed };
}

// ─── per-city import ────────────────────────────────────────────────────────

interface CityReport {
  slug: string;
  isNewDestination: boolean;
  slugInferred: boolean;
  inserted: number;
  alreadyExisting: number;
  rejected: ImportPlaceRejection[];
  invalidInput: ImportInvalidInput[];
  translatedCount: number;
  languageRetryAccepted: number;
  typeRetryAccepted: number;
  googleCalls: number;
  error?: string;
}

function emptyCityReport(slug: string, googleCalls: number, error?: string): CityReport {
  return {
    slug,
    isNewDestination: false,
    slugInferred: false,
    inserted: 0,
    alreadyExisting: 0,
    rejected: [],
    invalidInput: [],
    translatedCount: 0,
    languageRetryAccepted: 0,
    typeRetryAccepted: 0,
    googleCalls,
    error,
  };
}

/** Never throws: every failure (lock contention, a bad destination, a network error, ...) becomes this city's report instead of aborting the whole run — see scripts/curate/city-isolation.ts. */
async function importCity(
  resolvedIdentity: ResolvedCityDestination,
  block: ImportCityBlock,
  opts: ImportOptions,
  db: CurateDb | null,
  budget: GoogleCallBudget,
  aiStats: AiCallStats,
): Promise<CityReport> {
  const slug = resolvedIdentity.slug;
  const googleCallsBefore = budget.count;

  return runIsolated(
    ROOT_DIR,
    slug,
    () => importCityUnlocked(resolvedIdentity, block, opts, db, budget, aiStats),
    (err) => emptyCityReport(slug, budget.count - googleCallsBefore, err.message),
  );
}

async function importCityUnlocked(
  resolvedIdentity: ResolvedCityDestination,
  block: ImportCityBlock,
  opts: ImportOptions,
  db: CurateDb | null,
  budget: GoogleCallBudget,
  aiStats: AiCallStats,
): Promise<CityReport> {
  const slug = resolvedIdentity.slug;
  const googleCallsBefore = budget.count;

  const destination = await resolveDestinationForCity(
    resolvedIdentity,
    (s) => DESTINATIONS.find((d) => d.slug === s),
    async (s) => {
      if (!db) return undefined;
      const row = await getDestinationBySlug(db, s);
      if (!row) return undefined;
      return { nameEn: row.nameEn, namePt: row.namePt, country: row.country, countryCode: row.countryCode, tier: row.tier, googlePlaceId: row.googlePlaceId };
    },
    countryNameFor,
  );

    const center = await resolveCityCenter(destination.nameEn, destination.country, budget);
    if (!center) throw new Error(`Could not resolve a center point for "${destination.nameEn}, ${destination.country}"`);
    if (destination.isNew) destination.googlePlaceId = center.placeId;

    const discardCounts = newDiscardReasonCounts();
    const plan = await planCityPlaces({
      places: block.places,
      destinationName: destination.nameEn,
      countryCode: destination.countryCode,
      center,
      maxDistanceKm: MAX_DISTANCE_FROM_CENTER_KM,
      discardCounts,
      findByText: (names, neighborhood, language) => findPlaceMatches(names[0], neighborhood, destination.nameEn, center, budget, language),
      findByTextSearch: (names, type) => findPlaceMatchesByTextSearch(names[0], destination.nameEn, center, budget, type),
    });

    let toInsert = plan.resolved;
    let alreadyExisting = 0;
    let translatedCount = 0;

    if (!opts.dryRun && db) {
      const destinationRow = await upsertDestinationMeta(db, {
        slug: destination.slug,
        nameEn: destination.nameEn,
        namePt: destination.namePt,
        country: destination.country,
        countryCode: destination.countryCode,
        tier: destination.tier as InsertCuratedDestination["tier"],
        googlePlaceId: destination.googlePlaceId ?? center.placeId,
        status: "active",
      });

      const existingIds = await getExistingPlaceIds(db, destinationRow.id);
      alreadyExisting = toInsert.filter((p) => existingIds.has(p.googlePlaceId)).length;
      toInsert = toInsert.filter((p) => !existingIds.has(p.googlePlaceId));

      if (opts.translate && toInsert.length > 0) {
        const items = toInsert.map((p) => ({ id: p.googlePlaceId, descriptions: p.descriptions }));
        const translated = await translateMissingDescriptions(destination.nameEn, items, aiStats);
        for (const place of toInsert) {
          const merged = translated.get(place.googlePlaceId);
          if (merged) {
            place.descriptions = merged;
            translatedCount++;
          }
        }
      }

      const rows: InsertCuratedPlace[] = toInsert.map((p) => toInsertRow(p, destinationRow.id, destination.slug, opts.status));
      await insertPendingPlaces(db, rows); // idempotent (onConflictDoNothing)

      return {
        slug,
        isNewDestination: destination.isNew,
        slugInferred: resolvedIdentity.slugInferred,
        inserted: rows.length,
        alreadyExisting,
        rejected: plan.rejected,
        invalidInput: plan.invalidInput,
        translatedCount,
        languageRetryAccepted: plan.languageRetryAccepted,
        typeRetryAccepted: plan.typeRetryAccepted,
        googleCalls: budget.count - googleCallsBefore,
      };
    }

    // --dry-run: no DB access at all, just report what would happen.
    if (opts.translate && toInsert.length > 0) {
      const items = toInsert.map((p) => ({ id: p.googlePlaceId, descriptions: p.descriptions }));
      const translated = await translateMissingDescriptions(destination.nameEn, items, aiStats);
      translatedCount = translated.size;
    }

    return {
      slug,
      isNewDestination: destination.isNew,
      slugInferred: resolvedIdentity.slugInferred,
      inserted: toInsert.length,
      alreadyExisting,
      rejected: plan.rejected,
      invalidInput: plan.invalidInput,
      translatedCount,
      languageRetryAccepted: plan.languageRetryAccepted,
      typeRetryAccepted: plan.typeRetryAccepted,
      googleCalls: budget.count - googleCallsBefore,
    };
}

function toInsertRow(place: ImportPlaceResolved, destinationId: number, destinationSlug: string, status: ImportOptions["status"]): InsertCuratedPlace {
  const descriptions: Descriptions = { ...buildBaseDescriptions(place.descriptions.pt, place.descriptions.en), ...place.descriptions };
  return {
    destinationId,
    destinationSlug,
    googlePlaceId: place.googlePlaceId,
    aiName: place.requestedName,
    aiNeighborhood: place.neighborhood,
    category: place.category as InsertCuratedPlace["category"],
    tags: place.tags,
    priceTier: place.priceTier as InsertCuratedPlace["priceTier"],
    meals: place.meals,
    cuisine: place.cuisine,
    confidence: place.confidence as InsertCuratedPlace["confidence"],
    status,
    source: "manual",
    descriptions,
  };
}

// ─── reporting ──────────────────────────────────────────────────────────────

function printCityReport(report: CityReport): void {
  console.log(`\n=== ${report.slug} ===`);
  if (report.error) {
    console.log(`  falhou: ${report.error}`);
    return;
  }
  if (report.slugInferred) console.log(`  aviso: slug ausente no arquivo, inferido como "${report.slug}" por nome + país`);
  console.log(`  destino ${report.isNewDestination ? "novo" : "existente"}`);
  console.log(`  inseridos=${report.inserted} já existentes=${report.alreadyExisting} rejeitados=${report.rejected.length} inválidos=${report.invalidInput.length}`);
  if (report.translatedCount > 0) console.log(`  idiomas traduzidos para ${report.translatedCount} lugar(es)`);
  if (report.languageRetryAccepted > 0) console.log(`  aceitos na segunda busca (outro idioma): ${report.languageRetryAccepted}`);
  if (report.typeRetryAccepted > 0) console.log(`  aceitos no retry por tipo (Text Search): ${report.typeRetryAccepted}`);
  console.log(`  chamadas ao Google: ${report.googleCalls}`);
  for (const r of report.rejected.slice(0, 20)) {
    const names = r.googleNames.length > 0 ? ` (Google: ${r.googleNames.map((n) => `"${n}"`).join(" / ")})` : "";
    console.log(`    rejeitado "${r.name}": ${r.reason}${names}`);
  }
  if (report.rejected.length > 20) console.log(`    ...e mais ${report.rejected.length - 20}`);
  for (const i of report.invalidInput.slice(0, 20)) {
    console.log(`    inválido "${i.name}": ${i.errors.join("; ")}`);
  }
  if (report.invalidInput.length > 20) console.log(`    ...e mais ${report.invalidInput.length - 20}`);
}

function printTotals(reports: CityReport[], failedFiles: FailedFile[], aiStats: AiCallStats): void {
  const ok = reports.filter((r) => !r.error);
  const totals = {
    inserted: ok.reduce((n, r) => n + r.inserted, 0),
    alreadyExisting: ok.reduce((n, r) => n + r.alreadyExisting, 0),
    rejected: ok.reduce((n, r) => n + r.rejected.length, 0),
    invalidInput: ok.reduce((n, r) => n + r.invalidInput.length, 0),
    translatedCount: ok.reduce((n, r) => n + r.translatedCount, 0),
    languageRetryAccepted: ok.reduce((n, r) => n + r.languageRetryAccepted, 0),
    typeRetryAccepted: ok.reduce((n, r) => n + r.typeRetryAccepted, 0),
    googleCalls: reports.reduce((n, r) => n + r.googleCalls, 0),
  };
  console.log("\n=== Total ===");
  console.log(`cidades ok=${ok.length} falharam=${reports.length - ok.length + failedFiles.length}`);
  console.log(`inseridos=${totals.inserted} já existentes=${totals.alreadyExisting} rejeitados=${totals.rejected} inválidos=${totals.invalidInput}`);
  console.log(`idiomas traduzidos: ${totals.translatedCount} lugar(es)`);
  console.log(`aceitos na segunda busca (idioma): ${totals.languageRetryAccepted} | aceitos no retry por tipo: ${totals.typeRetryAccepted}`);
  console.log(`chamadas ao Google: ${totals.googleCalls}`);
  if (aiStats.calls > 0) {
    console.log(`custo estimado de tradução: ${formatModelCostUsd(estimateTotalCostUsd(aiStats.byModel))}`);
  }
  if (failedFiles.length > 0) {
    console.log("\nArquivos com falha:");
    for (const f of failedFiles) console.log(`  ${f.path}: ${f.message}${f.line ? ` (linha ${f.line})` : ""}`);
  }
  const anyFailed = reports.some((r) => r.error) || failedFiles.length > 0;
  if (anyFailed) process.exitCode = 1;
}

// ─── entrypoint ─────────────────────────────────────────────────────────────

async function main() {
  const opts = parseImportArgs(process.argv.slice(2));

  await confirmDatabaseWrite(opts);

  const filePaths = listImportFiles(opts);
  const { loaded, failed } = loadImportFiles(filePaths);

  const db = opts.dryRun ? null : getCurateDb();
  if (db) await assertCuratedTablesExist(db);

  const budget = new GoogleCallBudget(opts.maxGoogleCalls);
  const aiStats = newAiCallStats();
  const reports: CityReport[] = [];

  try {
    for (const file of loaded) {
      for (const block of file.cities) {
        const slugOutcome = resolveCityDestination(block.destination, DESTINATION_SEEDS_FOR_SLUG_MATCH);
        if (!slugOutcome.ok) {
          const keys = JSON.stringify(block.destination);
          const report = emptyCityReport("(desconhecido)", 0, `${slugOutcome.reason} — arquivo ${file.path}, destination=${keys}`);
          reports.push(report);
          printCityReport(report);
          continue;
        }

        const report = await importCity(slugOutcome.destination, block, opts, db, budget, aiStats);
        reports.push(report);
        printCityReport(report);
      }
    }
  } finally {
    if (db) await closeCurateDb();
    printTotals(reports, failed, aiStats);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
