import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

const { getSubscriptionStatus, claimFreeAi, releaseFreeAi, getFreeAiUsage } = vi.hoisted(() => ({
  getSubscriptionStatus: vi.fn(),
  claimFreeAi: vi.fn(),
  releaseFreeAi: vi.fn(),
  getFreeAiUsage: vi.fn(),
}));

vi.mock("../server/db", () => ({
  getSubscriptionStatus,
  claimFreeAi,
  releaseFreeAi,
  getFreeAiUsage,
}));

import { withFreeAiGate, requireProOrFreeTrip, destinationSetChanged } from "../server/routers";

beforeEach(() => {
  getSubscriptionStatus.mockReset();
  claimFreeAi.mockReset();
  releaseFreeAi.mockReset().mockResolvedValue(undefined);
  getFreeAiUsage.mockReset();
});

function proStatus() {
  return { subscriptionStatus: "active" as const, subscriptionPlan: "monthly" as const, subscriptionExpiresAt: null, revenuecatUserId: null };
}

describe("withFreeAiGate", () => {
  it("runs generate() directly for a Pro user, without claiming or releasing anything", async () => {
    getSubscriptionStatus.mockResolvedValue(proStatus());
    const generate = vi.fn().mockResolvedValue("ok");

    const result = await withFreeAiGate(1, "trip-1", "info", generate);

    expect(result).toBe("ok");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(claimFreeAi).not.toHaveBeenCalled();
    expect(releaseFreeAi).not.toHaveBeenCalled();
  });

  it("claims the free use and runs generate() for a non-Pro user when the claim succeeds", async () => {
    getSubscriptionStatus.mockResolvedValue(null);
    claimFreeAi.mockResolvedValue(true);
    const generate = vi.fn().mockResolvedValue("ok");

    const result = await withFreeAiGate(2, "trip-1", "places", generate);

    expect(result).toBe("ok");
    expect(claimFreeAi).toHaveBeenCalledWith(2, "trip-1", "places");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(releaseFreeAi).not.toHaveBeenCalled();
  });

  it("throws PAYMENT_REQUIRED without calling generate() when the claim fails", async () => {
    getSubscriptionStatus.mockResolvedValue({ subscriptionStatus: "expired" as const, subscriptionPlan: null, subscriptionExpiresAt: null, revenuecatUserId: null });
    claimFreeAi.mockResolvedValue(false);
    const generate = vi.fn().mockResolvedValue("ok");

    await expect(withFreeAiGate(3, "trip-1", "itinerary", generate)).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
    } satisfies Partial<TRPCError>);
    expect(generate).not.toHaveBeenCalled();
  });

  it("releases the claimed credit and rethrows when generate() fails after a successful claim", async () => {
    getSubscriptionStatus.mockResolvedValue(null);
    claimFreeAi.mockResolvedValue(true);
    const boom = new Error("LLM exploded");
    const generate = vi.fn().mockRejectedValue(boom);

    await expect(withFreeAiGate(4, "trip-1", "info", generate)).rejects.toBe(boom);
    expect(releaseFreeAi).toHaveBeenCalledWith(4, "info");
  });

  it("still rethrows the original error even if release_free_ai itself fails", async () => {
    getSubscriptionStatus.mockResolvedValue(null);
    claimFreeAi.mockResolvedValue(true);
    releaseFreeAi.mockRejectedValue(new Error("db down"));
    const boom = new Error("LLM exploded");
    const generate = vi.fn().mockRejectedValue(boom);

    await expect(withFreeAiGate(5, "trip-1", "info", generate)).rejects.toBe(boom);
  });
});

describe("requireProOrFreeTrip", () => {
  it("resolves for a Pro user regardless of free_ai_usage", async () => {
    getSubscriptionStatus.mockResolvedValue(proStatus());
    await expect(requireProOrFreeTrip(1, "trip-1")).resolves.toBeUndefined();
    expect(getFreeAiUsage).not.toHaveBeenCalled();
  });

  it("resolves for a non-Pro user when tripId matches their free trip", async () => {
    getSubscriptionStatus.mockResolvedValue(null);
    getFreeAiUsage.mockResolvedValue({ tripId: "trip-1", infoUsed: true, placesUsed: false, itineraryUsed: true });
    await expect(requireProOrFreeTrip(2, "trip-1")).resolves.toBeUndefined();
  });

  it("throws PAYMENT_REQUIRED for a non-Pro user on a different trip", async () => {
    getSubscriptionStatus.mockResolvedValue(null);
    getFreeAiUsage.mockResolvedValue({ tripId: "trip-1", infoUsed: true, placesUsed: false, itineraryUsed: true });
    await expect(requireProOrFreeTrip(2, "trip-2")).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
  });

  it("throws PAYMENT_REQUIRED for a non-Pro user with no free_ai_usage row yet", async () => {
    getSubscriptionStatus.mockResolvedValue(null);
    getFreeAiUsage.mockResolvedValue(null);
    await expect(requireProOrFreeTrip(3, "trip-1")).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
  });
});

describe("destinationSetChanged", () => {
  const paris = { placeId: "p1", name: "Paris", days: 3 };
  const rome = { placeId: "p2", name: "Rome", days: 2 };
  const milan = { placeId: "p3", name: "Milan", days: 2 };

  it("is false for the identical set", () => {
    expect(destinationSetChanged([paris, rome], [paris, rome])).toBe(false);
  });

  it("is false when only reordered", () => {
    expect(destinationSetChanged([paris, rome], [rome, paris])).toBe(false);
  });

  it("is false when only `days` changed", () => {
    expect(destinationSetChanged([paris, rome], [{ ...paris, days: 5 }, rome])).toBe(false);
  });

  it("is true when a destination is added", () => {
    expect(destinationSetChanged([paris], [paris, rome])).toBe(true);
  });

  it("is true when a destination is removed", () => {
    expect(destinationSetChanged([paris, rome], [paris])).toBe(true);
  });

  it("is true when one destination is swapped for another of the same count", () => {
    expect(destinationSetChanged([paris, rome], [paris, milan])).toBe(true);
  });

  it("falls back to lowercased name when placeId is missing", () => {
    expect(destinationSetChanged([{ name: "Paris" }], [{ name: "paris" }])).toBe(false);
    expect(destinationSetChanged([{ name: "Paris" }], [{ name: "Rome" }])).toBe(true);
  });
});
