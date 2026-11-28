import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTripsStore } from '@/store/trips';
import { useAuthStore } from '@/store/auth';
import { trpcVanilla } from '@/lib/trpc-vanilla';
import { formatMoney } from '@/utils/trip-helpers';
import { CurrencyPicker } from '@/components/ui/currency-picker';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { sheetScreenOptions } from '@/utils/sheet-presentation';
import { useDiscardConfirmation } from '@/hooks/use-discard-confirmation';

/**
 * Lets the trip owner/editor change the base currency. See the original
 * TripCurrencySettingsModal for the recalculation strategy (unchanged).
 */
export default function CurrencySettingsScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemoStyles(colors);
  const preferredLanguage = useAuthStore((s) => s.preferredLanguage);
  const trip = useTripsStore((s) => s.trips.find((tr) => tr.id === tripId));
  const recalculateTripCurrency = useTripsStore((s) => s.recalculateTripCurrency);

  const currency = trip?.currency ?? 'USD';
  const expenses = trip?.expenses ?? [];
  const [newCurrency, setNewCurrency] = useState(currency);
  const [loading, setLoading] = useState(false);

  useDiscardConfirmation(newCurrency !== currency && !loading);

  if (!trip) return null;

  const handleConfirm = async () => {
    if (newCurrency === currency) { router.back(); return; }
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
              router.back();
            },
          },
        ]
      );
    } catch (err) {
      console.error('[CurrencySettingsScreen] recalculation failed:', err);
      Alert.alert(t.tripSettings.rateLookupFailedTitle, t.tripSettings.rateLookupFailedMessage);
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors)} />
      <View style={styles.sheet}>
        <Text style={styles.title}>{t.tripSettings.title}</Text>

        <Text style={styles.label}>{t.tripSettings.baseCurrency}</Text>
        <Text style={styles.hint}>{t.tripSettings.baseCurrencyHint}</Text>
        <View style={{ marginTop: 10, marginBottom: 20, alignItems: 'flex-start' }}>
          <CurrencyPicker value={newCurrency} onChange={setNewCurrency} />
        </View>

        <TouchableOpacity
          onPress={handleConfirm}
          disabled={loading || newCurrency === currency}
          activeOpacity={0.7}
          style={[styles.confirmBtn, { backgroundColor: colors.primary, opacity: loading || newCurrency === currency ? 0.5 : 1 }]}
        >
          {loading ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={{ color: colors.textOnPrimary, fontWeight: '600', fontSize: 16 }}>{t.common.save}</Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );
}

function useMemoStyles(colors: ThemeColorPalette) {
  return useMemo(() => StyleSheet.create({
    sheet: { backgroundColor: colors.background, padding: 24 },
    title: { fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', color: colors.foreground, marginBottom: 20 },
    label: { fontSize: 12, fontWeight: '700', color: colors.foreground, letterSpacing: 0.5 },
    hint: { fontSize: 12, color: colors.muted, marginTop: 4 },
    confirmBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  }), [colors]);
}
