import { useAuthStore } from '@/store/auth';
import { getTranslations } from '@/i18n';
import type { Translations } from '@/i18n';

/**
 * Returns the translation object for the current preferred language.
 * Reads from the top-level `preferredLanguage` field in the auth store,
 * which is persisted independently of the user session so it survives logout
 * and is immediately reactive to changes from the Profile language selector.
 *
 * Usage:
 * ```tsx
 * const t = useTranslation();
 * <Text>{t.home.title}</Text>
 * ```
 */
export function useTranslation(): Translations {
  // Read from top-level preferredLanguage (not user.preferredLanguage)
  // This ensures reactivity even when user is null (not logged in)
  const lang = useAuthStore((s) => s.preferredLanguage ?? 'pt');
  return getTranslations(lang);
}
