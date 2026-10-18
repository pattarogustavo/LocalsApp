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
import { validateRedescribed, findBatchRepetitionIds, isTooLong, isLongDescription, type RedescribeValidationResult } from "./redescribe-validate";
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

/** Asked only for a single overlong text (one language, one place) — never the whole batch. Returns null if the call failed or came back unusable; the caller keeps the place invalid in that case. */
export type ShortenCallFn = (text: string, lang: "pt" | "en") => Promise<string | null>;

export interface AcceptedRewrite {
  id: number;
  pt: string;
  en: string;
  lowKnowledge: boolean;
}

export type InvalidCategory = "missing" | "length" | "generic" | "repetition" | "translation" | "batch_failure" | "other";

/** Classifies an invalidity's error messages into a reporting bucket — see RedescribeCityDeps and the per-city report grouping in scripts/curate-redescribe.ts. */
export function classifyInvalidReason(errors: string[]): InvalidCategory {
  const text = errors.join(" | ");
  if (/no item .*for this id/.test(text)) return "missing";
  if (/length \d+ is outside/.test(text)) return "length";
  if (/generic template/.test(text)) return "generic";
  if (/repeats another place/.test(text)) return "repetition";
  if (/translation did not complete/.test(text)) return "translation";
  if (/batch failed/.test(text)) return "batch_failure";
  return "other";
}

export interface InvalidRedescribed {
  id: number;
  name: string;
  errors: string[];
  category: InvalidCategory;
  /** The model's last attempted pt/en for this id, kept only for a "length" failure where the rest of the content looked salvageable — see the shortening pass in redescribeCity. Absent for every other category. */
  raw?: { pt: string; en: string; lowKnowledge: boolean };
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

/**
 * Treats `rewrite`'s return value as untrustworthy, regardless of what its
 * declared type promises: a checkpoint loaded from disk, or a malformed
 * model response that slipped past ai.ts's own normalization, can still
 * hand back a string, an object, or an array of garbage. Never throws —
 * anything that isn't a usable array of objects with a string `id` becomes
 * [], which the caller turns into a per-candidate "no item returned"
 * invalidity instead of crashing the whole batch.
 */
function coerceRewriteOutputs(result: unknown): RewrittenItem[] {
  if (!Array.isArray(result)) return [];
  return result.filter((o): o is RewrittenItem => !!o && typeof o === "object" && typeof (o as { id?: unknown }).id === "string");
}

interface InvalidAttempt {
  errors: string[];
  /** Kept only when the model did return something for this id — lets a later "length" failure be salvaged by shortening instead of discarded outright. */
  raw?: { pt: string; en: string; lowKnowledge: boolean };
}

/** One rewrite call over `candidates`, validated individually then checked for cross-item opening-sentence repetition. Never retries — see redescribeChunk for the one-retry policy. Never throws: a rejected call or a malformed response is treated as "no items returned" for this attempt. */
async function attemptRewrite(
  candidates: RedescribeCandidate[],
  rewrite: RewriteCallFn,
): Promise<{ accepted: Map<number, AcceptedRewrite>; invalid: Map<number, InvalidAttempt> }> {
  let outputs: RewrittenItem[];
  try {
    outputs = coerceRewriteOutputs(await rewrite(toRewriteInput(candidates)));
  } catch (err) {
    outputs = [];
    void err; // surfaced per-candidate below as a uniform "no item returned", not re-thrown — see the module doc.
  }
  const outputById = new Map(outputs.map((o) => [o.id, o]));

  const invalid = new Map<number, InvalidAttempt>();
  const passedIndividually: RewrittenItem[] = [];

  for (const c of candidates) {
    const out = outputById.get(String(c.id));
    if (!out) {
      invalid.set(c.id, { errors: ["model returned no item for this id"] });
      continue;
    }
    const pt = typeof out.pt === "string" ? out.pt.trim() : "";
    const en = typeof out.en === "string" ? out.en.trim() : "";
    const result: RedescribeValidationResult = validateRedescribed(pt, en);
    if (!result.valid) {
      invalid.set(c.id, { errors: result.errors, raw: { pt, en, lowKnowledge: !!out.lowKnowledge } });
      continue;
    }
    passedIndividually.push({ id: out.id, pt, en, lowKnowledge: !!out.lowKnowledge });
  }

  const repeatedIds = findBatchRepetitionIds(passedIndividually.map((o) => ({ id: o.id, pt: o.pt, en: o.en })));

  const accepted = new Map<number, AcceptedRewrite>();
  for (const out of passedIndividually) {
    const id = Number(out.id);
    if (repeatedIds.has(out.id)) {
      invalid.set(id, { errors: ["repeats another place's opening sentence in this batch"], raw: out });
      continue;
    }
    accepted.set(id, { id, pt: out.pt, en: out.en, lowKnowledge: out.lowKnowledge });
  }

  return { accepted, invalid };
}

/**
 * Rewrites one batch (<=12 places, same city): a first pass, then exactly
 * one retry for whatever came back invalid (missing, wrong length, still
 * generic, or repeating another item's opening sentence) — still-invalid
 * items after the retry are reported with a classified `category`, and a
 * `raw` pt/en when the model did answer (so a "length" failure can still be
 * salvaged by the shortening pass in redescribeCity), never written as-is.
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
      const info = retry.invalid.get(c.id) ?? first.invalid.get(c.id) ?? { errors: ["invalid"] };
      stillInvalid.push({ id: c.id, name: byId.get(c.id)!.aiName, errors: info.errors, category: classifyInvalidReason(info.errors), raw: info.raw });
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
  /** Shortens a single overlong pt/en text — see the shortening pass below. Defaults to a no-op (always null) when omitted, which simply leaves a "length"-invalid item unsalvaged. */
  shorten?: ShortenCallFn;
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
  /** Written places whose final pt or en exceeds LONG_DESCRIPTION_THRESHOLD (but is still within MAX_DESCRIPTION_LENGTH) — accepted, just worth flagging. */
  longCount: number;
}

export const MAX_SAMPLES_PER_CITY = 5;

/**
 * One shortening attempt for a "length"-invalid item that otherwise looked
 * salvageable (the model DID answer, it just ran long) — shortens only the
 * field(s) that are actually over the limit, keeping the other as-is, then
 * revalidates the pair as a whole. Never throws; a failed/unhelpful shorten
 * call simply leaves that field unchanged, so revalidation still fails and
 * the item stays invalid.
 */
async function trySalvageByShortening(
  raw: { pt: string; en: string; lowKnowledge: boolean },
  shorten: ShortenCallFn,
): Promise<{ pt: string; en: string } | null> {
  let pt = raw.pt;
  let en = raw.en;

  if (isTooLong(pt)) {
    try {
      const shortened = await shorten(pt, "pt");
      if (shortened) pt = shortened.trim();
    } catch {
      // leave pt as-is; the revalidation below will keep this invalid
    }
  }
  if (isTooLong(en)) {
    try {
      const shortened = await shorten(en, "en");
      if (shortened) en = shortened.trim();
    } catch {
      // leave en as-is; the revalidation below will keep this invalid
    }
  }

  return validateRedescribed(pt, en).valid ? { pt, en } : null;
}

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
  const shorten = deps.shorten ?? (async () => null);
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const acceptedAll = new Map<number, AcceptedRewrite>();
  const stillInvalid: InvalidRedescribed[] = [];

  for (const chunk of chunkItems(candidates, chunkSize)) {
    try {
      const { accepted, stillInvalid: invalid } = await redescribeChunk(chunk, deps.rewrite);
      for (const [id, r] of accepted) acceptedAll.set(id, r);
      stillInvalid.push(...invalid);
    } catch (err) {
      // A whole-batch failure (an exception escaping redescribeChunk itself,
      // not just a bad model response — that's already handled inside
      // attemptRewrite) must never take down the rest of the city: only this
      // chunk's places are reported invalid, the next chunk still runs.
      const message = err instanceof Error ? err.message : String(err);
      const errors = [`batch failed: ${message}`];
      for (const c of chunk) stillInvalid.push({ id: c.id, name: c.aiName, errors, category: classifyInvalidReason(errors) });
    }
  }

  // Salvage pass: a "length" failure where the model DID answer gets one
  // targeted shortening attempt (per overlong field) instead of being
  // discarded outright — see trySalvageByShortening.
  const afterShortening: InvalidRedescribed[] = [];
  for (const inv of stillInvalid) {
    if (inv.category === "length" && inv.raw) {
      const salvaged = await trySalvageByShortening(inv.raw, shorten);
      if (salvaged) {
        acceptedAll.set(inv.id, { id: inv.id, pt: salvaged.pt, en: salvaged.en, lowKnowledge: inv.raw.lowKnowledge });
        continue;
      }
      afterShortening.push({ ...inv, errors: [...inv.errors, "shortening retry did not bring it within bounds"] });
      continue;
    }
    afterShortening.push(inv);
  }
  stillInvalid.length = 0;
  stillInvalid.push(...afterShortening);

  const lowKnowledge = [...acceptedAll.values()]
    .filter((r) => r.lowKnowledge)
    .map((r) => ({ id: r.id, name: byId.get(r.id)!.aiName }));

  const samples: BeforeAfterSample[] = [...acceptedAll.values()].slice(0, MAX_SAMPLES_PER_CITY).map((r) => {
    const c = byId.get(r.id)!;
    return { id: r.id, name: c.aiName, before: { pt: c.descriptions.pt, en: c.descriptions.en }, after: { pt: r.pt, en: r.en } };
  });

  let rewritten = 0;
  let longCount = 0;
  for (const chunk of chunkItems([...acceptedAll.values()], translateChunkSize)) {
    let translated: { id: string; es?: string; fr?: string; de?: string; it?: string }[];
    try {
      const result = await deps.translate(chunk.map((r) => ({ id: String(r.id), en: r.en })));
      translated = Array.isArray(result)
        ? result.filter((t): t is { id: string; es?: string; fr?: string; de?: string; it?: string } => !!t && typeof t === "object" && typeof (t as { id?: unknown }).id === "string")
        : [];
    } catch {
      translated = [];
    }
    const translatedById = new Map(translated.map((t) => [t.id, t]));
    for (const r of chunk) {
      const full = assembleCompleteDescriptions(r.pt, r.en, translatedById.get(String(r.id)));
      if (!full) {
        const errors = ["translation did not complete all four languages"];
        stillInvalid.push({ id: r.id, name: byId.get(r.id)!.aiName, errors, category: classifyInvalidReason(errors) });
        continue;
      }
      await deps.write(r.id, full);
      rewritten++;
      if (isLongDescription(r.pt) || isLongDescription(r.en)) longCount++;
    }
  }

  return { selected: candidates.length, rewritten, stillInvalid, lowKnowledge, samples, longCount };
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
