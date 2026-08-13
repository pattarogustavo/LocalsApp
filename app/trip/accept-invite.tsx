import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { SchemeColors } from '@/constants/theme';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import { useTripsStore } from '@/store/trips';
import { useTranslation } from '@/hooks/use-translation';

// Text/icon color for content drawn on top of a solid brand-colored fill, which
// is identical in both schemes — always the light-scheme background swatch.
const ON_PRIMARY = SchemeColors.light.background;

/**
 * Screen shown when user taps an invite link.
 * Route: /trip/accept-invite?token=xxx
 */
export default function AcceptInviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const user = useAuthStore((s) => s.user);
  const { syncWithCloud } = useTripsStore();
  const t = useTranslation();

  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const acceptMutation = trpc.sharing.accept.useMutation();

  const handleAccept = async () => {
    if (!token) return;
    if (!user) {
      Alert.alert(
        t.sharing.loginRequired,
        t.sharing.loginRequiredMsg,
        [
          { text: t.common.cancel, style: 'cancel', onPress: () => router.back() },
          { text: t.sharing.loginBtn, onPress: () => router.replace('/auth/login' as any) },
        ]
      );
      return;
    }
    setStatus('loading');
    try {
      const result = await acceptMutation.mutateAsync({ token });
      // Sync trips to get the newly shared trip
      await syncWithCloud();
      setStatus('success');
    } catch (err: any) {
      setErrorMsg(err?.message ?? t.sharing.errorTitle);
      setStatus('error');
    }
  };

  // Auto-accept if user is already logged in
  useEffect(() => {
    if (token && user && status === 'idle') {
      handleAccept();
    }
  }, [token, user]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.content}>
        {status === 'idle' || status === 'loading' ? (
          <>
            <View style={[styles.iconCircle, { backgroundColor: colors.primary + '18' }]}>
              <Ionicons name="airplane-outline" size={40} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t.sharing.tripInviteTitle}
            </Text>
            <Text style={[styles.desc, { color: colors.muted }]}>
              {t.sharing.acceptDesc}
            </Text>
            {status === 'loading' ? (
              <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 24 }} />
            ) : (
              <TouchableOpacity
                onPress={handleAccept}
                style={[styles.btn, { backgroundColor: colors.primary }]}
              >
                <Ionicons name="checkmark-circle-outline" size={20} color={ON_PRIMARY} />
                <Text style={styles.btnText}>{t.sharing.acceptBtn}</Text>
              </TouchableOpacity>
            )}
          </>
        ) : status === 'success' ? (
          <>
            <View style={[styles.iconCircle, { backgroundColor: colors.success + '18' }]}>
              <Ionicons name="checkmark-circle" size={40} color={colors.success} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t.sharing.successTitle} 🎉
            </Text>
            <Text style={[styles.desc, { color: colors.muted }]}>
              {t.sharing.successMsg}
            </Text>
            <TouchableOpacity
              onPress={() => router.replace('/' as any)}
              style={[styles.btn, { backgroundColor: colors.success }]}
            >
              <Ionicons name="home-outline" size={20} color={ON_PRIMARY} />
              <Text style={styles.btnText}>{t.sharing.goToTrips}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={[styles.iconCircle, { backgroundColor: colors.error + '18' }]}>
              <Ionicons name="close-circle" size={40} color={colors.error} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t.sharing.errorTitle}
            </Text>
            <Text style={[styles.desc, { color: colors.muted }]}>
              {errorMsg || t.sharing.expiredOrUsed}
            </Text>
            <TouchableOpacity
              onPress={() => router.replace('/' as any)}
              style={[styles.btn, { backgroundColor: colors.primary }]}
            >
              <Ionicons name="home-outline" size={20} color={ON_PRIMARY} />
              <Text style={styles.btnText}>{t.sharing.goHome}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  desc: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  btnText: { color: ON_PRIMARY, fontSize: 16, fontWeight: '700' },
});
