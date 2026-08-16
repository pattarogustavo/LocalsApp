import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { Wordmark } from '@/components/ui/wordmark-logo';
import { SchemeColors, type ThemeColorPalette } from '@/constants/theme';
import { useAuthStore } from '@/store/auth';

const ONBOARDING_LANGUAGES = [
  { code: 'pt', label: 'PT' },
  { code: 'en', label: 'EN' },
] as const;

// Text/icon color for content drawn on top of the primary button color, which
// is identical in both schemes — always the light-scheme background swatch.
const ON_PRIMARY = SchemeColors.light.background;

const SCREEN_WIDTH = Dimensions.get('window').width;
// Wordmark font size (per line) — large enough to read as the hero mark now
// that it replaces both the old compass icon and the separate title text.
const WORDMARK_SIZE = Math.round(SCREEN_WIDTH * 0.15);

function LanguageSwitcher() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const preferredLanguage = useAuthStore((s) => s.preferredLanguage ?? 'pt');
  const setLanguage = useAuthStore((s) => s.setLanguage);

  return (
    <View style={styles.langSwitcher}>
      {ONBOARDING_LANGUAGES.map((lang) => {
        const active = preferredLanguage.slice(0, 2) === lang.code;
        return (
          <TouchableOpacity
            key={lang.code}
            style={[styles.langOption, active && styles.langOptionActive]}
            activeOpacity={0.8}
            onPress={() => setLanguage(lang.code)}
          >
            <Text style={[styles.langOptionText, active && styles.langOptionTextActive]}>
              {lang.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const features = [
    { icon: 'map-outline' as const, text: t.auth.onboarding.feature1 },
    { icon: 'document-text-outline' as const, text: t.auth.onboarding.feature2 },
    { icon: 'navigate-outline' as const, text: t.auth.onboarding.feature3 },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      <LanguageSwitcher />

      {/* Large wordmark logo */}
      <View style={styles.logoSection}>
        <Wordmark size={WORDMARK_SIZE} />
      </View>

      {/* Title block */}
      <View style={styles.titleBlock}>
        <Text style={styles.subtitle}>{t.auth.onboarding.subtitle}</Text>
      </View>

      {/* Feature rows */}
      <View style={styles.features}>
        {features.map((f) => (
          <View key={f.text} style={styles.featureRow}>
            <View style={styles.featureIconBg}>
              <Ionicons name={f.icon} size={18} color={colors.primary} />
            </View>
            <Text style={styles.featureText}>{f.text}</Text>
          </View>
        ))}
      </View>

      {/* CTA Buttons */}
      <View style={styles.buttons}>
        <TouchableOpacity
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/auth/register' as any)}
        >
          <Text style={styles.primaryBtnText}>{t.auth.onboarding.getStarted}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/auth/login' as any)}
        >
          <Text style={styles.secondaryBtnText}>{t.auth.onboarding.alreadyHaveAccount}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.trialNote}>{t.auth.onboarding.trialInfo}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
  },
  logoSection: {
    alignItems: 'center',
  },
  langSwitcher: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 3,
    gap: 2,
  },
  langOption: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 17,
  },
  langOptionActive: {
    backgroundColor: colors.primary,
  },
  langOptionText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  langOptionTextActive: {
    color: colors.textOnPrimary,
  },
  titleBlock: {
    alignItems: 'center',
    gap: 6,
  },
  subtitle: {
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
  },
  features: {
    gap: 14,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  featureIconBg: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    fontSize: 15,
    color: colors.foreground,
    fontWeight: '500',
  },
  buttons: {
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: ON_PRIMARY,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnText: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: '500',
  },
  trialNote: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.muted,
  },
});
