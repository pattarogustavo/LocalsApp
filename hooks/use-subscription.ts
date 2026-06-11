import { useMemo } from 'react';
import { useAuthStore } from '@/store/auth';

export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'cancelled' | null;

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  hasAccess: boolean;
  isTrial: boolean;
  isActive: boolean;
  isExpired: boolean;
  isCancelled: boolean;
  daysLeftInTrial: number | null;
  trialEndsAt: Date | null;
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
        isTrial: false,
        isActive: false,
        isExpired: false,
        isCancelled: false,
        daysLeftInTrial: null,
        trialEndsAt: null,
        subscriptionExpiresAt: null,
        plan: null,
      };
    }

    const status = user.subscriptionStatus as SubscriptionStatus;
    const now = new Date();

    const trialEndsAt = user.trialEndsAt ? new Date(user.trialEndsAt) : null;
    const subscriptionExpiresAt = user.subscriptionExpiresAt
      ? new Date(user.subscriptionExpiresAt)
      : null;

    // Compute effective status (client-side expiry check)
    let effectiveStatus = status;
    if (status === 'trial' && trialEndsAt && trialEndsAt < now) {
      effectiveStatus = 'expired';
    }
    if (status === 'active' && subscriptionExpiresAt && subscriptionExpiresAt < now) {
      effectiveStatus = 'expired';
    }

    const isTrial = effectiveStatus === 'trial';
    const isActive = effectiveStatus === 'active';
    const isExpired = effectiveStatus === 'expired';
    const isCancelled = effectiveStatus === 'cancelled';
    const hasAccess = isTrial || isActive;

    let daysLeftInTrial: number | null = null;
    if (isTrial && trialEndsAt) {
      daysLeftInTrial = Math.max(
        0,
        Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      );
    }

    return {
      status: effectiveStatus,
      hasAccess,
      isTrial,
      isActive,
      isExpired,
      isCancelled,
      daysLeftInTrial,
      trialEndsAt,
      subscriptionExpiresAt,
      plan: user.subscriptionPlan,
    };
  }, [user]);
}
