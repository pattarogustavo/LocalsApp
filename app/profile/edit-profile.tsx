import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Stack, router } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '@/store/auth';
import { trpc } from '@/lib/trpc';
import { UsernameField, type UsernameFieldStatus } from '@/components/ui/username-field';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { sheetScreenOptions } from '@/utils/sheet-presentation';
import { useDiscardConfirmation } from '@/hooks/use-discard-confirmation';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

export default function EditProfileScreen() {
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, updateProfile } = useAuthStore(
    useShallow((s) => ({ user: s.user, updateProfile: s.updateProfile })),
  );
  const [name, setName] = useState(user?.name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [usernameStatus, setUsernameStatus] = useState<UsernameFieldStatus>('idle');
  const [loading, setLoading] = useState(false);
  const updateProfileMutation = trpc.user.updateProfile.useMutation();
  const setUsernameMutation = trpc.user.setUsername.useMutation();

  const usernameChanged = username !== (user?.username ?? '');
  const canSubmit = !usernameChanged || usernameStatus === 'available';
  const isDirty = name !== (user?.name ?? '') || bio !== (user?.bio ?? '') || usernameChanged;
  useDiscardConfirmation(isDirty && !loading);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await updateProfileMutation.mutateAsync({ name: name.trim(), bio: bio.trim() });
      updateProfile({ name: name.trim(), bio: bio.trim() });
      if (usernameChanged) {
        await setUsernameMutation.mutateAsync({ username });
        updateProfile({ username });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t.common.success, t.profile.profileUpdated);
      router.back();
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t.common.error, e?.message ?? t.profile.profileUpdateError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors, [0.8, 1.0])} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.pwTitle}>{t.profile.editProfileTitle}</Text>
        <Text style={styles.pwLabel}>{t.profile.name}</Text>
        <TextInput style={styles.pwInput} value={name} onChangeText={setName} placeholder={t.profile.namePlaceholder} placeholderTextColor={colors.muted} />
        <Text style={styles.pwLabel}>{t.profile.username}</Text>
        <UsernameField value={username} onChangeText={setUsername} onStatusChange={setUsernameStatus} />
        <Text style={styles.pwLabel}>{t.profile.bio}</Text>
        <TextInput
          style={[styles.pwInput, styles.bioInput]}
          value={bio}
          onChangeText={setBio}
          placeholder={t.profile.bioPlaceholder}
          placeholderTextColor={colors.muted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
        <TouchableOpacity style={[styles.pwSaveBtn, (loading || !canSubmit) && { opacity: 0.6 }]} onPress={handleSubmit} disabled={loading || !canSubmit} activeOpacity={0.7}>
          {loading ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.pwSaveBtnText}>{t.profile.saveProfile}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  pwTitle: { fontSize: 20, fontWeight: '700', color: colors.foreground, marginBottom: 24 },
  pwLabel: { fontSize: 13, fontWeight: '600', color: withAlpha(colors.foreground, 0.6), marginBottom: 8, marginTop: 16 },
  pwInput: { backgroundColor: withAlpha(colors.foreground, 0.06), borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.foreground, borderWidth: 0.5, borderColor: withAlpha(colors.foreground, 0.12) },
  bioInput: { height: 90, paddingTop: 12 },
  pwSaveBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 28 },
  pwSaveBtnText: { fontSize: 16, fontWeight: '700', color: colors.textOnPrimary },
});
