// Route: /auth/reset-password[?email=...]
//
// Primary flow (CODE): user arrives here right after forgot-password.tsx,
// with `email` as a route param, and types in the 6-digit code emailed to
// them along with a new password. verifyOtp(type: 'recovery') exchanges the
// code for a recovery session, then updateUser sets the new password.
//
// Secondary flow (LINK, for future use): if this screen is opened via a
// Supabase recovery deep link instead — localsapp://auth/reset-password with
// either a #access_token/#refresh_token fragment, a ?code= (PKCE) or a
// ?token_hash=&type=recovery query — it validates that link on mount and, if
// valid, skips straight to the new-password fields.
//
// In both flows, only the raw supabase client gets a session before the
// password is actually changed (via setSession/verifyOtp/exchangeCodeForSession)
// — the auth store's `user` is only set after a successful password update,
// so AuthGuard never redirects to the app early. If the screen is left before
// that happens, the recovery session is signed out so it can't be reused.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { SchemeColors, type ThemeColorPalette } from '@/constants/theme';
import { parseResetPasswordLink } from '@/utils/auth-reset-link';
import { validateNewPassword } from '@/utils/password-validation';
import { isRateLimitError, isRetryableError, isSamePasswordError, isWeakPasswordError } from '@/utils/supabase-error';
import { isResetLinkConsumed, markResetLinkConsumed } from '@/utils/consumed-reset-links';

const ON_PRIMARY = SchemeColors.light.background;
const RESEND_SECONDS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LinkStatus = 'validating' | 'valid' | 'invalid';

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const setSession = useAuthStore((s) => s.setSession);
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [mode, setMode] = useState<'code' | 'link'>('code');
  const [linkStatus, setLinkStatus] = useState<LinkStatus>('validating');

  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [resendLoading, setResendLoading] = useState(false);

  const completedRef = useRef(false);
  const otpVerifiedRef = useRef(false);
  const deepLinkUrl = Linking.useURL();

  const showEmailField = !params.email;

  // Sign the recovery session back out if the user abandons this screen
  // before finishing — otherwise a session established by a link/code could
  // sit around unused. No-op if no recovery session was ever established.
  useEffect(() => {
    return () => {
      if (!completedRef.current) {
        supabase.auth.signOut().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const candidate = deepLinkUrl ?? (await Linking.getInitialURL().catch(() => null));
      if (cancelled || !candidate) return;
      // A cached getInitialURL() can resurface the same link after its
      // single-use token has already been consumed — skip it so the code
      // flow renders normally instead of re-validating (and failing) it.
      if (isResetLinkConsumed(candidate)) return;
      const parsed = parseResetPasswordLink(candidate);
      if (parsed.kind === 'invalid') return;

      markResetLinkConsumed(candidate);
      setMode('link');
      setLinkStatus('validating');
      try {
        if (parsed.kind === 'session') {
          const { error } = await supabase.auth.setSession({
            access_token: parsed.accessToken,
            refresh_token: parsed.refreshToken,
          });
          if (error) throw error;
        } else if (parsed.kind === 'code') {
          const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
          if (error) throw error;
        } else {
          const { error } = await supabase.auth.verifyOtp({ token_hash: parsed.tokenHash, type: 'recovery' });
          if (error) throw error;
        }
        if (!cancelled) setLinkStatus('valid');
      } catch {
        if (!cancelled) setLinkStatus('invalid');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deepLinkUrl]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const goAfterAuth = () => {
    const { hasSeenWelcomeOffer } = useAuthStore.getState();
    router.replace(hasSeenWelcomeOffer ? '/(tabs)' : ('/welcome-offer' as any));
  };

  const finishWithSession = async (session: Parameters<typeof setSession>[0]) => {
    completedRef.current = true;
    if (session) await setSession(session);
    Alert.alert(t.common.success, t.auth.resetPassword.successMsg, [
      { text: t.common.ok, onPress: goAfterAuth },
    ]);
  };

  const pwErrors = validateNewPassword(password, confirm);
  const pwErrorText = (errorCode: 'required' | 'tooShort' | 'mismatch' | undefined) => {
    if (errorCode === 'tooShort') return t.auth.resetPassword.passwordTooShort;
    if (errorCode === 'mismatch') return t.auth.resetPassword.passwordMismatch;
    if (errorCode === 'required') return t.auth.resetPassword.fillFields;
    return undefined;
  };

  const alertUpdateUserError = (updateError: unknown) => {
    if (isSamePasswordError(updateError)) {
      Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.samePassword);
    } else if (isWeakPasswordError(updateError)) {
      Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.weakPassword);
    } else {
      Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.genericError);
    }
  };

  const handleSubmitCode = async () => {
    setTouched({ email: true, code: true, password: true, confirm: true });
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.fillEmail);
      return;
    }
    // Once verifyOtp has already succeeded for this screen, the code has
    // been consumed server-side — a retry (e.g. after a same/weak password
    // rejection) must go straight to updateUser instead of re-sending it.
    if (!otpVerifiedRef.current && (!code || code.length !== 6)) {
      Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.fillFields);
      return;
    }
    if (Object.keys(pwErrors).length > 0) return;

    setLoading(true);
    try {
      if (!otpVerifiedRef.current) {
        const { error } = await supabase.auth.verifyOtp({
          email: trimmedEmail,
          type: 'recovery',
          token: code,
        });
        if (error) {
          if (isRateLimitError(error)) {
            Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.rateLimitError);
          } else if (isRetryableError(error)) {
            Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.genericError);
          } else {
            Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.codeInvalid);
          }
          return;
        }
        otpVerifiedRef.current = true;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        alertUpdateUserError(updateError);
        return;
      }
      const { data } = await supabase.auth.getSession();
      await finishWithSession(data.session);
    } catch {
      Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.genericError);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitLink = async () => {
    setTouched((prev) => ({ ...prev, password: true, confirm: true }));
    if (Object.keys(pwErrors).length > 0) return;

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        alertUpdateUserError(error);
        return;
      }
      const { data } = await supabase.auth.getSession();
      await finishWithSession(data.session);
    } catch {
      Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.genericError);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.fillEmail);
      return;
    }
    setResendLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: 'localsapp://auth/reset-password',
      });
      if (error) {
        if (isRateLimitError(error)) {
          Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.rateLimitError);
        } else {
          Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.genericError);
        }
        return;
      }
      setResendIn(RESEND_SECONDS);
    } catch {
      Alert.alert(t.auth.resetPassword.errorTitle, t.auth.resetPassword.genericError);
    } finally {
      setResendLoading(false);
    }
  };

  const field = (key: string) => ({
    onBlur: () => setTouched((prev) => ({ ...prev, [key]: true })),
  });

  if (mode === 'link' && linkStatus === 'validating') {
    return (
      <View style={[styles.centerContainer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.centerText}>{t.auth.resetPassword.validatingLink}</Text>
      </View>
    );
  }

  if (mode === 'link' && linkStatus === 'invalid') {
    return (
      <View style={[styles.centerContainer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.title}>{t.auth.resetPassword.linkInvalidTitle}</Text>
        <Text style={styles.centerText}>{t.auth.resetPassword.linkInvalidMsg}</Text>
        <TouchableOpacity
          style={styles.submitBtn}
          activeOpacity={0.85}
          onPress={() => router.replace('/auth/forgot-password' as any)}
        >
          <Text style={styles.submitBtnText}>{t.auth.resetPassword.requestNewCode}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isLinkMode = mode === 'link' && linkStatus === 'valid';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.muted} />
          </TouchableOpacity>
          <Text style={styles.title}>{t.auth.resetPassword.title}</Text>
          {!isLinkMode && <Text style={styles.subtitle}>{t.auth.resetPassword.subtitleCode}</Text>}
        </View>

        {!isLinkMode && showEmailField && (
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t.auth.resetPassword.emailLabel}</Text>
            <TextInput
              style={styles.input}
              placeholder={t.auth.resetPassword.emailPlaceholder}
              placeholderTextColor={colors.muted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              {...field('email')}
            />
          </View>
        )}

        {!isLinkMode && (
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t.auth.resetPassword.codeLabel}</Text>
            <TextInput
              style={styles.input}
              placeholder={t.auth.resetPassword.codePlaceholder}
              placeholderTextColor={colors.muted}
              value={code}
              onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              returnKeyType="next"
              {...field('code')}
            />
          </View>
        )}

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t.auth.resetPassword.newPasswordLabel}</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.inputFlex, touched.password && pwErrorText(pwErrors.password) ? styles.inputError : null]}
              placeholder={t.auth.resetPassword.newPasswordPlaceholder}
              placeholderTextColor={colors.muted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              returnKeyType="next"
              {...field('password')}
            />
            <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.muted} />
            </TouchableOpacity>
          </View>
          {touched.password && pwErrorText(pwErrors.password) ? (
            <Text style={styles.errorText}>{pwErrorText(pwErrors.password)}</Text>
          ) : null}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t.auth.resetPassword.confirmPasswordLabel}</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.inputFlex, touched.confirm && pwErrorText(pwErrors.confirm) ? styles.inputError : null]}
              placeholder={t.auth.resetPassword.confirmPasswordPlaceholder}
              placeholderTextColor={colors.muted}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry={!showConfirm}
              returnKeyType="done"
              onSubmitEditing={isLinkMode ? handleSubmitLink : handleSubmitCode}
              {...field('confirm')}
            />
            <TouchableOpacity onPress={() => setShowConfirm((v) => !v)} style={styles.eyeBtn}>
              <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.muted} />
            </TouchableOpacity>
          </View>
          {touched.confirm && pwErrorText(pwErrors.confirm) ? (
            <Text style={styles.errorText}>{pwErrorText(pwErrors.confirm)}</Text>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
          activeOpacity={0.85}
          onPress={isLinkMode ? handleSubmitLink : handleSubmitCode}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={ON_PRIMARY} />
          ) : (
            <Text style={styles.submitBtnText}>{t.auth.resetPassword.submitBtn}</Text>
          )}
        </TouchableOpacity>

        {!isLinkMode && (
          <TouchableOpacity style={styles.resendRow} onPress={handleResend} disabled={resendIn > 0 || resendLoading}>
            {resendLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={[styles.resendText, resendIn > 0 && styles.resendTextDisabled]}>
                {resendIn > 0 ? t.auth.resetPassword.resendCodeIn(resendIn) : t.auth.resetPassword.resendCode}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  scroll: {
    paddingHorizontal: 24,
    flexGrow: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 16,
    backgroundColor: colors.background,
  },
  centerText: {
    fontSize: 14,
    color: colors.foreground,
    textAlign: 'center',
    lineHeight: 22,
  },
  header: {
    marginBottom: 28,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    marginLeft: -4,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.foreground,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.foreground,
    lineHeight: 22,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.foreground,
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: colors.foreground,
  },
  inputError: {
    borderColor: colors.error,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingRight: 8,
  },
  inputFlex: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: colors.foreground,
  },
  eyeBtn: {
    padding: 8,
  },
  errorText: {
    fontSize: 12,
    color: colors.error,
    marginTop: 4,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: ON_PRIMARY,
    fontSize: 16,
    fontWeight: '700',
  },
  resendRow: {
    alignItems: 'center',
  },
  resendText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  resendTextDisabled: {
    color: colors.muted,
  },
});
