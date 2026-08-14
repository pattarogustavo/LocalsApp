import React, { useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { SchemeColors, type ThemeColorPalette } from '@/constants/theme';
import { EXAMPLE_ITINERARY_PARIS } from '@/constants/example-itineraries';
import { ExampleItineraryPreview } from '@/components/example-itinerary-preview';

// Text/icon color for content drawn on top of the primary button color, which
// is identical in both schemes — always the light-scheme background swatch.
const ON_PRIMARY = SchemeColors.light.background;

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

/**
 * One-time screen shown right after the first successful login/signup.
 * Gives a taste of what an AI-generated itinerary looks like and pitches
 * the subscription. The only way out is the "continue without subscribing"
 * link — there's no close button by design, see markWelcomeOfferSeen below.
 */
export default function WelcomeOfferScreen() {
  const insets = useSafeAreaInsets();
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const markWelcomeOfferSeen = useAuthStore((s) => s.markWelcomeOfferSeen);

  // Shown once: as soon as the screen mounts, the flag flips so this never
  // appears again for this device, regardless of how the user leaves it.
  useEffect(() => {
    markWelcomeOfferSeen();
  }, []);

  const benefits = [
    { icon: 'infinite-outline' as const, text: t.welcomeOffer.benefit1 },
    { icon: 'sparkles-outline' as const, text: t.welcomeOffer.benefit2 },
    { icon: 'information-circle-outline' as const, text: t.welcomeOffer.benefit3 },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Wordmark */}
        <View style={styles.wordmark}>
          <Text style={styles.wordmarkThe}>THE</Text>
          <Text style={styles.wordmarkLocals}>Locals</Text>
        </View>

        {/* Title */}
        <Text style={styles.title}>{t.welcomeOffer.title}</Text>
        <Text style={styles.subtitle}>{t.welcomeOffer.subtitle}</Text>

        {/* Preview card */}
        <TouchableOpacity
          style={styles.previewCard}
          activeOpacity={0.85}
          onPress={() => router.push('/example-itinerary' as any)}
        >
          <View style={styles.previewHeader}>
            <Ionicons name="map-outline" size={14} color={colors.textAccent} />
            <Text style={styles.previewLabel}>{t.welcomeOffer.previewLabel}</Text>
          </View>
          <ExampleItineraryPreview itinerary={EXAMPLE_ITINERARY_PARIS} maxStopsPerDay={3} />
          <View style={styles.previewMoreRow}>
            <Text style={styles.previewMoreText}>{t.welcomeOffer.previewTitle}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textAccent} />
          </View>
        </TouchableOpacity>

        {/* Benefits */}
        <View style={styles.benefits}>
          {benefits.map((b) => (
            <View key={b.text} style={styles.benefitRow}>
              <View style={styles.benefitIconBg}>
                <Ionicons name={b.icon} size={16} color={colors.primary} />
              </View>
              <Text style={styles.benefitText}>{b.text}</Text>
            </View>
          ))}
        </View>

        {/* Subscribe CTA */}
        <TouchableOpacity
          style={styles.ctaBtn}
          activeOpacity={0.85}
          onPress={() => router.replace('/paywall' as any)}
        >
          <Ionicons name="sparkles" size={16} color={ON_PRIMARY} />
          <Text style={styles.ctaBtnText}>{t.welcomeOffer.subscribeBtn}</Text>
        </TouchableOpacity>

        {/* The only way out of this screen */}
        <TouchableOpacity
          style={styles.continueLink}
          activeOpacity={0.7}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.continueLinkText}>{t.welcomeOffer.continueWithoutSubscribing}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  wordmark: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 24,
  },
  wordmarkThe: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B8963E',
    letterSpacing: 5,
  },
  wordmarkLocals: {
    fontSize: 34,
    fontWeight: '700',
    fontStyle: 'italic',
    color: colors.foreground,
    letterSpacing: -0.5,
    marginTop: 2,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.foreground,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  previewCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.surface,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  previewLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textAccent,
    letterSpacing: 0.3,
  },
  previewMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 4,
  },
  previewMoreText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textAccent,
  },
  benefits: {
    width: '100%',
    gap: 14,
    marginBottom: 28,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  benefitIconBg: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: withAlpha(colors.primary, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.foreground,
  },
  ctaBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginBottom: 16,
  },
  ctaBtnText: {
    color: ON_PRIMARY,
    fontSize: 16,
    fontWeight: '700',
  },
  continueLink: {
    paddingVertical: 8,
  },
  continueLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
    textDecorationLine: 'underline',
  },
});
