import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { sheetScreenOptions } from '@/utils/sheet-presentation';
import { useDiscardConfirmation } from '@/hooks/use-discard-confirmation';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

export default function ChangeEmailScreen() {
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const currentEmail = useAuthStore((s) => s.user?.email ?? null);
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(false);

  useDiscardConfirmation(newEmail.trim().length > 0 && !loading);

  const handleSubmit = async () => {
    const trimmed = newEmail.trim();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(trimmed)) {
      Alert.alert(t.common.error, t.profile.emailInvalid);
      return;
    }
    setLoading(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      const { error } = await supabase.auth.updateUser({ email: trimmed });
      if (error) throw error;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t.common.success, t.profile.emailChangeSent.replace('{email}', trimmed));
      router.back();
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t.common.error, e?.message ?? t.profile.emailChangeError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors)} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.pwTitle}>{t.profile.editEmailTitle}</Text>
        <Text style={styles.pwLabel}>{t.profile.currentEmail}</Text>
        <View style={[styles.pwInput, styles.pwInputDisabled]}>
          <Text style={{ fontSize: 15, color: colors.muted }}>{currentEmail ?? '—'}</Text>
        </View>
        <Text style={styles.pwLabel}>{t.profile.newEmail}</Text>
        <TextInput
          style={styles.pwInput}
          value={newEmail}
          onChangeText={setNewEmail}
          placeholder={t.profile.newEmailPlaceholder}
          placeholderTextColor={colors.muted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity style={[styles.pwSaveBtn, loading && { opacity: 0.6 }]} onPress={handleSubmit} disabled={loading} activeOpacity={0.7}>
          {loading ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.pwSaveBtnText}>{t.profile.sendConfirmation}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  pwTitle: { fontSize: 20, fontWeight: '700', color: colors.foreground, marginBottom: 24 },
  pwLabel: { fontSize: 13, fontWeight: '600', color: withAlpha(colors.foreground, 0.6), marginBottom: 8, marginTop: 16 },
  pwInput: { backgroundColor: withAlpha(colors.foreground, 0.06), borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.foreground, borderWidth: 0.5, borderColor: withAlpha(colors.foreground, 0.12) },
  pwInputDisabled: { justifyContent: 'center', opacity: 0.7 },
  pwSaveBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 28 },
  pwSaveBtnText: { fontSize: 16, fontWeight: '700', color: colors.textOnPrimary },
});
