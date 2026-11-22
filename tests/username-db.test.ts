import { describe, it, expect, vi, beforeEach } from "vitest";

// Same minimal chainable drizzle stand-in as tests/push-tokens.test.ts.
function createChain(result: unknown = []) {
  const calls: Array<[string, ...any[]]> = [];
  const chain: any = { calls };
  const methods = ["from", "where", "values", "onConflictDoUpdate", "set", "limit", "orderBy"];
  for (const name of methods) {
    chain[name] = vi.fn((...args: unknown[]) => {
      calls.push([name, ...args]);
      return chain;
    });
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

describe("username db helpers", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getUserByUsername returns undefined when nothing matches", async () => {
    const fakeDb = { select: vi.fn(() => createChain([])) };
    vi.doMock("drizzle-orm/postgres-js", () => ({ drizzle: () => fakeDb }));
    const db = await import("../server/db");
    expect(await db.getUserByUsername("nobody")).toBeUndefined();
  });

  it("getUserByUsername returns the row when one matches", async () => {
    const row = { id: 7, username: "gustavo" };
    const fakeDb = { select: vi.fn(() => createChain([row])) };
    vi.doMock("drizzle-orm/postgres-js", () => ({ drizzle: () => fakeDb }));
    const db = await import("../server/db");
    expect(await db.getUserByUsername("Gustavo")).toEqual(row);
  });

  it("isUsernameTaken is false when no account has it", async () => {
    const fakeDb = { select: vi.fn(() => createChain([])) };
    vi.doMock("drizzle-orm/postgres-js", () => ({ drizzle: () => fakeDb }));
    const db = await import("../server/db");
    expect(await db.isUsernameTaken("free_name")).toBe(false);
  });

  it("isUsernameTaken is true when a DIFFERENT account already has it", async () => {
    const row = { id: 1, username: "taken" };
    const fakeDb = { select: vi.fn(() => createChain([row])) };
    vi.doMock("drizzle-orm/postgres-js", () => ({ drizzle: () => fakeDb }));
    const db = await import("../server/db");
    expect(await db.isUsernameTaken("taken", 2)).toBe(true);
  });

  it("isUsernameTaken is false when it's the SAME account re-checking its own username", async () => {
    const row = { id: 1, username: "mine" };
    const fakeDb = { select: vi.fn(() => createChain([row])) };
    vi.doMock("drizzle-orm/postgres-js", () => ({ drizzle: () => fakeDb }));
    const db = await import("../server/db");
    expect(await db.isUsernameTaken("mine", 1)).toBe(false);
  });

  it("setUsername issues an update targeting the given openId", async () => {
    const updateChain = createChain();
    const fakeDb = { update: vi.fn(() => updateChain) };
    vi.doMock("drizzle-orm/postgres-js", () => ({ drizzle: () => fakeDb }));
    const db = await import("../server/db");
    await db.setUsername("open-id-123", "newname");
    expect(fakeDb.update).toHaveBeenCalledTimes(1);
    const setCall = updateChain.calls.find((c: any[]) => c[0] === "set");
    expect(setCall?.[1]).toMatchObject({ username: "newname" });
  });

  it("searchUsersByPrefix never selects email", async () => {
    const selectChain = createChain([{ id: 1, username: "gustavo_x", name: "Gustavo" }]);
    const fakeDb = { select: vi.fn((_cols?: unknown) => selectChain) };
    vi.doMock("drizzle-orm/postgres-js", () => ({ drizzle: () => fakeDb }));
    const db = await import("../server/db");
    const results = await db.searchUsersByPrefix("gust", 5);
    expect(results).toEqual([{ id: 1, username: "gustavo_x", name: "Gustavo" }]);
    const selectCallArgs = fakeDb.select.mock.calls[0][0];
    expect(selectCallArgs).not.toHaveProperty("email");
    const limitCall = selectChain.calls.find((c: any[]) => c[0] === "limit");
    expect(limitCall?.[1]).toBe(5);
  });
});
