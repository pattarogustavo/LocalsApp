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
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import { useTripsStore } from '@/store/trips';

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

  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const acceptMutation = trpc.sharing.accept.useMutation();

  const handleAccept = async () => {
    if (!token) return;
    if (!user) {
      Alert.alert(
        'Login necessário',
        'Você precisa estar logado para aceitar um convite.',
        [
          { text: 'Cancelar', style: 'cancel', onPress: () => router.back() },
          { text: 'Fazer login', onPress: () => router.replace('/auth/login' as any) },
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
      setErrorMsg(err?.message ?? 'Erro ao aceitar convite.');
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
              Convite de Viagem
            </Text>
            <Text style={[styles.desc, { color: colors.muted }]}>
              Você foi convidado(a) para participar de uma viagem no Voyage.
            </Text>
            {status === 'loading' ? (
              <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 24 }} />
            ) : (
              <TouchableOpacity
                onPress={handleAccept}
                style={[styles.btn, { backgroundColor: colors.primary }]}
              >
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                <Text style={styles.btnText}>Aceitar Convite</Text>
              </TouchableOpacity>
            )}
          </>
        ) : status === 'success' ? (
          <>
            <View style={[styles.iconCircle, { backgroundColor: '#22C55E18' }]}>
              <Ionicons name="checkmark-circle" size={40} color="#22C55E" />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Convite aceito! 🎉
            </Text>
            <Text style={[styles.desc, { color: colors.muted }]}>
              A viagem foi adicionada à sua lista. Você já pode visualizá-la na tela inicial.
            </Text>
            <TouchableOpacity
              onPress={() => router.replace('/' as any)}
              style={[styles.btn, { backgroundColor: '#22C55E' }]}
            >
              <Ionicons name="home-outline" size={20} color="#fff" />
              <Text style={styles.btnText}>Ver Minhas Viagens</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={[styles.iconCircle, { backgroundColor: '#EF444418' }]}>
              <Ionicons name="close-circle" size={40} color="#EF4444" />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Erro ao aceitar convite
            </Text>
            <Text style={[styles.desc, { color: colors.muted }]}>
              {errorMsg || 'O convite pode ter expirado ou já foi usado.'}
            </Text>
            <TouchableOpacity
              onPress={() => router.replace('/' as any)}
              style={[styles.btn, { backgroundColor: colors.primary }]}
            >
              <Ionicons name="home-outline" size={20} color="#fff" />
              <Text style={styles.btnText}>Ir para o Início</Text>
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
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
