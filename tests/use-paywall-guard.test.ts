import { describe, expect, it, vi, beforeEach } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("expo-router", () => ({ router: { push } }));

// The module keeps `paywallOpenedAt` as module-level state (that's the whole
// point of the dedupe), so each test gets a fresh import instead of sharing
// state with whichever test ran right before it.
async function freshGuard() {
  vi.resetModules();
  return import("../hooks/use-paywall-guard");
}

beforeEach(() => {
  push.mockReset();
  vi.useRealTimers();
});

describe("isPaywallRequiredError", () => {
  it("recognizes the PAYWALL_REQUIRED error code", async () => {
    const { isPaywallRequiredError } = await freshGuard();
    expect(isPaywallRequiredError({ data: { code: "PAYWALL_REQUIRED" } })).toBe(true);
  });

  it("is false for an unrelated error shape", async () => {
    const { isPaywallRequiredError } = await freshGuard();
    expect(isPaywallRequiredError({ data: { code: "FORBIDDEN" } })).toBe(false);
    expect(isPaywallRequiredError(new Error("network down"))).toBe(false);
    expect(isPaywallRequiredError(null)).toBe(false);
    expect(isPaywallRequiredError(undefined)).toBe(false);
  });
});

describe("handlePaywallError", () => {
  it("returns false and never navigates for a non-paywall error", async () => {
    const { handlePaywallError } = await freshGuard();
    expect(handlePaywallError(new Error("boom"))).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("navigates to /paywall and returns true on a paywall-required error", async () => {
    const { handlePaywallError } = await freshGuard();
    expect(handlePaywallError({ data: { code: "PAYWALL_REQUIRED" } })).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/paywall");
  });

  it("dedupes two paywall errors fired back-to-back into a single navigation", async () => {
    const { handlePaywallError } = await freshGuard();
    handlePaywallError({ data: { code: "PAYWALL_REQUIRED" } });
    const handledSecond = handlePaywallError({ data: { code: "PAYWALL_REQUIRED" } });

    expect(handledSecond).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("opens the paywall again after the dedupe window has passed", async () => {
    vi.useFakeTimers();
    const { handlePaywallError } = await freshGuard();
    handlePaywallError({ data: { code: "PAYWALL_REQUIRED" } });
    vi.advanceTimersByTime(2000);
    handlePaywallError({ data: { code: "PAYWALL_REQUIRED" } });

    expect(push).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
