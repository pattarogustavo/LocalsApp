import { router } from 'expo-router';

/** How long after opening the paywall a second 402 is treated as "already handled" — long enough to cover two AI calls (e.g. destination info + suggested places) that fire together and both come back unauthorized. */
const DEDUPE_WINDOW_MS = 1500;

let paywallOpenedAt = 0;

export function isPaywallRequiredError(error: unknown): boolean {
  const code = (error as { data?: { code?: string } } | null | undefined)?.data?.code;
  return code === 'PAYWALL_REQUIRED';
}

/**
 * Centralized handler for the backend's 402 PAYWALL_REQUIRED response.
 * Opens /paywall at most once within a short window, so two AI calls that
 * both reject around the same time don't stack two navigations.
 *
 * Returns whether `error` was a paywall-required error (handled either way,
 * whether or not this particular call actually opened the paywall) — the
 * caller uses this to decide whether to skip its own generic error handling.
 */
export function handlePaywallError(error: unknown): boolean {
  if (!isPaywallRequiredError(error)) return false;
  const now = Date.now();
  if (now - paywallOpenedAt >= DEDUPE_WINDOW_MS) {
    paywallOpenedAt = now;
    router.push('/paywall' as any);
  }
  return true;
}
