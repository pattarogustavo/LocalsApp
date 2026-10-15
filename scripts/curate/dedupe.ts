/** Deduplicates a list by `googlePlaceId`, keeping the first occurrence of each id. */
export function dedupeByPlaceId<T extends { googlePlaceId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.googlePlaceId)) continue;
    seen.add(item.googlePlaceId);
    result.push(item);
  }
  return result;
}
