import { DEFAULT_MAX_GOOGLE_CALLS } from "../data/curation-config";

export type CurateCommand = "generate" | "verify" | "translate" | "export" | "check" | "smoke";

export interface CurateOptions {
  command: CurateCommand;
  pilot: boolean;
  only?: string[];
  all: boolean;
  plan: boolean;
  dryRun: boolean;
  yes: boolean;
  refresh: boolean;
  maxGoogleCalls: number;
}

const COMMANDS: CurateCommand[] = ["generate", "verify", "translate", "export", "check", "smoke"];

/** Commands that always operate on a specific destination set and therefore require --pilot/--all/--only. */
const COMMANDS_REQUIRING_SELECTION: CurateCommand[] = ["generate", "verify", "translate", "export"];

export const SMOKE_DEFAULT_SLUG = "london-gb";

/**
 * Parses `tsx scripts/curate-destinations.ts <command> [flags]`.
 * generate/verify/translate/export require an explicit destination
 * selection (--pilot | --only | --all) so a bare invocation can't
 * accidentally run against the whole catalog. check runs globally (no
 * selection). smoke defaults to SMOKE_DEFAULT_SLUG unless --only overrides it.
 */
export function parseArgs(argv: string[]): CurateOptions {
  const [command, ...rest] = argv;
  if (!command || !COMMANDS.includes(command as CurateCommand)) {
    throw new Error(`Unknown command "${command ?? ""}". Expected one of: ${COMMANDS.join(", ")}`);
  }

  let pilot = false;
  let only: string[] | undefined;
  let all = false;
  let plan = false;
  let dryRun = false;
  let yes = false;
  let refresh = false;
  let maxGoogleCalls = DEFAULT_MAX_GOOGLE_CALLS;

  for (const arg of rest) {
    if (arg === "--pilot") pilot = true;
    else if (arg === "--all") all = true;
    else if (arg === "--plan") plan = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--yes") yes = true;
    else if (arg === "--refresh") refresh = true;
    else if (arg.startsWith("--only=")) only = arg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith("--max-google-calls=")) maxGoogleCalls = Number(arg.slice("--max-google-calls=".length));
    else throw new Error(`Unknown flag "${arg}"`);
  }

  if (COMMANDS_REQUIRING_SELECTION.includes(command as CurateCommand) && !pilot && !all && !only) {
    throw new Error("Specify a destination selection: --pilot, --all, or --only=slug1,slug2");
  }
  if (!Number.isFinite(maxGoogleCalls) || maxGoogleCalls <= 0) {
    throw new Error("--max-google-calls must be a positive number");
  }

  return { command: command as CurateCommand, pilot, only, all, plan, dryRun, yes, refresh, maxGoogleCalls };
}
