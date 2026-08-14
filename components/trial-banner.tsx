import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSubscription } from '@/hooks/use-subscription';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

// Badge accent color, same in both light and dark schemes.
const UPGRADE_COLOR = '#91876E';

/**
 * Small "Pro" badge shown at AI feature entry points for users who don't
 * have an active subscription yet. Tapping it navigates to the paywall.
 * Renders nothing once the user has access.
 */
export function ProBadge({ style }: { style?: object }) {
  const { hasAccess } = useSubscription();
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (hasAccess) return null;

  return (
    <TouchableOpacity
      style={[styles.badge, style]}
      activeOpacity={0.8}
      onPress={() => router.push('/paywall' as any)}
    >
      <Ionicons name="sparkles" size={11} color={UPGRADE_COLOR} />
      <Text style={styles.badgeText}>{t.proBadge.label}</Text>
    </TouchableOpacity>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: withAlpha(UPGRADE_COLOR, 0.15),
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: withAlpha(UPGRADE_COLOR, 0.35),
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: UPGRADE_COLOR,
  },
});
