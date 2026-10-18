export interface RedescribeOptions {
  only?: string[];
  all: boolean;
  ids?: number[];
  dryRun: boolean;
  yes: boolean;
}

/** Parses `tsx scripts/curate-redescribe.ts [--only=slug1,slug2 | --all] [--ids=1,2,3] [--dry-run] [--yes]`. */
export function parseRedescribeArgs(argv: string[]): RedescribeOptions {
  let only: string[] | undefined;
  let all = false;
  let ids: number[] | undefined;
  let dryRun = false;
  let yes = false;

  for (const arg of argv) {
    if (arg === "--all") all = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--yes") yes = true;
    else if (arg.startsWith("--only=")) only = arg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith("--ids=")) {
      ids = arg
        .slice("--ids=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
    } else throw new Error(`Unknown flag "${arg}"`);
  }

  if (only && all) throw new Error("Specify only one of --only or --all, not both");
  if (ids && ids.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new Error("--ids must be a comma-separated list of positive integers");
  }
  if (!only && !all && !ids) {
    throw new Error("Specify a selection: --only=slug1,slug2, --all, or --ids=1,2,3");
  }

  return { only, all, ids, dryRun, yes };
}
