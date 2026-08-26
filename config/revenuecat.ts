import { Platform } from 'react-native';
import Purchases, {
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';

// Public SDK key (safe to ship in the client bundle) — distinct from
// REVENUECAT_API_KEY_APPLE/GOOGLE, which are server-only secrets used for
// backend/build tooling.
const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY ?? '';

export type SubscriptionPlan = 'monthly' | 'annual';

export interface SubscriptionSnapshot {
  status: 'active';
  plan: SubscriptionPlan | null;
  expiresAt: string | null;
}

let configured = false;

/** Whether this platform + build has a usable RevenueCat SDK. */
export function isRevenueCatSupported(): boolean {
  return (Platform.OS === 'ios' || Platform.OS === 'android') && !!API_KEY;
}

/**
 * Configure the RevenueCat SDK. Call once at app startup, before logIn.
 */
export function configureRevenueCat(): void {
  if (configured || !isRevenueCatSupported()) return;
  Purchases.configure({ apiKey: API_KEY });
  configured = true;
}

/** Link the RevenueCat app_user_id to the authenticated Supabase user id. */
export async function loginRevenueCat(userId: string): Promise<void> {
  if (!configured) {
    console.log('[RevenueCat DEBUG] logIn pulado: SDK não configurado (configured=false)');
    return;
  }
  try {
    const { customerInfo } = await Purchases.logIn(userId);
    console.log('[RevenueCat DEBUG] logIn ok — app_user_id agora é:', customerInfo.originalAppUserId);
  } catch (err) {
    console.warn('[RevenueCat] logIn failed:', err);
  }
}

/** Detach the current user from RevenueCat. Call on sign-out. */
export async function logoutRevenueCat(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch {
    // Already anonymous / never logged in — safe to ignore.
  }
}

/** Fetch the current offering's monthly/annual packages, if configured. */
export async function getOfferingPackages(): Promise<Partial<Record<SubscriptionPlan, PurchasesPackage>>> {
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return {};
  return {
    monthly: current.monthly ?? undefined,
    annual: current.annual ?? undefined,
  };
}

/** Purchase a package. Throws on failure/cancellation — check `err.userCancelled`. */
export async function purchasePackage(pkg: PurchasesPackage): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

/** Restore previous purchases for the current store account. */
export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

/** Derive our subscription fields from RevenueCat's CustomerInfo, if any entitlement is active. */
export function subscriptionFromCustomerInfo(customerInfo: CustomerInfo): SubscriptionSnapshot | null {
  const entitlement = Object.values(customerInfo.entitlements.active)[0];
  if (!entitlement) return null;
  const plan: SubscriptionPlan | null = entitlement.productIdentifier?.includes('annual')
    ? 'annual'
    : entitlement.productIdentifier?.includes('monthly')
    ? 'monthly'
    : null;
  return {
    status: 'active',
    plan,
    expiresAt: entitlement.expirationDate,
  };
}
