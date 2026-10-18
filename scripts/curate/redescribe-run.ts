/**
 * Per-city orchestration for curate:redescribe: rewriting a batch of up to
 * 12 generic-template places, retrying invalid/repeated items once, then
 * translating and writing each place's FULL descriptions record atomically
 * (pt+en+es+fr+de+it in one write) so a place can never end up with new
 * pt/en mixed with a stale translation, or a half-translated record. Free
 * of direct DB/network calls (everything is injected) so it's fully
 * testable with fakes, the same way scripts/curate/import-run.ts is.
 */

import { chunkItems } from "./chunk";
import { validateRedescribed, findBatchRepetitionIds, type RedescribeValidationResult } from "./redescribe-validate";
import type { Descriptions } from "./descriptions";

export const REDESCRIBE_CHUNK_SIZE = 12;
export const REDESCRIBE_TRANSLATE_CHUNK_SIZE = 15;

export interface RedescribeCandidate {
  id: number;
  aiName: string;
  aiNeighborhood?: string | null;
  category: string;
  cuisine?: string | null;
  descriptions: Descriptions;
}

export interface RewrittenItem {
  id: string;
  pt: string;
  en: string;
  lowKnowledge: boolean;
}

export type RewriteCallFn = (
  items: { id: string; name: string; neighborhood?: string; category: string; cuisine?: string }[],
) => Promise<RewrittenItem[]>;

export type TranslateCallFn = (
  items: { id: string; en: string }[],
) => Promise<{ id: string; es?: string; fr?: string; de?: string; it?: string }[]>;

export interface AcceptedRewrite {
  id: number;
  pt: string;
  en: string;
  lowKnowledge: boolean;
}

export interface InvalidRedescribed {
  id: number;
  name: string;
  errors: string[];
}

function toRewriteInput(candidates: RedescribeCandidate[]) {
  return candidates.map((c) => ({
    id: String(c.id),
    name: c.aiName,
    neighborhood: c.aiNeighborhood ?? undefined,
    category: c.category,
    cuisine: c.cuisine ?? undefined,
  }));
}

/** One rewrite call over `candidates`, validated individually then checked for cross-item opening-sentence repetition. Never retries — see redescribeChunk for the one-retry policy. */
async function attemptRewrite(
  candidates: RedescribeCandidate[],
  rewrite: RewriteCallFn,
): Promise<{ accepted: Map<number, AcceptedRewrite>; invalid: Map<number, string[]> }> {
  const outputs = await rewrite(toRewriteInput(candidates));
  const outputById = new Map(outputs.map((o) => [o.id, o]));

  const invalid = new Map<number, string[]>();
  const passedIndividually: RewrittenItem[] = [];

  for (const c of candidates) {
    const out = outputById.get(String(c.id));
    if (!out) {
      invalid.set(c.id, ["model returned no item for this id"]);
      continue;
    }
    const result: RedescribeValidationResult = validateRedescribed(out.pt, out.en);
    if (!result.valid) {
      invalid.set(c.id, result.errors);
      continue;
    }
    passedIndividually.push({ ...out, pt: out.pt.trim(), en: out.en.trim() });
  }

  const repeatedIds = findBatchRepetitionIds(passedIndividually.map((o) => ({ id: o.id, pt: o.pt, en: o.en })));

  const accepted = new Map<number, AcceptedRewrite>();
  for (const out of passedIndividually) {
    const id = Number(out.id);
    if (repeatedIds.has(out.id)) {
      invalid.set(id, ["repeats another place's opening sentence in this batch"]);
      continue;
    }
    accepted.set(id, { id, pt: out.pt, en: out.en, lowKnowledge: !!out.lowKnowledge });
  }

  return { accepted, invalid };
}

/**
 * Rewrites one batch (<=12 places, same city): a first pass, then exactly
 * one retry for whatever came back invalid (missing, wrong length, still
 * generic, or repeating another item's opening sentence) — still-invalid
 * items after the retry are reported untouched, never written.
 */
export async function redescribeChunk(
  candidates: RedescribeCandidate[],
  rewrite: RewriteCallFn,
): Promise<{ accepted: Map<number, AcceptedRewrite>; stillInvalid: InvalidRedescribed[] }> {
  if (candidates.length === 0) return { accepted: new Map(), stillInvalid: [] };

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const first = await attemptRewrite(candidates, rewrite);
  if (first.invalid.size === 0) return { accepted: first.accepted, stillInvalid: [] };

  const retryCandidates = candidates.filter((c) => first.invalid.has(c.id));
  const retry = await attemptRewrite(retryCandidates, rewrite);

  const accepted = new Map(first.accepted);
  for (const [id, r] of retry.accepted) accepted.set(id, r);

  const stillInvalid: InvalidRedescribed[] = [];
  for (const c of retryCandidates) {
    if (!retry.accepted.has(c.id)) {
      stillInvalid.push({ id: c.id, name: byId.get(c.id)!.aiName, errors: retry.invalid.get(c.id) ?? first.invalid.get(c.id) ?? ["invalid"] });
    }
  }

  return { accepted, stillInvalid };
}

/** Builds the complete descriptions record for one place, or null if the translation didn't come back with all four languages — a place is never written with a partial set. */
export function assembleCompleteDescriptions(
  pt: string,
  en: string,
  translated: { es?: string; fr?: string; de?: string; it?: string } | undefined,
): Descriptions | null {
  const es = translated?.es?.trim();
  const fr = translated?.fr?.trim();
  const de = translated?.de?.trim();
  const it = translated?.it?.trim();
  if (!es || !fr || !de || !it) return null;
  return { pt, en, es, fr, de, it };
}

export interface RedescribeCityDeps {
  rewrite: RewriteCallFn;
  translate: TranslateCallFn;
  /** Writes the place's FULL descriptions record in one atomic update. Never called for a place whose translation didn't complete. */
  write: (id: number, descriptions: Descriptions) => Promise<void>;
  chunkSize?: number;
  translateChunkSize?: number;
}

export interface BeforeAfterSample {
  id: number;
  name: string;
  before: { pt?: string; en?: string };
  after: { pt: string; en: string };
}

export interface RedescribeCityReport {
  selected: number;
  rewritten: number;
  stillInvalid: InvalidRedescribed[];
  lowKnowledge: { id: number; name: string }[];
  samples: BeforeAfterSample[];
}

export const MAX_SAMPLES_PER_CITY = 5;

/**
 * Runs the full rewrite -> translate -> write pipeline for one city's
 * selected candidates. `deps.write` is the only place a database write
 * happens — the entrypoint passes a no-op there for --dry-run, which still
 * exercises the full rewrite/translate/validation pipeline so the printed
 * before/after samples are real model output, not a guess.
 */
export async function redescribeCity(candidates: RedescribeCandidate[], deps: RedescribeCityDeps): Promise<RedescribeCityReport> {
  const chunkSize = deps.chunkSize ?? REDESCRIBE_CHUNK_SIZE;
  const translateChunkSize = deps.translateChunkSize ?? REDESCRIBE_TRANSLATE_CHUNK_SIZE;
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const acceptedAll = new Map<number, AcceptedRewrite>();
  const stillInvalid: InvalidRedescribed[] = [];

  for (const chunk of chunkItems(candidates, chunkSize)) {
    const { accepted, stillInvalid: invalid } = await redescribeChunk(chunk, deps.rewrite);
    for (const [id, r] of accepted) acceptedAll.set(id, r);
    stillInvalid.push(...invalid);
  }

  const lowKnowledge = [...acceptedAll.values()]
    .filter((r) => r.lowKnowledge)
    .map((r) => ({ id: r.id, name: byId.get(r.id)!.aiName }));

  const samples: BeforeAfterSample[] = [...acceptedAll.values()].slice(0, MAX_SAMPLES_PER_CITY).map((r) => {
    const c = byId.get(r.id)!;
    return { id: r.id, name: c.aiName, before: { pt: c.descriptions.pt, en: c.descriptions.en }, after: { pt: r.pt, en: r.en } };
  });

  let rewritten = 0;
  for (const chunk of chunkItems([...acceptedAll.values()], translateChunkSize)) {
    const translated = await deps.translate(chunk.map((r) => ({ id: String(r.id), en: r.en })));
    const translatedById = new Map(translated.map((t) => [t.id, t]));
    for (const r of chunk) {
      const full = assembleCompleteDescriptions(r.pt, r.en, translatedById.get(String(r.id)));
      if (!full) {
        stillInvalid.push({ id: r.id, name: byId.get(r.id)!.aiName, errors: ["translation did not complete all four languages"] });
        continue;
      }
      await deps.write(r.id, full);
      rewritten++;
    }
  }

  return { selected: candidates.length, rewritten, stillInvalid, lowKnowledge, samples };
}

export class AiCallBudgetExceededError extends Error {}

/** Caps total AI calls (rewrite + translate) across the whole run, same spirit as GoogleCallBudget in scripts/curate/google.ts. */
export class AiCallBudget {
  count = 0;
  constructor(private readonly max: number) {}
  consume(n = 1): void {
    this.count += n;
    if (this.count > this.max) throw new AiCallBudgetExceededError(`AI call budget exceeded (${this.max})`);
  }
}
