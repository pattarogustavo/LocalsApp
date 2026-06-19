'use client';
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@/store/auth';
import { useSubscription } from '@/hooks/use-subscription';
import { trpc } from '@/lib/trpc';

// ─── Constants ────────────────────────────────────────────────────────────────

const LANGUAGES = [
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SubscriptionBadge({ status }: { status: string | null }) {
  const config = {
    trial: { label: 'Trial', bg: 'rgba(82,183,136,0.15)', color: '#52B788', icon: 'time-outline' },
    active: { label: 'Pro', bg: 'rgba(82,183,136,0.15)', color: '#52B788', icon: 'checkmark-circle-outline' },
    expired: { label: 'Expirado', bg: 'rgba(239,68,68,0.12)', color: '#EF4444', icon: 'close-circle-outline' },
    cancelled: { label: 'Cancelado', bg: 'rgba(156,163,175,0.15)', color: '#9CA3AF', icon: 'ban-outline' },
  }[status ?? 'expired'] ?? { label: 'Free', bg: 'rgba(156,163,175,0.15)', color: '#9CA3AF', icon: 'person-outline' };

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Ionicons name={config.icon as any} size={12} color={config.color} />
      <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

// ─── Language Picker Modal ────────────────────────────────────────────────────

function LanguageModal({
  visible,
  current,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={[styles.langSheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.langHandle} />
          <Text style={styles.langTitle}>Idioma do Aplicativo</Text>
          <Text style={styles.langSubtitle}>
            Selecione o idioma de exibição do Voyage
          </Text>
          {LANGUAGES.map((lang) => (
            <TouchableOpacity
              key={lang.code}
              style={[styles.langRow, current === lang.code && styles.langRowActive]}
              onPress={() => { onSelect(lang.code); onClose(); }}
            >
              <Text style={styles.langFlag}>{lang.flag}</Text>
              <Text style={[styles.langLabel, current === lang.code && styles.langLabelActive]}>
                {lang.label}
              </Text>
              {current === lang.code && (
                <Ionicons name="checkmark-circle" size={18} color="#52B788" />
              )}
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.langCancelBtn} onPress={onClose}>
            <Text style={styles.langCancelText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Change Password Modal ────────────────────────────────────────────────────

function ChangePasswordModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const changePwMutation = trpc.auth.changePassword.useMutation();

  const handleSubmit = async () => {
    if (!current || !next || !confirm) {
      Alert.alert('Campos obrigatórios', 'Preencha todos os campos.');
      return;
    }
    if (next !== confirm) {
      Alert.alert('Senhas diferentes', 'A nova senha e a confirmação não coincidem.');
      return;
    }
    if (next.length < 6) {
      Alert.alert('Senha fraca', 'A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    setLoading(true);
    try {
      await changePwMutation.mutateAsync({ currentPassword: current, newPassword: next });
      Alert.alert('Senha alterada', 'Sua senha foi alterada com sucesso.');
      setCurrent(''); setNext(''); setConfirm('');
      onClose();
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Não foi possível alterar a senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={[styles.pwSheet, { paddingBottom: insets.bottom + 24 }]}
          contentContainerStyle={{ padding: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.pwHeader}>
            <Text style={styles.pwTitle}>Alterar Senha</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close-circle" size={26} color="rgba(245,240,232,0.6)" />
            </TouchableOpacity>
          </View>
          <Text style={styles.pwLabel}>Senha atual</Text>
          <TextInput
            style={styles.pwInput}
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor="rgba(245,240,232,0.3)"
          />
          <Text style={styles.pwLabel}>Nova senha</Text>
          <TextInput
            style={styles.pwInput}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            placeholder="Mínimo 6 caracteres"
            placeholderTextColor="rgba(245,240,232,0.3)"
          />
          <Text style={styles.pwLabel}>Confirmar nova senha</Text>
          <TextInput
            style={styles.pwInput}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            placeholder="Repita a nova senha"
            placeholderTextColor="rgba(245,240,232,0.3)"
          />
          <TouchableOpacity
            style={[styles.pwSaveBtn, loading && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#0F1F16" />
            ) : (
              <Text style={styles.pwSaveBtnText}>Salvar nova senha</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, updateProfile } = useAuthStore();
  const { status, isTrial, isActive, isExpired, daysLeftInTrial, trialEndsAt, subscriptionExpiresAt, plan } = useSubscription();
  const [loggingOut, setLoggingOut] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showLangModal, setShowLangModal] = useState(false);
  const [showPwModal, setShowPwModal] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const cancelMutation = trpc.subscription.cancel.useMutation();
  const { updateSubscription } = useAuthStore();

  const currentLang = user?.preferredLanguage ?? 'pt';
  const currentLangLabel = LANGUAGES.find((l) => l.code === currentLang)?.label ?? 'Português';

  // ── Avatar picker ──────────────────────────────────────────────────────────
  const handlePickAvatar = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setUploadingAvatar(true);
        const uri = result.assets[0].uri;
        updateProfile({ avatarUri: uri });
        setUploadingAvatar(false);
      }
    } catch {
      setUploadingAvatar(false);
      Alert.alert('Erro', 'Não foi possível selecionar a foto.');
    }
  }, [updateProfile]);

  // ── Logout ─────────────────────────────────────────────────────────────────
  const handleLogout = () => {
    Alert.alert('Sair', 'Deseja realmente sair da sua conta?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          setLoggingOut(true);
          await logout();
          router.replace('/auth/onboarding' as any);
        },
      },
    ]);
  };

  // ── Cancel subscription ────────────────────────────────────────────────────
  const handleCancelSubscription = () => {
    Alert.alert(
      'Cancelar assinatura',
      'Você perderá acesso aos recursos Pro ao final do período atual. Confirmar?',
      [
        { text: 'Manter assinatura', style: 'cancel' },
        {
          text: 'Cancelar assinatura',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await cancelMutation.mutateAsync();
              updateSubscription({ subscriptionStatus: 'cancelled' });
              Alert.alert('Assinatura cancelada', 'Você terá acesso até o final do período atual.');
            } catch {
              Alert.alert('Erro', 'Não foi possível cancelar. Tente novamente.');
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  const formatDate = (date: Date | null) => {
    if (!date) return '—';
    return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="rgba(245,240,232,0.8)" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Perfil & Configurações</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── User card ── */}
        <View style={styles.userCard}>
          {/* Avatar with edit button */}
          <TouchableOpacity style={styles.avatarWrapper} onPress={handlePickAvatar} disabled={uploadingAvatar}>
            {user?.avatarUri ? (
              <Image source={{ uri: user.avatarUri }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>
                  {(user?.name ?? user?.email ?? '?')[0].toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color="#0F1F16" />
              ) : (
                <Ionicons name="camera" size={12} color="#0F1F16" />
              )}
            </View>
          </TouchableOpacity>

          <View style={styles.userInfo}>
            <View style={styles.userNameRow}>
              <Text style={styles.userName}>{user?.name ?? 'Viajante'}</Text>
              <SubscriptionBadge status={status} />
            </View>
            <Text style={styles.userEmail}>{user?.email ?? '—'}</Text>
          </View>
        </View>

        {/* ── Subscription ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Assinatura</Text>
          <View style={styles.card}>
            {isTrial && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Status</Text>
                  <Text style={styles.cardValue}>Trial gratuito</Text>
                </View>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Dias restantes</Text>
                  <Text style={[styles.cardValue, (daysLeftInTrial ?? 0) <= 2 && styles.cardValueWarning]}>
                    {daysLeftInTrial ?? 0} dia{daysLeftInTrial !== 1 ? 's' : ''}
                  </Text>
                </View>
                {trialEndsAt && (
                  <View style={styles.cardRow}>
                    <Text style={styles.cardLabel}>Trial termina em</Text>
                    <Text style={styles.cardValue}>{formatDate(trialEndsAt)}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.upgradeBtn}
                  activeOpacity={0.85}
                  onPress={() => router.push('/paywall' as any)}
                >
                  <Ionicons name="sparkles-outline" size={14} color="#0F1F16" />
                  <Text style={styles.upgradeBtnText}>Fazer upgrade para Pro</Text>
                </TouchableOpacity>
              </>
            )}

            {isActive && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Plano</Text>
                  <Text style={styles.cardValue}>{plan === 'annual' ? 'Anual' : 'Mensal'}</Text>
                </View>
                {subscriptionExpiresAt && (
                  <View style={styles.cardRow}>
                    <Text style={styles.cardLabel}>Renova em</Text>
                    <Text style={styles.cardValue}>{formatDate(subscriptionExpiresAt)}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.cancelBtn}
                  activeOpacity={0.85}
                  onPress={handleCancelSubscription}
                  disabled={cancelling}
                >
                  {cancelling ? (
                    <ActivityIndicator size="small" color="#EF4444" />
                  ) : (
                    <Text style={styles.cancelBtnText}>Cancelar assinatura</Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            {isExpired && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Status</Text>
                  <Text style={[styles.cardValue, { color: '#EF4444' }]}>Expirado</Text>
                </View>
                <TouchableOpacity
                  style={styles.upgradeBtn}
                  activeOpacity={0.85}
                  onPress={() => router.push('/paywall' as any)}
                >
                  <Ionicons name="refresh-outline" size={14} color="#0F1F16" />
                  <Text style={styles.upgradeBtnText}>Reativar assinatura</Text>
                </TouchableOpacity>
              </>
            )}

            {status === 'cancelled' && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Status</Text>
                  <Text style={[styles.cardValue, { color: '#9CA3AF' }]}>Cancelado</Text>
                </View>
                {subscriptionExpiresAt && (
                  <View style={styles.cardRow}>
                    <Text style={styles.cardLabel}>Acesso até</Text>
                    <Text style={styles.cardValue}>{formatDate(subscriptionExpiresAt)}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.upgradeBtn}
                  activeOpacity={0.85}
                  onPress={() => router.push('/paywall' as any)}
                >
                  <Ionicons name="refresh-outline" size={14} color="#0F1F16" />
                  <Text style={styles.upgradeBtnText}>Assinar novamente</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* ── Preferences ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferências</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.7}
              onPress={() => setShowLangModal(true)}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="language-outline" size={16} color="rgba(245,240,232,0.6)" />
              </View>
              <Text style={styles.menuLabel}>Idioma</Text>
              <Text style={styles.menuValue}>{currentLangLabel}</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(245,240,232,0.25)" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Account ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Conta</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.menuRow, styles.menuRowBorder]}
              activeOpacity={0.7}
              onPress={() => setShowPwModal(true)}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="lock-closed-outline" size={16} color="rgba(245,240,232,0.6)" />
              </View>
              <Text style={styles.menuLabel}>Alterar senha</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(245,240,232,0.25)" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.7}
              onPress={() => Alert.alert('Privacidade', 'Seus dados são armazenados localmente no dispositivo e não são compartilhados com terceiros sem sua autorização.')}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="shield-checkmark-outline" size={16} color="rgba(245,240,232,0.6)" />
              </View>
              <Text style={styles.menuLabel}>Privacidade & Segurança</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(245,240,232,0.25)" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Support ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Suporte</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.menuRow, styles.menuRowBorder]}
              activeOpacity={0.7}
              onPress={() => Alert.alert(
                'Ajuda & FAQ',
                'Para dúvidas frequentes, acesse nossa central de ajuda ou entre em contato pelo suporte.',
                [
                  { text: 'Fechar', style: 'cancel' },
                  { text: 'Abrir central de ajuda', onPress: () => Linking.openURL('https://voyage.app/help') },
                ]
              )}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="help-circle-outline" size={16} color="rgba(245,240,232,0.6)" />
              </View>
              <Text style={styles.menuLabel}>Ajuda & FAQ</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(245,240,232,0.25)" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuRow, styles.menuRowBorder]}
              activeOpacity={0.7}
              onPress={() => Linking.openURL('mailto:suporte@voyage.app?subject=Suporte%20Voyage')}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="chatbubble-outline" size={16} color="rgba(245,240,232,0.6)" />
              </View>
              <Text style={styles.menuLabel}>Falar com suporte</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(245,240,232,0.25)" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.7}
              onPress={() => {
                const storeUrl = Platform.OS === 'ios'
                  ? 'https://apps.apple.com/app/id000000000'
                  : 'https://play.google.com/store/apps/details?id=space.manus.voyage';
                Linking.openURL(storeUrl);
              }}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="star-outline" size={16} color="rgba(245,240,232,0.6)" />
              </View>
              <Text style={styles.menuLabel}>Avaliar o Voyage</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(245,240,232,0.25)" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Logout ── */}
        <TouchableOpacity
          style={styles.logoutBtn}
          activeOpacity={0.85}
          onPress={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? (
            <ActivityIndicator color="#EF4444" />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={18} color="#EF4444" />
              <Text style={styles.logoutText}>Sair da conta</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.versionText}>Voyage v1.0.0</Text>
      </ScrollView>

      {/* ── Modals ── */}
      <LanguageModal
        visible={showLangModal}
        current={currentLang}
        onSelect={(code) => updateProfile({ preferredLanguage: code })}
        onClose={() => setShowLangModal(false)}
      />
      <ChangePasswordModal
        visible={showPwModal}
        onClose={() => setShowPwModal(false)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F1F16' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(245,240,232,0.06)',
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: '#F5F0E8' },
  scroll: { paddingHorizontal: 16, paddingTop: 20 },

  // User card
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 28, paddingHorizontal: 4 },
  avatarWrapper: { position: 'relative' },
  avatarCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(82,183,136,0.15)',
    borderWidth: 2, borderColor: 'rgba(82,183,136,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: 'rgba(82,183,136,0.3)' },
  avatarText: { fontSize: 26, fontWeight: '700', color: '#52B788' },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#52B788',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#0F1F16',
  },
  userInfo: { flex: 1, gap: 4 },
  userNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  userName: { fontSize: 18, fontWeight: '700', color: '#F5F0E8' },
  userEmail: { fontSize: 13, color: 'rgba(245,240,232,0.45)' },

  // Badge
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },

  // Section
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 11, fontWeight: '700', color: 'rgba(245,240,232,0.35)',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, paddingHorizontal: 4,
  },
  card: {
    backgroundColor: 'rgba(245,240,232,0.05)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(245,240,232,0.08)',
    overflow: 'hidden', paddingHorizontal: 16, paddingVertical: 12, gap: 10,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontSize: 14, color: 'rgba(245,240,232,0.5)' },
  cardValue: { fontSize: 14, fontWeight: '600', color: '#F5F0E8' },
  cardValueWarning: { color: '#F59E0B' },

  // Subscription buttons
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#52B788', borderRadius: 10, paddingVertical: 12, marginTop: 4,
  },
  upgradeBtnText: { color: '#0F1F16', fontSize: 14, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  cancelBtnText: { fontSize: 13, color: '#EF4444', textDecorationLine: 'underline' },

  // Menu rows
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(245,240,232,0.06)' },
  menuIconBg: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: 'rgba(245,240,232,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  menuLabel: { flex: 1, fontSize: 14, color: 'rgba(245,240,232,0.8)', fontWeight: '500' },
  menuValue: { fontSize: 13, color: 'rgba(245,240,232,0.45)', marginRight: 4 },

  // Logout
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.15)', marginTop: 8, marginBottom: 16,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: '#EF4444' },
  versionText: { textAlign: 'center', fontSize: 11, color: 'rgba(245,240,232,0.2)', marginBottom: 8 },

  // Language modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  langSheet: {
    backgroundColor: '#1A2E22', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 16,
  },
  langHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 16,
  },
  langTitle: { fontSize: 18, fontWeight: '700', color: '#F5F0E8', marginBottom: 4 },
  langSubtitle: { fontSize: 13, color: 'rgba(245,240,232,0.45)', marginBottom: 16 },
  langRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  langRowActive: { backgroundColor: 'rgba(82,183,136,0.08)', borderRadius: 10, paddingHorizontal: 8 },
  langFlag: { fontSize: 22 },
  langLabel: { flex: 1, fontSize: 15, color: 'rgba(245,240,232,0.7)' },
  langLabelActive: { color: '#F5F0E8', fontWeight: '600' },
  langCancelBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 8 },
  langCancelText: { fontSize: 15, color: 'rgba(245,240,232,0.4)', fontWeight: '500' },

  // Change password modal
  pwSheet: { backgroundColor: '#1A2E22', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  pwHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  pwTitle: { fontSize: 20, fontWeight: '700', color: '#F5F0E8' },
  pwLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(245,240,232,0.5)', marginBottom: 6, letterSpacing: 0.5 },
  pwInput: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    color: '#F5F0E8', fontSize: 15, marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  pwSaveBtn: {
    backgroundColor: '#52B788', borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  pwSaveBtnText: { color: '#0F1F16', fontWeight: '700', fontSize: 15 },
});
