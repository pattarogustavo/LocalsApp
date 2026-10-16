import fs from "node:fs";
import path from "node:path";

import { checkpointDir } from "./checkpoint";

export function lockPath(baseDir: string, slug: string): string {
  return path.join(checkpointDir(baseDir, slug), ".lock");
}

/** True if a process with this PID is currently alive (works even without permission to signal it). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class LockHeldError extends Error {}

export interface AcquiredLock {
  /** Removes the lock file. Safe to call more than once. */
  release: () => void;
  /** True when a leftover lock from a dead process was found and replaced. */
  staleLockReplaced: boolean;
}

/**
 * Acquires a single-execution lock for one destination, so two curate runs
 * never work on the same destination's checkpoints at once. Throws
 * LockHeldError if the existing lock belongs to a still-alive process; a
 * lock left behind by a dead process is silently replaced.
 */
export function acquireLock(baseDir: string, slug: string): AcquiredLock {
  const dir = checkpointDir(baseDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = lockPath(baseDir, slug);
  let staleLockReplaced = false;

  if (fs.existsSync(file)) {
    const existingPid = Number(fs.readFileSync(file, "utf8").trim());
    if (Number.isFinite(existingPid) && isProcessAlive(existingPid)) {
      throw new LockHeldError(
        `Já existe uma execução em andamento para "${slug}" (PID ${existingPid}). Aborting to avoid concurrent writes to the same checkpoints.`,
      );
    }
    staleLockReplaced = true;
  }

  fs.writeFileSync(file, String(process.pid));

  let released = false;
  return {
    staleLockReplaced,
    release: () => {
      if (released) return;
      released = true;
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // best-effort: a missing/unremovable lock file is not worth failing the run over
      }
    },
  };
}
