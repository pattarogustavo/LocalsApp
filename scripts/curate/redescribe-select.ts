/**
 * Pure selection logic for curate:redescribe: given candidate rows already
 * scoped by the entrypoint's DB query (status approved/pending, and the
 * requested destinations/ids), decides which ones actually get rewritten.
 * A row forced via --ids is always kept; every other row must match the
 * generic template (see scripts/curate/generic-description.ts) — a row that
 * doesn't match is never touched, even if it's within a requested city.
 */

import { isGenericDescriptions } from "./generic-description";

export interface SelectableRow {
  id: number;
  descriptions: { pt?: string | null; en?: string | null } | null;
}

export function selectRedescribeCandidates<T extends SelectableRow>(rows: T[], forcedIds: Set<number> = new Set()): T[] {
  return rows.filter((row) => {
    if (forcedIds.has(row.id)) return true;
    return isGenericDescriptions(row.descriptions ?? {});
  });
}
