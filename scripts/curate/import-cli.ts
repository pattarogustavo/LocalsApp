import { DEFAULT_MAX_GOOGLE_CALLS } from "../data/curation-config";

export type ImportStatus = "pending" | "approved";

export interface ImportOptions {
  file?: string;
  dir?: string;
  status: ImportStatus;
  translate: boolean;
  dryRun: boolean;
  yes: boolean;
  maxGoogleCalls: number;
}

/** Parses `tsx scripts/curate-import.ts [--file=<arquivo.json> | --dir=<pasta>] [flags]`. */
export function parseImportArgs(argv: string[]): ImportOptions {
  let file: string | undefined;
  let dir: string | undefined;
  let status: ImportStatus = "pending";
  let translate = false;
  let dryRun = false;
  let yes = false;
  let maxGoogleCalls = DEFAULT_MAX_GOOGLE_CALLS;

  for (const arg of argv) {
    if (arg === "--translate") translate = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--yes") yes = true;
    else if (arg.startsWith("--file=")) file = arg.slice("--file=".length);
    else if (arg.startsWith("--dir=")) dir = arg.slice("--dir=".length);
    else if (arg.startsWith("--status=")) {
      const value = arg.slice("--status=".length);
      if (value !== "pending" && value !== "approved") {
        throw new Error(`--status must be "pending" or "approved", got "${value}"`);
      }
      status = value;
    } else if (arg.startsWith("--max-google-calls=")) {
      maxGoogleCalls = Number(arg.slice("--max-google-calls=".length));
    } else {
      throw new Error(`Unknown flag "${arg}"`);
    }
  }

  if (!file && !dir) throw new Error("Specify --file=<arquivo.json> or --dir=<pasta>");
  if (file && dir) throw new Error("Specify only one of --file or --dir, not both");
  if (!Number.isFinite(maxGoogleCalls) || maxGoogleCalls <= 0) {
    throw new Error("--max-google-calls must be a positive number");
  }

  return { file, dir, status, translate, dryRun, yes, maxGoogleCalls };
}
