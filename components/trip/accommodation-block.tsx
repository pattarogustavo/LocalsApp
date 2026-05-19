import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { useTripsStore } from '@/store/trips';
import { generateId } from '@/utils/trip-helpers';
import type { Trip, Accommodation, AccommodationType, Destination } from '@/types/voyage';

interface AccommodationBlockProps {
  trip: Trip;
}

const TYPE_OPTIONS: { id: AccommodationType; label: string; icon: string }[] = [
  { id: 'hotel', label: 'Hotel', icon: '🏨' },
  { id: 'house', label: 'Casa / Apartamento', icon: '🏠' },
  { id: 'hostel', label: 'Hostel', icon: '🛏️' },
  { id: 'airbnb', label: 'Airbnb', icon: '🔑' },
  { id: 'other', label: 'Outro', icon: '📍' },
];

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function nightsBetween(checkIn: string, checkOut: string) {
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)));
}

interface AddAccommodationModalProps {
  visible: boolean;
  onClose: () => void;
  destination: Destination;
  tripId: string;
  tripStartDate: string;
}

function AddAccommodationModal({
  visible,
  onClose,
  destination,
  tripId,
  tripStartDate,
}: AddAccommodationModalProps) {
  const colors = useColors();
  const { addAccommodation } = useTripsStore();

  const [name, setName] = useState('');
  const [type, setType] = useState<AccommodationType>('hotel');
  const [address, setAddress] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [website, setWebsite] = useState('');
  const [notes, setNotes] = useState('');

  // Simple date pickers
  const [checkIn, setCheckIn] = useState(tripStartDate);
  const [checkOut, setCheckOut] = useState(() => {
    const d = new Date(tripStartDate);
    d.setDate(d.getDate() + destination.days);
    return d.toISOString();
  });

  const handleSave = async () => {
    if (!name.trim()) return;
    const acc: Accommodation = {
      id: generateId(),
      destinationId: destination.id,
      name: name.trim(),
      type,
      address: address.trim() || undefined,
      checkIn,
      checkOut,
      confirmationCode: confirmationCode.trim() || undefined,
      website: website.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    await addAccommodation(tripId, acc);
    handleClose();
  };

  const handleClose = () => {
    setName('');
    setType('hotel');
    setAddress('');
    setConfirmationCode('');
    setWebsite('');
    setNotes('');
    onClose();
  };

  const adjustDate = (current: string, delta: number, setter: (v: string) => void) => {
    const d = new Date(current);
    d.setDate(d.getDate() + delta);
    setter(d.toISOString());
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.addSheet, { backgroundColor: colors.background }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={styles.addHeader}>
            <Text style={[styles.addTitle, { color: '#1C3D2E' }]}>
              Hospedagem em {destination.name}
            </Text>
            <Pressable onPress={handleClose} style={[styles.closeBtn, { backgroundColor: colors.surface }]}>
              <Ionicons name="close" size={16} color="#1C3D2E" />
            </Pressable>
          </View>

          <ScrollView
            style={styles.addScroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Type */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>TIPO</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeRow}>
              {TYPE_OPTIONS.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => setType(t.id)}
                  style={({ pressed }) => [
                    styles.typeChip,
                    {
                      backgroundColor: type === t.id ? '#2D5A3D' : colors.surface,
                      borderColor: type === t.id ? '#2D5A3D' : colors.border,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Text style={styles.typeChipEmoji}>{t.icon}</Text>
                  <Text style={[styles.typeChipLabel, { color: type === t.id ? '#fff' : colors.foreground }]}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Name */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>NOME DO LOCAL *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
              placeholder="Ex: Hotel Marriott, Casa da Ana..."
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
            />

            {/* Check-in / Check-out */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>CHECK-IN / CHECK-OUT</Text>
            <View style={styles.dateRow}>
              <View style={[styles.datePicker, { backgroundColor: colors.surface }]}>
                <Text style={[styles.datePickerLabel, { color: colors.muted }]}>Check-in</Text>
                <View style={styles.datePickerRow}>
                  <Pressable onPress={() => adjustDate(checkIn, -1, setCheckIn)}>
                    <Ionicons name="chevron-back" size={18} color="#2D5A3D" />
                  </Pressable>
                  <Text style={[styles.datePickerValue, { color: colors.foreground }]}>
                    {formatDate(checkIn)}
                  </Text>
                  <Pressable onPress={() => adjustDate(checkIn, 1, setCheckIn)}>
                    <Ionicons name="chevron-forward" size={18} color="#2D5A3D" />
                  </Pressable>
                </View>
              </View>

              <View style={[styles.nightsBadge, { backgroundColor: '#2D5A3D' }]}>
                <Text style={styles.nightsNum}>{nightsBetween(checkIn, checkOut)}</Text>
                <Text style={styles.nightsLabel}>noites</Text>
              </View>

              <View style={[styles.datePicker, { backgroundColor: colors.surface }]}>
                <Text style={[styles.datePickerLabel, { color: colors.muted }]}>Check-out</Text>
                <View style={styles.datePickerRow}>
                  <Pressable onPress={() => adjustDate(checkOut, -1, setCheckOut)}>
                    <Ionicons name="chevron-back" size={18} color="#2D5A3D" />
                  </Pressable>
                  <Text style={[styles.datePickerValue, { color: colors.foreground }]}>
                    {formatDate(checkOut)}
                  </Text>
                  <Pressable onPress={() => adjustDate(checkOut, 1, setCheckOut)}>
                    <Ionicons name="chevron-forward" size={18} color="#2D5A3D" />
                  </Pressable>
                </View>
              </View>
            </View>

            {/* Address */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>ENDEREÇO</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
              placeholder="Endereço completo"
              placeholderTextColor={colors.muted}
              value={address}
              onChangeText={setAddress}
            />

            {/* Confirmation code */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>CÓDIGO DE RESERVA</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
              placeholder="Ex: ABC123"
              placeholderTextColor={colors.muted}
              value={confirmationCode}
              onChangeText={setConfirmationCode}
              autoCapitalize="characters"
            />

            {/* Website */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>SITE / LINK</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
              placeholder="https://..."
              placeholderTextColor={colors.muted}
              value={website}
              onChangeText={setWebsite}
              keyboardType="url"
              autoCapitalize="none"
            />

            {/* Notes */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>OBSERVAÇÕES</Text>
            <TextInput
              style={[styles.input, styles.textArea, { backgroundColor: colors.surface, color: colors.foreground }]}
              placeholder="Informações adicionais..."
              placeholderTextColor={colors.muted}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />

            <TouchableOpacity
              onPress={handleSave}
              disabled={!name.trim()}
              style={[styles.saveBtn, { backgroundColor: name.trim() ? '#1C3D2E' : colors.border }]}
            >
              <Text style={[styles.saveBtnText, { color: name.trim() ? '#fff' : colors.muted }]}>
                Salvar Hospedagem
              </Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function AccommodationBlock({ trip }: AccommodationBlockProps) {
  const colors = useColors();
  const { removeAccommodation } = useTripsStore();
  const [addingForDest, setAddingForDest] = useState<Destination | null>(null);

  return (
    <View style={[styles.container, { backgroundColor: '#1A3A2A' }]}>
      <View style={styles.blockHeader}>
        <View style={styles.blockTitleRow}>
          <Ionicons name="bed-outline" size={16} color="#A8D5B5" />
          <Text style={styles.blockTitle}>HOSPEDAGEM</Text>
        </View>
      </View>

      {trip.destinations.map((dest) => {
        const destAccommodations = trip.accommodations.filter((a) => a.destinationId === dest.id);
        return (
          <View key={dest.id} style={styles.destSection}>
            <View style={styles.destHeaderRow}>
              <Text style={styles.destName}>{dest.name}</Text>
              <Text style={styles.destDays}>{dest.days} dia{dest.days !== 1 ? 's' : ''}</Text>
            </View>

            {destAccommodations.length === 0 ? (
              <Text style={styles.noAccText}>Nenhuma hospedagem adicionada</Text>
            ) : (
              destAccommodations.map((acc) => {
                const typeInfo = TYPE_OPTIONS.find((t) => t.id === acc.type);
                const nights = nightsBetween(acc.checkIn, acc.checkOut);
                return (
                  <View key={acc.id} style={styles.accCard}>
                    <View style={styles.accCardHeader}>
                      <Text style={styles.accTypeEmoji}>{typeInfo?.icon || '🏨'}</Text>
                      <View style={styles.accInfo}>
                        <Text style={styles.accName}>{acc.name}</Text>
                        <Text style={styles.accDates}>
                          {formatDate(acc.checkIn)} → {formatDate(acc.checkOut)} · {nights} noite{nights !== 1 ? 's' : ''}
                        </Text>
                        {acc.confirmationCode && (
                          <Text style={styles.accCode}>Reserva: {acc.confirmationCode}</Text>
                        )}
                      </View>
                      <Pressable
                        onPress={() => removeAccommodation(trip.id, acc.id)}
                        style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.7 : 1 }]}
                      >
                        <Ionicons name="trash-outline" size={14} color="#E74C3C" />
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}

            <Pressable
              onPress={() => setAddingForDest(dest)}
              style={({ pressed }) => [styles.addAccBtn, { opacity: pressed ? 0.8 : 1 }]}
            >
              <Ionicons name="add" size={14} color="#A8D5B5" />
              <Text style={styles.addAccBtnText}>Adicionar hospedagem</Text>
            </Pressable>
          </View>
        );
      })}

      {addingForDest && (
        <AddAccommodationModal
          visible={true}
          onClose={() => setAddingForDest(null)}
          destination={addingForDest}
          tripId={trip.id}
          tripStartDate={trip.startDate}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  blockHeader: {
    marginBottom: 12,
  },
  blockTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  blockTitle: {
    color: '#A8D5B5',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  destSection: {
    marginBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingTop: 12,
  },
  destHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  destName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  destDays: {
    color: '#A8D5B5',
    fontSize: 12,
  },
  noAccText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    marginBottom: 8,
  },
  accCard: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  accCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  accTypeEmoji: {
    fontSize: 20,
    marginTop: 2,
  },
  accInfo: {
    flex: 1,
    gap: 2,
  },
  accName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  accDates: {
    color: '#A8D5B5',
    fontSize: 12,
  },
  accCode: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
  },
  removeBtn: {
    padding: 4,
  },
  addAccBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  addAccBtnText: {
    color: '#A8D5B5',
    fontSize: 13,
    fontWeight: '500',
  },
  // Modal styles
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  addSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    maxHeight: '90%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  addHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  addTitle: {
    fontSize: 20,
    fontStyle: 'italic',
    fontFamily: 'serif',
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addScroll: {
    paddingHorizontal: 24,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 16,
  },
  typeRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  typeChipEmoji: {
    fontSize: 14,
  },
  typeChipLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  datePicker: {
    flex: 1,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  datePickerLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  datePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  datePickerValue: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 48,
    textAlign: 'center',
  },
  nightsBadge: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  nightsNum: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  nightsLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
  },
  saveBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
