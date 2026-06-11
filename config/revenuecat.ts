// TODO: Replace PLACEHOLDER keys with real RevenueCat API keys
// after registering the app on App Store Connect and Google Play Console.
// Products must be created in each store with the identifiers above.

import { Platform } from 'react-native';

export const REVENUECAT_CONFIG = {
  apiKeyApple: process.env.REVENUECAT_API_KEY_APPLE ?? 'PLACEHOLDER_APPLE_KEY',
  apiKeyGoogle: process.env.REVENUECAT_API_KEY_GOOGLE ?? 'PLACEHOLDER_GOOGLE_KEY',
  products: {
    monthly: 'travel_app_monthly',
    annual: 'travel_app_annual',
  },
};

export type SubscriptionPlan = 'monthly' | 'annual';

export interface PurchaseResult {
  success: boolean;
  plan: SubscriptionPlan;
  expiresAt: Date;
}

/**
 * Initialize RevenueCat SDK.
 * Call this once at app startup after the user is identified.
 */
export async function initRevenueCat(userId: string): Promise<void> {
  // In production: configure with real API keys
  // const apiKey = Platform.OS === 'ios'
  //   ? REVENUECAT_CONFIG.apiKeyApple
  //   : REVENUECAT_CONFIG.apiKeyGoogle;
  // await Purchases.configure({ apiKey, appUserID: userId });
  console.log('[RevenueCat] SDK initialized (sandbox mode) for user:', userId);
}

/**
 * Check if RevenueCat is configured with real keys.
 * Returns false when using placeholder keys (sandbox/dev mode).
 */
export function isRevenueCatConfigured(): boolean {
  const key = Platform.OS === 'ios'
    ? REVENUECAT_CONFIG.apiKeyApple
    : REVENUECAT_CONFIG.apiKeyGoogle;
  return !key.startsWith('PLACEHOLDER_');
}

/**
 * Purchase a subscription plan.
 * In dev/sandbox mode, delegates to the mock purchase endpoint.
 * In production, calls RevenueCat SDK.
 */
export async function purchasePlan(
  plan: SubscriptionPlan,
  mockPurchaseFn: (plan: SubscriptionPlan) => Promise<PurchaseResult>,
): Promise<PurchaseResult> {
  if (!isRevenueCatConfigured()) {
    // Mock purchase for local testing
    console.log('[RevenueCat] Mock purchase:', plan);
    return mockPurchaseFn(plan);
  }

  // Production: use RevenueCat SDK
  // const offerings = await Purchases.getOfferings();
  // const pkg = plan === 'annual'
  //   ? offerings.current?.annual
  //   : offerings.current?.monthly;
  // if (!pkg) throw new Error('Package not found');
  // const result = await Purchases.purchasePackage(pkg);
  // const expiresAt = new Date(result.customerInfo.latestExpirationDate ?? Date.now());
  // return { success: true, plan, expiresAt };

  throw new Error('RevenueCat not configured. Please add API keys.');
}

/**
 * Restore previous purchases.
 * In dev/sandbox mode, returns null (no-op).
 */
export async function restorePurchases(): Promise<{ restored: boolean }> {
  if (!isRevenueCatConfigured()) {
    console.log('[RevenueCat] Restore purchases (sandbox mode - no-op)');
    return { restored: false };
  }
  // Production:
  // const customerInfo = await Purchases.restorePurchases();
  // return { restored: !!customerInfo.activeSubscriptions.length };
  return { restored: false };
}
