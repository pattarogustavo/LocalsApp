import type { Trip } from '@/types/voyage';

export interface SharedTripRow {
  shareId: number;
  shareRole: 'editor' | 'viewer';
  tripData: Trip;
}

/**
 * Merges the store's own trips with trips shared by other users
 * (sharing.listSharedWithMe), without duplicating by id. If a trip from the
 * shared query already exists in `baseTrips` (e.g. previously hydrated via
 * hydrateSharedTrip), the query's copy wins since it's the freshest, but it
 * keeps the shareId/shareRole tagging either way.
 */
export function mergeTripsWithShared(baseTrips: Trip[], sharedRows: SharedTripRow[]): Trip[] {
  const result = [...baseTrips];
  const indexById = new Map(result.map((t, i) => [t.id, i] as const));
  for (const row of sharedRows) {
    const merged: Trip = { ...row.tripData, shareId: row.shareId, shareRole: row.shareRole };
    const idx = indexById.get(merged.id);
    if (idx !== undefined) {
      result[idx] = merged;
    } else {
      indexById.set(merged.id, result.length);
      result.push(merged);
    }
  }
  return result;
}
