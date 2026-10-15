/**
 * Guards against a re-run of curate:generate silently touching rows a human
 * has already reviewed. 'approved' and 'rejected' rows are frozen: new runs
 * only ever add brand-new places (new googlePlaceId for that destination) as
 * 'pending'.
 */

export type ExistingPlaceStatus = "pending" | "approved" | "rejected" | "closed";

export function canOverwriteRow(existingStatus: ExistingPlaceStatus | undefined): boolean {
  return existingStatus !== "approved" && existingStatus !== "rejected";
}

export interface PartitionResult<T> {
  toInsert: T[];
  toSkip: T[];
}

/**
 * Splits newly generated candidates into ones to insert (not already present
 * for this destination) and ones to skip (a place with that googlePlaceId
 * already exists, regardless of its status — generation never updates an
 * existing row, approved/rejected or not).
 */
export function partitionNewCandidates<T extends { googlePlaceId: string }>(
  candidates: T[],
  existingPlaceIds: ReadonlySet<string>,
): PartitionResult<T> {
  const toInsert: T[] = [];
  const toSkip: T[] = [];
  for (const candidate of candidates) {
    if (existingPlaceIds.has(candidate.googlePlaceId)) {
      toSkip.push(candidate);
    } else {
      toInsert.push(candidate);
    }
  }
  return { toInsert, toSkip };
}
