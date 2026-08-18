import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { PurchasesPackage } from 'react-native-purchases';
import { useAuthStore } from '@/store/auth';
import {
  getOfferingPackages,
  purchasePackage,
  restorePurchases,
  subscriptionFromCustomerInfo,
  type SubscriptionPlan,
} from '@/config/revenuecat';
import { sendSubscriptionConfirmedNotification, scheduleRenewalReminder } from '@/lib/subscription-notifications';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { SchemeColors, type ThemeColorPalette } from '@/constants/theme';
import { Wordmark } from '@/components/ui/wordmark-logo';

// Text/icon color for content drawn on top of the primary button color, which
// is identical in both schemes — always the light-scheme background swatch.
const ON_PRIMARY = SchemeColors.light.background;

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

export default function PaywallScreen() {
  const insets = useSafeAreaInsets();
  const { blocking } = useLocalSearchParams<{ blocking?: string }>();
  const isBlocking = blocking === 'true';
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { updateSubscription } = useAuthStore();

  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>('annual');
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [packages, setPackages] = useState<Partial<Record<SubscriptionPlan, PurchasesPackage>>>({});

  useEffect(() => {
    getOfferingPackages().then(setPackages).catch(() => {});
  }, []);

  const FEATURES = [
    { icon: 'infinite-outline', text: t.paywall.featureUnlimited },
    { icon: 'sparkles-outline', text: t.paywall.featureAI },
    { icon: 'airplane-outline', text: t.paywall.featureFlight },
    { icon: 'document-text-outline', text: t.paywall.featureDocs },
    { icon: 'people-outline', text: t.paywall.featureCollaborate },
    { icon: 'notifications-outline', text: t.paywall.featureReminders },
  ];

  const handlePurchase = async () => {
    const pkg = packages[selectedPlan];
    if (!pkg) {
      Alert.alert(t.paywall.purchaseFailed, t.paywall.purchaseFailedMsg);
      return;
    }
    setLoading(true);
    try {
      const customerInfo = await purchasePackage(pkg);
      const snapshot = subscriptionFromCustomerInfo(customerInfo);
      const expiresAt = snapshot?.expiresAt ? new Date(snapshot.expiresAt) : null;
      // Update local state immediately from the purchase response instead of
      // waiting for the RevenueCat webhook, which can take a few seconds.
      updateSubscription({
        subscriptionStatus: 'active',
        subscriptionPlan: snapshot?.plan ?? selectedPlan,
        subscriptionExpiresAt: expiresAt ? expiresAt.toISOString() : null,
      });
      sendSubscriptionConfirmedNotification(selectedPlan).catch(() => {});
      if (expiresAt) scheduleRenewalReminder(expiresAt).catch(() => {});
      Alert.alert(
        t.paywall.subscribeSuccess,
        t.paywall.subscribeSuccessMsg.replace('{plan}', selectedPlan),
        [{ text: t.common.continue, onPress: () => router.replace('/(tabs)') }]
      );
    } catch (err: any) {
      // The user closing the purchase sheet isn't a real error — just let
      // them try again without an alert.
      if (!err?.userCancelled) {
        // TEMP DEBUG: surface the real RevenueCat error to investigate the
        // generic "Purchase failed" reports. Remove once diagnosed.
        const debugInfo = err?.message || err;
        if (debugInfo) {
          Alert.alert('Purchase failed (DEBUG)', String(debugInfo));
        } else {
          Alert.alert(t.paywall.purchaseFailed, t.paywall.purchaseFailedMsg);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const customerInfo = await restorePurchases();
      const snapshot = subscriptionFromCustomerInfo(customerInfo);
      if (snapshot) {
        updateSubscription({
          subscriptionStatus: 'active',
          subscriptionPlan: snapshot.plan ?? selectedPlan,
          subscriptionExpiresAt: snapshot.expiresAt,
        });
        Alert.alert(
          t.paywall.restoreSuccess,
          t.paywall.restoreSuccessMsg.replace('{plan}', snapshot.plan ?? selectedPlan),
          [{ text: t.common.continue, onPress: () => router.replace('/(tabs)') }]
        );
      } else {
        Alert.alert(t.paywall.noPurchases, t.paywall.noPurchasesMsg);
      }
    } catch {
      Alert.alert(t.paywall.purchaseFailed, t.paywall.purchaseFailedMsg);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        {!isBlocking && (
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={colors.muted} />
          </TouchableOpacity>
        )}
        <View style={styles.headerCenter}>
          <Wordmark size={20} color={colors.primary} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          {isBlocking ? (
            <>
              <Text style={styles.heroTitle}>{t.paywall.accessRequired}</Text>
              <Text style={styles.heroSubtitle}>{t.paywall.accessRequiredSubtitle}</Text>
            </>
          ) : (
            <>
              <Text style={styles.heroTitle}>{t.paywall.upgradeTitle}</Text>
              <Text style={styles.heroSubtitle}>{t.paywall.upgradeSubtitle}</Text>
            </>
          )}
        </View>

        {/* Features */}
        <View style={styles.featuresCard}>
          {FEATURES.map((f) => (
            <View key={f.text} style={styles.featureRow}>
              <View style={styles.featureIconBg}>
                <Ionicons name={f.icon as any} size={16} color={colors.primary} />
              </View>
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {/* Example itinerary preview link */}
        <TouchableOpacity
          style={styles.exampleLink}
          activeOpacity={0.7}
          onPress={() => router.push('/example-itinerary' as any)}
        >
          <Ionicons name="map-outline" size={14} color={colors.textAccent} />
          <Text style={styles.exampleLinkText}>{t.paywall.seeExampleItinerary}</Text>
        </TouchableOpacity>

        {/* Plan selector */}
        <View style={styles.plans}>
          {/* Annual plan */}
          <TouchableOpacity
            style={[styles.planCard, selectedPlan === 'annual' && styles.planCardSelected]}
            activeOpacity={0.85}
            onPress={() => setSelectedPlan('annual')}
          >
            <View style={styles.planBadgeRow}>
              <View style={styles.saveBadge}>
                <Text style={styles.saveBadgeText}>{t.paywall.save} 33%</Text>
              </View>
              {selectedPlan === 'annual' && (
                <View style={styles.selectedDot}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                </View>
              )}
            </View>
            <Text style={styles.planName}>{t.paywall.annual}</Text>
            <View style={styles.planPriceRow}>
              <Text style={styles.planPrice}>$39.99</Text>
              <Text style={styles.planPeriod}>{t.paywall.perYear}</Text>
            </View>
            <Text style={styles.planBilled}>$3.33{t.paywall.perMonth}</Text>
          </TouchableOpacity>

          {/* Monthly plan */}
          <TouchableOpacity
            style={[styles.planCard, selectedPlan === 'monthly' && styles.planCardSelected]}
            activeOpacity={0.85}
            onPress={() => setSelectedPlan('monthly')}
          >
            {selectedPlan === 'monthly' && (
              <View style={[styles.planBadgeRow, { justifyContent: 'flex-end' }]}>
                <View style={styles.selectedDot}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                </View>
              </View>
            )}
            <Text style={styles.planName}>{t.paywall.monthly}</Text>
            <View style={styles.planPriceRow}>
              <Text style={styles.planPrice}>$4.99</Text>
              <Text style={styles.planPeriod}>{t.paywall.perMonth}</Text>
            </View>
            <Text style={styles.planBilled}>{t.paywall.cancelAnytime}</Text>
          </TouchableOpacity>
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={[styles.ctaBtn, loading && styles.ctaBtnDisabled]}
          activeOpacity={0.85}
          onPress={handlePurchase}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={ON_PRIMARY} />
          ) : (
            <Text style={styles.ctaBtnText}>
              {selectedPlan === 'annual' ? t.paywall.startAnnual : t.paywall.startMonthly}
            </Text>
          )}
        </TouchableOpacity>

        {/* Legal */}
        <Text style={styles.legalText}>{t.paywall.terms}</Text>

        {/* Restore */}
        <TouchableOpacity
          style={styles.restoreBtn}
          activeOpacity={0.7}
          onPress={handleRestore}
          disabled={restoring}
        >
          {restoring ? (
            <ActivityIndicator size="small" color={colors.muted} />
          ) : (
            <Text style={styles.restoreText}>{t.paywall.restore}</Text>
          )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: 'relative',
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  headerCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  scroll: {
    paddingHorizontal: 20,
    gap: 0,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.foreground,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 14,
    color: colors.foreground,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  // Cards use the same fill/border color so the border stays invisible until
  // planCardSelected overrides it — avoids a layout shift on selection.
  featuresCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.surface,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureIconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: withAlpha(colors.primary, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    fontSize: 14,
    color: colors.foreground,
    fontWeight: '500',
  },
  exampleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 20,
  },
  exampleLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textAccent,
    textDecorationLine: 'underline',
  },
  plans: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  planCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: colors.surface,
    minHeight: 120,
    justifyContent: 'flex-end',
  },
  planCardSelected: {
    borderColor: colors.primary,
    backgroundColor: withAlpha(colors.primary, 0.08),
  },
  planBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  saveBadge: {
    backgroundColor: withAlpha(colors.primary, 0.15),
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  saveBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  selectedDot: {
    marginLeft: 'auto',
  },
  planName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.foreground,
    marginBottom: 4,
  },
  planPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  planPrice: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.foreground,
  },
  planPeriod: {
    fontSize: 11,
    color: colors.foreground,
  },
  planBilled: {
    fontSize: 10,
    color: colors.foreground,
    marginTop: 2,
  },
  ctaBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  ctaBtnDisabled: {
    opacity: 0.5,
  },
  ctaBtnText: {
    color: ON_PRIMARY,
    fontSize: 16,
    fontWeight: '700',
  },
  legalText: {
    fontSize: 10,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  restoreBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  restoreText: {
    fontSize: 13,
    color: colors.muted,
    textDecorationLine: 'underline',
  },
});
