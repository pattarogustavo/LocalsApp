import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Stack, router } from 'expo-router';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { sheetScreenOptions } from '@/utils/sheet-presentation';
import { useDiscardConfirmation } from '@/hooks/use-discard-confirmation';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

export default function ChangePasswordScreen() {
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  useDiscardConfirmation(!!(current || next || confirm) && !loading);

  const handleSubmit = async () => {
    if (!current || !next || !confirm) {
      Alert.alert(t.common.error, t.profile.fillAllFields);
      return;
    }
    if (next !== confirm) {
      Alert.alert(t.common.error, t.profile.passwordMismatch);
      return;
    }
    if (next.length < 6) {
      Alert.alert(t.common.error, t.profile.passwordTooShort);
      return;
    }
    setLoading(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      const { useAuthStore } = await import('@/store/auth');
      const userEmail = useAuthStore.getState().user?.email;
      if (!userEmail) throw new Error('No email found');
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: userEmail, password: current });
      if (signInError) throw new Error(t.profile.passwordError);
      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      if (updateError) throw updateError;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t.common.success, t.profile.passwordChanged);
      router.back();
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t.common.error, e?.message ?? t.profile.passwordError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors, [0.7, 1.0])} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.pwTitle}>{t.profile.changePasswordTitle}</Text>
        <Text style={styles.pwLabel}>{t.profile.currentPassword}</Text>
        <TextInput style={styles.pwInput} value={current} onChangeText={setCurrent} secureTextEntry placeholder="••••••••" placeholderTextColor={colors.muted} />
        <Text style={styles.pwLabel}>{t.profile.newPassword}</Text>
        <TextInput style={styles.pwInput} value={next} onChangeText={setNext} secureTextEntry placeholder={t.profile.newPasswordPlaceholder} placeholderTextColor={colors.muted} />
        <Text style={styles.pwLabel}>{t.profile.confirmPassword}</Text>
        <TextInput style={styles.pwInput} value={confirm} onChangeText={setConfirm} secureTextEntry placeholder={t.profile.confirmPasswordPlaceholder} placeholderTextColor={colors.muted} />
        <TouchableOpacity style={[styles.pwSaveBtn, loading && { opacity: 0.6 }]} onPress={handleSubmit} disabled={loading} activeOpacity={0.7}>
          {loading ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.pwSaveBtnText}>{t.profile.savePassword}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  pwTitle: { fontSize: 20, fontWeight: '700', color: colors.foreground, marginBottom: 24 },
  pwLabel: { fontSize: 13, fontWeight: '600', color: withAlpha(colors.foreground, 0.6), marginBottom: 8, marginTop: 16 },
  pwInput: { backgroundColor: withAlpha(colors.foreground, 0.06), borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.foreground, borderWidth: 0.5, borderColor: withAlpha(colors.foreground, 0.12) },
  pwSaveBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 28 },
  pwSaveBtnText: { fontSize: 16, fontWeight: '700', color: colors.textOnPrimary },
});
