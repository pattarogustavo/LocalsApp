import { useMemo } from 'react';
import { useAuthStore } from '@/store/auth';

export type SubscriptionStatus = 'active' | 'expired' | 'cancelled' | null;

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  hasAccess: boolean;
  isActive: boolean;
  isExpired: boolean;
  isCancelled: boolean;
  subscriptionExpiresAt: Date | null;
  plan: 'monthly' | 'annual' | null;
}

/**
 * Central hook for subscription state.
 * Derives all subscription info from the auth store.
 */
export function useSubscription(): SubscriptionInfo {
  const user = useAuthStore((s) => s.user);

  return useMemo(() => {
    if (!user) {
      return {
        status: null,
        hasAccess: false,
        isActive: false,
        isExpired: false,
        isCancelled: false,
        subscriptionExpiresAt: null,
        plan: null,
      };
    }

    const status = user.subscriptionStatus as SubscriptionStatus;
    const now = new Date();

    const subscriptionExpiresAt = user.subscriptionExpiresAt
      ? new Date(user.subscriptionExpiresAt)
      : null;

    // Compute effective status (client-side expiry check)
    let effectiveStatus = status;
    if (status === 'active' && subscriptionExpiresAt && subscriptionExpiresAt < now) {
      effectiveStatus = 'expired';
    }

    const isActive = effectiveStatus === 'active';
    const isExpired = effectiveStatus === 'expired';
    const isCancelled = effectiveStatus === 'cancelled';
    const hasAccess = isActive;

    return {
      status: effectiveStatus,
      hasAccess,
      isActive,
      isExpired,
      isCancelled,
      subscriptionExpiresAt,
      plan: user.subscriptionPlan,
    };
  }, [user]);
}
