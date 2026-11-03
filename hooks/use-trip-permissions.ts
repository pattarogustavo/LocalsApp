import { useMemo } from 'react';

export type TripRole = 'owner' | 'editor' | 'viewer';

export interface TripPermissions {
  role: TripRole;
  isOwner: boolean;
  /**
   * Owner or editor — may change any part of the trip, including triggering
   * AI features. Whether an AI call actually succeeds (Pro, this trip's one
   * free use, or neither) is entirely the backend's call, surfaced to the
   * caller as a 402 PAYWALL_REQUIRED (see hooks/use-paywall-guard.ts) rather
   * than a client-side permission.
   */
  canEdit: boolean;
  /** Only the owner may invite, change roles, or cancel invites. */
  canManageTravelers: boolean;
  /** Only the owner may delete the trip for everyone. */
  canDeleteTrip: boolean;
}

/**
 * Single source of truth for what the current user may do on a trip.
 * `role` must already be resolved by the caller: 'owner' for a trip owned
 * locally by this account, or the `shareRole` returned by
 * sharing.listSharedWithMe for a trip shared with this account.
 */
export function useTripPermissions(role: TripRole): TripPermissions {
  return useMemo(() => {
    const isOwner = role === 'owner';
    const canEdit = role === 'owner' || role === 'editor';
    return {
      role,
      isOwner,
      canEdit,
      canManageTravelers: isOwner,
      canDeleteTrip: isOwner,
    };
  }, [role]);
}
