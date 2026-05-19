import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
  Platform,
  Animated,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTripsStore } from '@/store/trips';
import { generateId } from '@/utils/trip-helpers';
import type { Trip, Destination } from '@/types/voyage';

interface CreateTripSheetProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: (trip: Trip) => void;
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatDateDisplay(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function CreateTripSheet({ visible, onClose, onCreated }: CreateTripSheetProps) {
  const insets = useSafeAreaInsets();
  const addTrip = useTripsStore((s) => s.addTrip);

  const [startDate, setStartDate] = useState<Date | null>(null);
  const [totalDays, setTotalDays] = useState(3);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [destInput, setDestInput] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const distributedDays = destinations.reduce((sum, d) => sum + d.days, 0);
  const canCreate = startDate !== null && destinations.length > 0;

  const handleAddDestination = () => {
    if (!destInput.trim()) return;
    const newDest: Destination = {
      id: generateId(),
      name: destInput.trim(),
      country: '',
      days: Math.max(1, totalDays - distributedDays),
    };
    setDestinations([...destinations, newDest]);
    setDestInput('');
  };

  const handleUpdateDestDays = (id: string, delta: number) => {
    setDestinations(
      destinations.map((d) =>
        d.id === id ? { ...d, days: Math.max(1, d.days + delta) } : d
      )
    );
  };

  const handleRemoveDest = (id: string) => {
    setDestinations(destinations.filter((d) => d.id !== id));
  };

  const handleCreate = async () => {
    if (!startDate || destinations.length === 0) return;
    setIsCreating(true);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + totalDays - 1);

    const firstName = destinations[0].name;
    const tripName = destinations.length === 1
      ? `${totalDays} ${totalDays === 1 ? 'Dia' : 'Dias'} em ${firstName}`
      : destinations.map((d) => d.name).join(', ');

    const trip: Trip = {
      id: generateId(),
      name: tripName,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totalDays,
      destinations,
      transport: [],
      places: [],
      documents: [],
      expenses: [],
      travelers: [{ id: generateId(), name: 'Você', initials: 'V', color: '#1C3D2E' }],
      accommodations: [],
      itinerary: [],
      currency: 'BRL',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await addTrip(trip);
    setIsCreating(false);
    onCreated?.(trip);
    handleClose();
  };

  const handleClose = () => {
    setStartDate(null);
    setTotalDays(3);
    setDestinations([]);
    setDestInput('');
    onClose();
  };

  // Simple date picker using scroll/buttons for cross-platform
  const today = new Date();
  const [pickerDate, setPickerDate] = useState(today);

  const handleDateConfirm = () => {
    setStartDate(pickerDate);
    setShowDatePicker(false);
  };

  const adjustPickerDate = (delta: number) => {
    const d = new Date(pickerDate);
    d.setDate(d.getDate() + delta);
    if (d >= today) setPickerDate(d);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View
            className="bg-background rounded-t-3xl"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            {/* Handle */}
            <View className="items-center pt-3 pb-1">
              <View className="w-10 h-1 rounded-full bg-border" />
            </View>

            <ScrollView
              className="px-6 pt-4"
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Header */}
              <View className="flex-row items-center justify-between mb-6">
                <Text style={{ fontFamily: 'serif', fontSize: 26, color: '#1C3D2E', fontStyle: 'italic' }}>
                  Criar Roteiro
                </Text>
                <TouchableOpacity
                  onPress={handleClose}
                  className="w-8 h-8 rounded-full bg-surface items-center justify-center"
                >
                  <Ionicons name="close" size={16} color="#1C3D2E" />
                </TouchableOpacity>
              </View>

              {/* Start Date + Days */}
              <Text className="text-xs font-semibold text-muted mb-2 tracking-widest uppercase">
                Início da Viagem
              </Text>
              <View className="flex-row gap-3 mb-5">
                {/* Date picker button */}
                <TouchableOpacity
                  onPress={() => setShowDatePicker(true)}
                  className="flex-1 flex-row items-center gap-2 bg-surface rounded-2xl px-4 py-3.5"
                >
                  <Ionicons name="calendar-outline" size={18} color="#3D5A47" />
                  <Text className={startDate ? 'text-foreground font-medium' : 'text-muted'}>
                    {startDate ? formatDateDisplay(startDate) : 'Selecione a data'}
                  </Text>
                </TouchableOpacity>

                {/* Days stepper */}
                <View className="flex-row items-center gap-2 bg-surface rounded-2xl px-3 py-3">
                  <TouchableOpacity
                    onPress={() => setTotalDays(Math.max(1, totalDays - 1))}
                    className="w-7 h-7 rounded-full bg-background items-center justify-center"
                  >
                    <Ionicons name="remove" size={14} color="#1C3D2E" />
                  </TouchableOpacity>
                  <View className="items-center w-10">
                    <Text className="text-foreground font-bold text-lg">{totalDays}</Text>
                    <Text className="text-muted text-xs">DIAS</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setTotalDays(totalDays + 1)}
                    className="w-7 h-7 rounded-full bg-background items-center justify-center"
                  >
                    <Ionicons name="add" size={14} color="#1C3D2E" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Destinations */}
              <Text className="text-xs font-semibold text-muted mb-2 tracking-widest uppercase">
                Destinos
              </Text>

              {destinations.length > 0 && (
                <View className="bg-surface rounded-2xl mb-3 overflow-hidden">
                  {destinations.map((dest, idx) => (
                    <View key={dest.id}>
                      <View className="flex-row items-center px-4 py-3">
                        <View className="w-1 h-4 rounded-full bg-accent mr-3" />
                        <View className="flex-1">
                          <Text className="text-foreground font-medium">{dest.name}</Text>
                          {dest.country ? (
                            <Text className="text-muted text-xs">{dest.country}</Text>
                          ) : null}
                        </View>
                        <View className="flex-row items-center gap-2">
                          <TouchableOpacity
                            onPress={() => handleUpdateDestDays(dest.id, -1)}
                            className="w-6 h-6 rounded-full bg-background items-center justify-center"
                          >
                            <Ionicons name="remove" size={12} color="#1C3D2E" />
                          </TouchableOpacity>
                          <Text className="text-foreground font-semibold w-4 text-center">{dest.days}</Text>
                          <Text className="text-muted text-xs">dias</Text>
                          <TouchableOpacity
                            onPress={() => handleUpdateDestDays(dest.id, 1)}
                            className="w-6 h-6 rounded-full bg-background items-center justify-center"
                          >
                            <Ionicons name="add" size={12} color="#1C3D2E" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleRemoveDest(dest.id)}
                            className="w-6 h-6 rounded-full bg-background items-center justify-center ml-1"
                          >
                            <Ionicons name="close" size={12} color="#C0392B" />
                          </TouchableOpacity>
                        </View>
                      </View>
                      {idx < destinations.length - 1 && (
                        <View className="h-px bg-border mx-4" />
                      )}
                    </View>
                  ))}
                  {/* Days distributed */}
                  <View className="flex-row justify-between items-center px-4 py-2 border-t border-border">
                    <Text className="text-muted text-xs">Dias distribuídos</Text>
                    <Text className={`text-xs font-semibold ${distributedDays > totalDays ? 'text-error' : 'text-accent'}`}>
                      {distributedDays}/{totalDays}
                    </Text>
                  </View>
                </View>
              )}

              {/* Add destination input */}
              <View className="flex-row items-center bg-surface rounded-2xl px-4 py-3.5 mb-6">
                <Ionicons name="location-outline" size={18} color="#6B7C72" />
                <TextInput
                  value={destInput}
                  onChangeText={setDestInput}
                  placeholder="Adicionar destino"
                  placeholderTextColor="#6B7C72"
                  className="flex-1 ml-2 text-foreground"
                  onSubmitEditing={handleAddDestination}
                  returnKeyType="done"
                />
                {destInput.length > 0 && (
                  <TouchableOpacity onPress={handleAddDestination}>
                    <Ionicons name="add-circle" size={22} color="#1C3D2E" />
                  </TouchableOpacity>
                )}
              </View>

              {/* AI Button */}
              <TouchableOpacity className="flex-row items-center justify-center gap-2 bg-surface rounded-2xl py-4 mb-3">
                <Ionicons name="sparkles" size={18} color="#3D5A47" />
                <Text className="text-foreground font-medium">Criar com IA</Text>
              </TouchableOpacity>

              {/* Create / Disabled button */}
              <TouchableOpacity
                onPress={canCreate ? handleCreate : undefined}
                disabled={!canCreate || isCreating}
                className={`rounded-2xl py-4 items-center mb-2 ${canCreate ? 'bg-primary' : 'bg-surface'}`}
              >
                <Text className={`font-semibold text-base ${canCreate ? 'text-background' : 'text-muted'}`}>
                  {!startDate
                    ? 'Selecione a data de início'
                    : !canCreate
                    ? 'Adicione um destino'
                    : isCreating
                    ? 'Criando...'
                    : 'Criar Roteiro'}
                </Text>
              </TouchableOpacity>

              <View className="h-4" />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>

      {/* Date Picker Modal */}
      <Modal visible={showDatePicker} transparent animationType="fade">
        <View className="flex-1 justify-center items-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View className="bg-background rounded-3xl p-6 mx-8 w-80">
            <Text style={{ fontFamily: 'serif', fontSize: 20, color: '#1C3D2E', fontStyle: 'italic', marginBottom: 20 }}>
              Selecionar Data
            </Text>
            <View className="flex-row items-center justify-between mb-6">
              <TouchableOpacity
                onPress={() => adjustPickerDate(-1)}
                className="w-10 h-10 rounded-full bg-surface items-center justify-center"
              >
                <Ionicons name="chevron-back" size={20} color="#1C3D2E" />
              </TouchableOpacity>
              <View className="items-center">
                <Text className="text-foreground font-bold text-2xl">{pickerDate.getDate()}</Text>
                <Text className="text-muted text-sm">{MONTHS[pickerDate.getMonth()]} {pickerDate.getFullYear()}</Text>
              </View>
              <TouchableOpacity
                onPress={() => adjustPickerDate(1)}
                className="w-10 h-10 rounded-full bg-surface items-center justify-center"
              >
                <Ionicons name="chevron-forward" size={20} color="#1C3D2E" />
              </TouchableOpacity>
            </View>
            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => setShowDatePicker(false)}
                className="flex-1 bg-surface rounded-2xl py-3 items-center"
              >
                <Text className="text-foreground font-medium">Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDateConfirm}
                className="flex-1 bg-primary rounded-2xl py-3 items-center"
              >
                <Text className="text-background font-semibold">Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}
