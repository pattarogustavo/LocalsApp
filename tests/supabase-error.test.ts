import { describe, expect, it } from "vitest";
import {
  isRateLimitError,
  isRetryableError,
  isSamePasswordError,
  isWeakPasswordError,
} from "../utils/supabase-error";

describe("isRateLimitError", () => {
  it("detects a 429 status", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
  });

  it("detects an over_*_rate_limit code", () => {
    expect(isRateLimitError({ code: "over_email_send_rate_limit" })).toBe(true);
    expect(isRateLimitError({ code: "over_request_rate_limit" })).toBe(true);
  });

  it("detects a rate-limit message as a fallback", () => {
    expect(isRateLimitError({ message: "For security purposes, you can only request this after 42 seconds (rate limit)." })).toBe(true);
  });

  it("returns false for an unrelated error", () => {
    expect(isRateLimitError({ status: 400, code: "otp_expired" })).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError("oops")).toBe(false);
  });
});

describe("isRetryableError", () => {
  it("detects AuthRetryableFetchError by name", () => {
    expect(isRetryableError({ name: "AuthRetryableFetchError", status: 0 })).toBe(true);
  });

  it("treats a missing status as retryable (network-level failure)", () => {
    expect(isRetryableError({ name: "TypeError", message: "Network request failed" })).toBe(true);
  });

  it("returns false for a normal API error with a status", () => {
    expect(isRetryableError({ name: "AuthApiError", status: 400, code: "otp_expired" })).toBe(false);
  });

  it("returns false for non-object input", () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe("isSamePasswordError", () => {
  it("detects the same_password code", () => {
    expect(isSamePasswordError({ code: "same_password" })).toBe(true);
  });

  it("detects the fallback message", () => {
    expect(
      isSamePasswordError({ message: "New password should be different from the old password." }),
    ).toBe(true);
  });

  it("returns false for an unrelated error", () => {
    expect(isSamePasswordError({ code: "weak_password" })).toBe(false);
    expect(isSamePasswordError(null)).toBe(false);
  });
});

describe("isWeakPasswordError", () => {
  it("detects the weak_password code", () => {
    expect(isWeakPasswordError({ code: "weak_password" })).toBe(true);
  });

  it("detects the AuthWeakPasswordError name", () => {
    expect(isWeakPasswordError({ name: "AuthWeakPasswordError" })).toBe(true);
  });

  it("returns false for an unrelated error", () => {
    expect(isWeakPasswordError({ code: "same_password" })).toBe(false);
    expect(isWeakPasswordError(null)).toBe(false);
  });
});
