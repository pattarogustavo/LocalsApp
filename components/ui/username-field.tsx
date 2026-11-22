import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { useTranslation } from '@/hooks/use-translation';
import { trpc } from '@/lib/trpc';
import { isValidUsernameFormat } from '@/shared/username';

export type UsernameFieldStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid_format';

interface UsernameFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  /** Reports the latest known status so the caller can gate its own submit button — 'available' is the only status that's safe to submit. */
  onStatusChange?: (status: UsernameFieldStatus) => void;
  autoFocus?: boolean;
}

/**
 * Username input with live availability feedback (debounced ~400ms):
 * checking / available / taken / invalid format. Used at signup, in
 * profile settings, and on the "choose a username" gate for pre-existing
 * accounts — the three places that need this exact check.
 */
export function UsernameField({ value, onChangeText, onStatusChange, autoFocus }: UsernameFieldProps) {
  const colors = useColors();
  const t = useTranslation();
  const [debounced, setDebounced] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(value), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value]);

  const formatOk = value.length === 0 || isValidUsernameFormat(value);
  const checkQuery = trpc.user.checkUsername.useQuery(
    { username: debounced },
    { enabled: debounced.length >= 3 && debounced === value && isValidUsernameFormat(debounced) }
  );

  const status: UsernameFieldStatus = (() => {
    if (value.length === 0) return 'idle';
    if (!formatOk) return 'invalid_format';
    if (debounced !== value || checkQuery.isFetching) return 'checking';
    if (checkQuery.data?.available) return 'available';
    if (checkQuery.data?.available === false) return checkQuery.data.reason === 'taken' ? 'taken' : 'invalid_format';
    return 'checking';
  })();

  useEffect(() => {
    onStatusChange?.(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const statusView = (() => {
    switch (status) {
      case 'checking':
        return <ActivityIndicator size="small" color={colors.muted} />;
      case 'available':
        return <Ionicons name="checkmark-circle" size={18} color={colors.primary} />;
      case 'taken':
      case 'invalid_format':
        return <Ionicons name="close-circle" size={18} color={colors.error} />;
      default:
        return null;
    }
  })();

  const statusText = (() => {
    switch (status) {
      case 'available': return t.username.available;
      case 'taken': return t.username.taken;
      case 'invalid_format': return t.username.invalidFormat;
      default: return t.username.hint;
    }
  })();

  const statusColor = status === 'available' ? colors.primary : status === 'taken' || status === 'invalid_format' ? colors.error : colors.muted;

  return (
    <View>
      <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.at, { color: colors.muted }]}>@</Text>
        <TextInput
          style={[styles.input, { color: colors.foreground }]}
          value={value}
          onChangeText={(text) => onChangeText(text.toLowerCase())}
          placeholder={t.username.placeholder}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          autoFocus={autoFocus}
        />
        {statusView}
      </View>
      <Text style={[styles.hint, { color: statusColor }]}>{statusText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  at: { fontSize: 15, fontWeight: '600' },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
  hint: { fontSize: 11, marginTop: 6, lineHeight: 15 },
});
