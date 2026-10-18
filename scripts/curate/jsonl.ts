/**
 * Tolerant JSON Lines parser for curate:redescribe's rewrite call: the
 * prompt asks for exactly one JSON object per line (no markdown, no prose
 * before/after), but models don't always comply — a code fence, a leading
 * "Here are the descriptions:" sentence, or one malformed line in the
 * middle are all handled without losing the rest of the batch. Any line
 * that isn't a JSON object on its own (doesn't start with "{", or fails to
 * parse, or parses to something other than an object) is simply skipped —
 * it invalidates only the id it was trying to represent, which the normal
 * "model returned no item for this id" path in redescribe-run.ts already
 * covers.
 */

export interface MalformedLine {
  /** First 300 chars of the offending line, for diagnostics. */
  line: string;
  /** Best-effort id extracted via regex from the line, when recognizable. */
  idGuess?: string;
}

export interface JsonLinesParseResult<T> {
  items: T[];
  malformedLines: MalformedLine[];
}

const ID_GUESS_REGEX = /"id"\s*:\s*"?([\w-]+)"?/;

export function parseJsonLines<T = Record<string, unknown>>(content: string): JsonLinesParseResult<T> {
  const items: T[] = [];
  const malformedLines: MalformedLine[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("```")) continue;
    if (!line.startsWith("{")) continue;

    try {
      const parsed = JSON.parse(line);
      // Requiring an "id" key rules out a single-line response that is
      // actually the WHOLE blob (e.g. `{"places":[...]}` on one line,
      // because JSON.stringify never inserts newlines) being mistaken for
      // one line item — that case falls through as malformed here, so the
      // caller's normalizeBatchArray fallback handles it instead.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "id" in parsed) {
        items.push(parsed as T);
      } else {
        malformedLines.push({ line: line.slice(0, 300), idGuess: line.match(ID_GUESS_REGEX)?.[1] });
      }
    } catch {
      malformedLines.push({ line: line.slice(0, 300), idGuess: line.match(ID_GUESS_REGEX)?.[1] });
    }
  }

  return { items, malformedLines };
}
