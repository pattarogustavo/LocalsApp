import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTripsStore } from '@/store/trips';
import { useAuthStore } from '@/store/auth';
import { formatMoney } from '@/utils/trip-helpers';
import type { Expense, Traveler } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';
import type { Translations } from '@/i18n';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import type { TripPermissions } from '@/hooks/use-trip-permissions';

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

export function ExpensesBlock({ tripId, expenses, currency, travelers = [], permissions }: ExpensesBlockProps) {
  const canEdit = permissions.canEdit;
  const t = useTranslation();
  const preferredLanguage = useAuthStore((s) => s.preferredLanguage);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const CATEGORIES = useMemo(() => getCategories(t), [t]);
  const removeExpense = useTripsStore((s) => s.removeExpense);
  const [showAll, setShowAll] = useState(false);

  const selfName = t.expenses.self;

  const total = expenses.reduce((sum, e) => sum + baseAmountOf(e), 0);
  const money = (amt: number, curr: string = currency) => formatMoney(amt, curr, preferredLanguage);

  const { transactions } = useMemo(
    () => computeSettlement(expenses, travelers, selfName),
    [expenses, travelers, selfName]
  );

  const displayedExpenses = showAll ? expenses : expenses.slice(0, 3);
  const openNewExpense = () => router.push({ pathname: '/trip/[id]/new-expense', params: { id: tripId, tripId } });

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Ionicons name="cash-outline" size={16} color={colors.textAccent} />
          <Text style={styles.sectionTitle}>{t.expenses.title.toUpperCase()}</Text>
        </View>
        {canEdit && (
          <TouchableOpacity onPress={openNewExpense} style={styles.addBtn}>
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
