import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripsStore } from '@/store/trips';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';

/**
 * Small floating, non-interactive pill shown while trips are being
 * translated in the background after a language switch. Deliberately not a
 * modal/Alert — it must never block navigation or input.
 */
export function TranslatingIndicator() {
  const isTranslating = useTripsStore((s) => s.isTranslating);
  const insets = useSafeAreaInsets();
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!isTranslating) return null;

  return (
    <View pointerEvents="none" style={[styles.container, { top: insets.top + 8 }]}>
      <View style={styles.pill}>
        <ActivityIndicator size="small" color={colors.tint} />
        <Text style={styles.text} numberOfLines={1}>{t.common.translatingTrips}</Text>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
    elevation: 10,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
      },
      android: { elevation: 6 },
    }),
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
});
