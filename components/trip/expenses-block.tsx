import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripsStore } from '@/store/trips';
import { generateId, getCurrencySymbol } from '@/utils/trip-helpers';
import type { Expense } from '@/types/voyage';

interface ExpensesBlockProps {
  tripId: string;
  expenses: Expense[];
  currency: string;
}

const CATEGORIES = [
  { key: 'food', label: 'Alimentação', icon: 'restaurant' },
  { key: 'transport', label: 'Transporte', icon: 'car' },
  { key: 'accommodation', label: 'Hospedagem', icon: 'bed' },
  { key: 'activity', label: 'Atividade', icon: 'ticket' },
  { key: 'shopping', label: 'Compras', icon: 'bag' },
  { key: 'other', label: 'Outro', icon: 'ellipsis-horizontal' },
];

export function ExpensesBlock({ tripId, expenses, currency }: ExpensesBlockProps) {
  const addExpense = useTripsStore((s) => s.addExpense);
  const removeExpense = useTripsStore((s) => s.removeExpense);
  const [showModal, setShowModal] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Expense['category']>('other');
  const insets = useSafeAreaInsets();

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const symbol = getCurrencySymbol(currency);

  const handleAdd = async () => {
    if (!description.trim() || !amount) return;
    const expense: Expense = {
      id: generateId(),
      description: description.trim(),
      amount: parseFloat(amount),
      currency,
      category,
      date: new Date().toISOString(),
      paidBy: 'Você',
    };
    await addExpense(tripId, expense);
    setShowModal(false);
    setDescription('');
    setAmount('');
    setCategory('other');
  };

  return (
    <View
      style={{
        backgroundColor: 'rgba(28,61,46,0.85)',
        borderRadius: 20,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: expenses.length > 0 ? 12 : 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="cash-outline" size={16} color="#52B788" />
          <Text style={{ color: '#F5F0E8', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>
            Despesas
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowModal(true)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            backgroundColor: 'rgba(82,183,136,0.2)',
            borderRadius: 20,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}
        >
          <Ionicons name="add" size={14} color="#52B788" />
          <Text style={{ color: '#52B788', fontSize: 12, fontWeight: '600' }}>Adicionar</Text>
        </TouchableOpacity>
      </View>

      {expenses.length === 0 ? (
        <Text style={{ color: 'rgba(245,240,232,0.5)', fontSize: 13, marginTop: 4 }}>
          Nenhuma despesa registrada
        </Text>
      ) : (
        <>
          {expenses.slice(0, 3).map((expense) => {
            const cat = CATEGORIES.find((c) => c.key === expense.category) || CATEGORIES[5];
            return (
              <View
                key={expense.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}
              >
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(82,183,136,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={cat.icon as any} size={14} color="#52B788" />
                </View>
                <Text style={{ color: '#F5F0E8', fontSize: 14, flex: 1 }}>{expense.description}</Text>
                <Text style={{ color: '#52B788', fontSize: 14, fontWeight: '600' }}>
                  {symbol}{expense.amount.toFixed(2)}
                </Text>
                <TouchableOpacity onPress={() => removeExpense(tripId, expense.id)}>
                  <Ionicons name="trash-outline" size={14} color="rgba(245,240,232,0.4)" />
                </TouchableOpacity>
              </View>
            );
          })}
          {expenses.length > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(245,240,232,0.1)' }}>
              <Text style={{ color: 'rgba(245,240,232,0.6)', fontSize: 13 }}>Total</Text>
              <Text style={{ color: '#F5F0E8', fontSize: 15, fontWeight: '700' }}>
                {symbol}{total.toFixed(2)}
              </Text>
            </View>
          )}
        </>
      )}

      {/* Add Expense Modal */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View
              style={{
                backgroundColor: '#F5F0E8',
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                padding: 24,
                paddingBottom: insets.bottom + 24,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', color: '#1C3D2E' }}>
                  Nova Despesa
                </Text>
                <TouchableOpacity onPress={() => setShowModal(false)}>
                  <Ionicons name="close-circle" size={26} color="#1C3D2E" />
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    onPress={() => setCategory(c.key as any)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 20,
                      backgroundColor: category === c.key ? '#1C3D2E' : '#EDE8DC',
                    }}
                  >
                    <Ionicons name={c.icon as any} size={14} color={category === c.key ? '#F5F0E8' : '#1C3D2E'} />
                    <Text style={{ fontSize: 12, color: category === c.key ? '#F5F0E8' : '#1C3D2E' }}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Descrição"
                placeholderTextColor="#9BA1A6"
                style={{ backgroundColor: '#EDE8DC', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#1C3D2E', fontSize: 15, marginBottom: 10 }}
              />
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder={`Valor (${symbol})`}
                placeholderTextColor="#9BA1A6"
                keyboardType="decimal-pad"
                style={{ backgroundColor: '#EDE8DC', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#1C3D2E', fontSize: 15, marginBottom: 16 }}
              />

              <TouchableOpacity
                onPress={handleAdd}
                style={{ backgroundColor: '#1C3D2E', borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}
              >
                <Text style={{ color: '#F5F0E8', fontWeight: '600', fontSize: 16 }}>Adicionar</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}
