import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { useTranslation } from '@/hooks/use-translation';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';

export default function TripShareScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const translations = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [sending, setSending] = useState(false);

  const inviteMutation = trpc.sharing.invite.useMutation();
  const revokeMutation = trpc.sharing.revoke.useMutation();
  const sharesQuery = trpc.sharing.listSentByMe.useQuery(
    { tripClientId: tripId ?? '' },
    { enabled: !!tripId }
  );

  const handleInvite = useCallback(async () => {
    if (!email.trim() || !tripId) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert(translations.common.error, 'Por favor insira um e-mail válido.');
      return;
    }
    setSending(true);
    try {
      await inviteMutation.mutateAsync({
        tripClientId: tripId,
        email: email.trim().toLowerCase(),
        role,
      });
      setEmail('');
      sharesQuery.refetch();
      Alert.alert('✅ Convite enviado!', `${email.trim()} foi convidado(a) para esta viagem.`);
    } catch (err: any) {
      Alert.alert(translations.common.error, err?.message ?? 'Erro ao enviar convite.');
    } finally {
      setSending(false);
    }
  }, [email, role, tripId, inviteMutation, sharesQuery, translations]);

  const handleRevoke = useCallback((shareId: number, inviteeEmail: string) => {
    Alert.alert(
      'Remover acesso',
      `Remover o acesso de ${inviteeEmail}?`,
      [
        { text: translations.common.cancel, style: 'cancel' },
        {
          text: 'Remover',
          style: 'destructive',
          onPress: async () => {
            try {
              await revokeMutation.mutateAsync({ shareId });
              sharesQuery.refetch();
            } catch (err: any) {
              Alert.alert(translations.common.error, err?.message ?? 'Erro ao remover acesso.');
            }
          },
        },
      ]
    );
  }, [revokeMutation, sharesQuery, translations]);

  const statusLabel = (status: string) => {
    if (status === 'accepted') return { label: 'Aceitou', color: '#22C55E' };
    if (status === 'revoked') return { label: 'Revogado', color: '#EF4444' };
    return { label: 'Pendente', color: '#F59E0B' };
  };

  const roleLabel = (r: string) => r === 'editor' ? 'Editor' : 'Visualizador';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Compartilhar Viagem</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Invite section */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Convidar por e-mail</Text>
            <Text style={[styles.sectionDesc, { color: colors.muted }]}>
              O convidado receberá acesso a esta viagem após aceitar o convite.
            </Text>

            <TextInput
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              placeholder="E-mail do convidado"
              placeholderTextColor={colors.muted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
            />

            {/* Role selector */}
            <View style={styles.roleRow}>
              <TouchableOpacity
                onPress={() => setRole('viewer')}
                style={[
                  styles.roleBtn,
                  { borderColor: role === 'viewer' ? colors.primary : colors.border },
                  role === 'viewer' && { backgroundColor: colors.primary + '18' },
                ]}
              >
                <Ionicons name="eye-outline" size={16} color={role === 'viewer' ? colors.primary : colors.muted} />
                <Text style={[styles.roleBtnText, { color: role === 'viewer' ? colors.primary : colors.muted }]}>
                  Visualizador
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setRole('editor')}
                style={[
                  styles.roleBtn,
                  { borderColor: role === 'editor' ? colors.primary : colors.border },
                  role === 'editor' && { backgroundColor: colors.primary + '18' },
                ]}
              >
                <Ionicons name="create-outline" size={16} color={role === 'editor' ? colors.primary : colors.muted} />
                <Text style={[styles.roleBtnText, { color: role === 'editor' ? colors.primary : colors.muted }]}>
                  Editor
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={handleInvite}
              disabled={sending || !email.trim()}
              style={[
                styles.inviteBtn,
                { backgroundColor: colors.primary },
                (sending || !email.trim()) && { opacity: 0.5 },
              ]}
            >
              {sending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="paper-plane-outline" size={16} color="#fff" />
                  <Text style={styles.inviteBtnText}>Enviar Convite</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Existing shares */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 16 }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Convites enviados</Text>

            {sharesQuery.isLoading && (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
            )}

            {!sharesQuery.isLoading && (!sharesQuery.data || sharesQuery.data.length === 0) && (
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                Nenhum convite enviado ainda.
              </Text>
            )}

            {sharesQuery.data?.map((share) => {
              const { label, color } = statusLabel(share.status);
              return (
                <View
                  key={share.shareId}
                  style={[styles.shareRow, { borderBottomColor: colors.border }]}
                >
                  <View style={styles.shareInfo}>
                    <View style={[styles.avatarCircle, { backgroundColor: colors.primary + '22' }]}>
                      <Text style={[styles.avatarLetter, { color: colors.primary }]}>
                        {share.inviteeEmail.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.shareEmail, { color: colors.foreground }]} numberOfLines={1}>
                        {share.inviteeEmail}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                        <Text style={[styles.shareRole, { color: colors.muted }]}>
                          {roleLabel(share.role)}
                        </Text>
                        <Text style={{ color, fontSize: 12, fontWeight: '600' }}>
                          {label}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {share.status !== 'revoked' && (
                    <TouchableOpacity
                      onPress={() => handleRevoke(share.shareId, share.inviteeEmail)}
                      style={styles.revokeBtn}
                    >
                      <Ionicons name="close-circle-outline" size={22} color={colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>

          {/* Info box */}
          <View style={[styles.infoBox, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '30' }]}>
            <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.primary }]}>
              O convidado precisa ter uma conta no LocalsApp para aceitar o convite. Após aceitar, a viagem aparecerá na tela inicial dele.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  sectionDesc: { fontSize: 13, lineHeight: 18, marginBottom: 14 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  roleRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  roleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  roleBtnText: { fontSize: 14, fontWeight: '600' },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
  },
  inviteBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  emptyText: { fontSize: 14, textAlign: 'center', paddingVertical: 16 },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  shareInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: 16, fontWeight: '700' },
  shareEmail: { fontSize: 14, fontWeight: '500' },
  shareRole: { fontSize: 12 },
  revokeBtn: { padding: 4 },
  infoBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 18 },
});
