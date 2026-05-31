import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripsStore } from '@/store/trips';
import { generateId, getCurrencySymbol } from '@/utils/trip-helpers';
import type { Expense } from '@/types/voyage';

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
  const addExpense = useTripsStore((s) => s.addExpense);
  const removeExpense = useTripsStore((s) => s.removeExpense);
  const [showModal, setShowModal] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Expense['category']>('other');
  const [paidBy, setPaidBy] = useState('Você');
  const [splitWith, setSplitWith] = useState<string[]>([]);
  const insets = useSafeAreaInsets();

  const allParticipants = useMemo(() => {
    const names = ['Você', ...travelers.map((t) => t.name)];
    return Array.from(new Set(names));
  }, [travelers]);

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
    setPaidBy('Você');
    setSplitWith([]);
  };

  const displayedExpenses = showAll ? expenses : expenses.slice(0, 3);

  return (
    <View style={card}>
      {/* Header */}
      <View style={row}>
        <View style={rowLeft}>
          <Ionicons name="cash-outline" size={16} color="#52B788" />
          <Text style={sectionTitle}>DESPESAS</Text>
        </View>
        <TouchableOpacity onPress={() => setShowModal(true)} style={addBtn}>
          <Ionicons name="add" size={14} color="#52B788" />
          <Text style={addBtnText}>Adicionar</Text>
        </TouchableOpacity>
      </View>

      {expenses.length === 0 ? (
        <Text style={emptyText}>Nenhuma despesa registrada</Text>
      ) : (
        <>
          {/* Expense list */}
          {displayedExpenses.map((expense) => {
            const cat = CATEGORIES.find((c) => c.key === expense.category) || CATEGORIES[5];
            return (
              <View key={expense.id} style={expenseRow}>
                <View style={catIcon}>
                  <Ionicons name={cat.icon as any} size={14} color="#52B788" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={expenseDesc} numberOfLines={1}>{expense.description}</Text>
                  <Text style={expenseMeta}>
                    {expense.paidBy || 'Você'}
                    {expense.splitWith && expense.splitWith.length > 0
                      ? ` · dividido com ${expense.splitWith.filter((n) => n !== expense.paidBy).join(', ') || 'todos'}`
                      : ''}
                  </Text>
                </View>
                <Text style={expenseAmount}>{symbol}{expense.amount.toFixed(2)}</Text>
                <TouchableOpacity onPress={() => removeExpense(tripId, expense.id)} style={{ padding: 4 }}>
                  <Ionicons name="trash-outline" size={14} color="rgba(245,240,232,0.4)" />
                </TouchableOpacity>
              </View>
            );
          })}

          {expenses.length > 3 && (
            <TouchableOpacity onPress={() => setShowAll((v) => !v)} style={showMoreBtn}>
              <Text style={showMoreText}>{showAll ? 'Ver menos' : `Ver mais ${expenses.length - 3} despesas`}</Text>
            </TouchableOpacity>
          )}

          {/* Total */}
          <View style={totalRow}>
            <Text style={totalLabel}>Total</Text>
            <Text style={totalValue}>{symbol}{total.toFixed(2)}</Text>
          </View>

          {/* Settlement summary */}
          {transactions.length > 0 && (
            <View style={settlementBox}>
              <Text style={settlementTitle}>ACERTO DE CONTAS</Text>
              {transactions.map((tx, i) => (
                <View key={i} style={settlementRow}>
                  <Ionicons name="arrow-forward" size={12} color="#52B788" />
                  <Text style={settlementText}>
                    <Text style={{ fontWeight: '700', color: '#F5F0E8' }}>{tx.from}</Text>
                    {' paga '}
                    <Text style={{ fontWeight: '700', color: '#52B788' }}>{symbol}{tx.amount.toFixed(2)}</Text>
                    {' para '}
                    <Text style={{ fontWeight: '700', color: '#F5F0E8' }}>{tx.to}</Text>
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* Add Expense Modal */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView style={{ backgroundColor: '#F5F0E8', borderTopLeftRadius: 28, borderTopRightRadius: 28 }}
              contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', color: '#1C3D2E' }}>
                  Nova Despesa
                </Text>
                <TouchableOpacity onPress={() => setShowModal(false)}>
                  <Ionicons name="close-circle" size={26} color="#1C3D2E" />
                </TouchableOpacity>
              </View>

              {/* Category */}
              <Text style={formLabel}>Categoria</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    onPress={() => setCategory(c.key as any)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 6,
                      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                      backgroundColor: category === c.key ? '#1C3D2E' : '#EDE8DC',
                    }}
                  >
                    <Ionicons name={c.icon as any} size={14} color={category === c.key ? '#F5F0E8' : '#1C3D2E'} />
                    <Text style={{ fontSize: 12, color: category === c.key ? '#F5F0E8' : '#1C3D2E' }}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Description */}
              <Text style={formLabel}>Descrição</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Ex: Jantar no restaurante"
                placeholderTextColor="#9BA1A6"
                style={formInput}
              />

              {/* Amount */}
              <Text style={formLabel}>Valor ({symbol})</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0,00"
                placeholderTextColor="#9BA1A6"
                keyboardType="decimal-pad"
                style={formInput}
              />

              {/* Paid by */}
              {allParticipants.length > 1 && (
                <>
                  <Text style={formLabel}>Quem pagou?</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {allParticipants.map((name) => (
                      <TouchableOpacity
                        key={name}
                        onPress={() => setPaidBy(name)}
                        style={{
                          paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                          backgroundColor: paidBy === name ? '#1C3D2E' : '#EDE8DC',
                        }}
                      >
                        <Text style={{ fontSize: 13, color: paidBy === name ? '#F5F0E8' : '#1C3D2E', fontWeight: '600' }}>
                          {name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Split with */}
                  <Text style={formLabel}>Quem participou? (deixe vazio = todos)</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                    {allParticipants.map((name) => (
                      <TouchableOpacity
                        key={name}
                        onPress={() => toggleParticipant(name)}
                        style={{
                          paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                          backgroundColor: splitWith.includes(name) ? '#2D5A3D' : '#EDE8DC',
                          borderWidth: 1,
                          borderColor: splitWith.includes(name) ? '#52B788' : 'transparent',
                        }}
                      >
                        <Text style={{ fontSize: 13, color: splitWith.includes(name) ? '#F5F0E8' : '#1C3D2E', fontWeight: '600' }}>
                          {name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <TouchableOpacity
                onPress={handleAdd}
                style={{ backgroundColor: '#1C3D2E', borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}
              >
                <Text style={{ color: '#F5F0E8', fontWeight: '600', fontSize: 16 }}>Adicionar</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

// ─── Inline styles ────────────────────────────────────────────────────────────

const card: any = {
  backgroundColor: 'rgba(28,61,46,0.85)',
  borderRadius: 20, padding: 16, marginBottom: 12,
};
const row: any = {
  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12,
};
const rowLeft: any = { flexDirection: 'row', alignItems: 'center', gap: 8 };
const sectionTitle: any = { color: '#F5F0E8', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' };
const addBtn: any = { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(82,183,136,0.2)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 };
const addBtnText: any = { color: '#52B788', fontSize: 12, fontWeight: '600' };
const emptyText: any = { color: 'rgba(245,240,232,0.5)', fontSize: 13, marginTop: 4 };
const expenseRow: any = { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 };
const catIcon: any = { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(82,183,136,0.15)', alignItems: 'center', justifyContent: 'center' };
const expenseDesc: any = { color: '#F5F0E8', fontSize: 14 };
const expenseMeta: any = { color: 'rgba(245,240,232,0.4)', fontSize: 11, marginTop: 1 };
const expenseAmount: any = { color: '#52B788', fontSize: 14, fontWeight: '600' };
const showMoreBtn: any = { alignItems: 'center', paddingVertical: 6 };
const showMoreText: any = { color: 'rgba(82,183,136,0.7)', fontSize: 12 };
const totalRow: any = { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(245,240,232,0.1)' };
const totalLabel: any = { color: 'rgba(245,240,232,0.6)', fontSize: 13 };
const totalValue: any = { color: '#F5F0E8', fontSize: 15, fontWeight: '700' };
const settlementBox: any = { marginTop: 12, backgroundColor: 'rgba(82,183,136,0.08)', borderRadius: 12, padding: 12, gap: 8 };
const settlementTitle: any = { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: 'rgba(245,240,232,0.4)', marginBottom: 4 };
const settlementRow: any = { flexDirection: 'row', alignItems: 'center', gap: 6 };
const settlementText: any = { fontSize: 13, color: 'rgba(245,240,232,0.7)', flex: 1 };
const formLabel: any = { fontSize: 12, fontWeight: '700', color: '#1C3D2E', marginBottom: 6, letterSpacing: 0.5 };
const formInput: any = { backgroundColor: '#EDE8DC', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#1C3D2E', fontSize: 15, marginBottom: 14 };
