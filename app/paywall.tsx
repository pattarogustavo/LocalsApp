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

const FEATURES = [
  { icon: 'infinite-outline', text: 'Unlimited trips & itineraries' },
  { icon: 'sparkles-outline', text: 'AI-powered trip planning' },
  { icon: 'airplane-outline', text: 'Real-time flight tracking' },
  { icon: 'document-text-outline', text: 'Document storage & sharing' },
  { icon: 'people-outline', text: 'Collaborative trip planning' },
  { icon: 'notifications-outline', text: 'Smart travel reminders' },
];

export default function PaywallScreen() {
  const insets = useSafeAreaInsets();
  const { blocking } = useLocalSearchParams<{ blocking?: string }>();
  const isBlocking = blocking === 'true';

  const { updateSubscription } = useAuthStore();
  const { isTrial, daysLeftInTrial } = useSubscription();

  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual');
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const mockPurchaseMutation = trpc.subscription.mockPurchase.useMutation();

  const handlePurchase = async () => {
    setLoading(true);
    try {
      const result = await mockPurchaseMutation.mutateAsync({ plan: selectedPlan });
      updateSubscription({
        subscriptionStatus: 'active',
        subscriptionPlan: selectedPlan,
        subscriptionExpiresAt: result.expiresAt.toISOString(),
      });
      // Send confirmation notification and schedule renewal reminder
      sendSubscriptionConfirmedNotification(selectedPlan).catch(() => {});
      scheduleRenewalReminder(result.expiresAt).catch(() => {});
      Alert.alert(
        'Subscription activated!',
        `Your ${selectedPlan} plan is now active. Enjoy Voyage!`,
        [{ text: 'Continue', onPress: () => router.replace('/(tabs)') }]
      );
    } catch {
      Alert.alert('Purchase failed', 'Please try again or contact support.');
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    // In production: call RevenueCat restorePurchases()
    setTimeout(() => {
      setRestoring(false);
      Alert.alert('No purchases found', 'No previous purchases were found for this account.');
    }, 1500);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        {!isBlocking && (
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="rgba(245,240,232,0.6)" />
          </TouchableOpacity>
        )}
        <View style={styles.headerCenter}>
          <View style={styles.logoCircle}>
            <Ionicons name="airplane" size={24} color="#52B788" />
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
              <Text style={styles.heroTitle}>Your trial has ended</Text>
              <Text style={styles.heroSubtitle}>
                Subscribe to continue planning your trips with Voyage.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.heroTitle}>Upgrade to Voyage Pro</Text>
              <Text style={styles.heroSubtitle}>
                {isTrial && daysLeftInTrial !== null
                  ? `${daysLeftInTrial} day${daysLeftInTrial !== 1 ? 's' : ''} left in your trial — unlock everything.`
                  : 'Unlock the full travel planning experience.'}
              </Text>
            </>
          )}
        </View>

        {/* Features */}
        <View style={styles.featuresCard}>
          {FEATURES.map((f) => (
            <View key={f.text} style={styles.featureRow}>
              <View style={styles.featureIconBg}>
                <Ionicons name={f.icon as any} size={16} color="#52B788" />
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
                <Text style={styles.saveBadgeText}>SAVE 40%</Text>
              </View>
              {selectedPlan === 'annual' && (
                <View style={styles.selectedDot}>
                  <Ionicons name="checkmark-circle" size={18} color="#52B788" />
                </View>
              )}
            </View>
            <Text style={styles.planName}>Annual</Text>
            <View style={styles.planPriceRow}>
              <Text style={styles.planPrice}>R$19,90</Text>
              <Text style={styles.planPeriod}>/month</Text>
            </View>
            <Text style={styles.planBilled}>Billed R$238,80/year</Text>
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
                  <Ionicons name="checkmark-circle" size={18} color="#52B788" />
                </View>
              </View>
            )}
            <Text style={styles.planName}>Monthly</Text>
            <View style={styles.planPriceRow}>
              <Text style={styles.planPrice}>R$33,90</Text>
              <Text style={styles.planPeriod}>/month</Text>
            </View>
            <Text style={styles.planBilled}>Cancel anytime</Text>
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
            <ActivityIndicator color="#0F1F16" />
          ) : (
            <Text style={styles.ctaBtnText}>
              {selectedPlan === 'annual' ? 'Start Annual Plan' : 'Start Monthly Plan'}
            </Text>
          )}
        </TouchableOpacity>

        {/* Legal */}
        <Text style={styles.legalText}>
          Payment will be charged to your account. Subscription automatically renews unless cancelled at least 24 hours before the end of the current period.
        </Text>

        {/* Restore */}
        <TouchableOpacity
          style={styles.restoreBtn}
          activeOpacity={0.7}
          onPress={handleRestore}
          disabled={restoring}
        >
          {restoring ? (
            <ActivityIndicator size="small" color="rgba(245,240,232,0.4)" />
          ) : (
            <Text style={styles.restoreText}>Restore purchases</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F1F16',
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
    backgroundColor: 'rgba(245,240,232,0.08)',
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
    backgroundColor: 'rgba(82,183,136,0.12)',
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
    color: '#F5F0E8',
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 14,
    color: 'rgba(245,240,232,0.55)',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  featuresCard: {
    backgroundColor: 'rgba(245,240,232,0.04)',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(245,240,232,0.08)',
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
    color: 'rgba(245,240,232,0.8)',
    fontWeight: '500',
  },
  plans: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  planCard: {
    flex: 1,
    backgroundColor: 'rgba(245,240,232,0.05)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(245,240,232,0.1)',
    minHeight: 120,
    justifyContent: 'flex-end',
  },
  planCardSelected: {
    borderColor: '#52B788',
    backgroundColor: 'rgba(82,183,136,0.08)',
  },
  planBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  saveBadge: {
    backgroundColor: 'rgba(82,183,136,0.2)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  saveBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#52B788',
    letterSpacing: 0.5,
  },
  selectedDot: {
    marginLeft: 'auto',
  },
  planName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F5F0E8',
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
    color: '#F5F0E8',
  },
  planPeriod: {
    fontSize: 11,
    color: 'rgba(245,240,232,0.45)',
  },
  planBilled: {
    fontSize: 10,
    color: 'rgba(245,240,232,0.35)',
    marginTop: 2,
  },
  ctaBtn: {
    backgroundColor: '#52B788',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  ctaBtnDisabled: {
    opacity: 0.5,
  },
  ctaBtnText: {
    color: '#0F1F16',
    fontSize: 16,
    fontWeight: '700',
  },
  legalText: {
    fontSize: 10,
    color: 'rgba(245,240,232,0.25)',
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
    color: 'rgba(245,240,232,0.35)',
    textDecorationLine: 'underline',
  },
});
