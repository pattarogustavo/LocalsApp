/**
 * Bounded, targeted one-shot repair loop for itinerary generation (spec
 * "Stage 10"). Replaces the previous behavior of silently accepting
 * whatever validateAndCorrectItinerary produced, even when it logged a hard
 * CONFLICT (e.g. a must-visit place that couldn't be fit) that never
 * actually reached the user (see docs/itinerary-audit.md section 7.9).
 *
 * Design, deliberately conservative:
 * - At most ONE extra LLM call per generation, ever — no retry loop.
 * - The repair call gets a CONCISE list of concrete failures, not a fresh
 *   prompt from scratch, and reuses the exact same candidate pool/schema.
 * - The repaired result is only used if it strictly reduces the number of
 *   unresolved conflicts; otherwise the original result is kept and
 *   reported as-is. A repair attempt can never make the returned warnings
 *   look better than what was actually achieved.
 * - Any failure during the repair call (timeout, invalid JSON, provider
 *   error) is swallowed — the original, already-valid result is returned.
 */

/**
 * Warnings that represent a genuinely unresolved, user-visible conflict —
 * as opposed to a routine, already-fixed correction (e.g. "Removed
 * duplicate stop", "Shifted day 1 stops later") which needed no repair
 * because validateAndCorrectItinerary already handled it deterministically.
 */
export function extractRepairableConflicts(warnings: string[]): string[] {
  return warnings.filter(
    (w) =>
      w.startsWith("CONFLICT:") ||
      w.includes("no fallback restaurant candidate available") ||
      w.includes("no free slot to insert a fallback"),
  );
}

/** Builds the prompt addendum describing exactly what needs fixing — appended to the ORIGINAL prompt, not a new one. */
export function buildRepairPromptBlock(conflicts: string[]): string {
  return `\n\nIMPORTANTE — correção necessária: a versão anterior deste roteiro tinha os seguintes problemas não resolvidos. Ajuste o roteiro para corrigi-los — pode remover, trocar ou reordenar paradas de menor prioridade se necessário — mas continue respeitando TODAS as outras regras obrigatórias já descritas acima:\n${conflicts.map((c) => `- ${c}`).join("\n")}`;
}

export interface GenerateAttempt<T> {
  result: T;
  warnings: string[];
}

export interface RepairOutcome<T> {
  result: T;
  warnings: string[];
  /** Telemetry: did a repair call happen at all, and was its output actually used. */
  repairAttempted: boolean;
  repairUsed: boolean;
}

/**
 * Runs `generate(undefined)` for the initial attempt. If its warnings
 * contain a repairable conflict, runs `generate(repairPromptBlock)` exactly
 * once more and keeps whichever attempt has strictly fewer unresolved
 * conflicts (ties keep the original, since a repair call that didn't
 * measurably help isn't worth the nondeterminism of swapping results).
 */
export async function withOneRepairAttempt<T>(
  generate: (repairPromptBlock: string | undefined) => Promise<GenerateAttempt<T>>,
): Promise<RepairOutcome<T>> {
  const first = await generate(undefined);
  const firstConflicts = extractRepairableConflicts(first.warnings);
  if (firstConflicts.length === 0) {
    return { result: first.result, warnings: first.warnings, repairAttempted: false, repairUsed: false };
  }

  try {
    const repairBlock = buildRepairPromptBlock(firstConflicts);
    const second = await generate(repairBlock);
    const secondConflicts = extractRepairableConflicts(second.warnings);
    if (secondConflicts.length < firstConflicts.length) {
      return { result: second.result, warnings: second.warnings, repairAttempted: true, repairUsed: true };
    }
    return { result: first.result, warnings: first.warnings, repairAttempted: true, repairUsed: false };
  } catch (err) {
    console.warn("[itinerary] repair attempt failed, keeping the original result:", err);
    return { result: first.result, warnings: first.warnings, repairAttempted: true, repairUsed: false };
  }
}
