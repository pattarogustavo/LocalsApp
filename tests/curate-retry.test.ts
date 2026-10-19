import { describe, expect, it, vi } from "vitest";
import {
  withRetry,
  isRetryableOpenAIError,
  getOpenAIRetryAfterMs,
  isRetryableGoogleError,
  GoogleApiStatusError,
} from "../scripts/curate/retry";

function fakeSleep() {
  const calls: number[] = [];
  const sleep = async (ms: number) => {
    calls.push(ms);
  };
  return { sleep, calls };
}

describe("withRetry", () => {
  it("returns the result immediately on success, without sleeping", async () => {
    const { sleep, calls } = fakeSleep();
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { isRetryable: () => true, sleep });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it("retries a retryable error with exponential backoff, then succeeds", async () => {
    const { sleep, calls } = fakeSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { isRetryable: () => true, sleep, baseDelayMs: 100 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([100, 200]);
  });

  it("rethrows immediately on a non-retryable error", async () => {
    const { sleep } = fakeSleep();
    const fn = vi.fn().mockRejectedValue(new Error("nope"));
    await expect(withRetry(fn, { isRetryable: () => false, sleep })).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts and rethrows the last error", async () => {
    const { sleep } = fakeSleep();
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(withRetry(fn, { isRetryable: () => true, sleep, maxAttempts: 3 })).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("prefers a server-provided Retry-After delay over the computed backoff", async () => {
    const { sleep, calls } = fakeSleep();
    const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("ok");
    await withRetry(fn, { isRetryable: () => true, sleep, baseDelayMs: 100, getRetryAfterMs: () => 5000 });
    expect(calls).toEqual([5000]);
  });

  it("calls onRetry with the attempt number and delay before sleeping", async () => {
    const { sleep } = fakeSleep();
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("ok");
    await withRetry(fn, { isRetryable: () => true, sleep, baseDelayMs: 100, onRetry });
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 100);
  });
});

describe("isRetryableOpenAIError", () => {
  it("retries on 429/5xx/529 status codes", () => {
    for (const status of [429, 500, 502, 503, 504, 529]) {
      expect(isRetryableOpenAIError({ status })).toBe(true);
    }
  });

  it("retries on an overloaded_error type even without a status", () => {
    expect(isRetryableOpenAIError({ error: { type: "overloaded_error" } })).toBe(true);
  });

  it("doesn't retry a 400 or 401", () => {
    expect(isRetryableOpenAIError({ status: 400 })).toBe(false);
    expect(isRetryableOpenAIError({ status: 401 })).toBe(false);
  });
});

describe("getOpenAIRetryAfterMs", () => {
  it("converts a retry-after header (seconds) to milliseconds", () => {
    expect(getOpenAIRetryAfterMs({ headers: { "retry-after": "3" } })).toBe(3000);
  });

  it("returns undefined when absent", () => {
    expect(getOpenAIRetryAfterMs({})).toBeUndefined();
  });
});

describe("isRetryableGoogleError", () => {
  it("recognizes GoogleApiStatusError via its googleStatus field", () => {
    const err = new GoogleApiStatusError("OVER_QUERY_LIMIT");
    expect(isRetryableGoogleError(err as unknown as { googleStatus?: string })).toBe(true);
  });

  it("doesn't retry ZERO_RESULTS", () => {
    expect(isRetryableGoogleError(new GoogleApiStatusError("ZERO_RESULTS"))).toBe(false);
  });

  it("retries a generic network error", () => {
    expect(isRetryableGoogleError(new TypeError("fetch failed"))).toBe(true);
  });
});
