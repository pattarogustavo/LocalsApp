import { describe, it, expect, vi, beforeEach } from "vitest";

// A minimal chainable stand-in for a drizzle query builder: every method
// records the call and returns `this` so builder chains keep working, and
// the chain itself is awaitable (thenable) so `await db.select()...` resolves
// to whatever `result` was configured.
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

describe("db push-token helpers", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("upsertPushToken reassigns an existing token to the new caller on conflict", async () => {
    const insertChain = createChain();
    const fakeDb = {
      insert: vi.fn(() => insertChain),
      select: vi.fn(() => createChain([])),
      delete: vi.fn(() => createChain()),
      update: vi.fn(() => createChain()),
    };
    vi.doMock("drizzle-orm/postgres-js", () => ({ drizzle: () => fakeDb }));

    const db = await import("../server/db");
    await db.upsertPushToken({ userId: 42, token: "ExponentPushToken[abc]", platform: "ios", language: "pt" });

    expect(fakeDb.insert).toHaveBeenCalledTimes(1);
    const valuesCall = insertChain.calls.find((c: any[]) => c[0] === "values");
    expect(valuesCall?.[1]).toMatchObject({ userId: 42, token: "ExponentPushToken[abc]", platform: "ios", language: "pt" });

    const conflictCall = insertChain.calls.find((c: any[]) => c[0] === "onConflictDoUpdate");
    expect(conflictCall).toBeTruthy();
    const conflictArg = conflictCall?.[1] as { target: unknown; set: Record<string, unknown> };
    // The whole point of upserting by token: a token that already belongs to
    // a different account gets reassigned to the new caller, not rejected.
    expect(conflictArg.set.userId).toBe(42);
    expect(conflictArg.set.platform).toBe("ios");
    expect(conflictArg.set.language).toBe("pt");
  });

  it("deletePushToken deletes by the token column", async () => {
    const deleteChain = createChain();
    const fakeDb = {
      insert: vi.fn(() => createChain()),
      select: vi.fn(() => createChain([])),
      delete: vi.fn(() => deleteChain),
      update: vi.fn(() => createChain()),
    };
    vi.doMock("drizzle-orm/postgres-js", () => ({ drizzle: () => fakeDb }));

    const db = await import("../server/db");
    await db.deletePushToken("ExponentPushToken[stale]");

    expect(fakeDb.delete).toHaveBeenCalledTimes(1);
    expect(deleteChain.calls.some((c: any[]) => c[0] === "where")).toBe(true);
  });
});
