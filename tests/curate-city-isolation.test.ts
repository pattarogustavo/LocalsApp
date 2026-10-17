import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runIsolated } from "../scripts/curate/city-isolation";
import { lockPath } from "../scripts/curate/lock";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "curate-city-isolation-test-"));
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("runIsolated", () => {
  it("returns fn's result when it succeeds, and releases the lock", async () => {
    const result = await runIsolated(
      baseDir,
      "lisbon-pt",
      async () => "ok",
      () => "never",
    );
    expect(result).toBe("ok");
    expect(fs.existsSync(lockPath(baseDir, "lisbon-pt"))).toBe(false);
  });

  it("catches an exception thrown by fn and hands it to onError, instead of propagating it (A: the undefined-slug crash)", async () => {
    const result = await runIsolated(
      baseDir,
      "porto-pt",
      async () => {
        throw new TypeError('The "path" argument must be of type string. Received undefined');
      },
      (err) => `failed: ${err.message}`,
    );
    expect(result).toBe('failed: The "path" argument must be of type string. Received undefined');
  });

  it("catches a failure to even acquire the lock (e.g. a concurrent run), instead of propagating it", async () => {
    // Simulate another live process already holding this destination's lock.
    fs.mkdirSync(path.dirname(lockPath(baseDir, "madrid-es")), { recursive: true });
    fs.writeFileSync(lockPath(baseDir, "madrid-es"), String(process.pid));

    const result = await runIsolated(
      baseDir,
      "madrid-es",
      async () => "should never run",
      (err) => `failed: ${err.constructor.name}`,
    );
    expect(result).toBe("failed: LockHeldError");

    // The pre-existing lock (not ours) is left alone.
    expect(fs.existsSync(lockPath(baseDir, "madrid-es"))).toBe(true);
  });

  it("releases the lock even when fn throws", async () => {
    await runIsolated(
      baseDir,
      "paris-fr",
      async () => {
        throw new Error("boom");
      },
      (err) => err.message,
    );
    expect(fs.existsSync(lockPath(baseDir, "paris-fr"))).toBe(false);
  });

  it("processing several destinations in sequence: one failure doesn't block the others", async () => {
    const results: string[] = [];
    for (const slug of ["a", "b", "c"]) {
      const result = await runIsolated(
        baseDir,
        slug,
        async () => {
          if (slug === "b") throw new Error("b failed");
          return `${slug} ok`;
        },
        (err) => `${slug} failed: ${err.message}`,
      );
      results.push(result);
    }
    expect(results).toEqual(["a ok", "b failed: b failed", "c ok"]);
  });
});
