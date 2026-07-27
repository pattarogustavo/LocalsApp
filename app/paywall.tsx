import React, { useState } from 'react';
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
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import { useSubscription } from '@/hooks/use-subscription';
import { sendSubscriptionConfirmedNotification, scheduleRenewalReminder } from '@/lib/subscription-notifications';
import { useTranslation } from '@/hooks/use-translation';

export default function PaywallScreen() {
  const insets = useSafeAreaInsets();
  const { blocking } = useLocalSearchParams<{ blocking?: string }>();
  const isBlocking = blocking === 'true';
  const t = useTranslation();

  const { updateSubscription } = useAuthStore();
  const { isTrial, daysLeftInTrial } = useSubscription();

  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual');
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const mockPurchaseMutation = trpc.subscription.mockPurchase.useMutation();

  const FEATURES = [
    { icon: 'infinite-outline', text: t.paywall.featureUnlimited },
    { icon: 'sparkles-outline', text: t.paywall.featureAI },
    { icon: 'airplane-outline', text: t.paywall.featureFlight },
    { icon: 'document-text-outline', text: t.paywall.featureDocs },
    { icon: 'people-outline', text: t.paywall.featureCollaborate },
    { icon: 'notifications-outline', text: t.paywall.featureReminders },
  ];

  const handlePurchase = async () => {
    setLoading(true);
    try {
      const result = await mockPurchaseMutation.mutateAsync({ plan: selectedPlan });
      updateSubscription({
        subscriptionStatus: 'active',
        subscriptionPlan: selectedPlan,
        subscriptionExpiresAt: result.expiresAt.toISOString(),
      });
      sendSubscriptionConfirmedNotification(selectedPlan).catch(() => {});
      scheduleRenewalReminder(result.expiresAt).catch(() => {});
      Alert.alert(
        t.paywall.subscribeSuccess,
        t.paywall.subscribeSuccessMsg.replace('{plan}', selectedPlan),
        [{ text: t.common.continue, onPress: () => router.replace('/(tabs)') }]
      );
    } catch {
      Alert.alert(t.paywall.purchaseFailed, t.paywall.purchaseFailedMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    setTimeout(() => {
      setRestoring(false);
      Alert.alert(t.paywall.noPurchases, t.paywall.noPurchasesMsg);
    }, 1500);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        {!isBlocking && (
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#8A7F6E" />
          </TouchableOpacity>
        )}
        <View style={styles.headerCenter}>
          <View style={styles.logoCircle}>
            <Ionicons name="airplane" size={24} color="#3D5A2E" />
          </View>
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
              <Text style={styles.heroTitle}>{t.paywall.trialEnded}</Text>
              <Text style={styles.heroSubtitle}>{t.paywall.trialEndedSubtitle}</Text>
            </>
          ) : (
            <>
              <Text style={styles.heroTitle}>{t.paywall.upgradeTitle}</Text>
              <Text style={styles.heroSubtitle}>
                {isTrial && daysLeftInTrial !== null
                  ? t.trialBanner.daysLeft(daysLeftInTrial) + ' — ' + t.paywall.unlockAll
                  : t.paywall.upgradeSubtitle}
              </Text>
            </>
          )}
        </View>

        {/* Features */}
        <View style={styles.featuresCard}>
          {FEATURES.map((f) => (
            <View key={f.text} style={styles.featureRow}>
              <View style={styles.featureIconBg}>
                <Ionicons name={f.icon as any} size={16} color="#3D5A2E" />
              </View>
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

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
                <Text style={styles.saveBadgeText}>{t.paywall.save} 40%</Text>
              </View>
              {selectedPlan === 'annual' && (
                <View style={styles.selectedDot}>
                  <Ionicons name="checkmark-circle" size={18} color="#3D5A2E" />
                </View>
              )}
            </View>
            <Text style={styles.planName}>{t.paywall.annual}</Text>
            <View style={styles.planPriceRow}>
              <Text style={styles.planPrice}>R$19,90</Text>
              <Text style={styles.planPeriod}>{t.paywall.perMonth}</Text>
            </View>
            <Text style={styles.planBilled}>{t.paywall.billedAnnuallyFull}</Text>
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
                  <Ionicons name="checkmark-circle" size={18} color="#3D5A2E" />
                </View>
              </View>
            )}
            <Text style={styles.planName}>{t.paywall.monthly}</Text>
            <View style={styles.planPriceRow}>
              <Text style={styles.planPrice}>R$33,90</Text>
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
            <ActivityIndicator color="#2C2416" />
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
            <ActivityIndicator size="small" color="#8A7F6E" />
          ) : (
            <Text style={styles.restoreText}>{t.paywall.restore}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0EBE0',
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
    backgroundColor: 'rgba(240,235,224,0.9)',
  },
  headerCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  logoCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(61,90,46,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.25)',
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
    color: '#F7F3EC',
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 14,
    color: '#2C2416',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  featuresCard: {
    backgroundColor: 'rgba(240,235,224,0.9)',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(240,235,224,0.9)',
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
    backgroundColor: 'rgba(82,183,136,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    fontSize: 14,
    color: '#2C2416',
    fontWeight: '500',
  },
  plans: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  planCard: {
    flex: 1,
    backgroundColor: 'rgba(240,235,224,0.9)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(240,235,224,0.9)',
    minHeight: 120,
    justifyContent: 'flex-end',
  },
  planCardSelected: {
    borderColor: '#3D5A2E',
    backgroundColor: 'rgba(82,183,136,0.08)',
  },
  planBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  saveBadge: {
    backgroundColor: 'rgba(61,90,46,0.15)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  saveBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#3D5A2E',
    letterSpacing: 0.5,
  },
  selectedDot: {
    marginLeft: 'auto',
  },
  planName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2C2416',
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
    color: '#2C2416',
  },
  planPeriod: {
    fontSize: 11,
    color: '#2C2416',
  },
  planBilled: {
    fontSize: 10,
    color: '#2C2416',
    marginTop: 2,
  },
  ctaBtn: {
    backgroundColor: '#3D5A2E',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  ctaBtnDisabled: {
    opacity: 0.5,
  },
  ctaBtnText: {
    color: '#F7F3EC',
    fontSize: 16,
    fontWeight: '700',
  },
  legalText: {
    fontSize: 10,
    color: '#2C2416',
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
    color: '#2C2416',
    textDecorationLine: 'underline',
  },
});
