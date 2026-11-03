import { describe, expect, it } from "vitest";
import { parseResetPasswordLink } from "../utils/auth-reset-link";

describe("parseResetPasswordLink", () => {
  it("parses a fragment with access/refresh tokens and type=recovery", () => {
    const result = parseResetPasswordLink(
      "localsapp://auth/reset-password#access_token=abc123&refresh_token=def456&type=recovery",
    );
    expect(result).toEqual({ kind: "session", accessToken: "abc123", refreshToken: "def456" });
  });

  it("rejects a fragment with a type other than recovery", () => {
    const result = parseResetPasswordLink(
      "localsapp://auth/reset-password#access_token=abc123&refresh_token=def456&type=signup",
    );
    expect(result).toEqual({ kind: "invalid" });
  });

  it("rejects a fragment missing the type param entirely", () => {
    const result = parseResetPasswordLink(
      "localsapp://auth/reset-password#access_token=abc123&refresh_token=def456",
    );
    expect(result).toEqual({ kind: "invalid" });
  });

  it("parses a query string with a PKCE code", () => {
    const result = parseResetPasswordLink("localsapp://auth/reset-password?code=xyz789");
    expect(result).toEqual({ kind: "code", code: "xyz789" });
  });

  it("parses a query string with token_hash and type=recovery", () => {
    const result = parseResetPasswordLink(
      "localsapp://auth/reset-password?token_hash=th_123&type=recovery",
    );
    expect(result).toEqual({ kind: "token_hash", tokenHash: "th_123" });
  });

  it("rejects token_hash with a type other than recovery", () => {
    const result = parseResetPasswordLink(
      "localsapp://auth/reset-password?token_hash=th_123&type=email_change",
    );
    expect(result).toEqual({ kind: "invalid" });
  });

  it("rejects token_hash missing the type param", () => {
    const result = parseResetPasswordLink("localsapp://auth/reset-password?token_hash=th_123");
    expect(result).toEqual({ kind: "invalid" });
  });

  it("prefers the fragment over the query when both are present", () => {
    const result = parseResetPasswordLink(
      "localsapp://auth/reset-password?code=should_be_ignored#access_token=a&refresh_token=b&type=recovery",
    );
    expect(result).toEqual({ kind: "session", accessToken: "a", refreshToken: "b" });
  });

  it("returns invalid for a URL with no recognizable params", () => {
    const result = parseResetPasswordLink("localsapp://auth/reset-password");
    expect(result).toEqual({ kind: "invalid" });
  });

  it("returns invalid for garbage input", () => {
    expect(parseResetPasswordLink("not a url at all")).toEqual({ kind: "invalid" });
    expect(parseResetPasswordLink("")).toEqual({ kind: "invalid" });
    expect(parseResetPasswordLink(null)).toEqual({ kind: "invalid" });
    expect(parseResetPasswordLink(undefined)).toEqual({ kind: "invalid" });
  });
});
