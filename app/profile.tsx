import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/auth';
import { useSubscription } from '@/hooks/use-subscription';
import { trpc } from '@/lib/trpc';

function SubscriptionBadge({ status }: { status: string | null }) {
  const config = {
    trial: { label: 'Trial', bg: 'rgba(82,183,136,0.15)', color: '#52B788', icon: 'time-outline' },
    active: { label: 'Pro', bg: 'rgba(82,183,136,0.15)', color: '#52B788', icon: 'checkmark-circle-outline' },
    expired: { label: 'Expired', bg: 'rgba(239,68,68,0.12)', color: '#EF4444', icon: 'close-circle-outline' },
    cancelled: { label: 'Cancelled', bg: 'rgba(156,163,175,0.15)', color: '#9CA3AF', icon: 'ban-outline' },
  }[status ?? 'expired'] ?? { label: 'Free', bg: 'rgba(156,163,175,0.15)', color: '#9CA3AF', icon: 'person-outline' };

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Ionicons name={config.icon as any} size={12} color={config.color} />
      <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();
  const { status, isTrial, isActive, isExpired, daysLeftInTrial, trialEndsAt, subscriptionExpiresAt, plan } = useSubscription();
  const [loggingOut, setLoggingOut] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const cancelMutation = trpc.subscription.cancel.useMutation();
  const { updateSubscription } = useAuthStore();

  const handleLogout = async () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          setLoggingOut(true);
          await logout();
          router.replace('/auth/onboarding' as any);
        },
      },
    ]);
  };

  const handleCancelSubscription = async () => {
    Alert.alert(
      'Cancel subscription',
      'You will lose access to Pro features at the end of your billing period. Are you sure?',
      [
        { text: 'Keep subscription', style: 'cancel' },
        {
          text: 'Cancel subscription',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await cancelMutation.mutateAsync();
              updateSubscription({ subscriptionStatus: 'cancelled' });
              Alert.alert('Subscription cancelled', 'You will have access until the end of your billing period.');
            } catch {
              Alert.alert('Error', 'Could not cancel subscription. Please try again.');
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  const formatDate = (date: Date | null) => {
    if (!date) return '—';
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="rgba(245,240,232,0.8)" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile & Settings</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* User card */}
        <View style={styles.userCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {(user?.name ?? user?.email ?? '?')[0].toUpperCase()}
            </Text>
          </View>
          <View style={styles.userInfo}>
            <View style={styles.userNameRow}>
              <Text style={styles.userName}>{user?.name ?? 'Traveler'}</Text>
              <SubscriptionBadge status={status} />
            </View>
            <Text style={styles.userEmail}>{user?.email ?? '—'}</Text>
          </View>
        </View>

        {/* Subscription section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Subscription</Text>

          <View style={styles.card}>
            {isTrial && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Status</Text>
                  <Text style={styles.cardValue}>Free trial</Text>
                </View>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Days remaining</Text>
                  <Text style={[styles.cardValue, (daysLeftInTrial ?? 0) <= 2 && styles.cardValueWarning]}>
                    {daysLeftInTrial ?? 0} day{daysLeftInTrial !== 1 ? 's' : ''}
                  </Text>
                </View>
                {trialEndsAt && (
                  <View style={styles.cardRow}>
                    <Text style={styles.cardLabel}>Trial ends</Text>
                    <Text style={styles.cardValue}>{formatDate(trialEndsAt)}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.upgradeBtn}
                  activeOpacity={0.85}
                  onPress={() => router.push('/paywall' as any)}
                >
                  <Ionicons name="sparkles-outline" size={14} color="#0F1F16" />
                  <Text style={styles.upgradeBtnText}>Upgrade to Pro</Text>
                </TouchableOpacity>
              </>
            )}

            {isActive && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Plan</Text>
                  <Text style={styles.cardValue}>{plan === 'annual' ? 'Annual' : 'Monthly'}</Text>
                </View>
                {subscriptionExpiresAt && (
                  <View style={styles.cardRow}>
                    <Text style={styles.cardLabel}>Renews on</Text>
                    <Text style={styles.cardValue}>{formatDate(subscriptionExpiresAt)}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.cancelBtn}
                  activeOpacity={0.85}
                  onPress={handleCancelSubscription}
                  disabled={cancelling}
                >
                  {cancelling ? (
                    <ActivityIndicator size="small" color="#EF4444" />
                  ) : (
                    <Text style={styles.cancelBtnText}>Cancel subscription</Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            {isExpired && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Status</Text>
                  <Text style={[styles.cardValue, { color: '#EF4444' }]}>Expired</Text>
                </View>
                <TouchableOpacity
                  style={styles.upgradeBtn}
                  activeOpacity={0.85}
                  onPress={() => router.push('/paywall' as any)}
                >
                  <Ionicons name="refresh-outline" size={14} color="#0F1F16" />
                  <Text style={styles.upgradeBtnText}>Reactivate subscription</Text>
                </TouchableOpacity>
              </>
            )}

            {status === 'cancelled' && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Status</Text>
                  <Text style={[styles.cardValue, { color: '#9CA3AF' }]}>Cancelled</Text>
                </View>
                {subscriptionExpiresAt && (
                  <View style={styles.cardRow}>
                    <Text style={styles.cardLabel}>Access until</Text>
                    <Text style={styles.cardValue}>{formatDate(subscriptionExpiresAt)}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.upgradeBtn}
                  activeOpacity={0.85}
                  onPress={() => router.push('/paywall' as any)}
                >
                  <Ionicons name="refresh-outline" size={14} color="#0F1F16" />
                  <Text style={styles.upgradeBtnText}>Resubscribe</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Account section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            {[
              { icon: 'notifications-outline', label: 'Notifications', onPress: () => {} },
              { icon: 'lock-closed-outline', label: 'Change password', onPress: () => {} },
              { icon: 'shield-checkmark-outline', label: 'Privacy & Security', onPress: () => {} },
            ].map((item, i, arr) => (
              <TouchableOpacity
                key={item.label}
                style={[styles.menuRow, i < arr.length - 1 && styles.menuRowBorder]}
                activeOpacity={0.7}
                onPress={item.onPress}
              >
                <View style={styles.menuIconBg}>
                  <Ionicons name={item.icon as any} size={16} color="rgba(245,240,232,0.6)" />
                </View>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={14} color="rgba(245,240,232,0.25)" />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Support section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support</Text>
          <View style={styles.card}>
            {[
              { icon: 'help-circle-outline', label: 'Help & FAQ', onPress: () => {} },
              { icon: 'chatbubble-outline', label: 'Contact support', onPress: () => {} },
              { icon: 'star-outline', label: 'Rate Voyage', onPress: () => {} },
            ].map((item, i, arr) => (
              <TouchableOpacity
                key={item.label}
                style={[styles.menuRow, i < arr.length - 1 && styles.menuRowBorder]}
                activeOpacity={0.7}
                onPress={item.onPress}
              >
                <View style={styles.menuIconBg}>
                  <Ionicons name={item.icon as any} size={16} color="rgba(245,240,232,0.6)" />
                </View>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={14} color="rgba(245,240,232,0.25)" />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity
          style={styles.logoutBtn}
          activeOpacity={0.85}
          onPress={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? (
            <ActivityIndicator color="#EF4444" />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={18} color="#EF4444" />
              <Text style={styles.logoutText}>Log out</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.versionText}>Voyage v1.0.0</Text>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245,240,232,0.06)',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5F0E8',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 0,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 28,
    paddingHorizontal: 4,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(82,183,136,0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(82,183,136,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#52B788',
  },
  userInfo: {
    flex: 1,
    gap: 4,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F5F0E8',
  },
  userEmail: {
    fontSize: 13,
    color: 'rgba(245,240,232,0.45)',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(245,240,232,0.35)',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: 'rgba(245,240,232,0.05)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(245,240,232,0.08)',
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLabel: {
    fontSize: 14,
    color: 'rgba(245,240,232,0.5)',
  },
  cardValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5F0E8',
  },
  cardValueWarning: {
    color: '#F59E0B',
  },
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#52B788',
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 4,
  },
  upgradeBtnText: {
    color: '#0F1F16',
    fontSize: 14,
    fontWeight: '700',
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  cancelBtnText: {
    fontSize: 13,
    color: '#EF4444',
    textDecorationLine: 'underline',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  menuRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245,240,232,0.06)',
  },
  menuIconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(245,240,232,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: {
    flex: 1,
    fontSize: 14,
    color: 'rgba(245,240,232,0.8)',
    fontWeight: '500',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.15)',
    marginTop: 8,
    marginBottom: 16,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#EF4444',
  },
  versionText: {
    textAlign: 'center',
    fontSize: 11,
    color: 'rgba(245,240,232,0.2)',
    marginBottom: 8,
  },
});
