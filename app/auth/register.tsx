import React, { useState } from 'react';
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
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth';
import { startOAuthLogin } from '@/constants/oauth';
import { useTranslation } from '@/hooks/use-translation';

// Validation is now done inside the component so it can use translations

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const { setUser } = useAuthStore();
  const t = useTranslation();

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

  const registerMutation = trpc.auth.register.useMutation();

  const handleRegister = async () => {
    // Mark all fields as touched to show errors
    setTouched({ name: true, email: true, password: true, confirm: true });
    if (!canSubmit) return;
    setLoading(true);
    try {
      const result = await registerMutation.mutateAsync({ name, email, password });
      setUser({
        id: result.user.id,
        openId: result.user.openId,
        name: result.user.name,
        email: result.user.email,
        subscriptionStatus: result.user.subscriptionStatus,
        subscriptionPlan: null,
        subscriptionExpiresAt: null,
        trialEndsAt: result.user.trialEndsAt ? result.user.trialEndsAt.toISOString() : null,
      });
      // Redirect to preferences onboarding after registration
      router.replace('/auth/preferences' as any);
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('EMAIL_TAKEN')) {
        Alert.alert(t.auth.register.errorTitle, t.auth.register.emailValidation);
      } else {
        Alert.alert(t.auth.register.errorTitle, t.common.tryAgain);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await startOAuthLogin();
    } catch {
      Alert.alert(t.common.error, t.common.tryAgain);
    }
  };

  const field = (key: string) => ({
    onBlur: () => setTouched((t) => ({ ...t, [key]: true })),
  });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F0EBE0' }}
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
            <Ionicons name="arrow-back" size={22} color="#2C2416" />
          </TouchableOpacity>
          <Text style={styles.title}>{t.auth.register.title}</Text>
          <Text style={styles.subtitle}>{t.auth.register.trialInfo}</Text>
        </View>

        {/* Google button */}
        <TouchableOpacity style={styles.googleBtn} activeOpacity={0.85} onPress={handleGoogleLogin}>
          <Ionicons name="logo-google" size={18} color="#2C2416" />
          <Text style={styles.googleBtnText}>{t.auth.register.continueWithGoogle}</Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>{t.common.or}</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Full name */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t.auth.register.name}</Text>
          <TextInput
            style={[styles.input, touched.name && errors.name ? styles.inputError : null]}
            placeholder={t.auth.register.namePlaceholder}
            placeholderTextColor="#8A7F6E"
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
            placeholderTextColor="#8A7F6E"
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
              placeholderTextColor="#8A7F6E"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              returnKeyType="next"
              {...field('password')}
            />
            <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#8A7F6E" />
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
              placeholderTextColor="#8A7F6E"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry={!showConfirm}
              returnKeyType="done"
              onSubmitEditing={handleRegister}
              {...field('confirm')}
            />
            <TouchableOpacity onPress={() => setShowConfirm((v) => !v)} style={styles.eyeBtn}>
              <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color="#8A7F6E" />
            </TouchableOpacity>
          </View>
          {touched.confirm && errors.confirm ? <Text style={styles.errorText}>{errors.confirm}</Text> : null}
        </View>

        {/* Terms checkbox */}
        <TouchableOpacity style={styles.checkRow} activeOpacity={0.8} onPress={() => setAgreed((v) => !v)}>
          <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
            {agreed && <Ionicons name="checkmark" size={12} color="#2C2416" />}
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
            <ActivityIndicator color="#F7F3EC" />
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

const styles = StyleSheet.create({
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
    color: '#2C2416',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#2C2416',
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#DDD5C5',
    marginBottom: 20,
  },
  googleBtnText: {
    color: '#2C2416',
    fontSize: 15,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#FFFFFF',
  },
  dividerText: {
    color: '#2C2416',
    fontSize: 12,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2C2416',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDD5C5',
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: '#2C2416',
  },
  inputError: {
    borderColor: '#E74C3C',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDD5C5',
    paddingRight: 8,
  },
  inputFlex: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: '#2C2416',
  },
  eyeBtn: {
    padding: 8,
  },
  errorText: {
    fontSize: 12,
    color: '#E74C3C',
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
    borderColor: '#DDD5C5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: '#3D5A2E',
    borderColor: '#3D5A2E',
  },
  checkText: {
    flex: 1,
    fontSize: 13,
    color: '#2C2416',
    lineHeight: 20,
  },
  link: {
    color: '#3D5A2E',
    fontWeight: '600',
  },
  submitBtn: {
    backgroundColor: '#3D5A2E',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitBtnText: {
    color: '#2C2416',
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
    color: '#2C2416',
  },
  loginLink: {
    fontSize: 14,
    color: '#3D5A2E',
    fontWeight: '600',
  },
});
