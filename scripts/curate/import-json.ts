/**
 * Tolerant JSON extraction/parsing for curate:import. Input files may be a
 * bare JSON object, a ```json fenced block, or free text with a JSON object
 * embedded somewhere in it (e.g. copy-pasted from a chat) — this module
 * finds and parses the first balanced JSON object it can, and otherwise
 * reports exactly where parsing failed.
 */

export interface ImportDestinationBlock {
  slug: string;
  nameEn: string;
  namePt: string;
  country: string;
  countryCode: string;
  tier: string;
}

export interface ImportRawPlace {
  name?: unknown;
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
