import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { sheetScreenOptions } from '@/utils/sheet-presentation';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

const LANGUAGES = [
  { code: 'pt', label: 'Português', initials: 'PT' },
  { code: 'en', label: 'English', initials: 'EN' },
  { code: 'es', label: 'Español', initials: 'ES' },
  { code: 'fr', label: 'Français', initials: 'FR' },
  { code: 'de', label: 'Deutsch', initials: 'DE' },
  { code: 'it', label: 'Italiano', initials: 'IT' },
];

export default function LanguageScreen() {
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const current = user?.preferredLanguage ?? 'pt';

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors)} />
      <View style={styles.langSheet}>
        <Text style={styles.langTitle}>{t.profile.languageTitle}</Text>
        <Text style={styles.langSubtitle}>{t.profile.languageSubtitle}</Text>
        {LANGUAGES.map((lang) => (
          <TouchableOpacity
            key={lang.code}
            style={[styles.langRow, current === lang.code && styles.langRowActive]}
            onPress={() => { updateProfile({ preferredLanguage: lang.code }); router.back(); }}
          >
            <Text style={styles.langFlag}>{lang.initials}</Text>
            <Text style={[styles.langLabel, current === lang.code && styles.langLabelActive]}>{lang.label}</Text>
            {current === lang.code && <Ionicons name="checkmark-circle" size={18} color={colors.textAccent} />}
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  langSheet: { backgroundColor: colors.surface, paddingHorizontal: 24, paddingTop: 20 },
  langTitle: { fontSize: 18, fontWeight: '700', color: colors.foreground, marginBottom: 6 },
  langSubtitle: { fontSize: 13, color: colors.muted, marginBottom: 20 },
  langRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, marginBottom: 4, gap: 12 },
  langRowActive: { backgroundColor: withAlpha(colors.primary, 0.10) },
  langFlag: { fontSize: 13, fontWeight: '700', color: colors.muted, width: 28 },
  langLabel: { flex: 1, fontSize: 16, color: withAlpha(colors.foreground, 0.7) },
  langLabelActive: { color: colors.foreground, fontWeight: '600' },
});
