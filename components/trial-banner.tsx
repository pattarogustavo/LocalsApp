import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSubscription } from '@/hooks/use-subscription';

/**
 * Displays a banner at the top of the main app during the trial period.
 * Shows days remaining and a CTA to upgrade.
 * Dismissible per session (not persisted).
 */
export function TrialBanner() {
  const { isTrial, daysLeftInTrial } = useSubscription();
  const [dismissed, setDismissed] = useState(false);

  if (!isTrial || dismissed) return null;

  const isUrgent = (daysLeftInTrial ?? 0) <= 2;

  return (
    <View style={[styles.container, isUrgent && styles.containerUrgent]}>
      <View style={styles.left}>
        <Ionicons
          name={isUrgent ? 'warning-outline' : 'time-outline'}
          size={14}
          color={isUrgent ? '#F59E0B' : '#52B788'}
        />
        <Text style={styles.text}>
          {daysLeftInTrial === 0
            ? 'Trial expires today'
            : daysLeftInTrial === 1
            ? '1 day left in your trial'
            : `${daysLeftInTrial} days left in your trial`}
        </Text>
      </View>
      <View style={styles.right}>
        <TouchableOpacity
          style={[styles.upgradeBtn, isUrgent && styles.upgradeBtnUrgent]}
          activeOpacity={0.8}
          onPress={() => router.push('/paywall' as any)}
        >
          <Text style={[styles.upgradeText, isUrgent && styles.upgradeTextUrgent]}>
            Upgrade
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setDismissed(true)} style={styles.dismissBtn}>
          <Ionicons name="close" size={14} color="rgba(245,240,232,0.4)" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(82,183,136,0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(82,183,136,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  containerUrgent: {
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderBottomColor: 'rgba(245,158,11,0.2)',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  text: {
    fontSize: 12,
    color: 'rgba(245,240,232,0.7)',
    fontWeight: '500',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  upgradeBtn: {
    backgroundColor: 'rgba(82,183,136,0.2)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.35)',
  },
  upgradeBtnUrgent: {
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderColor: 'rgba(245,158,11,0.35)',
  },
  upgradeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#52B788',
  },
  upgradeTextUrgent: {
    color: '#F59E0B',
  },
  dismissBtn: {
    padding: 2,
  },
});
