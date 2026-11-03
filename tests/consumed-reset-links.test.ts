import { afterEach, describe, expect, it } from "vitest";
import {
  __clearConsumedResetLinksForTests,
  isResetLinkConsumed,
  markResetLinkConsumed,
} from "../utils/consumed-reset-links";

describe("consumed-reset-links", () => {
  afterEach(() => {
    __clearConsumedResetLinksForTests();
  });

  it("reports a link as unconsumed before it is marked", () => {
    const url = "localsapp://auth/reset-password?code=abc123";
    expect(isResetLinkConsumed(url)).toBe(false);
  });

  it("reports a link as consumed after it is marked", () => {
    const url = "localsapp://auth/reset-password?code=abc123";
    markResetLinkConsumed(url);
    expect(isResetLinkConsumed(url)).toBe(true);
  });

  it("does not affect a different link", () => {
    const used = "localsapp://auth/reset-password?code=abc123";
    const other = "localsapp://auth/reset-password?code=xyz789";
    markResetLinkConsumed(used);
    expect(isResetLinkConsumed(other)).toBe(false);
  });

  it("clears tracked links between tests via the test-only helper", () => {
    const url = "localsapp://auth/reset-password?code=abc123";
    markResetLinkConsumed(url);
    __clearConsumedResetLinksForTests();
    expect(isResetLinkConsumed(url)).toBe(false);
  });
});
