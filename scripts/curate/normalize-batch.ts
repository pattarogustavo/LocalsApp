/**
 * Coerces a batch AI call's parsed response into a plain array, tolerating
 * every shape a model has been seen to return instead of the requested
 * `{ "<arrayKey>": [...] }` — a JSON string (which gets parsed, then
 * unwrapped the same way), an object keyed by id (its values become the
 * array, each one stamped with `id = its key` when it doesn't already carry
 * one), or the array itself, already unwrapped. Never throws: an unusable
 * shape becomes `{ items: [] }` plus a `shape`/`sample` diagnostic instead
 * of letting a `.map` downstream blow up the whole batch (and, with it, the
 * whole city — see scripts/curate/redescribe-run.ts).
 */

export interface BatchNormalizeResult<T> {
  items: T[];
  /** Human description of what was actually received ("string", "object", "empty array", ...) — set only when `raw` needed coercion or was unusable, never for an already-clean non-empty array. */
  shape?: string;
  /** First 300 chars of `raw` (stringified if not already a string) — present only alongside `shape`, for diagnosing a malformed batch. */
  sample?: string;
}

function describeShape(value: unknown): string {
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return value.length === 0 ? "empty array" : "array";
  if (value === null) return "null";
  if (typeof value === "object") return "object";
  return typeof value;
}

function sampleOf(raw: unknown): string {
  let text: string;
  try {
    text = typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch {
    text = String(raw);
  }
  return (text ?? "").slice(0, 300);
}

export function normalizeBatchArray<T = Record<string, unknown>>(raw: unknown, arrayKey: string): BatchNormalizeResult<T> {
  let value: unknown = raw;

  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { items: [], shape: "string", sample: sampleOf(raw) };
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value) && arrayKey in (value as Record<string, unknown>)) {
    value = (value as Record<string, unknown>)[arrayKey];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return { items: [], shape: "empty array" };
    return { items: value as T[] };
  }

  if (value && typeof value === "object") {
    // Reaching this branch always means the response wasn't the requested
    // array shape — even a successful id -> object reconstruction is a
    // deviation worth flagging, not a silently "clean" result.
    const items = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v && typeof v === "object")
      .map(([key, v]) => ({ ...(v as Record<string, unknown>), id: (v as Record<string, unknown>).id ?? key }));
    return { items: items as T[], shape: "object", sample: sampleOf(raw) };
  }

  return { items: [], shape: describeShape(value), sample: sampleOf(raw) };
}
