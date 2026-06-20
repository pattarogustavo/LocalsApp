import { useAuthStore } from '@/store/auth';
import { getTranslations } from '@/i18n';
import type { Translations } from '@/i18n';

/**
 * Returns the translation object for the user's current preferred language.
 * Reactively updates when the user changes their language in Profile settings.
 *
 * Usage:
 * ```tsx
 * const t = useTranslation();
 * <Text>{t.home.title}</Text>
 * <Text>{t.trialBanner.daysLeft(3)}</Text>
 * ```
 */
export function useTranslation(): Translations {
  const lang = useAuthStore((s) => s.user?.preferredLanguage ?? 'pt');
  return getTranslations(lang ?? 'pt');
}
