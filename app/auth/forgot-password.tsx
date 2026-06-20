import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { trpc } from '@/lib/trpc';
import { useTranslation } from '@/hooks/use-translation';

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const t = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const forgotMutation = trpc.auth.forgotPassword.useMutation();

  const handleSubmit = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert(t.common.error, t.auth.forgotPassword.fillEmail);
      return;
    }
    setLoading(true);
    try {
      await forgotMutation.mutateAsync({ email });
      setSent(true);
    } catch {
      Alert.alert(t.common.error, t.common.tryAgain);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0F1F16' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
        {/* Header */}
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="rgba(245,240,232,0.8)" />
        </TouchableOpacity>

        {sent ? (
          /* Success state */
          <View style={styles.successContainer}>
            <View style={styles.successIcon}>
              <Ionicons name="mail-outline" size={36} color="#52B788" />
            </View>
            <Text style={styles.title}>{t.auth.forgotPassword.successTitle}</Text>
            <Text style={styles.successText}>
              {t.auth.forgotPassword.successMsg} <Text style={styles.emailHighlight}>{email}</Text>
            </Text>
            <TouchableOpacity
              style={styles.submitBtn}
              activeOpacity={0.85}
              onPress={() => router.replace('/auth/login' as any)}
            >
              <Text style={styles.submitBtnText}>{t.auth.forgotPassword.backToLogin}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* Form state */
          <View style={styles.formContainer}>
            <Text style={styles.title}>{t.auth.forgotPassword.title}</Text>
            <Text style={styles.subtitle}>{t.auth.forgotPassword.subtitle}</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t.auth.forgotPassword.email}</Text>
              <TextInput
                style={styles.input}
                placeholder={t.auth.forgotPassword.emailPlaceholder}
                placeholderTextColor="rgba(245,240,232,0.25)"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                autoFocus
              />
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              activeOpacity={0.85}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#0F1F16" />
              ) : (
                <Text style={styles.submitBtnText}>{t.auth.forgotPassword.sendBtn}</Text>
              )}
            </TouchableOpacity>

            <View style={styles.loginRow}>
              <Text style={styles.loginText}>{t.auth.login.noAccount} </Text>
              <TouchableOpacity onPress={() => router.replace('/auth/login' as any)}>
                <Text style={styles.loginLink}>{t.auth.forgotPassword.backToLogin}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
    marginLeft: -4,
  },
  formContainer: {
    flex: 1,
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 40,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(82,183,136,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F5F0E8',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(245,240,232,0.5)',
    lineHeight: 22,
    marginBottom: 32,
  },
  successText: {
    fontSize: 14,
    color: 'rgba(245,240,232,0.5)',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 16,
  },
  emailHighlight: {
    color: '#F5F0E8',
    fontWeight: '600',
  },
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.5)',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
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
  submitBtn: {
    backgroundColor: '#52B788',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20,
    width: '100%',
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: '#0F1F16',
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
    color: 'rgba(245,240,232,0.45)',
  },
  loginLink: {
    fontSize: 14,
    color: '#52B788',
    fontWeight: '600',
  },
});
