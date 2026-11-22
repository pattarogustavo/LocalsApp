import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { useTranslation } from '@/hooks/use-translation';
import { COMMON_CURRENCIES, getAllCurrencyCodes, getCurrencySymbol } from '@/utils/trip-helpers';

interface CurrencyPickerProps {
  value: string;
  onChange: (currency: string) => void;
  /** Compact pill trigger instead of the full labeled row — for inline use next to another field (e.g. the amount input). */
  compact?: boolean;
}

/**
 * Currency selector: a trigger (full row or compact pill) that opens a
 * full-screen list — common currencies pinned on top, then every
 * recognized code, filterable by a search box. Shown as "CODE  SYMBOL"
 * (no localized full names, to avoid needing 38 currency names × 6
 * languages of translation).
 */
export function CurrencyPicker({ value, onChange, compact = false }: CurrencyPickerProps) {
  const colors = useColors();
  const t = useTranslation();
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');

  const allCodes = useMemo(() => getAllCurrencyCodes(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return { common: COMMON_CURRENCIES, rest: allCodes.filter((c) => !COMMON_CURRENCIES.includes(c)) };
    const matches = allCodes.filter((c) => c.includes(q) || getCurrencySymbol(c).toUpperCase().includes(q));
    return { common: [], rest: matches };
  }, [query, allCodes]);

  const handleSelect = (code: string) => {
    onChange(code);
    setVisible(false);
    setQuery('');
  };

  const handleClose = () => {
    setVisible(false);
    setQuery('');
  };

  const renderRow = (code: string) => (
    <Pressable
      key={code}
      onPress={() => handleSelect(code)}
      style={({ pressed }) => [
        styles.resultRow,
        { borderBottomColor: colors.border },
        pressed && { opacity: 0.7 },
        code === value && { backgroundColor: colors.surface },
      ]}
    >
      <Text style={[styles.resultSymbol, { color: colors.muted }]}>{getCurrencySymbol(code)}</Text>
      <Text style={[styles.resultCode, { color: colors.foreground }]}>{code}</Text>
      {code === value && <Ionicons name="checkmark" size={16} color={colors.primary} />}
    </Pressable>
  );

  const sections = [
    ...(filtered.common.length > 0 ? [{ title: t.expenses.currencyCommon, codes: filtered.common }] : []),
    { title: filtered.common.length > 0 ? t.expenses.currencyAll : undefined, codes: filtered.rest },
  ];

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        style={compact
          ? [styles.compactTrigger, { backgroundColor: colors.surface, borderColor: colors.border }]
          : [styles.trigger, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={[compact ? styles.compactTriggerText : styles.triggerText, { color: colors.foreground }]}>
          {value}
        </Text>
        <Ionicons name="chevron-down" size={compact ? 12 : 14} color={colors.muted} />
      </Pressable>

      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={handleClose} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: colors.primary }]}>{t.common.cancel}</Text>
            </Pressable>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>{t.expenses.currencyPickerTitle}</Text>
            <View style={{ width: 70 }} />
          </View>

          <View style={[styles.searchRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="search" size={16} color={colors.muted} style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder={t.expenses.currencyPickerSearchPlaceholder}
              placeholderTextColor={colors.muted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            )}
          </View>

          <FlatList
            data={sections}
            keyExtractor={(s, i) => s.title ?? `rest-${i}`}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={styles.resultsList}
            renderItem={({ item: section }) => (
              <View>
                {section.title && (
                  <Text style={[styles.sectionTitle, { color: colors.muted }]}>{section.title}</Text>
                )}
                {section.codes.map(renderRow)}
              </View>
            )}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  triggerText: { fontSize: 15, fontWeight: '600' },
  compactTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  compactTriggerText: { fontSize: 13, fontWeight: '700' },
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: { width: 70 },
  cancelText: { fontSize: 16 },
  modalTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  resultsList: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 12, marginBottom: 4 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultSymbol: { fontSize: 14, width: 28 },
  resultCode: { fontSize: 15, fontWeight: '600', flex: 1 },
});
