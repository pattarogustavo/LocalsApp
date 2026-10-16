import { DEFAULT_MAX_GOOGLE_CALLS } from "../data/curation-config";

export type CurateCommand = "generate" | "verify" | "translate" | "export" | "check" | "smoke" | "add";

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
  /** --names="Name 1; Name 2; ..." — semicolon-separated, "add" only. */
  names?: string[];
}

const COMMANDS: CurateCommand[] = ["generate", "verify", "translate", "export", "check", "smoke", "add"];

/** Commands that always operate on a specific destination set and therefore require --pilot/--all/--only. */
const COMMANDS_REQUIRING_SELECTION: CurateCommand[] = ["generate", "verify", "translate", "export", "add"];

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
  let names: string[] | undefined;

  for (const arg of rest) {
    if (arg === "--pilot") pilot = true;
    else if (arg === "--all") all = true;
    else if (arg === "--plan") plan = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--yes") yes = true;
    else if (arg === "--refresh") refresh = true;
    else if (arg.startsWith("--only=")) only = arg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith("--max-google-calls=")) maxGoogleCalls = Number(arg.slice("--max-google-calls=".length));
    else if (arg.startsWith("--names=")) names = arg.slice("--names=".length).split(";").map((s) => s.trim()).filter(Boolean);
    else throw new Error(`Unknown flag "${arg}"`);
  }

  if (COMMANDS_REQUIRING_SELECTION.includes(command as CurateCommand) && !pilot && !all && !only) {
    throw new Error("Specify a destination selection: --pilot, --all, or --only=slug1,slug2");
  }
  if (!Number.isFinite(maxGoogleCalls) || maxGoogleCalls <= 0) {
    throw new Error("--max-google-calls must be a positive number");
  }
  if (command === "add") {
    if (pilot || all) throw new Error('"add" requires a single destination via --only=slug (not --pilot/--all)');
    if (!only || only.length !== 1) throw new Error('"add" requires exactly one destination: --only=slug');
    if (!names || names.length === 0) throw new Error('"add" requires --names="Name 1; Name 2; ..."');
  }

  return { command: command as CurateCommand, pilot, only, all, plan, dryRun, yes, refresh, maxGoogleCalls, names };
}
