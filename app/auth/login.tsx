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
import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from '@/hooks/use-translation';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { setSession } = useAuthStore();
  const t = useTranslation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Erro', 'Preencha e-mail e senha.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) {
        Alert.alert('Erro ao entrar', error.message);
        return;
      }
      if (data.session) {
        await setSession(data.session);
        router.replace('/(tabs)');
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
            <Ionicons name="arrow-back" size={22} color="#8A7F6E" />
          </TouchableOpacity>
          <Text style={styles.title}>{t.auth.login.subtitle}</Text>
          <Text style={styles.subtitle}>{t.auth.login.title}</Text>
        </View>

        {/* Apple Sign In — iOS only */}
        {Platform.OS === 'ios' && (
          <>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={12}
              style={styles.appleBtn}
              onPress={handleAppleLogin}
            />
            {appleLoading && (
              <ActivityIndicator color="#2C2416" style={{ marginBottom: 12 }} />
            )}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>ou continue com e-mail</Text>
              <View style={styles.dividerLine} />
            </View>
          </>
        )}

        {/* Email */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t.auth.login.email}</Text>
          <TextInput
            style={styles.input}
            placeholder={t.auth.login.emailPlaceholder}
            placeholderTextColor="#8A7F6E"
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
            <Text style={styles.label}>{t.auth.login.password}</Text>
            <TouchableOpacity onPress={() => router.push('/auth/forgot-password' as any)}>
              <Text style={styles.forgotLink}>{t.auth.login.forgotPassword}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.inputFlex}
              placeholder={t.auth.login.passwordPlaceholder}
              placeholderTextColor="#8A7F6E"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#8A7F6E" />
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
            <ActivityIndicator color="#F7F3EC" />
          ) : (
            <Text style={styles.submitBtnText}>{t.auth.login.loginBtn}</Text>
          )}
        </TouchableOpacity>

        {/* Register link */}
        <View style={styles.registerRow}>
          <Text style={styles.registerText}>{t.auth.login.noAccount} </Text>
          <TouchableOpacity onPress={() => router.replace('/auth/register' as any)}>
            <Text style={styles.registerLink}>{t.auth.login.register}</Text>
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
    color: '#2C2416',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#2C2416',
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
    backgroundColor: '#DDD5C5',
  },
  dividerText: {
    color: '#2C2416',
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
    color: '#2C2416',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  forgotLink: {
    fontSize: 12,
    color: '#3D5A2E',
    fontWeight: '600',
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
  submitBtn: {
    backgroundColor: '#3D5A2E',
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
    color: '#F7F3EC',
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
    color: '#2C2416',
  },
  registerLink: {
    fontSize: 14,
    color: '#3D5A2E',
    fontWeight: '600',
  },
});
