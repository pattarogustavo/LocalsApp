import { describe, it, expect, vi } from "vitest";
import { fetchRates } from "../server/exchange-rates";

describe("fetchRates", () => {
  it("resolves same-currency pairs to 1 without any network call", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const [result] = await fetchRates([{ date: "2024-01-01", from: "EUR", to: "EUR" }]);
    expect(result.rate).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("fetches a real historical rate from Frankfurter", async () => {
    const [result] = await fetchRates([{ date: "2024-01-02", from: "EUR", to: "USD" }]);
    expect(result.rate).not.toBeNull();
    expect(typeof result.rate).toBe("number");
    expect(result.rate).toBeGreaterThan(0);
  }, 15000);

  it("caches a (date, from, to) pair — a second lookup doesn't hit the network again", async () => {
    // A date far enough in the past (and a pair) unlikely to collide with
    // another test's cache entry, so this test is self-contained.
    const pair = { date: "2019-06-15", from: "GBP", to: "JPY" };
    const [first] = await fetchRates([pair]);
    expect(first.rate).not.toBeNull();

    const fetchSpy = vi.spyOn(global, "fetch");
    const [second] = await fetchRates([pair]);
    expect(second.rate).toBe(first.rate);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  }, 15000);

  it("returns null (not a thrown error) when the HTTP call fails", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({ ok: false } as Response);
    const [result] = await fetchRates([{ date: "2030-01-01", from: "XXX", to: "YYY" }]);
    expect(result.rate).toBeNull();
    fetchSpy.mockRestore();
  });
});
