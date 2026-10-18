import "./load-env.js";

import { parseRedescribeArgs } from "./curate/redescribe-cli";
import { selectRedescribeCandidates } from "./curate/redescribe-select";
import {
  redescribeCity,
  AiCallBudget,
  AiCallBudgetExceededError,
  type RedescribeCandidate,
  type RedescribeCityReport,
  type RewrittenItem,
} from "./curate/redescribe-run";
import { redescribeBatch, translateBatch, newAiCallStats, type AiCallStats } from "./curate/ai";
import type { RedescribeItem } from "./curate/prompts";
import { runIsolated } from "./curate/city-isolation";
import { confirmDatabaseWrite } from "./curate/confirm";
import { estimateTotalCostUsd, formatModelCostUsd } from "./data/model-prices";
import { saveCheckpoint, loadCheckpoint } from "./curate/checkpoint";
import {
  getCurateDb,
  closeCurateDb,
  assertCuratedTablesExist,
  getCandidatePlacesForRedescribe,
  getDestinationBySlug,
  updatePlaceDescriptions,
  type CurateDb,
} from "./curate/db";
import type { CuratedPlace } from "../drizzle/schema";
import type { Descriptions } from "./curate/descriptions";

const ROOT_DIR = process.cwd();

/** Default cap on rewrite+translate AI calls across the whole run. */
const DEFAULT_MAX_AI_CALLS = 500;

function toCandidate(row: CuratedPlace): RedescribeCandidate {
  return {
    id: row.id,
    aiName: row.aiName,
    aiNeighborhood: row.aiNeighborhood,
    category: row.category,
    cuisine: row.cuisine,
    descriptions: (row.descriptions ?? {}) as Descriptions,
  };
}

/** A checkpointed rewrite call: the batch (keyed by its sorted candidate ids) is skipped and reused on resume instead of calling the model again. */
function checkpointedRewrite(slug: string, destinationName: string, country: string, stats: AiCallStats, budget: AiCallBudget) {
  return async (items: RedescribeItem[]): Promise<RewrittenItem[]> => {
    const key = `redescribe-${items.map((i) => i.id).sort((a, b) => Number(a) - Number(b)).join("_")}`;
    const cached = loadCheckpoint<RewrittenItem[]>(ROOT_DIR, slug, key);
    if (cached) return cached;
    budget.consume(1);
    const result = await redescribeBatch(destinationName, country, items, stats);
    saveCheckpoint(ROOT_DIR, slug, key, result.items);
    return result.items;
  };
}

function checkpointedTranslate(slug: string, destinationName: string, stats: AiCallStats, budget: AiCallBudget) {
  return async (items: { id: string; en: string }[]) => {
    const key = `redescribe-translate-${items.map((i) => i.id).sort((a, b) => Number(a) - Number(b)).join("_")}`;
    const cached = loadCheckpoint<{ id: string; es?: string; fr?: string; de?: string; it?: string }[]>(ROOT_DIR, slug, key);
    if (cached) return cached;
    budget.consume(1);
    const result = await translateBatch(destinationName, items, stats);
    saveCheckpoint(ROOT_DIR, slug, key, result.translations);
    return result.translations;
  };
}

interface CityRunResult extends RedescribeCityReport {
  slug: string;
  error?: string;
}

async function runCity(
  db: CurateDb | null,
  slug: string,
  candidates: RedescribeCandidate[],
  dryRun: boolean,
  stats: AiCallStats,
  budget: AiCallBudget,
): Promise<CityRunResult> {
  return runIsolated(
    ROOT_DIR,
    slug,
    async () => {
      const destinationRow = db ? await getDestinationBySlug(db, slug) : undefined;
      const destinationName = destinationRow?.nameEn ?? slug;
      const country = destinationRow?.country ?? "";

      const report = await redescribeCity(candidates, {
        rewrite: checkpointedRewrite(slug, destinationName, country, stats, budget),
        translate: checkpointedTranslate(slug, destinationName, stats, budget),
        write: dryRun || !db ? async () => {} : (id, descriptions) => updatePlaceDescriptions(db, id, descriptions),
      });

      return { ...report, slug };
    },
    (err) => ({
      slug,
      selected: candidates.length,
      rewritten: 0,
      stillInvalid: [],
      lowKnowledge: [],
      samples: [],
      error: err.message,
    }),
  );
}

function printCityReport(report: CityRunResult): void {
  console.log(`\n=== ${report.slug} ===`);
  if (report.error) {
    console.log(`  falhou: ${report.error}`);
    return;
  }
  console.log(`  selecionados=${report.selected} reescritos=${report.rewritten} ainda inválidos=${report.stillInvalid.length} lowKnowledge=${report.lowKnowledge.length}`);
  if (report.lowKnowledge.length > 0) {
    console.log(`  lowKnowledge: ${report.lowKnowledge.map((p) => p.name).join(", ")}`);
  }
  for (const i of report.stillInvalid.slice(0, 20)) {
    console.log(`    inválido "${i.name}" (id=${i.id}): ${i.errors.join("; ")}`);
  }
  if (report.stillInvalid.length > 20) console.log(`    ...e mais ${report.stillInvalid.length - 20}`);
  for (const sample of report.samples) {
    console.log(`  exemplo "${sample.name}" (id=${sample.id}):`);
    console.log(`    antes pt: ${sample.before.pt ?? "(vazio)"}`);
    console.log(`    depois pt: ${sample.after.pt}`);
    console.log(`    antes en: ${sample.before.en ?? "(vazio)"}`);
    console.log(`    depois en: ${sample.after.en}`);
  }
}

function printTotals(reports: CityRunResult[], stats: AiCallStats): void {
  const ok = reports.filter((r) => !r.error);
  console.log("\n=== Total ===");
  console.log(`cidades ok=${ok.length} falharam=${reports.length - ok.length}`);
  console.log(`selecionados=${ok.reduce((n, r) => n + r.selected, 0)} reescritos=${ok.reduce((n, r) => n + r.rewritten, 0)}`);
  console.log(`ainda inválidos=${ok.reduce((n, r) => n + r.stillInvalid.length, 0)} lowKnowledge=${ok.reduce((n, r) => n + r.lowKnowledge.length, 0)}`);
  if (stats.calls > 0) {
    console.log(`chamadas de IA: ${stats.calls} | custo estimado: ${formatModelCostUsd(estimateTotalCostUsd(stats.byModel))}`);
  }
  if (reports.some((r) => r.error)) process.exitCode = 1;
}

async function main() {
  const opts = parseRedescribeArgs(process.argv.slice(2));

  await confirmDatabaseWrite(opts);

  const db = getCurateDb();
  await assertCuratedTablesExist(db);

  const forcedIds = new Set(opts.ids ?? []);
  const rows = await getCandidatePlacesForRedescribe(db, { all: opts.all, slugs: opts.only, ids: opts.ids });
  const selected = selectRedescribeCandidates(rows, forcedIds);

  const bySlug = new Map<string, RedescribeCandidate[]>();
  for (const row of selected) {
    const list = bySlug.get(row.destinationSlug) ?? [];
    list.push(toCandidate(row));
    bySlug.set(row.destinationSlug, list);
  }

  if (opts.dryRun) {
    console.log(`\n--dry-run: ${selected.length} lugar(es) selecionado(s) em ${bySlug.size} cidade(s). Nada será gravado.`);
  }

  const stats = newAiCallStats();
  const budget = new AiCallBudget(DEFAULT_MAX_AI_CALLS);
  const reports: CityRunResult[] = [];

  try {
    for (const [slug, candidates] of bySlug) {
      try {
        const report = await runCity(db, slug, candidates, opts.dryRun, stats, budget);
        reports.push(report);
        printCityReport(report);
      } catch (err) {
        if (err instanceof AiCallBudgetExceededError) {
          console.log(`\nLimite de chamadas de IA atingido (${DEFAULT_MAX_AI_CALLS}). Interrompendo.`);
          break;
        }
        throw err;
      }
    }
  } finally {
    await closeCurateDb();
    printTotals(reports, stats);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
