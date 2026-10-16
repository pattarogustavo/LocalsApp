export interface RetryOptions {
  /** Total attempts, including the first — default 4. */
  maxAttempts?: number;
  /** Base delay for exponential backoff (attempt 1 waits baseDelayMs, attempt 2 waits 2x, etc). */
  baseDelayMs?: number;
  /** Decides whether an error is worth retrying at all. */
  isRetryable: (err: unknown) => boolean;
  /** Extracts a server-provided Retry-After delay (ms), taking priority over the computed backoff. */
  getRetryAfterMs?: (err: unknown) => number | undefined;
  /** Injectable for tests — defaults to a real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Called before each retry wait, e.g. for logging. */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` with exponential backoff on retryable errors. Honors a
 * server-provided Retry-After delay when `getRetryAfterMs` returns one;
 * otherwise backs off as baseDelayMs * 2^(attempt-1). Rethrows immediately
 * on a non-retryable error or once `maxAttempts` is exhausted.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const sleep = opts.sleep ?? defaultSleep;

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      const canRetry = attempt < maxAttempts && opts.isRetryable(err);
      if (!canRetry) throw err;
      const retryAfterMs = opts.getRetryAfterMs?.(err);
      const delayMs = retryAfterMs ?? baseDelayMs * 2 ** (attempt - 1);
      opts.onRetry?.(attempt, err, delayMs);
      await sleep(delayMs);
    }
  }
}

const RETRYABLE_ANTHROPIC_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

/** Matches Anthropic SDK APIError shapes (rate limit, server errors, overloaded) worth retrying. */
export function isRetryableAnthropicError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (typeof status === "number" && RETRYABLE_ANTHROPIC_STATUSES.has(status)) return true;
  const errorType = (err as { error?: { type?: string } })?.error?.type;
  return errorType === "overloaded_error" || errorType === "rate_limit_error" || errorType === "api_error";
}

/** Reads a Retry-After header (seconds) off an Anthropic SDK error, if present. */
export function getAnthropicRetryAfterMs(err: unknown): number | undefined {
  const headers = (err as { headers?: Record<string, string> })?.headers;
  const raw = headers?.["retry-after"];
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

const RETRYABLE_GOOGLE_STATUSES = new Set(["OVER_QUERY_LIMIT", "UNKNOWN_ERROR"]);

/** Matches Google Places API `status` fields, plus generic network errors (fetch TypeError, aborts). */
export function isRetryableGoogleError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TypeError") return true;
    if (/network|ECONNRESET|ETIMEDOUT|fetch failed/i.test(err.message)) return true;
  }
  const status = (err as { googleStatus?: string })?.googleStatus;
  return typeof status === "string" && RETRYABLE_GOOGLE_STATUSES.has(status);
}

/** Matches an Anthropic 400 complaining that the model doesn't support the web_search tool — never retryable, never worth silently falling back on. */
export function isWebSearchUnsupportedError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status !== 400) return false;
  const message = (err as { message?: string; error?: { error?: { message?: string } } })?.message ?? (err as { error?: { error?: { message?: string } } })?.error?.error?.message ?? "";
  return /web_search|web search/i.test(message);
}

/** Wraps a Google status string in an Error so isRetryableGoogleError can recognize it uniformly. */
export class GoogleApiStatusError extends Error {
  googleStatus: string;
  constructor(googleStatus: string, message?: string) {
    super(message ?? `Google API returned status ${googleStatus}`);
    this.name = "GoogleApiStatusError";
    this.googleStatus = googleStatus;
  }
}
