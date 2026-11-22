import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripsStore } from '@/store/trips';
import { useAuthStore } from '@/store/auth';
import { trpcVanilla } from '@/lib/trpc-vanilla';
import { formatMoney } from '@/utils/trip-helpers';
import { CurrencyPicker } from '@/components/ui/currency-picker';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import type { Expense } from '@/types/voyage';

interface TripCurrencySettingsModalProps {
  visible: boolean;
  onClose: () => void;
  tripId: string;
  currency: string;
  expenses: Expense[];
}

/**
 * Lets the trip owner/editor change the base currency. Every expense's
 * base-currency conversion is recomputed using its ORIGINAL date — pivoting
 * through the trip's current (old) base currency, so only one exchange-rate
 * lookup per unique expense date is needed (date, oldCurrency → newCurrency),
 * not one per (date, expense.currency) pair. The user sees the impact
 * (old vs. new total) and must confirm before anything is written.
 */
export function TripCurrencySettingsModal({ visible, onClose, tripId, currency, expenses }: TripCurrencySettingsModalProps) {
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemoStyles(colors);
  const insets = useSafeAreaInsets();
  const preferredLanguage = useAuthStore((s) => s.preferredLanguage);
  const recalculateTripCurrency = useTripsStore((s) => s.recalculateTripCurrency);

  const [newCurrency, setNewCurrency] = useState(currency);
  const [loading, setLoading] = useState(false);

  const handleClose = () => {
    setNewCurrency(currency);
    onClose();
  };

  const handleConfirm = async () => {
    if (newCurrency === currency) { handleClose(); return; }
    setLoading(true);
    try {
      const uniqueDates = Array.from(new Set(expenses.map((e) => e.date.slice(0, 10))));
      let rateByDate = new Map<string, number>();
      if (uniqueDates.length > 0) {
        const res = await trpcVanilla.exchangeRates.getRates.query({
          pairs: uniqueDates.map((date) => ({ date, from: currency, to: newCurrency })),
        });
        const missing = res.rates.filter((r) => r.rate == null);
        if (missing.length > 0) {
          Alert.alert(t.tripSettings.rateLookupFailedTitle, t.tripSettings.rateLookupFailedMessage);
          setLoading(false);
          return;
        }
        rateByDate = new Map(res.rates.map((r) => [r.date.slice(0, 10), r.rate as number]));
      }

      const rates: Record<string, { exchangeRate: number; baseAmount: number; rateSource: 'frankfurter' | 'manual' }> = {};
      let newTotal = 0;
      for (const e of expenses) {
        const pivot = rateByDate.get(e.date.slice(0, 10)) ?? 1;
        const oldBaseAmount = e.baseAmount ?? e.amount;
        const baseAmount = oldBaseAmount * pivot;
        newTotal += baseAmount;
        rates[e.id] = {
          exchangeRate: e.amount !== 0 ? baseAmount / e.amount : pivot,
          baseAmount,
          rateSource: 'frankfurter',
        };
      }
      const oldTotal = expenses.reduce((sum, e) => sum + (e.baseAmount ?? e.amount), 0);

      Alert.alert(
        t.tripSettings.confirmTitle,
        t.tripSettings.confirmMessage
          .replace('{count}', String(expenses.length))
          .replace('{from}', formatMoney(oldTotal, currency, preferredLanguage))
          .replace('{to}', formatMoney(newTotal, newCurrency, preferredLanguage)),
        [
          { text: t.common.cancel, style: 'cancel', onPress: () => setLoading(false) },
          {
            text: t.common.confirm,
            onPress: async () => {
              await recalculateTripCurrency(tripId, newCurrency, rates);
              setLoading(false);
              handleClose();
            },
          },
        ]
      );
    } catch (err) {
      console.error('[TripCurrencySettingsModal] recalculation failed:', err);
      Alert.alert(t.tripSettings.rateLookupFailedTitle, t.tripSettings.rateLookupFailedMessage);
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlayModal }}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.header}>
            <Text style={styles.title}>{t.tripSettings.title}</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close-circle" size={26} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>{t.tripSettings.baseCurrency}</Text>
          <Text style={styles.hint}>{t.tripSettings.baseCurrencyHint}</Text>
          <View style={{ marginTop: 10, marginBottom: 20, alignItems: 'flex-start' }}>
            <CurrencyPicker value={newCurrency} onChange={setNewCurrency} />
          </View>

          <TouchableOpacity
            onPress={handleConfirm}
            disabled={loading || newCurrency === currency}
            activeOpacity={0.7}
            style={[
              styles.confirmBtn,
              { backgroundColor: colors.primary, opacity: loading || newCurrency === currency ? 0.5 : 1 },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={{ color: colors.textOnPrimary, fontWeight: '600', fontSize: 16 }}>
                {t.common.save}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function useMemoStyles(colors: ThemeColorPalette) {
  return React.useMemo(() => StyleSheet.create({
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      padding: 24,
    },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    title: { fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', color: colors.foreground },
    label: { fontSize: 12, fontWeight: '700', color: colors.foreground, letterSpacing: 0.5 },
    hint: { fontSize: 12, color: colors.muted, marginTop: 4 },
    confirmBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  }), [colors]);
}
