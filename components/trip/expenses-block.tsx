import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripsStore } from '@/store/trips';
import { useAuthStore } from '@/store/auth';
import { generateId, formatMoney } from '@/utils/trip-helpers';
import type { Expense, Traveler } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';
import type { Translations } from '@/i18n';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import type { TripPermissions } from '@/hooks/use-trip-permissions';
import { AddTravelerForm } from '@/components/trip/travelers-block';
import { CurrencyPicker } from '@/components/ui/currency-picker';
import { trpc } from '@/lib/trpc';

/** `expense.baseAmount` when present (post-multi-currency), else `amount` — every pre-existing expense was always saved in the trip's base currency already, so this is exact for them too, not just a fallback. */
function baseAmountOf(expense: Expense): number {
  return expense.baseAmount ?? expense.amount;
}

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

interface ExpensesBlockProps {
  tripId: string;
  expenses: Expense[];
  /** The trip's base currency. */
  currency: string;
  /** Last currency picked in this trip's "Nova Despesa" form, if any — defaults the picker to it instead of the base currency. */
  lastExpenseCurrency?: string;
  travelers?: Traveler[];
  permissions: TripPermissions;
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

// ─── Settlement Calculator ────────────────────────────────────────────────────

function computeSettlement(expenses: Expense[], travelers: Traveler[], selfLabel: string) {
  // Build list of all participant names (including the self label as the implicit self)
  const allNames = new Set<string>([selfLabel]);
  travelers.forEach((t) => allNames.add(t.name));

  // Balance map: positive = is owed money, negative = owes money
  const balance: Record<string, number> = {};
  allNames.forEach((n) => { balance[n] = 0; });

  expenses.forEach((e) => {
    const payer = e.paidBy || selfLabel;
    const participants = e.splitWith && e.splitWith.length > 0 ? e.splitWith : Array.from(allNames);
    // Always settle in the trip's base currency — baseAmountOf(e) is e's
    // amount already converted at the rate recorded when it was saved.
    const baseAmount = baseAmountOf(e);
    const share = baseAmount / participants.length;
    // Payer gets credited
    if (!(payer in balance)) balance[payer] = 0;
    balance[payer] += baseAmount;
    // Each participant gets debited their share
    participants.forEach((p) => {
      if (!(p in balance)) balance[p] = 0;
      balance[p] -= share;
    });
  });

  // Simplify debts: who pays whom
  const transactions: { from: string; to: string; amount: number }[] = [];
  const debtors = Object.entries(balance).filter(([, v]) => v < -0.01).map(([n, v]) => ({ name: n, amount: -v }));
  const creditors = Object.entries(balance).filter(([, v]) => v > 0.01).map(([n, v]) => ({ name: n, amount: v }));

  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di];
    const c = creditors[ci];
    const amount = Math.min(d.amount, c.amount);
    transactions.push({ from: d.name, to: c.name, amount });
    d.amount -= amount;
    c.amount -= amount;
    if (d.amount < 0.01) di++;
    if (c.amount < 0.01) ci++;
  }

  return { balance, transactions };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ExpensesBlock({ tripId, expenses, currency, lastExpenseCurrency, travelers = [], permissions }: ExpensesBlockProps) {
  const canEdit = permissions.canEdit;
  const t = useTranslation();
  const preferredLanguage = useAuthStore((s) => s.preferredLanguage);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const CATEGORIES = useMemo(() => getCategories(t), [t]);
  const addExpense = useTripsStore((s) => s.addExpense);
  const removeExpense = useTripsStore((s) => s.removeExpense);
  const [showModal, setShowModal] = useState(false);
  // Shows the add-traveler form IN PLACE of the expense form, inside this
  // SAME modal, instead of opening a second native Modal on top of this
  // one — stacking two RN Modals silently fails to present the second one
  // on iOS. Embedding also means description/amount/category typed so far
  // are never lost (they're untouched component state, and the modal never
  // actually closes).
  const [showAddTravelerForm, setShowAddTravelerForm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Expense['category']>('other');
  const [paidBy, setPaidBy] = useState('');
  const [splitWith, setSplitWith] = useState<string[]>([]);
  const [expenseCurrency, setExpenseCurrency] = useState(currency);
  const [rateText, setRateText] = useState('1');
  const [rateEditedManually, setRateEditedManually] = useState(false);
  const insets = useSafeAreaInsets();

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

  const selfName = t.expenses.self;
  const allParticipants = useMemo(() => {
    const names = [selfName, ...travelers.map((tr) => tr.name)];
    return Array.from(new Set(names));
  }, [travelers, selfName]);

  // Pre-select "self" as both payer and sole participant every time the
  // modal opens (including the very first time, before any expense was ever
  // added) — payer/participants must always show a selection, even on a
  // solo trip with no other travelers.
  useEffect(() => {
    if (showModal) {
      setPaidBy(selfName);
      setSplitWith([selfName]);
      setShowAddTravelerForm(false);
      setExpenseCurrency(lastExpenseCurrency || currency);
      setRateEditedManually(false);
    }
  }, [showModal, selfName, lastExpenseCurrency, currency]);

  const total = expenses.reduce((sum, e) => sum + baseAmountOf(e), 0);
  const money = (amt: number, curr: string = currency) => formatMoney(amt, curr, preferredLanguage);

  const { balance, transactions } = useMemo(
    () => computeSettlement(expenses, travelers, selfName),
    [expenses, travelers, selfName]
  );

  const toggleParticipant = (name: string) => {
    setSplitWith((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const handleAdd = async () => {
    if (!description.trim() || !amount) return;
    const parsedAmount = parseFloat(amount.replace(',', '.'));
    if (isNaN(parsedAmount)) return;
    const exchangeRate = needsRate ? parsedRate : 1;
    if (needsRate && isNaN(exchangeRate)) return; // no rate available and user hasn't entered one — can't save yet
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
    setShowModal(false);
    setDescription('');
    setAmount('');
    setCategory('other');
    setPaidBy(selfName);
    setSplitWith([]);
  };

  const displayedExpenses = showAll ? expenses : expenses.slice(0, 3);

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Ionicons name="cash-outline" size={16} color={colors.textAccent} />
          <Text style={styles.sectionTitle}>{t.expenses.title.toUpperCase()}</Text>
        </View>
        {canEdit && (
          <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addBtn}>
            <Ionicons name="add" size={14} color={colors.textAccent} />
            <Text style={styles.addBtnText}>{t.common.add}</Text>
          </TouchableOpacity>
        )}
      </View>

      {expenses.length === 0 ? (
        <Text style={styles.emptyText}>{t.expenses.empty}</Text>
      ) : (
        <>
          {/* Expense list */}
          {displayedExpenses.map((expense) => {
            const cat = CATEGORIES.find((c) => c.key === expense.category) || CATEGORIES[5];
            return (
              <View key={expense.id} style={styles.expenseRow}>
                <View style={styles.catIcon}>
                  <Ionicons name={cat.icon as any} size={14} color={colors.textAccent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.expenseDesc} numberOfLines={1}>{expense.description}</Text>
                  <Text style={styles.expenseMeta}>
                    {expense.paidBy || selfName}
                    {expense.splitWith && expense.splitWith.length > 0
                      ? ` · ${t.expenses.splitWith} ${expense.splitWith.filter((n) => n !== expense.paidBy).join(', ') || t.expenses.everyone}`
                      : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.expenseAmount}>{money(expense.amount, expense.currency)}</Text>
                  {expense.currency !== currency && (
                    <Text style={styles.expenseBaseAmount}>≈ {money(baseAmountOf(expense))}</Text>
                  )}
                </View>
                {canEdit && (
                  <TouchableOpacity onPress={() => removeExpense(tripId, expense.id)} style={{ padding: 4 }}>
                    <Ionicons name="trash-outline" size={14} color={colors.muted} />
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          {expenses.length > 3 && (
            <TouchableOpacity onPress={() => setShowAll((v) => !v)} style={styles.showMoreBtn}>
              <Text style={styles.showMoreText}>{showAll ? t.common.close : `${t.expenses.showMore} ${expenses.length - 3}`}</Text>
            </TouchableOpacity>
          )}

          {/* Total */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t.expenses.total}</Text>
            <Text style={styles.totalValue}>{money(total)}</Text>
          </View>

          {/* Settlement summary */}
          {transactions.length > 0 && (
            <View style={styles.settlementBox}>
              <Text style={styles.settlementTitle}>{t.expenses.settlement.toUpperCase()}</Text>
              {transactions.map((tx, i) => (
                <View key={i} style={styles.settlementRow}>
                  <Ionicons name="arrow-forward" size={12} color={colors.textAccent} />
                  <Text style={styles.settlementText}>
                    <Text style={{ fontWeight: '700', color: colors.foreground }}>{tx.from}</Text>
                    {` ${t.expenses.pays} `}
                    <Text style={{ fontWeight: '700', color: colors.textAccent }}>{money(tx.amount)}</Text>
                    {` ${t.expenses.to} `}
                    <Text style={{ fontWeight: '700', color: colors.foreground }}>{tx.to}</Text>
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* Add Expense Modal */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlayModal }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView style={{ backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28 }}
              contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24 }}
              keyboardShouldPersistTaps="handled"
            >
              {showAddTravelerForm ? (
                // Embedded directly in THIS already-open modal, never as a
                // second stacked Modal — two RN Modals on top of each other
                // silently fail to present the second one on iOS. Category/
                // description/amount/paidBy/splitWith below are untouched
                // component state, so nothing typed so far is lost while
                // this sub-flow is shown.
                <AddTravelerForm
                  tripId={tripId}
                  travelers={travelers}
                  onDone={() => setShowAddTravelerForm(false)}
                />
              ) : (
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <Text style={{ fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', color: colors.foreground }}>
                      {t.expenses.newExpense}
                    </Text>
                    <TouchableOpacity onPress={() => setShowModal(false)}>
                      <Ionicons name="close-circle" size={26} color={colors.foreground} />
                    </TouchableOpacity>
                  </View>

                  {/* Category */}
                  <Text style={styles.formLabel}>{t.expenses.category}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {CATEGORIES.map((c) => (
                      <TouchableOpacity
                        key={c.key}
                        onPress={() => setCategory(c.key as any)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 6,
                          paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                          backgroundColor: category === c.key ? colors.primary : colors.surface,
                        }}
                      >
                        <Ionicons name={c.icon as any} size={14} color={category === c.key ? colors.textOnPrimary : colors.foreground} />
                        <Text style={{ fontSize: 12, color: category === c.key ? colors.textOnPrimary : colors.foreground }}>{c.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Description */}
                  <Text style={styles.formLabel}>{t.expenses.description}</Text>
                  <TextInput
                    value={description}
                    onChangeText={setDescription}
                    placeholder={t.expenses.descriptionPlaceholder}
                    placeholderTextColor={colors.muted}
                    style={styles.formInput}
                  />

                  {/* Amount + currency */}
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

                  {/* Exchange rate — only shown when the expense's currency differs
                      from the trip's base currency. Prefilled from the daily rate,
                      but always editable (e.g. the traveler's actual card rate). */}
                  {needsRate && (
                    <View style={{ marginBottom: 14 }}>
                      <Text style={styles.formLabel}>
                        {t.expenses.exchangeRate} (1 {expenseCurrency} = ? {currency})
                      </Text>
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
                        <Text style={styles.rateHint}>≈ {money(baseAmountPreview)}</Text>
                      ) : null}
                    </View>
                  )}

                  {/* Paid by — always shown, even on a solo trip (self pre-selected) */}
                  <Text style={styles.formLabel}>{t.expenses.paidBy}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {allParticipants.map((name) => (
                      <TouchableOpacity
                        key={name}
                        onPress={() => setPaidBy(name)}
                        style={{
                          paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                          backgroundColor: paidBy === name ? colors.primary : colors.surface,
                        }}
                      >
                        <Text style={{ fontSize: 13, color: paidBy === name ? colors.textOnPrimary : colors.foreground, fontWeight: '600' }}>
                          {name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Split with — always shown, even on a solo trip (self pre-selected) */}
                  <Text style={styles.formLabel}>{t.expenses.splitWith} ({t.expenses.emptyMeansAll})</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                    {allParticipants.map((name) => (
                      <TouchableOpacity
                        key={name}
                        onPress={() => toggleParticipant(name)}
                        style={{
                          paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                          backgroundColor: splitWith.includes(name) ? colors.primary : colors.surface,
                          borderWidth: 1,
                          borderColor: splitWith.includes(name) ? colors.primary : 'transparent',
                        }}
                      >
                        <Text style={{ fontSize: 13, color: splitWith.includes(name) ? colors.textOnPrimary : colors.foreground, fontWeight: '600' }}>
                          {name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Add traveler — same flow/component as the Viajantes section at the bottom of the trip page, embedded inline (see showAddTravelerForm above) instead of duplicated */}
                  {permissions.canManageTravelers && (
                    <TouchableOpacity
                      onPress={() => setShowAddTravelerForm(true)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginBottom: 20 }}
                    >
                      <Ionicons name="person-add-outline" size={14} color={colors.textAccent} />
                      <Text style={{ fontSize: 13, color: colors.textAccent, fontWeight: '600' }}>
                        {t.travelers.addTraveler}
                      </Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    onPress={handleAdd}
                    activeOpacity={0.7}
                    style={{ backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}
                  >
                    <Text style={{ color: colors.textOnPrimary, fontWeight: '600', fontSize: 16 }}>{t.common.add}</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: {
    color: colors.foreground,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: withAlpha(colors.primary, 0.15),
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  addBtnText: { color: colors.textAccent, fontSize: 12, fontWeight: '600' },
  emptyText: { color: colors.muted, fontSize: 13, marginTop: 4 },
  expenseRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  catIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: withAlpha(colors.primary, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  expenseDesc: { color: colors.foreground, fontSize: 14 },
  expenseMeta: { color: colors.muted, fontSize: 11, marginTop: 1 },
  expenseAmount: { color: colors.textAccent, fontSize: 14, fontWeight: '600' },
  expenseBaseAmount: { color: colors.muted, fontSize: 11, marginTop: 1 },
  rateHint: { color: colors.muted, fontSize: 12, marginTop: -8, marginBottom: 2 },
  showMoreBtn: { alignItems: 'center', paddingVertical: 6 },
  showMoreText: { color: withAlpha(colors.primary, 0.7), fontSize: 12 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: { color: colors.muted, fontSize: 13 },
  totalValue: { color: colors.foreground, fontSize: 15, fontWeight: '700' },
  settlementBox: {
    marginTop: 12,
    backgroundColor: withAlpha(colors.primary, 0.08),
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  settlementTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 4,
  },
  settlementRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  settlementText: { fontSize: 13, color: colors.muted, flex: 1 },
  formLabel: { fontSize: 12, fontWeight: '700', color: colors.foreground, marginBottom: 6, letterSpacing: 0.5 },
  formInput: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.foreground,
    fontSize: 15,
    marginBottom: 14,
  },
});
