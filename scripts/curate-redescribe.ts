import "./load-env.js";

import { parseRedescribeArgs } from "./curate/redescribe-cli";
import { selectRedescribeCandidates } from "./curate/redescribe-select";
import {
  redescribeCity,
  AiCallBudget,
  AiCallBudgetExceededError,
  type RedescribeCandidate,
  type RedescribeCityReport,
} from "./curate/redescribe-run";
import { newAiCallStats, type AiCallStats } from "./curate/ai";
import { checkpointedRewrite, checkpointedTranslate, checkpointedShorten, type BatchIssue } from "./curate/redescribe-checkpoint";
import { runIsolated } from "./curate/city-isolation";
import { confirmDatabaseWrite } from "./curate/confirm";
import { estimateTotalCostUsd, formatModelCostUsd } from "./data/model-prices";
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

/** Default cap on rewrite+translate+shorten AI calls across the whole run. */
const DEFAULT_MAX_AI_CALLS = 500;

function mergeAiCallStats(target: AiCallStats, source: AiCallStats): void {
  target.calls += source.calls;
  target.promptTokens += source.promptTokens;
  target.completionTokens += source.completionTokens;
  target.webSearchRequests += source.webSearchRequests;
  for (const [model, usage] of Object.entries(source.byModel)) {
    const existing = target.byModel[model] ?? { calls: 0, promptTokens: 0, completionTokens: 0 };
    existing.calls += usage.calls;
    existing.promptTokens += usage.promptTokens;
    existing.completionTokens += usage.completionTokens;
    target.byModel[model] = existing;
  }
}

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

interface CityRunResult extends RedescribeCityReport {
  slug: string;
  error?: string;
  batchIssues: BatchIssue[];
  stats: AiCallStats;
}

async function runCity(
  db: CurateDb | null,
  slug: string,
  candidates: RedescribeCandidate[],
  dryRun: boolean,
  budget: AiCallBudget,
): Promise<CityRunResult> {
  const batchIssues: BatchIssue[] = [];
  const stats = newAiCallStats();
  return runIsolated(
    ROOT_DIR,
    slug,
    async () => {
      const destinationRow = db ? await getDestinationBySlug(db, slug) : undefined;
      const destinationName = destinationRow?.nameEn ?? slug;
      const country = destinationRow?.country ?? "";

      const report = await redescribeCity(candidates, {
        rewrite: checkpointedRewrite(ROOT_DIR, slug, destinationName, country, stats, budget, batchIssues),
        translate: checkpointedTranslate(ROOT_DIR, slug, destinationName, stats, budget, batchIssues),
        shorten: checkpointedShorten(ROOT_DIR, slug, stats, budget),
        write: dryRun || !db ? async () => {} : (id, descriptions) => updatePlaceDescriptions(db, id, descriptions),
      });

      return { ...report, slug, batchIssues, stats };
    },
    (err) => ({
      slug,
      selected: candidates.length,
      rewritten: 0,
      stillInvalid: [],
      lowKnowledge: [],
      samples: [],
      longCount: 0,
      batchIssues,
      stats,
      error: err.message,
    }),
  );
}

function groupByCategory(stillInvalid: RedescribeCityReport["stillInvalid"]): string {
  const counts = new Map<string, number>();
  for (const i of stillInvalid) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
  if (counts.size === 0) return "(nenhum)";
  return [...counts.entries()].map(([category, n]) => `${category}=${n}`).join(", ");
}

function printCityReport(report: CityRunResult): void {
  console.log(`\n=== ${report.slug} ===`);
  if (report.error) {
    console.log(`  falhou: ${report.error}`);
    return;
  }
  console.log(`  selecionados=${report.selected} reescritos=${report.rewritten} ainda inválidos=${report.stillInvalid.length} lowKnowledge=${report.lowKnowledge.length} longas=${report.longCount}`);
  console.log(`  inválidos por motivo: ${groupByCategory(report.stillInvalid)}`);
  if (report.lowKnowledge.length > 0) {
    console.log(`  lowKnowledge: ${report.lowKnowledge.map((p) => p.name).join(", ")}`);
  }
  for (const i of report.stillInvalid.slice(0, 20)) {
    console.log(`    inválido [${i.category}] "${i.name}" (id=${i.id}): ${i.errors.join("; ")}`);
  }
  if (report.stillInvalid.length > 20) console.log(`    ...e mais ${report.stillInvalid.length - 20}`);
  for (const issue of report.batchIssues) {
    console.log(`  lote problemático (${issue.kind}, ids=${issue.ids.join(",")}): formato recebido="${issue.shape}"${issue.sample ? ` amostra="${issue.sample}"` : ""}`);
  }
  for (const sample of report.samples) {
    console.log(`  exemplo "${sample.name}" (id=${sample.id}):`);
    console.log(`    antes pt: ${sample.before.pt ?? "(vazio)"}`);
    console.log(`    depois pt: ${sample.after.pt}`);
    console.log(`    antes en: ${sample.before.en ?? "(vazio)"}`);
    console.log(`    depois en: ${sample.after.en}`);
  }
  if (report.stats.calls > 0) {
    console.log(`  chamadas de IA: ${report.stats.calls} | custo estimado: ${formatModelCostUsd(estimateTotalCostUsd(report.stats.byModel))}`);
  }
}

function printTotals(reports: CityRunResult[], stats: AiCallStats): void {
  const ok = reports.filter((r) => !r.error);
  console.log("\n=== Total ===");
  console.log(`cidades ok=${ok.length} falharam=${reports.length - ok.length}`);
  console.log(`selecionados=${ok.reduce((n, r) => n + r.selected, 0)} reescritos=${ok.reduce((n, r) => n + r.rewritten, 0)}`);
  console.log(`ainda inválidos=${ok.reduce((n, r) => n + r.stillInvalid.length, 0)} lowKnowledge=${ok.reduce((n, r) => n + r.lowKnowledge.length, 0)} longas=${ok.reduce((n, r) => n + r.longCount, 0)}`);
  console.log(`inválidos por motivo (total): ${groupByCategory(ok.flatMap((r) => r.stillInvalid))}`);
  const totalBatchIssues = reports.reduce((n, r) => n + r.batchIssues.length, 0);
  if (totalBatchIssues > 0) console.log(`lotes com resposta malformada: ${totalBatchIssues}`);
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
        const report = await runCity(db, slug, candidates, opts.dryRun, budget);
        mergeAiCallStats(stats, report.stats);
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
