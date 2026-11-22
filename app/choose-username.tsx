import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { SchemeColors, type ThemeColorPalette } from '@/constants/theme';
import { UsernameField, type UsernameFieldStatus } from '@/components/ui/username-field';
import { suggestUsernameFrom } from '@/shared/username';
import { trpc } from '@/lib/trpc';

const ON_PRIMARY = SchemeColors.light.background;

/**
 * Blocking gate for accounts created before username support existed —
 * app/_layout.tsx's AuthGuard redirects here whenever a logged-in user's
 * `username` comes back null from the server. Not reachable by a fresh
 * signup, which already collects a username in app/auth/register.tsx.
 */
export default function ChooseUsernameScreen() {
  const insets = useSafeAreaInsets();
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, updateProfile } = useAuthStore((s) => ({ user: s.user, updateProfile: s.updateProfile }));

  const [username, setUsername] = useState(() => suggestUsernameFrom(user?.name, user?.email));
  const [status, setStatus] = useState<UsernameFieldStatus>('idle');
  const [loading, setLoading] = useState(false);
  const setUsernameMutation = trpc.user.setUsername.useMutation();

  const handleContinue = async () => {
    if (status !== 'available') return;
    setLoading(true);
    try {
      await setUsernameMutation.mutateAsync({ username });
      updateProfile({ username });
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert(t.common.error, e?.message ?? t.username.saveError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t.username.chooseTitle}</Text>
        <Text style={styles.subtitle}>{t.username.chooseSubtitle}</Text>

        <View style={{ marginTop: 24 }}>
          <UsernameField value={username} onChangeText={setUsername} onStatusChange={setStatus} autoFocus />
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, (status !== 'available' || loading) && styles.submitBtnDisabled]}
          onPress={handleContinue}
          disabled={status !== 'available' || loading}
          activeOpacity={0.85}
        >
          {loading ? <ActivityIndicator color={ON_PRIMARY} /> : <Text style={styles.submitBtnText}>{t.username.continueBtn}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  scroll: { paddingHorizontal: 24, flexGrow: 1 },
  title: { fontSize: 24, fontWeight: '700', color: colors.foreground, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.foreground, lineHeight: 20 },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: ON_PRIMARY, fontSize: 16, fontWeight: '700' },
});
