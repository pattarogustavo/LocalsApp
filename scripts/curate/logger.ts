import fs from "node:fs";
import path from "node:path";

/** "lote 3/8: ok, 14 lugares, 41 s" style progress line. */
export function formatBatchLine(index: number, of: number, status: string, placesCount: number, elapsedSec: number): string {
  return `lote ${index}/${of}: ${status}, ${placesCount} lugares, ${elapsedSec} s`;
}

export function logFileName(date = new Date()): string {
  const iso = date.toISOString().slice(0, 10); // YYYY-MM-DD
  return `curate-${iso}.log`;
}

export interface CurateLogger {
  /** Writes to the log file only. */
  log(line: string): void;
  /** Prints to the console AND writes to the log file. */
  info(line: string): void;
  path: string;
}

/** Creates a logger that appends timestamped lines to curate-<date>.log under `dir` (repo root by default). */
export function createLogger(dir: string, date = new Date()): CurateLogger {
  const filePath = path.join(dir, logFileName(date));

  function write(line: string) {
    fs.appendFileSync(filePath, `[${new Date().toISOString()}] ${line}\n`);
  }

  return {
    path: filePath,
    log: write,
    info(line: string) {
      console.log(line);
      write(line);
    },
  };
}
