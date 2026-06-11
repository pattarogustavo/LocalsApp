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

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { setUser } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const loginMutation = trpc.auth.loginEmail.useMutation();

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const result = await loginMutation.mutateAsync({ email, password });
      setUser({
        id: result.user.id,
        openId: result.user.openId,
        name: result.user.name,
        email: result.user.email,
        subscriptionStatus: result.user.subscriptionStatus,
        subscriptionPlan: result.user.subscriptionPlan ?? null,
        subscriptionExpiresAt: result.user.subscriptionExpiresAt
          ? result.user.subscriptionExpiresAt.toISOString()
          : null,
        trialEndsAt: result.user.trialEndsAt
          ? result.user.trialEndsAt.toISOString()
          : null,
      });
      router.replace('/(tabs)');
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('INVALID_CREDENTIALS')) {
        Alert.alert('Incorrect email or password', 'Please check your credentials and try again.');
      } else {
        Alert.alert('Login failed', 'Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await startOAuthLogin();
    } catch {
      Alert.alert('Error', 'Could not start Google login.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0F1F16' }}
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
            <Ionicons name="arrow-back" size={22} color="rgba(245,240,232,0.8)" />
          </TouchableOpacity>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Log in to continue your journey</Text>
        </View>

        {/* Google button */}
        <TouchableOpacity style={styles.googleBtn} activeOpacity={0.85} onPress={handleGoogleLogin}>
          <Ionicons name="logo-google" size={18} color="#F5F0E8" />
          <Text style={styles.googleBtnText}>Continue with Google</Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Email */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor="rgba(245,240,232,0.25)"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />
        </View>

        {/* Password */}
        <View style={styles.fieldGroup}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Password</Text>
            <TouchableOpacity onPress={() => router.push('/auth/forgot-password' as any)}>
              <Text style={styles.forgotLink}>Forgot password?</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.inputFlex}
              placeholder="Your password"
              placeholderTextColor="rgba(245,240,232,0.25)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="rgba(245,240,232,0.4)" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
          activeOpacity={0.85}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#0F1F16" />
          ) : (
            <Text style={styles.submitBtnText}>Log in</Text>
          )}
        </TouchableOpacity>

        {/* Register link */}
        <View style={styles.registerRow}>
          <Text style={styles.registerText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.replace('/auth/register' as any)}>
            <Text style={styles.registerLink}>Sign up free</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 24,
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
    color: '#F5F0E8',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(245,240,232,0.5)',
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(245,240,232,0.08)',
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(245,240,232,0.12)',
    marginBottom: 20,
  },
  googleBtnText: {
    color: '#F5F0E8',
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
    backgroundColor: 'rgba(245,240,232,0.1)',
  },
  dividerText: {
    color: 'rgba(245,240,232,0.3)',
    fontSize: 12,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.5)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  forgotLink: {
    fontSize: 12,
    color: '#52B788',
    fontWeight: '600',
  },
  input: {
    backgroundColor: 'rgba(245,240,232,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,240,232,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: '#F5F0E8',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245,240,232,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,240,232,0.1)',
    paddingRight: 8,
  },
  inputFlex: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: '#F5F0E8',
  },
  eyeBtn: {
    padding: 8,
  },
  submitBtn: {
    backgroundColor: '#52B788',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: '#0F1F16',
    fontSize: 16,
    fontWeight: '700',
  },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  registerText: {
    fontSize: 14,
    color: 'rgba(245,240,232,0.45)',
  },
  registerLink: {
    fontSize: 14,
    color: '#52B788',
    fontWeight: '600',
  },
});
