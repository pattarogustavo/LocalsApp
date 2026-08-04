import React, { useMemo, useState } from 'react';
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
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { SchemeColors, type ThemeColorPalette } from '@/constants/theme';

// Validation is now done inside the component so it can use translations

// Text/icon color for content drawn on top of the primary button color, which
// is identical in both schemes — always the light-scheme background swatch.
const ON_PRIMARY = SchemeColors.light.background;

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const { setSession } = useAuthStore();
  const [appleLoading, setAppleLoading] = useState(false);
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  function validate(n: string, e: string, p: string, c: string) {
    const errors: Record<string, string> = {};
    if (!n.trim()) errors.name = t.auth.register.nameValidation;
    if (!e.trim()) errors.email = t.auth.register.emailValidation;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) errors.email = t.auth.register.emailValidation;
    if (!p) errors.password = t.auth.register.fillFields;
    else if (p.length < 6) errors.password = t.auth.register.passwordTooShort;
    if (!c) errors.confirm = t.auth.register.fillFields;
    else if (c !== p) errors.confirm = t.auth.register.passwordMismatch;
    return errors;
  }

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  const errors = validate(name, email, password, confirm);
  const canSubmit = Object.keys(errors).length === 0 && agreed && !loading;

  const handleRegister = async () => {
    setTouched({ name: true, email: true, password: true, confirm: true });
    if (!canSubmit) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { full_name: name.trim() } },
      });
      if (error) {
        Alert.alert('Erro ao criar conta', error.message);
        return;
      }
      if (data.session) {
        await setSession(data.session);
        router.replace('/(tabs)');
      } else {
        Alert.alert(
          'Confirme seu e-mail',
          'Enviamos um link de confirmação para ' + email.trim().toLowerCase() + '. Verifique sua caixa de entrada.',
          [{ text: 'OK', onPress: () => router.replace('/auth/login' as any) }],
        );
      }
    } catch (e: any) {
      Alert.alert('Erro', e.message ?? 'Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    setAppleLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken!,
      });
      if (error) {
        Alert.alert('Erro ao entrar com Apple', error.message);
        return;
      }
      if (data.session) {
        await setSession(data.session);
        router.replace('/(tabs)');
      }
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Erro', e.message ?? 'Tente novamente.');
      }
    } finally {
      setAppleLoading(false);
    }
  };

  const field = (key: string) => ({
    onBlur: () => setTouched((t) => ({ ...t, [key]: true })),
  });

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
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.title}>{t.auth.register.title}</Text>
          <Text style={styles.subtitle}>{t.auth.register.trialInfo}</Text>
        </View>

        {/* Apple Sign In — iOS only */}
        {Platform.OS === 'ios' && (
          <>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={12}
              style={styles.appleBtn}
              onPress={handleAppleLogin}
            />
            {appleLoading && (
              <ActivityIndicator color={colors.foreground} style={{ marginBottom: 12 }} />
            )}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>ou crie com e-mail</Text>
              <View style={styles.dividerLine} />
            </View>
          </>
        )}

        {/* Full name */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t.auth.register.name}</Text>
          <TextInput
            style={[styles.input, touched.name && errors.name ? styles.inputError : null]}
            placeholder={t.auth.register.namePlaceholder}
            placeholderTextColor={colors.muted}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            returnKeyType="next"
            {...field('name')}
          />
          {touched.name && errors.name ? <Text style={styles.errorText}>{errors.name}</Text> : null}
        </View>

        {/* Email */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t.auth.register.email}</Text>
          <TextInput
            style={[styles.input, touched.email && errors.email ? styles.inputError : null]}
            placeholder={t.auth.register.emailPlaceholder}
            placeholderTextColor={colors.muted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            {...field('email')}
          />
          {touched.email && errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
        </View>

        {/* Password */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t.auth.register.password}</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.inputFlex, touched.password && errors.password ? styles.inputError : null]}
              placeholder={t.auth.register.passwordPlaceholder}
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
          {touched.password && errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
        </View>

        {/* Confirm password */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t.auth.register.confirmPassword}</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.inputFlex, touched.confirm && errors.confirm ? styles.inputError : null]}
              placeholder={t.auth.register.confirmPasswordPlaceholder}
              placeholderTextColor={colors.muted}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry={!showConfirm}
              returnKeyType="done"
              onSubmitEditing={handleRegister}
              {...field('confirm')}
            />
            <TouchableOpacity onPress={() => setShowConfirm((v) => !v)} style={styles.eyeBtn}>
              <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.muted} />
            </TouchableOpacity>
          </View>
          {touched.confirm && errors.confirm ? <Text style={styles.errorText}>{errors.confirm}</Text> : null}
        </View>

        {/* Terms checkbox */}
        <TouchableOpacity style={styles.checkRow} activeOpacity={0.8} onPress={() => setAgreed((v) => !v)}>
          <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
            {agreed && <Ionicons name="checkmark" size={12} color={ON_PRIMARY} />}
          </View>
          <Text style={styles.checkText}>
            I agree to the{' '}
            <Text style={styles.link}>Terms of Use</Text>
            {' '}and{' '}
            <Text style={styles.link}>Privacy Policy</Text>
          </Text>
        </TouchableOpacity>

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
          activeOpacity={0.85}
          onPress={handleRegister}
          disabled={!canSubmit}
        >
          {loading ? (
            <ActivityIndicator color={ON_PRIMARY} />
          ) : (
            <Text style={styles.submitBtnText}>{t.auth.register.registerBtn}</Text>
          )}
        </TouchableOpacity>

        {/* Login link */}
        <View style={styles.loginRow}>
          <Text style={styles.loginText}>{t.auth.register.haveAccount} </Text>
          <TouchableOpacity onPress={() => router.replace('/auth/login' as any)}>
            <Text style={styles.loginLink}>{t.auth.register.login}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  scroll: {
    paddingHorizontal: 24,
    gap: 0,
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
  },
  appleBtn: { height: 50, marginBottom: 16 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.foreground,
    fontSize: 12,
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
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 24,
    marginTop: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkText: {
    flex: 1,
    fontSize: 13,
    color: colors.foreground,
    lineHeight: 20,
  },
  link: {
    color: colors.primary,
    fontWeight: '600',
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitBtnText: {
    color: ON_PRIMARY,
    fontSize: 16,
    fontWeight: '700',
  },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginText: {
    fontSize: 14,
    color: colors.foreground,
  },
  loginLink: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
});
