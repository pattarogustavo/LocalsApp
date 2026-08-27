import { useState, useCallback, useMemo, useEffect } from 'react';
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
import * as Haptics from 'expo-haptics';
import { useAuthStore, type ThemeMode } from '@/store/auth';
import { useSubscription } from '@/hooks/use-subscription';
import { trpc } from '@/lib/trpc';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LANGUAGES = [
  { code: 'pt', label: 'Português', initials: 'PT' },
  { code: 'en', label: 'English', initials: 'EN' },
  { code: 'es', label: 'Español', initials: 'ES' },
  { code: 'fr', label: 'Français', initials: 'FR' },
  { code: 'de', label: 'Deutsch', initials: 'DE' },
  { code: 'it', label: 'Italiano', initials: 'IT' },
];

const LOCALE_MAP: Record<string, string> = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
};

const THEME_OPTIONS: { mode: ThemeMode; icon: string }[] = [
  { mode: 'system', icon: 'phone-portrait-outline' },
  { mode: 'light', icon: 'sunny-outline' },
  { mode: 'dark', icon: 'moon-outline' },
];

function getSubscriptionBadgeConfig(colors: ThemeColorPalette) {
  return {
    active: { bg: withAlpha(colors.primary, 0.12), color: colors.textAccent, icon: 'checkmark-circle-outline' },
    expired: { bg: withAlpha(colors.error, 0.12), color: colors.error, icon: 'close-circle-outline' },
    cancelled: { bg: withAlpha(colors.muted, 0.15), color: colors.muted, icon: 'ban-outline' },
    free: { bg: withAlpha(colors.muted, 0.15), color: colors.muted, icon: 'person-outline' },
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SubscriptionBadge({ status, t }: { status: string | null; t: ReturnType<typeof useTranslation> }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const statusConfig = getSubscriptionBadgeConfig(colors);
  const labels: Record<string, string> = {
    active: 'Pro',
    expired: t.profile.expiredStatus,
    cancelled: t.common.cancel,
    free: t.profile.freeStatus,
  };
  const key = status ?? 'free';
  const base = (statusConfig as Record<string, { bg: string; color: string; icon: string }>)[key];
  const config = base
    ? { label: labels[key], ...base }
    : { label: 'Free', bg: withAlpha(colors.muted, 0.15), color: colors.muted, icon: 'person-outline' };

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
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
              <Text style={styles.langFlag}>{lang.initials}</Text>
              <Text style={[styles.langLabel, current === lang.code && styles.langLabelActive]}>
                {lang.label}
              </Text>
              {current === lang.code && (
                <Ionicons name="checkmark-circle" size={18} color={colors.textAccent} />
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
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t.common.success, t.profile.passwordChanged);
      setCurrent(''); setNext(''); setConfirm('');
      onClose();
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t.common.error, e?.message ?? t.profile.passwordError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlayModal }}
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
              <Ionicons name="close-circle" size={26} color={withAlpha(colors.foreground, 0.6)} />
            </TouchableOpacity>
          </View>
          <Text style={styles.pwLabel}>{t.profile.currentPassword}</Text>
          <TextInput
            style={styles.pwInput}
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={colors.muted}
          />
          <Text style={styles.pwLabel}>{t.profile.newPassword}</Text>
          <TextInput
            style={styles.pwInput}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            placeholder={t.profile.newPasswordPlaceholder}
            placeholderTextColor={colors.muted}
          />
          <Text style={styles.pwLabel}>{t.profile.confirmPassword}</Text>
          <TextInput
            style={styles.pwInput}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            placeholder={t.profile.confirmPasswordPlaceholder}
            placeholderTextColor={colors.muted}
          />
          <TouchableOpacity
            style={[styles.pwSaveBtn, loading && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.pwSaveBtnText}>{t.profile.savePassword}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Edit Profile Modal (name + bio) ──────────────────────────────────────────

function EditProfileModal({
  visible,
  onClose,
  t,
}: {
  visible: boolean;
  onClose: () => void;
  t: ReturnType<typeof useTranslation>;
}) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, updateProfile } = useAuthStore();
  const [name, setName] = useState(user?.name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [loading, setLoading] = useState(false);
  const updateProfileMutation = trpc.user.updateProfile.useMutation();

  // The modal stays mounted while hidden, so re-sync fields from the store
  // each time it's opened (in case the profile changed since last open).
  useEffect(() => {
    if (visible) {
      setName(user?.name ?? '');
      setBio(user?.bio ?? '');
    }
  }, [visible]);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await updateProfileMutation.mutateAsync({ name: name.trim(), bio: bio.trim() });
      updateProfile({ name: name.trim(), bio: bio.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t.common.success, t.profile.profileUpdated);
      onClose();
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t.common.error, e?.message ?? t.profile.profileUpdateError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlayModal }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={[styles.pwSheet, { paddingBottom: insets.bottom + 24 }]}
          contentContainerStyle={{ padding: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.pwHeader}>
            <Text style={styles.pwTitle}>{t.profile.editProfileTitle}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close-circle" size={26} color={withAlpha(colors.foreground, 0.6)} />
            </TouchableOpacity>
          </View>
          <Text style={styles.pwLabel}>{t.profile.name}</Text>
          <TextInput
            style={styles.pwInput}
            value={name}
            onChangeText={setName}
            placeholder={t.profile.namePlaceholder}
            placeholderTextColor={colors.muted}
          />
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
          <TouchableOpacity
            style={[styles.pwSaveBtn, loading && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.7}
          >
            {loading ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.pwSaveBtnText}>{t.profile.saveProfile}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Edit Email Modal ──────────────────────────────────────────────────────────

function EditEmailModal({
  visible,
  onClose,
  currentEmail,
  t,
}: {
  visible: boolean;
  onClose: () => void;
  currentEmail: string | null;
  t: ReturnType<typeof useTranslation>;
}) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleClose = () => {
    setNewEmail('');
    onClose();
  };

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
      // Do NOT update the displayed email here — Supabase only applies the
      // change once the user confirms via the link sent to the new address.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t.common.success, t.profile.emailChangeSent.replace('{email}', trimmed));
      setNewEmail('');
      onClose();
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t.common.error, e?.message ?? t.profile.emailChangeError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlayModal }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={[styles.pwSheet, { paddingBottom: insets.bottom + 24 }]}
          contentContainerStyle={{ padding: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.pwHeader}>
            <Text style={styles.pwTitle}>{t.profile.editEmailTitle}</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close-circle" size={26} color={withAlpha(colors.foreground, 0.6)} />
            </TouchableOpacity>
          </View>
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
          <TouchableOpacity
            style={[styles.pwSaveBtn, loading && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.7}
          >
            {loading ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.pwSaveBtnText}>{t.profile.sendConfirmation}</Text>
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
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, logout, updateProfile, themeMode, setThemeMode } = useAuthStore();
  const { status, isActive, isExpired, subscriptionExpiresAt, plan } = useSubscription();
  const [loggingOut, setLoggingOut] = useState(false);
  const [showLangModal, setShowLangModal] = useState(false);
  const [showPwModal, setShowPwModal] = useState(false);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showEditEmailModal, setShowEditEmailModal] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t.common.error, t.profile.photoPickError);
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

  const formatDate = (date: Date | null) => {
    if (!date) return '—';
    return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // ── Manage subscription (Apple) ────────────────────────────────────────────
  const handleManageSubscription = () => {
    Linking.openURL('https://apps.apple.com/account/subscriptions');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={withAlpha(colors.foreground, 0.8)} />
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
                <ActivityIndicator size="small" color={colors.textOnPrimary} />
              ) : (
                <Ionicons name="camera" size={12} color={colors.textOnPrimary} />
              )}
            </View>
          </TouchableOpacity>

          <View style={styles.userInfo}>
            <View style={styles.userNameRow}>
              <Text style={styles.userName}>{user?.name ?? t.profile.traveler}</Text>
              <SubscriptionBadge status={status} t={t} />
            </View>
            <Text style={styles.userEmail}>{user?.email ?? '—'}</Text>
            {user?.bio ? (
              <Text style={styles.userBio} numberOfLines={2}>{user.bio}</Text>
            ) : null}
          </View>
        </View>

        {/* ── Subscription ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.profile.subscription}</Text>
          <View style={styles.card}>
            {status === null && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>{t.profile.plan}</Text>
                  <Text style={styles.cardValue}>{t.profile.freePlan}</Text>
                </View>
                <TouchableOpacity
                  style={styles.upgradeBtn}
                  activeOpacity={0.85}
                  onPress={() => router.push('/paywall' as any)}
                >
                  <Text style={styles.upgradeBtnText}>{t.profile.viewPlansBtn}</Text>
                </TouchableOpacity>
              </>
            )}

            {isActive && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>{t.profile.plan}</Text>
                  <Text style={styles.cardValue}>Pro ({plan === 'annual' ? t.profile.annual : t.profile.monthly})</Text>
                </View>
                {subscriptionExpiresAt && (
                  <View style={styles.cardRow}>
                    <Text style={styles.cardLabel}>{t.profile.renewsOn}</Text>
                    <Text style={styles.cardValue}>{formatDate(subscriptionExpiresAt)}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.manageBtn}
                  activeOpacity={0.85}
                  onPress={handleManageSubscription}
                >
                  <Text style={styles.manageBtnText}>{t.profile.manageSubscriptionBtn}</Text>
                </TouchableOpacity>
              </>
            )}

            {isExpired && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Status</Text>
                  <Text style={[styles.cardValue, { color: colors.error }]}>{t.profile.expiredStatus}</Text>
                </View>
                <TouchableOpacity
                  style={styles.upgradeBtn}
                  activeOpacity={0.85}
                  onPress={() => router.push('/paywall' as any)}
                >
                  <Ionicons name="refresh-outline" size={14} color={colors.textOnPrimary} />
                  <Text style={styles.upgradeBtnText}>{t.profile.renewBtn}</Text>
                </TouchableOpacity>
              </>
            )}

            {status === 'cancelled' && (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>{t.profile.plan}</Text>
                  <Text style={styles.cardValue}>Pro ({plan === 'annual' ? t.profile.annual : t.profile.monthly})</Text>
                </View>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Status</Text>
                  <Text style={[styles.cardValue, { color: colors.muted }]}>
                    {t.profile.cancelledAccessUntil} {formatDate(subscriptionExpiresAt)}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.manageBtn}
                  activeOpacity={0.85}
                  onPress={handleManageSubscription}
                >
                  <Text style={styles.manageBtnText}>{t.profile.manageSubscriptionBtn}</Text>
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
                <Ionicons name="language-outline" size={16} color={withAlpha(colors.foreground, 0.6)} />
              </View>
              <Text style={styles.menuLabel}>{t.profile.language}</Text>
              <Text style={styles.menuValue}>{currentLangLabel}</Text>
              <Ionicons name="chevron-forward" size={14} color={withAlpha(colors.foreground, 0.25)} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Theme ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.profile.theme}</Text>
          <View style={styles.card}>
            {THEME_OPTIONS.map((opt) => {
              const active = themeMode === opt.mode;
              const label = opt.mode === 'system' ? t.profile.themeSystem : opt.mode === 'light' ? t.profile.themeLight : t.profile.themeDark;
              return (
                <TouchableOpacity
                  key={opt.mode}
                  style={[styles.langRow, active && styles.langRowActive]}
                  activeOpacity={0.7}
                  onPress={() => { Haptics.selectionAsync(); setThemeMode(opt.mode); }}
                >
                  <Ionicons name={opt.icon as any} size={18} color={active ? colors.textAccent : withAlpha(colors.foreground, 0.5)} style={{ width: 28 }} />
                  <Text style={[styles.langLabel, active && styles.langLabelActive]}>{label}</Text>
                  {active && <Ionicons name="checkmark-circle" size={18} color={colors.textAccent} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Account ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.profile.account}</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.menuRow, styles.menuRowBorder]}
              activeOpacity={0.7}
              onPress={() => setShowEditProfileModal(true)}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="person-outline" size={16} color={withAlpha(colors.foreground, 0.6)} />
              </View>
              <Text style={styles.menuLabel}>{t.profile.editProfile}</Text>
              <Ionicons name="chevron-forward" size={14} color={withAlpha(colors.foreground, 0.25)} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuRow, styles.menuRowBorder]}
              activeOpacity={0.7}
              onPress={() => setShowEditEmailModal(true)}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="mail-outline" size={16} color={withAlpha(colors.foreground, 0.6)} />
              </View>
              <Text style={styles.menuLabel}>{t.profile.editEmail}</Text>
              <Ionicons name="chevron-forward" size={14} color={withAlpha(colors.foreground, 0.25)} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuRow, styles.menuRowBorder]}
              activeOpacity={0.7}
              onPress={() => setShowPwModal(true)}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="lock-closed-outline" size={16} color={withAlpha(colors.foreground, 0.6)} />
              </View>
              <Text style={styles.menuLabel}>{t.profile.changePassword}</Text>
              <Ionicons name="chevron-forward" size={14} color={withAlpha(colors.foreground, 0.25)} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.7}
              onPress={() => Linking.openURL('https://pattarogustavo.github.io/The-Locals/')}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="shield-checkmark-outline" size={16} color={withAlpha(colors.foreground, 0.6)} />
              </View>
              <Text style={styles.menuLabel}>{t.profile.privacy}</Text>
              <Ionicons name="chevron-forward" size={14} color={withAlpha(colors.foreground, 0.25)} />
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
                  { text: t.profile.help, onPress: () => Linking.openURL('mailto:ghstudioapp@gmail.com?subject=Suporte%20TheLocals') },
                ]
              )}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="help-circle-outline" size={16} color={withAlpha(colors.foreground, 0.6)} />
              </View>
              <Text style={styles.menuLabel}>{t.profile.help}</Text>
              <Ionicons name="chevron-forward" size={14} color={withAlpha(colors.foreground, 0.25)} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuRow, styles.menuRowBorder]}
              activeOpacity={0.7}
              onPress={() => Linking.openURL('mailto:ghstudioapp@gmail.com?subject=Suporte%20TheLocals')}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="chatbubble-outline" size={16} color={withAlpha(colors.foreground, 0.6)} />
              </View>
              <Text style={styles.menuLabel}>{t.profile.contact}</Text>
              <Ionicons name="chevron-forward" size={14} color={withAlpha(colors.foreground, 0.25)} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.7}
              onPress={() => {
                const storeUrl = Platform.OS === 'ios'
                  ? 'https://apps.apple.com/app/id000000000'
                  : 'https://play.google.com/store/apps/details?id=com.localsapp.app';
                Linking.openURL(storeUrl);
              }}
            >
              <View style={styles.menuIconBg}>
                <Ionicons name="star-outline" size={16} color={withAlpha(colors.foreground, 0.6)} />
              </View>
              <Text style={styles.menuLabel}>{t.profile.rate}</Text>
              <Ionicons name="chevron-forward" size={14} color={withAlpha(colors.foreground, 0.25)} />
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
            <ActivityIndicator color={colors.error} />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={18} color={colors.error} />
              <Text style={styles.logoutText}>{t.profile.logout}</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.versionText}>TheLocals v1.0.0</Text>
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
      <EditProfileModal
        visible={showEditProfileModal}
        onClose={() => setShowEditProfileModal(false)}
        t={t}
      />
      <EditEmailModal
        visible={showEditEmailModal}
        onClose={() => setShowEditEmailModal(false)}
        currentEmail={user?.email ?? null}
        t={t}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: withAlpha(colors.primary, 0.06),
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: colors.foreground, letterSpacing: 0.2 },
  scroll: { padding: 20, gap: 20 },

  // User card
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: withAlpha(colors.foreground, 0.04),
    borderRadius: 16,
    padding: 16,
    borderWidth: 0.5,
    borderColor: withAlpha(colors.primary, 0.06),
  },
  avatarWrapper: { position: 'relative' },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: withAlpha(colors.primary, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: 64, height: 64, borderRadius: 32 },
  avatarText: { fontSize: 24, fontWeight: '700', color: colors.textAccent },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  userInfo: { flex: 1, gap: 4 },
  userNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  userName: { fontSize: 17, fontWeight: '700', color: colors.foreground },
  userEmail: { fontSize: 13, color: colors.muted },
  userBio: { fontSize: 13, color: withAlpha(colors.foreground, 0.55), marginTop: 2 },

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
  sectionTitle: { fontSize: 13, fontWeight: '600', color: withAlpha(colors.foreground, 0.45), letterSpacing: 0.8, textTransform: 'uppercase' },

  // Card
  card: {
    backgroundColor: withAlpha(colors.foreground, 0.04),
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: withAlpha(colors.primary, 0.06),
    overflow: 'hidden',
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  cardLabel: { fontSize: 14, color: withAlpha(colors.foreground, 0.55) },
  cardValue: { fontSize: 14, fontWeight: '500', color: colors.foreground },
  cardValueWarning: { color: colors.error },

  // Upgrade / manage buttons
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    margin: 12,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
  },
  upgradeBtnText: { fontSize: 14, fontWeight: '700', color: colors.textOnPrimary },
  manageBtn: {
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.3),
    borderRadius: 10,
    paddingVertical: 12,
  },
  manageBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },

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
    borderBottomColor: colors.border,
  },
  menuIconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: withAlpha(colors.foreground, 0.06),
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: { flex: 1, fontSize: 15, color: colors.foreground },
  menuValue: { fontSize: 13, color: withAlpha(colors.foreground, 0.45), marginRight: 4 },

  // Logout
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: withAlpha(colors.error, 0.08),
    borderRadius: 14,
    paddingVertical: 16,
    borderWidth: 0.5,
    borderColor: withAlpha(colors.error, 0.2),
  },
  logoutText: { fontSize: 16, fontWeight: '600', color: colors.error },
  versionText: { textAlign: 'center', fontSize: 12, color: withAlpha(colors.foreground, 0.2), marginTop: 4 },

  // Language modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlayModal },
  langSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  langHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: withAlpha(colors.foreground, 0.2),
    alignSelf: 'center',
    marginBottom: 20,
  },
  langTitle: { fontSize: 18, fontWeight: '700', color: colors.foreground, marginBottom: 6 },
  langSubtitle: { fontSize: 13, color: colors.muted, marginBottom: 20 },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
    gap: 12,
  },
  langRowActive: { backgroundColor: withAlpha(colors.primary, 0.10) },
  langFlag: { fontSize: 13, fontWeight: '700', color: colors.muted, width: 28 },
  langLabel: { flex: 1, fontSize: 16, color: withAlpha(colors.foreground, 0.7) },
  langLabelActive: { color: colors.foreground, fontWeight: '600' },
  langCancelBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: withAlpha(colors.primary, 0.06),
  },
  langCancelText: { fontSize: 16, color: colors.muted },

  // Change password modal
  pwSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  pwHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  pwTitle: { fontSize: 20, fontWeight: '700', color: colors.foreground },
  pwLabel: { fontSize: 13, fontWeight: '600', color: withAlpha(colors.foreground, 0.6), marginBottom: 8, marginTop: 16 },
  pwInput: {
    backgroundColor: withAlpha(colors.foreground, 0.06),
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.foreground,
    borderWidth: 0.5,
    borderColor: withAlpha(colors.foreground, 0.12),
  },
  bioInput: { height: 90, paddingTop: 12 },
  pwInputDisabled: { justifyContent: 'center', opacity: 0.7 },
  pwSaveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  pwSaveBtnText: { fontSize: 16, fontWeight: '700', color: colors.textOnPrimary },
});
