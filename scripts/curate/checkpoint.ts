import fs from "node:fs";
import path from "node:path";

export const CHECKPOINT_DIR_NAME = ".curate-cache";

export function checkpointDir(baseDir: string, slug: string): string {
  return path.join(baseDir, CHECKPOINT_DIR_NAME, slug);
}

export function checkpointPath(baseDir: string, slug: string, batchKey: string): string {
  return path.join(checkpointDir(baseDir, slug), `${batchKey}.json`);
}

/** Saves a batch's verified result to disk BEFORE any database write, so an interruption loses at most the in-flight batch. */
export function saveCheckpoint<T>(baseDir: string, slug: string, batchKey: string, data: T): void {
  const dir = checkpointDir(baseDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(checkpointPath(baseDir, slug, batchKey), JSON.stringify(data, null, 2));
}

/** Returns the saved batch result, or null if no checkpoint exists for it yet. */
export function loadCheckpoint<T>(baseDir: string, slug: string, batchKey: string): T | null {
  const file = checkpointPath(baseDir, slug, batchKey);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function hasCheckpoint(baseDir: string, slug: string, batchKey: string): boolean {
  return fs.existsSync(checkpointPath(baseDir, slug, batchKey));
}

/** Lists the batch keys already checkpointed for a destination (derived from filenames, without reading their contents). */
export function listCheckpointKeys(baseDir: string, slug: string): string[] {
  const dir = checkpointDir(baseDir, slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
}

/** Removes every checkpoint for a destination — used by --refresh to force a clean re-run. */
export function clearCheckpoints(baseDir: string, slug: string): void {
  const dir = checkpointDir(baseDir, slug);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
