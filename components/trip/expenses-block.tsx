import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripsStore } from '@/store/trips';
import { generateId, getCurrencySymbol } from '@/utils/trip-helpers';
import type { Expense } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

interface Traveler {
  id: string;
  name: string;
  initials: string;
  color: string;
}

interface ExpensesBlockProps {
  tripId: string;
  expenses: Expense[];
  currency: string;
  travelers?: Traveler[];
}

const CATEGORIES = [
  { key: 'food', label: 'Alimentação', icon: 'restaurant' },
  { key: 'transport', label: 'Transporte', icon: 'car' },
  { key: 'accommodation', label: 'Hospedagem', icon: 'bed' },
  { key: 'activity', label: 'Atividade', icon: 'ticket' },
  { key: 'shopping', label: 'Compras', icon: 'bag' },
  { key: 'other', label: 'Outro', icon: 'ellipsis-horizontal' },
];

// ─── Settlement Calculator ────────────────────────────────────────────────────

function computeSettlement(expenses: Expense[], travelers: Traveler[]) {
  // Build list of all participant names (including "Você" as the implicit self)
  const allNames = new Set<string>(['Você']);
  travelers.forEach((t) => allNames.add(t.name));

  // Balance map: positive = is owed money, negative = owes money
  const balance: Record<string, number> = {};
  allNames.forEach((n) => { balance[n] = 0; });

  expenses.forEach((e) => {
    const payer = e.paidBy || 'Você';
    const participants = e.splitWith && e.splitWith.length > 0 ? e.splitWith : Array.from(allNames);
    const share = e.amount / participants.length;
    // Payer gets credited
    if (!(payer in balance)) balance[payer] = 0;
    balance[payer] += e.amount;
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

export function ExpensesBlock({ tripId, expenses, currency, travelers = [] }: ExpensesBlockProps) {
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const addExpense = useTripsStore((s) => s.addExpense);
  const removeExpense = useTripsStore((s) => s.removeExpense);
  const [showModal, setShowModal] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Expense['category']>('other');
  const [paidBy, setPaidBy] = useState('');  // will be set in useMemo below
  const [splitWith, setSplitWith] = useState<string[]>([]);
  const insets = useSafeAreaInsets();

  const selfName = t.expenses.self;
  const allParticipants = useMemo(() => {
    const names = [selfName, ...travelers.map((tr) => tr.name)];
    return Array.from(new Set(names));
  }, [travelers, selfName]);

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const symbol = getCurrencySymbol(currency);

  const { balance, transactions } = useMemo(
    () => computeSettlement(expenses, travelers),
    [expenses, travelers]
  );

  const toggleParticipant = (name: string) => {
    setSplitWith((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const handleAdd = async () => {
    if (!description.trim() || !amount) return;
    const expense: Expense = {
      id: generateId(),
      description: description.trim(),
      amount: parseFloat(amount),
      currency,
      category,
      date: new Date().toISOString(),
      paidBy,
      splitWith: splitWith.length > 0 ? splitWith : allParticipants,
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
        <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addBtn}>
          <Ionicons name="add" size={14} color={colors.textAccent} />
          <Text style={styles.addBtnText}>{t.common.add}</Text>
        </TouchableOpacity>
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
                <Text style={styles.expenseAmount}>{symbol}{expense.amount.toFixed(2)}</Text>
                <TouchableOpacity onPress={() => removeExpense(tripId, expense.id)} style={{ padding: 4 }}>
                  <Ionicons name="trash-outline" size={14} color={colors.muted} />
                </TouchableOpacity>
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
            <Text style={styles.totalValue}>{symbol}{total.toFixed(2)}</Text>
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
                    <Text style={{ fontWeight: '700', color: colors.textAccent }}>{symbol}{tx.amount.toFixed(2)}</Text>
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

              {/* Amount */}
              <Text style={styles.formLabel}>{t.expenses.amount} ({symbol})</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0,00"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                style={styles.formInput}
              />

              {/* Paid by */}
              {allParticipants.length > 1 && (
                <>
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

                  {/* Split with */}
                  <Text style={styles.formLabel}>{t.expenses.splitWith} ({t.expenses.emptyMeansAll})</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
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
                </>
              )}

              <TouchableOpacity
                onPress={handleAdd}
                style={{ backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}
              >
                <Text style={{ color: colors.textOnPrimary, fontWeight: '600', fontSize: 16 }}>{t.common.add}</Text>
              </TouchableOpacity>
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
