import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, isProcessAlive, lockPath, LockHeldError } from "../scripts/curate/lock";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "curate-lock-test-"));
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("isProcessAlive", () => {
  it("is true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("is false for a PID that doesn't exist", () => {
    // A PID this large is extremely unlikely to be in use.
    expect(isProcessAlive(999_999_999)).toBe(false);
  });
});

describe("acquireLock", () => {
  it("creates a lock file with the current PID when none exists", () => {
    const lock = acquireLock(baseDir, "paris-fr");
    expect(lock.staleLockReplaced).toBe(false);
    expect(fs.readFileSync(lockPath(baseDir, "paris-fr"), "utf8")).toBe(String(process.pid));
    lock.release();
  });

  it("throws LockHeldError when a live process already holds the lock", () => {
    fs.mkdirSync(path.dirname(lockPath(baseDir, "paris-fr")), { recursive: true });
    fs.writeFileSync(lockPath(baseDir, "paris-fr"), String(process.pid));
    expect(() => acquireLock(baseDir, "paris-fr")).toThrow(LockHeldError);
  });

  it("replaces a stale lock left by a dead process", () => {
    fs.mkdirSync(path.dirname(lockPath(baseDir, "paris-fr")), { recursive: true });
    fs.writeFileSync(lockPath(baseDir, "paris-fr"), "999999999");
    const lock = acquireLock(baseDir, "paris-fr");
    expect(lock.staleLockReplaced).toBe(true);
    expect(fs.readFileSync(lockPath(baseDir, "paris-fr"), "utf8")).toBe(String(process.pid));
    lock.release();
  });

  it("release removes the lock file, and is safe to call twice", () => {
    const lock = acquireLock(baseDir, "paris-fr");
    lock.release();
    expect(fs.existsSync(lockPath(baseDir, "paris-fr"))).toBe(false);
    expect(() => lock.release()).not.toThrow();
  });

  it("keeps locks for different destinations independent", () => {
    const parisLock = acquireLock(baseDir, "paris-fr");
    const londonLock = acquireLock(baseDir, "london-gb");
    expect(fs.existsSync(lockPath(baseDir, "paris-fr"))).toBe(true);
    expect(fs.existsSync(lockPath(baseDir, "london-gb"))).toBe(true);
    parisLock.release();
    londonLock.release();
  });
});
