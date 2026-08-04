import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSubscription } from '@/hooks/use-subscription';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

/**
 * Displays a banner at the top of the main app during the trial period.
 * Shows days remaining and a CTA to upgrade.
 * Dismissible per session (not persisted).
 */
export function TrialBanner() {
  const { isTrial, daysLeftInTrial } = useSubscription();
  const [dismissed, setDismissed] = useState(false);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!isTrial || dismissed) return null;

  const isUrgent = (daysLeftInTrial ?? 0) <= 2;

  return (
    <View style={[styles.container, isUrgent && styles.containerUrgent]}>
      <View style={styles.left}>
        <Ionicons
          name={isUrgent ? 'warning-outline' : 'time-outline'}
          size={14}
          color={isUrgent ? colors.warning : colors.primary}
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
          <Ionicons name="close" size={14} color={colors.muted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: withAlpha(colors.primary, 0.1),
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(colors.primary, 0.15),
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  containerUrgent: {
    backgroundColor: withAlpha(colors.warning, 0.1),
    borderBottomColor: withAlpha(colors.warning, 0.2),
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  text: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '500',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  upgradeBtn: {
    backgroundColor: withAlpha(colors.primary, 0.15),
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.35),
  },
  upgradeBtnUrgent: {
    backgroundColor: withAlpha(colors.warning, 0.15),
    borderColor: withAlpha(colors.warning, 0.35),
  },
  upgradeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  upgradeTextUrgent: {
    color: colors.warning,
  },
  dismissBtn: {
    padding: 2,
  },
});
