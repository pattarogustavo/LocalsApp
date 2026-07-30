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
import { useTranslation } from '@/hooks/use-translation';

// ─── Constants ────────────────────────────────────────────────────────────────

const LANGUAGES = [
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
];

const LOCALE_MAP: Record<string, string> = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SubscriptionBadge({ status, t }: { status: string | null; t: ReturnType<typeof useTranslation> }) {
  const config = {
    trial: { label: 'Trial', bg: 'rgba(61,90,46,0.12)', color: '#3D5A2E', icon: 'time-outline' },
    active: { label: 'Pro', bg: 'rgba(61,90,46,0.12)', color: '#3D5A2E', icon: 'checkmark-circle-outline' },
    expired: { label: t.profile.expiredStatus, bg: 'rgba(239,68,68,0.12)', color: '#EF4444', icon: 'close-circle-outline' },
    cancelled: { label: t.common.cancel, bg: 'rgba(156,163,175,0.15)', color: '#9CA3AF', icon: 'ban-outline' },
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
  t,
}: {
  visible: boolean;
  current: string;
  onSelect: (code: string) => void;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={[styles.langSheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.langHandle} />
          <Text style={styles.langTitle}>{t.profile.languageTitle}</Text>
          <Text style={styles.langSubtitle}>{t.profile.languageSubtitle}</Text>
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
                <Ionicons name="checkmark-circle" size={18} color="#3D5A2E" />
              )}
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.langCancelBtn} onPress={onClose}>
            <Text style={styles.langCancelText}>{t.profile.languageCancel}</Text>
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
  t,
}: {
  visible: boolean;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>;
}) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
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
      // Verify current password
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: userEmail, password: current });
      if (signInError) throw new Error(t.profile.passwordError);
      // Update to new password
      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      if (updateError) throw updateError;
      Alert.alert(t.common.success, t.profile.passwordChanged);
      setCurrent(''); setNext(''); setConfirm('');
      onClose();
    } catch (e: any) {
      Alert.alert(t.common.error, e?.message ?? t.profile.passwordError);
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
            <Text style={styles.pwTitle}>{t.profile.changePasswordTitle}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close-circle" size={26} color="rgba(44,36,22,0.6)" />
            </TouchableOpacity>
          </View>
          <Text style={styles.pwLabel}>{t.profile.currentPassword}</Text>
          <TextInput
            style={styles.pwInput}
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor="rgba(245,240,232,0.3)"
          />
          <Text style={styles.pwLabel}>{t.profile.newPassword}</Text>
          <TextInput
            style={styles.pwInput}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            placeholder={t.profile.newPasswordPlaceholder}
            placeholderTextColor="rgba(245,240,232,0.3)"
          />
          <Text style={styles.pwLabel}>{t.profile.confirmPassword}</Text>
          <TextInput
            style={styles.pwInput}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            placeholder={t.profile.confirmPasswordPlaceholder}
            placeholderTextColor="rgba(245,240,232,0.3)"
          />
          <TouchableOpacity
            style={[styles.pwSaveBtn, loading && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#F0EBE0" />
            ) : (
              <Text style={styles.pwSaveBtnText}>{t.profile.savePassword}</Text>
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
  const t = useTranslation();
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
  const locale = LOCALE_MAP[currentLang] ?? 'pt-BR';

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
      Alert.alert(t.common.error, 'Não foi possível selecionar a foto.');
    }
  }, [updateProfile, t]);

  // ── Logout ─────────────────────────────────────────────────────────────────
  const handleLogout = () => {
    Alert.alert(t.profile.logoutConfirmTitle, t.profile.logoutConfirmMsg, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.profile.logout,
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
      t.profile.cancelConfirmTitle,
      t.profile.cancelConfirmMsg,
      [
        { text: t.profile.keepSubscription, style: 'cancel' },
        {
          text: t.profile.cancelSubscription,
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await cancelMutation.mutateAsync();
              updateSubscription({ subscriptionStatus: 'cancelled' });
              Alert.alert(t.common.success, t.profile.cancelSubscription);
            } catch {
              Alert.alert(t.common.error, t.common.tryAgain);
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
    return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="rgba(44,36,22,0.8)" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t.profile.title}</Text>
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
                <ActivityIndicator size="small" color="#F0EBE0" />
              ) : (
                <Ionicons name="camera" size={12} color="#F0EBE0" />
              )}
            </View>
          </TouchableOpacity>

          <View style={styles.userInfo}>
            <View style={styles.userNameRow}>
              <Text style={styles.userName}>{user?.name ?? t.profile.traveler}</Text>
              <SubscriptionBadge status={status} t={t} />
            </View>
            <Text style={styles.userEmail}>{user?.email ?? '—'}</Text>
          </View>
        </View>

        {/* ── Subscription ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.profile.subscription}</Text>
          <View style={styles.card}>
            {isTrial && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Status</Text>
                  <Text style={styles.cardValue}>{t.profile.trialStatus}</Text>
                </View>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>{t.profile.daysLeft}</Text>
                  <Text style={[styles.cardValue, (daysLeftInTrial ?? 0) <= 2 && styles.cardValueWarning]}>
                    {daysLeftInTrial ?? 0} {(daysLeftInTrial ?? 0) !== 1 ? t.common.days : t.common.day}
                  </Text>
                </View>
                {trialEndsAt && (
                  <View style={styles.cardRow}>
                    <Text style={styles.cardLabel}>{t.profile.trialEnds}</Text>
                    <Text style={styles.cardValue}>{formatDate(trialEndsAt)}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.upgradeBtn}
                  activeOpacity={0.85}
                  onPress={() => router.push('/paywall' as any)}
                >
                  <Ionicons name="sparkles-outline" size={14} color="#F0EBE0" />
                  <Text style={styles.upgradeBtnText}>{t.profile.upgradeBtn}</Text>
                </TouchableOpacity>
              </>
            )}

            {isActive && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>{t.profile.plan}</Text>
                  <Text style={styles.cardValue}>{plan === 'annual' ? t.profile.annual : t.profile.monthly}</Text>
                </View>
                {subscriptionExpiresAt && (
                  <View style={styles.cardRow}>
                    <Text style={styles.cardLabel}>{t.profile.renewsOn}</Text>
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
                    <Text style={styles.cancelBtnText}>{t.profile.cancelSubscription}</Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            {isExpired && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Status</Text>
                  <Text style={[styles.cardValue, { color: '#EF4444' }]}>{t.profile.expiredStatus}</Text>
                </View>
                <TouchableOpacity
                  style={styles.upgradeBtn}
                  activeOpacity={0.85}
                  onPress={() => router.push('/paywall' as any)}
                >
                  <Ionicons name="refresh-outline" size={14} color="#F0EBE0" />
                  <Text style={styles.upgradeBtnText}>{t.profile.renewBtn}</Text>
                </TouchableOpacity>
              </>
            )}

            {status === 'cancelled' && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Status</Text>
                  <Text style={[styles.cardValue, { color: '#9CA3AF' }]}>{t.common.cancel}</Text>
                </View>
                {subscriptionExpiresAt && (
                  <View style={styles.cardRow}>
                    <Text style={styles.cardLabel}>{t.profile.expiresOn}</Text>
                    <Text style={styles.cardValue}>{formatDate(subscriptionExpiresAt)}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.upgradeBtn}
                  activeOpacity={0.85}
                  onPress={() => router.push('/paywall' as any)}
                >
                  <Ionicons name="refresh-outline" size={14} color="#F0EBE0" />
                  <Text style={styles.upgradeBtnText}>{t.profile.upgradeBtn}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* ── Preferences ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.profile.preferences}</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.7}
              onPress={() => setShowLangModal(true)}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="language-outline" size={16} color="rgba(44,36,22,0.6)" />
              </View>
              <Text style={styles.menuLabel}>{t.profile.language}</Text>
              <Text style={styles.menuValue}>{currentLangLabel}</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(44,36,22,0.25)" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Account ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.profile.account}</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.menuRow, styles.menuRowBorder]}
              activeOpacity={0.7}
              onPress={() => setShowPwModal(true)}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="lock-closed-outline" size={16} color="rgba(44,36,22,0.6)" />
              </View>
              <Text style={styles.menuLabel}>{t.profile.changePassword}</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(44,36,22,0.25)" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.7}
              onPress={() => Alert.alert(t.profile.privacy, t.profile.privacyDesc)}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="shield-checkmark-outline" size={16} color="rgba(44,36,22,0.6)" />
              </View>
              <Text style={styles.menuLabel}>{t.profile.privacy}</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(44,36,22,0.25)" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Support ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.profile.support}</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.menuRow, styles.menuRowBorder]}
              activeOpacity={0.7}
              onPress={() => Alert.alert(
                t.profile.help,
                t.profile.notificationsDesc,
                [
                  { text: t.common.close, style: 'cancel' },
                  { text: t.profile.help, onPress: () => Linking.openURL('https://voyage.app/help') },
                ]
              )}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="help-circle-outline" size={16} color="rgba(44,36,22,0.6)" />
              </View>
              <Text style={styles.menuLabel}>{t.profile.help}</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(44,36,22,0.25)" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuRow, styles.menuRowBorder]}
              activeOpacity={0.7}
              onPress={() => Linking.openURL('mailto:suporte@localsapp.com?subject=Suporte%20LocalsApp')}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="chatbubble-outline" size={16} color="rgba(44,36,22,0.6)" />
              </View>
              <Text style={styles.menuLabel}>{t.profile.contact}</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(44,36,22,0.25)" />
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
                <Ionicons name="star-outline" size={16} color="rgba(44,36,22,0.6)" />
              </View>
              <Text style={styles.menuLabel}>{t.profile.rate}</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(44,36,22,0.25)" />
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
              <Text style={styles.logoutText}>{t.profile.logout}</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.versionText}>LocalsApp v1.0.0</Text>
      </ScrollView>

      {/* ── Modals ── */}
      <LanguageModal
        visible={showLangModal}
        current={currentLang}
        onSelect={(code) => updateProfile({ preferredLanguage: code })}
        onClose={() => setShowLangModal(false)}
        t={t}
      />
      <ChangePasswordModal
        visible={showPwModal}
        onClose={() => setShowPwModal(false)}
        t={t}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0EBE0' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(61,90,46,0.06)',
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#2C2416', letterSpacing: 0.2 },
  scroll: { padding: 20, gap: 20 },

  // User card
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: 'rgba(245,240,232,0.04)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 0.5,
    borderColor: 'rgba(61,90,46,0.06)',
  },
  avatarWrapper: { position: 'relative' },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(61,90,46,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: 64, height: 64, borderRadius: 32 },
  avatarText: { fontSize: 24, fontWeight: '700', color: '#3D5A2E' },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#3D5A2E',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F0EBE0',
  },
  userInfo: { flex: 1, gap: 4 },
  userNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  userName: { fontSize: 17, fontWeight: '700', color: '#2C2416' },
  userEmail: { fontSize: 13, color: '#8A7F6E' },

  // Badge
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },

  // Section
  section: { gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: 'rgba(245,240,232,0.45)', letterSpacing: 0.8, textTransform: 'uppercase' },

  // Card
  card: {
    backgroundColor: 'rgba(245,240,232,0.04)',
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: 'rgba(61,90,46,0.06)',
    overflow: 'hidden',
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(245,240,232,0.06)',
  },
  cardLabel: { fontSize: 14, color: 'rgba(245,240,232,0.55)' },
  cardValue: { fontSize: 14, fontWeight: '500', color: '#2C2416' },
  cardValueWarning: { color: '#EF4444' },

  // Upgrade / Cancel buttons
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    margin: 12,
    backgroundColor: '#3D5A2E',
    borderRadius: 10,
    paddingVertical: 12,
  },
  upgradeBtnText: { fontSize: 14, fontWeight: '700', color: '#2C2416' },
  cancelBtn: {
    alignItems: 'center',
    margin: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 10,
    paddingVertical: 12,
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: '#EF4444' },

  // Menu rows
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  menuRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(245,240,232,0.06)',
  },
  menuIconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(245,240,232,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: { flex: 1, fontSize: 15, color: '#2C2416' },
  menuValue: { fontSize: 13, color: 'rgba(245,240,232,0.45)', marginRight: 4 },

  // Logout
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderRadius: 14,
    paddingVertical: 16,
    borderWidth: 0.5,
    borderColor: 'rgba(239,68,68,0.2)',
  },
  logoutText: { fontSize: 16, fontWeight: '600', color: '#EF4444' },
  versionText: { textAlign: 'center', fontSize: 12, color: 'rgba(245,240,232,0.2)', marginTop: 4 },

  // Language modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  langSheet: {
    backgroundColor: '#EDE8DC',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  langHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(245,240,232,0.2)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  langTitle: { fontSize: 18, fontWeight: '700', color: '#2C2416', marginBottom: 6 },
  langSubtitle: { fontSize: 13, color: '#8A7F6E', marginBottom: 20 },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
    gap: 12,
  },
  langRowActive: { backgroundColor: 'rgba(61,90,46,0.10)' },
  langFlag: { fontSize: 22 },
  langLabel: { flex: 1, fontSize: 16, color: 'rgba(245,240,232,0.7)' },
  langLabelActive: { color: '#2C2416', fontWeight: '600' },
  langCancelBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(61,90,46,0.06)',
  },
  langCancelText: { fontSize: 16, color: '#8A7F6E' },

  // Change password modal
  pwSheet: {
    backgroundColor: '#EDE8DC',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  pwHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  pwTitle: { fontSize: 20, fontWeight: '700', color: '#2C2416' },
  pwLabel: { fontSize: 13, fontWeight: '600', color: 'rgba(44,36,22,0.6)', marginBottom: 8, marginTop: 16 },
  pwInput: {
    backgroundColor: 'rgba(245,240,232,0.06)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#2C2416',
    borderWidth: 0.5,
    borderColor: 'rgba(245,240,232,0.12)',
  },
  pwSaveBtn: {
    backgroundColor: '#3D5A2E',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  pwSaveBtnText: { fontSize: 16, fontWeight: '700', color: '#F0EBE0' },
});
