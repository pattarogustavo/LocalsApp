import { useMemo } from 'react';
import { useSubscription } from '@/hooks/use-subscription';

export type TripRole = 'owner' | 'editor' | 'viewer';

export interface TripPermissions {
  role: TripRole;
  isOwner: boolean;
  /** Owner or editor — may change any part of the trip except AI features. */
  canEdit: boolean;
  /** Only the owner may invite, change roles, or cancel invites. */
  canManageTravelers: boolean;
  /** Only the owner may delete the trip for everyone. */
  canDeleteTrip: boolean;
  /** canEdit AND the current (logged-in) account has an active subscription. */
  canUseAI: boolean;
}

/**
 * Single source of truth for what the current user may do on a trip.
 * `role` must already be resolved by the caller: 'owner' for a trip owned
 * locally by this account, or the `shareRole` returned by
 * sharing.listSharedWithMe for a trip shared with this account.
 */
export function useTripPermissions(role: TripRole): TripPermissions {
  const { hasAccess } = useSubscription();

  return useMemo(() => {
    const isOwner = role === 'owner';
    const canEdit = role === 'owner' || role === 'editor';
    return {
      role,
      isOwner,
      canEdit,
      canManageTravelers: isOwner,
      canDeleteTrip: isOwner,
      canUseAI: canEdit && hasAccess,
    };
  }, [role, hasAccess]);
}
