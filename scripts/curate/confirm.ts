import readline from "node:readline/promises";

import { maskDatabaseHost } from "./db";

export interface ConfirmOptions {
  yes: boolean;
  dryRun: boolean;
}

/** Prompts for a typed "sim" before any real database write, unless --yes or --dry-run was given. Shared by curate-destinations.ts and curate-import.ts. */
export async function confirmDatabaseWrite(opts: ConfirmOptions): Promise<void> {
  if (opts.yes || opts.dryRun) return;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  console.log(`\nThis will write to database host: ${maskDatabaseHost(connectionString)}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "sim" to continue: ');
  rl.close();
  if (answer.trim().toLowerCase() !== "sim") {
    throw new Error("Aborted: confirmation not given.");
  }
}
