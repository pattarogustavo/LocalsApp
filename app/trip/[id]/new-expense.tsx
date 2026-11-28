import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTripsStore } from '@/store/trips';
import { useAuthStore } from '@/store/auth';
import { generateId } from '@/utils/trip-helpers';
import type { Expense } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';
import type { Translations } from '@/i18n';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { CurrencyPicker } from '@/components/ui/currency-picker';
import { trpc } from '@/lib/trpc';
import { sheetScreenOptions } from '@/utils/sheet-presentation';
import { useDiscardConfirmation } from '@/hooks/use-discard-confirmation';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

function getCategories(t: Translations) {
  return [
    { key: 'food', label: t.expenses.categories.food, icon: 'restaurant' },
    { key: 'transport', label: t.expenses.categories.transport, icon: 'car' },
    { key: 'accommodation', label: t.expenses.categories.accommodation, icon: 'bed' },
    { key: 'activity', label: t.expenses.categories.activities, icon: 'ticket' },
    { key: 'shopping', label: t.expenses.categories.shopping, icon: 'bag' },
    { key: 'other', label: t.expenses.categories.other, icon: 'ellipsis-horizontal' },
  ];
}

export default function NewExpenseScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const CATEGORIES = useMemo(() => getCategories(t), [t]);
  const preferredLanguage = useAuthStore((s) => s.preferredLanguage);
  const trip = useTripsStore((s) => s.trips.find((tr) => tr.id === tripId));
  const addExpense = useTripsStore((s) => s.addExpense);

  const currency = trip?.currency ?? 'USD';
  const travelers = trip?.travelers ?? [];
  const selfName = t.expenses.self;
  const allParticipants = useMemo(() => {
    const names = [selfName, ...travelers.map((tr) => tr.name)];
    return Array.from(new Set(names));
  }, [travelers, selfName]);

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Expense['category']>('other');
  const [paidBy, setPaidBy] = useState(selfName);
  const [splitWith, setSplitWith] = useState<string[]>([selfName]);
  const [expenseCurrency, setExpenseCurrency] = useState(trip?.lastExpenseCurrency || currency);
  const [rateText, setRateText] = useState('1');
  const [rateEditedManually, setRateEditedManually] = useState(false);

  useDiscardConfirmation(description.trim().length > 0 || amount.length > 0);

  const today = useMemo(() => new Date().toISOString(), []);
  const needsRate = expenseCurrency !== currency;
  const rateQuery = trpc.exchangeRates.getRates.useQuery(
    { pairs: [{ date: today, from: expenseCurrency, to: currency }] },
    { enabled: needsRate }
  );
  useEffect(() => {
    if (!needsRate) {
      setRateText('1');
      setRateEditedManually(false);
      return;
    }
    const fetched = rateQuery.data?.rates?.[0]?.rate;
    if (fetched != null && !rateEditedManually) setRateText(String(fetched));
  }, [needsRate, rateQuery.data, rateEditedManually]);
  const parsedRate = parseFloat(rateText.replace(',', '.'));
  const rateUnavailable = needsRate && !rateQuery.isFetching && rateQuery.data?.rates?.[0]?.rate == null && !rateEditedManually;
  const baseAmountPreview = (() => {
    const amt = parseFloat(amount.replace(',', '.'));
    if (isNaN(amt)) return null;
    if (!needsRate) return amt;
    if (isNaN(parsedRate)) return null;
    return amt * parsedRate;
  })();

  const toggleParticipant = (name: string) => {
    setSplitWith((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  const handleAdd = async () => {
    if (!description.trim() || !amount) return;
    const parsedAmount = parseFloat(amount.replace(',', '.'));
    if (isNaN(parsedAmount)) return;
    const exchangeRate = needsRate ? parsedRate : 1;
    if (needsRate && isNaN(exchangeRate)) return;
    const expense: Expense = {
      id: generateId(),
      description: description.trim(),
      amount: parsedAmount,
      currency: expenseCurrency,
      category,
      date: today,
      paidBy,
      splitWith: splitWith.length > 0 ? splitWith : allParticipants,
      exchangeRate,
      baseAmount: parsedAmount * exchangeRate,
      rateSource: !needsRate || (!rateEditedManually && rateQuery.data?.rates?.[0]?.rate != null) ? 'frankfurter' : 'manual',
    };
    await addExpense(tripId, expense);
    router.back();
  };

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors, [0.85, 1.0])} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', color: colors.foreground, marginBottom: 20 }}>
          {t.expenses.newExpense}
        </Text>

        <Text style={styles.formLabel}>{t.expenses.category}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c.key}
              onPress={() => setCategory(c.key as any)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: category === c.key ? colors.primary : colors.surface }}
            >
              <Ionicons name={c.icon as any} size={14} color={category === c.key ? colors.textOnPrimary : colors.foreground} />
              <Text style={{ fontSize: 12, color: category === c.key ? colors.textOnPrimary : colors.foreground }}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.formLabel}>{t.expenses.description}</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder={t.expenses.descriptionPlaceholder}
          placeholderTextColor={colors.muted}
          style={styles.formInput}
        />

        <Text style={styles.formLabel}>{t.expenses.amount}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: needsRate ? 10 : 14 }}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0,00"
            placeholderTextColor={colors.muted}
            keyboardType="decimal-pad"
            style={[styles.formInput, { flex: 1, marginBottom: 0 }]}
          />
          <CurrencyPicker value={expenseCurrency} onChange={setExpenseCurrency} compact />
        </View>

        {needsRate && (
          <View style={{ marginBottom: 14 }}>
            <Text style={styles.formLabel}>{t.expenses.exchangeRate} (1 {expenseCurrency} = ? {currency})</Text>
            <TextInput
              value={rateText}
              onChangeText={(v) => { setRateText(v); setRateEditedManually(true); }}
              placeholder="0,00"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              style={styles.formInput}
            />
            {rateQuery.isFetching ? (
              <Text style={styles.rateHint}>{t.expenses.rateLoading}</Text>
            ) : rateUnavailable ? (
              <Text style={styles.rateHint}>{t.expenses.rateUnavailable}</Text>
            ) : baseAmountPreview != null ? (
              <Text style={styles.rateHint}>≈ {baseAmountPreview.toFixed(2)} {currency}</Text>
            ) : null}
          </View>
        )}

        <Text style={styles.formLabel}>{t.expenses.paidBy}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {allParticipants.map((name) => (
            <TouchableOpacity
              key={name}
              onPress={() => setPaidBy(name)}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: paidBy === name ? colors.primary : colors.surface }}
            >
              <Text style={{ fontSize: 13, color: paidBy === name ? colors.textOnPrimary : colors.foreground, fontWeight: '600' }}>{name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.formLabel}>{t.expenses.splitWith} ({t.expenses.emptyMeansAll})</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {allParticipants.map((name) => (
            <TouchableOpacity
              key={name}
              onPress={() => toggleParticipant(name)}
              style={{
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                backgroundColor: splitWith.includes(name) ? colors.primary : colors.surface,
                borderWidth: 1, borderColor: splitWith.includes(name) ? colors.primary : 'transparent',
              }}
            >
              <Text style={{ fontSize: 13, color: splitWith.includes(name) ? colors.textOnPrimary : colors.foreground, fontWeight: '600' }}>{name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={() => router.push({ pathname: '/trip/[id]/add-traveler', params: { id: tripId, tripId } })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginBottom: 20 }}
        >
          <Ionicons name="person-add-outline" size={14} color={colors.textAccent} />
          <Text style={{ fontSize: 13, color: colors.textAccent, fontWeight: '600' }}>{t.travelers.addTraveler}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleAdd} activeOpacity={0.7} style={{ backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}>
          <Text style={{ color: colors.textOnPrimary, fontWeight: '600', fontSize: 16 }}>{t.common.add}</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  formLabel: { fontSize: 12, fontWeight: '700', color: colors.foreground, marginBottom: 6, letterSpacing: 0.5 },
  formInput: { backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: colors.foreground, fontSize: 15, marginBottom: 14 },
  rateHint: { color: colors.muted, fontSize: 12, marginTop: -8, marginBottom: 2 },
});
