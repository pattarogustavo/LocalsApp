import { describe, expect, it, vi, afterEach } from "vitest";
import { LruTtlCache, normalizeCacheKeyPart } from "../server/cache";

afterEach(() => {
  vi.useRealTimers();
});

describe("LruTtlCache", () => {
  it("returns a value that was just set", () => {
    const cache = new LruTtlCache<string>(10);
    cache.set("a", "value-a", 1000);
    expect(cache.get("a")).toBe("value-a");
  });

  it("returns undefined for a key that was never set", () => {
    const cache = new LruTtlCache<string>(10);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("expires an entry once its TTL has passed", () => {
    vi.useFakeTimers();
    const cache = new LruTtlCache<string>(10);
    cache.set("a", "value-a", 1000);
    vi.advanceTimersByTime(999);
    expect(cache.get("a")).toBe("value-a");
    vi.advanceTimersByTime(2);
    expect(cache.get("a")).toBeUndefined();
  });

  it("evicts the least-recently-used entry once over its size limit", () => {
    const cache = new LruTtlCache<string>(2);
    cache.set("a", "1", 10_000);
    cache.set("b", "2", 10_000);
    cache.set("c", "3", 10_000);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
    expect(cache.size).toBe(2);
  });

  it("treats a recently-read entry as fresher than one only inserted earlier", () => {
    const cache = new LruTtlCache<string>(2);
    cache.set("a", "1", 10_000);
    cache.set("b", "2", 10_000);
    // Touch "a" so it's no longer the least-recently-used entry.
    cache.get("a");
    cache.set("c", "3", 10_000);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("1");
    expect(cache.get("c")).toBe("3");
  });

  it("overwrites an existing key without growing past the size limit", () => {
    const cache = new LruTtlCache<string>(2);
    cache.set("a", "1", 10_000);
    cache.set("b", "2", 10_000);
    cache.set("a", "1-updated", 10_000);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe("1-updated");
    expect(cache.get("b")).toBe("2");
  });

  it("deletes an entry on request", () => {
    const cache = new LruTtlCache<string>(10);
    cache.set("a", "1", 10_000);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("normalizeCacheKeyPart", () => {
  it("lowercases, trims, and collapses internal whitespace", () => {
    expect(normalizeCacheKeyPart("  Rio   de Janeiro  ")).toBe("rio de janeiro");
  });

  it("treats null/undefined as an empty string", () => {
    expect(normalizeCacheKeyPart(undefined)).toBe("");
    expect(normalizeCacheKeyPart(null)).toBe("");
  });

  it("makes two differently-cased/spaced inputs produce the same key", () => {
    expect(normalizeCacheKeyPart("Paris")).toBe(normalizeCacheKeyPart("  paris  "));
  });
});
