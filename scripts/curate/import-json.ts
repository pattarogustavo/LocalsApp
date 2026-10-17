/**
 * Tolerant JSON extraction/parsing for curate:import. Input files may be a
 * bare JSON object, a ```json fenced block, or free text with a JSON object
 * embedded somewhere in it (e.g. copy-pasted from a chat) — this module
 * finds and parses the first balanced JSON object it can, and otherwise
 * reports exactly where parsing failed.
 */

export interface ImportDestinationBlock {
  slug?: unknown;
  nameEn?: unknown;
  namePt?: unknown;
  /** Generic alternative to nameEn/namePt, accepted only for slug inference below. */
  name?: unknown;
  country?: unknown;
  countryCode?: unknown;
  tier?: unknown;
}

export interface ImportRawPlace {
  name?: unknown;
  /** Alternative names (e.g. the same place in another language) — any of them matching Google's result is enough to accept a candidate. */
  altNames?: unknown;
  neighborhood?: unknown;
  category?: unknown;
  tags?: unknown;
  priceTier?: unknown;
  meals?: unknown;
  cuisine?: unknown;
  confidence?: unknown;
  descriptions?: unknown;
}

export interface ImportCityBlock {
  destination: ImportDestinationBlock;
  places: ImportRawPlace[];
}

export interface ParsedImportFile {
  cities: ImportCityBlock[];
}

export class ImportParseError extends Error {
  /** 1-based line number the error points to, when known. */
  line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.name = "ImportParseError";
    this.line = line;
  }
}

/** 1-based line number containing character offset `index` in `text`. */
function lineAtOffset(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/** Extracts the position JSON.parse's error message reports (V8's "...at position N"), if any. */
function positionFromJsonError(err: unknown): number | undefined {
  const match = (err as Error)?.message?.match(/position (\d+)/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Scans `text` starting at `from` for a balanced `{...}` object, respecting
 * string literals (so a brace inside a quoted string never counts). Returns
 * the substring from the opening brace through its match, or null if `text`
 * has no `{` at or after `from`, or the braces never balance.
 */
function extractBalancedObject(text: string, from: number): string | null {
  const start = text.indexOf("{", from);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const FENCED_JSON_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;

/**
 * Finds the first JSON object to parse: inside a ```json fenced block if
 * present, otherwise the first balanced `{...}` in the raw text (which
 * covers a bare JSON file as well as JSON embedded in surrounding prose).
 */
export function extractJsonObject(text: string): string | null {
  const fenced = text.match(FENCED_JSON_PATTERN);
  if (fenced) {
    const inner = extractBalancedObject(fenced[1], 0);
    if (inner) return inner;
  }
  return extractBalancedObject(text, 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toCityBlock(raw: unknown): ImportCityBlock {
  if (!isPlainObject(raw) || !isPlainObject(raw.destination) || !Array.isArray(raw.places)) {
    throw new ImportParseError('expected a city block shaped as { destination: {...}, places: [...] }');
  }
  return { destination: raw.destination as unknown as ImportDestinationBlock, places: raw.places as ImportRawPlace[] };
}

/**
 * Parses one import file's raw text content into a flat list of city
 * blocks. Accepts either `{ destination, places }` (a single city) or
 * `{ cities: [{ destination, places }, ...] }` (several cities in one
 * file).
 */
export function parseImportFileContent(raw: string): ParsedImportFile {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) throw new ImportParseError("no JSON object found in file");

  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    const position = positionFromJsonError(err);
    const line = position != null ? lineAtOffset(jsonText, position) : undefined;
    throw new ImportParseError(`invalid JSON: ${(err as Error).message}`, line);
  }

  if (!isPlainObject(data)) throw new ImportParseError("expected a JSON object at the top level");

  if (Array.isArray(data.cities)) {
    return { cities: data.cities.map(toCityBlock) };
  }
  if (data.destination !== undefined || data.places !== undefined) {
    return { cities: [toCityBlock(data)] };
  }
  throw new ImportParseError('expected { destination, places } or { cities: [...] }');
}

// ─── destination slug resolution/validation ─────────────────────────────────

export const VALID_DESTINATION_TIERS = ["mega", "large", "medium", "small"] as const;

export interface DestinationSeedForSlugMatch {
  slug: string;
  nameEn: string;
  namePt: string;
  countryCode: string;
  tier: string;
}

export interface ResolvedCityDestination {
  slug: string;
  nameEn: string;
  namePt: string;
  country: string;
  countryCode: string;
  tier: string;
  /** True when the file gave no slug at all and it was inferred by matching name + countryCode against known destinations. */
  slugInferred: boolean;
}

export type ResolveCityDestinationResult = { ok: true; destination: ResolvedCityDestination } | { ok: false; reason: string };

function stripAccentsLower(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Resolves (and validates) a city block's destination identity. A
 * non-empty `slug` is used as given. A missing one is inferred by matching
 * nameEn/namePt/name (accent- and case-insensitive) plus countryCode
 * against `seeds` (normally destinations.ts) — but only when that narrows
 * to exactly one destination; zero or several matches is reported as a
 * failure instead of guessing. An invalid or missing `tier` falls back to
 * the matched seed's tier (existing destination) or "large" (brand-new
 * one) rather than failing the whole city over a cosmetic field.
 */
export function resolveCityDestination(raw: ImportDestinationBlock, seeds: DestinationSeedForSlugMatch[]): ResolveCityDestinationResult {
  const nameEn = asString(raw.nameEn);
  const namePt = asString(raw.namePt);
  const name = asString(raw.name);
  const country = asString(raw.country) ?? "";
  const countryCode = asString(raw.countryCode)?.toUpperCase();
  const rawTier = asString(raw.tier);
  const givenSlug = asString(raw.slug);

  if (givenSlug) {
    const seed = seeds.find((s) => s.slug === givenSlug);
    const tier = rawTier && (VALID_DESTINATION_TIERS as readonly string[]).includes(rawTier) ? rawTier : seed?.tier ?? "large";
    return {
      ok: true,
      destination: {
        slug: givenSlug,
        nameEn: nameEn ?? seed?.nameEn ?? givenSlug,
        namePt: namePt ?? seed?.namePt ?? givenSlug,
        country,
        countryCode: countryCode ?? seed?.countryCode ?? "",
        tier,
        slugInferred: false,
      },
    };
  }

  const candidateNames = [nameEn, namePt, name].filter((n): n is string => !!n).map(stripAccentsLower);
  if (candidateNames.length === 0) {
    return { ok: false, reason: "destination.slug is missing, and no nameEn/namePt/name was given to infer it from" };
  }

  const matches = seeds.filter((seed) => {
    if (countryCode && seed.countryCode.toUpperCase() !== countryCode) return false;
    const seedNames = [stripAccentsLower(seed.nameEn), stripAccentsLower(seed.namePt)];
    return candidateNames.some((n) => seedNames.includes(n));
  });

  if (matches.length !== 1) {
    const label = `nameEn=${nameEn ?? "?"}, namePt=${namePt ?? "?"}, countryCode=${countryCode ?? "?"}`;
    return {
      ok: false,
      reason:
        matches.length === 0
          ? `destination.slug is missing and no known destination matched (${label})`
          : `destination.slug is missing and ${matches.length} destinations matched ambiguously (${label}): ${matches.map((m) => m.slug).join(", ")}`,
    };
  }

  const seed = matches[0];
  const tier = rawTier && (VALID_DESTINATION_TIERS as readonly string[]).includes(rawTier) ? rawTier : seed.tier;
  return {
    ok: true,
    destination: {
      slug: seed.slug,
      nameEn: nameEn ?? seed.nameEn,
      namePt: namePt ?? seed.namePt,
      country,
      countryCode: seed.countryCode,
      tier,
      slugInferred: true,
    },
  };
}
