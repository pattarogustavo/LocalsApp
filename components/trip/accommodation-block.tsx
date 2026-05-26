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
import { PlacesAutocompleteInput, type PlaceResult } from '@/components/ui/places-autocomplete-input';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { DocAttachField } from '@/components/ui/doc-attach-field';
import { trpc } from '@/lib/trpc';

// ─── Types ────────────────────────────────────────────────────────────────────

const TYPE_OPTIONS: { id: AccommodationType; label: string; icon: string }[] = [
  { id: 'hotel', label: 'Hotel', icon: '🏨' },
  { id: 'house', label: 'Casa / Apartamento', icon: '🏠' },
  { id: 'other', label: 'Outro', icon: '📍' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Modal ────────────────────────────────────────────────────────────────────

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

  const [type, setType] = useState<AccommodationType>('hotel');
  const [checkIn, setCheckIn] = useState<Date>(new Date(tripStartDate));
  const [checkOut, setCheckOut] = useState<Date>(() => {
    const d = new Date(tripStartDate);
    d.setDate(d.getDate() + destination.days);
    return d;
  });

  // Hotel / Other fields
  const [hotelPlace, setHotelPlace] = useState<PlaceResult | null>(null);
  const [hotelName, setHotelName] = useState('');
  const [hotelAddress, setHotelAddress] = useState('');
  const [hotelPlaceId, setHotelPlaceId] = useState('');

  // House/Apt fields
  const [houseAddressPlace, setHouseAddressPlace] = useState<PlaceResult | null>(null);
  const [houseAddress, setHouseAddress] = useState('');

  // Other name (free text)
  const [otherName, setOtherName] = useState('');

  // Common fields
  const [confirmationCode, setConfirmationCode] = useState('');
  const [confirmationDocUri, setConfirmationDocUri] = useState<string | null>(null);

  // Fetch hotel details (address) when a hotel place is selected
  const detailsQuery = trpc.places.details.useQuery(
    { placeId: hotelPlaceId },
    { enabled: hotelPlaceId.length > 0 }
  );

  React.useEffect(() => {
    if (detailsQuery.data?.address) {
      setHotelAddress(detailsQuery.data.address);
    }
  }, [detailsQuery.data]);

  const isHouse = type === 'house';
  const isHotelOrOther = type === 'hotel' || type === 'other';

  const canSave = isHouse
    ? houseAddress.trim().length > 0
    : (hotelName.trim().length > 0 || otherName.trim().length > 0);

  const handleSave = async () => {
    if (!canSave) return;

    const acc: Accommodation = {
      id: generateId(),
      destinationId: destination.id,
      name: isHouse ? houseAddress.trim() : (type === 'other' ? otherName.trim() : hotelName.trim()),
      type,
      address: isHouse ? houseAddress.trim() : hotelAddress.trim() || undefined,
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
      confirmationCode: confirmationCode.trim() || undefined,
      confirmationDocUri: confirmationDocUri || undefined,
    };
    await addAccommodation(tripId, acc);
    handleClose();
  };

  const handleClose = () => {
    setType('hotel');
    setHotelPlace(null); setHotelName(''); setHotelAddress(''); setHotelPlaceId('');
    setHouseAddressPlace(null); setHouseAddress('');
    setOtherName('');
    setConfirmationCode(''); setConfirmationDocUri(null);
    onClose();
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
            {/* 1. Type */}
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

            {/* 2. Check-in / Check-out */}
            <View style={styles.dateRow}>
              <View style={{ flex: 1 }}>
                <DatePickerField
                  label="CHECK-IN"
                  value={checkIn}
                  onChange={(d) => {
                    setCheckIn(d);
                    if (d >= checkOut) {
                      const next = new Date(d);
                      next.setDate(next.getDate() + 1);
                      setCheckOut(next);
                    }
                  }}
                />
              </View>
              <View style={[styles.nightsBadge, { backgroundColor: '#2D5A3D' }]}>
                <Text style={styles.nightsNum}>
                  {nightsBetween(checkIn.toISOString(), checkOut.toISOString())}
                </Text>
                <Text style={styles.nightsLabel}>noites</Text>
              </View>
              <View style={{ flex: 1 }}>
                <DatePickerField
                  label="CHECK-OUT"
                  value={checkOut}
                  onChange={(d) => {
                    if (d > checkIn) setCheckOut(d);
                  }}
                />
              </View>
            </View>

            {/* 3a. Hotel / Other: name via Google Places */}
            {isHotelOrOther && type === 'hotel' && (
              <View style={{ marginBottom: 14 }}>
                <Text style={[styles.fieldLabel, { color: colors.muted }]}>NOME DO HOTEL *</Text>
                <PlacesAutocompleteInput
                  placeholder="Buscar hotel..."
                  value={hotelPlace?.name || ''}
                  onSelect={(p) => {
                    setHotelPlace(p);
                    setHotelName(p.name);
                    setHotelPlaceId(p.placeId);
                  }}
                  searchTypes="establishment"
                />
              </View>
            )}

            {/* 3b. Other type: free text name */}
            {type === 'other' && (
              <View style={{ marginBottom: 14 }}>
                <Text style={[styles.fieldLabel, { color: colors.muted }]}>NOME DO LOCAL *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
                  placeholder="Ex: Pousada, Glamping, Resort..."
                  placeholderTextColor={colors.muted}
                  value={otherName}
                  onChangeText={setOtherName}
                />
              </View>
            )}

            {/* 3c. Hotel: address auto-filled from Google, editable */}
            {type === 'hotel' && (
              <View style={{ marginBottom: 14 }}>
                <Text style={[styles.fieldLabel, { color: colors.muted }]}>ENDEREÇO</Text>
                {detailsQuery.isFetching ? (
                  <View style={[styles.input, { backgroundColor: colors.surface, justifyContent: 'center' }]}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Buscando endereço...</Text>
                  </View>
                ) : (
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
                    placeholder="Endereço preenchido automaticamente"
                    placeholderTextColor={colors.muted}
                    value={hotelAddress}
                    onChangeText={setHotelAddress}
                  />
                )}
              </View>
            )}

            {/* 3d. House/Apt: only address via Google Places */}
            {isHouse && (
              <View style={{ marginBottom: 14 }}>
                <Text style={[styles.fieldLabel, { color: colors.muted }]}>ENDEREÇO *</Text>
                <PlacesAutocompleteInput
                  placeholder="Buscar endereço..."
                  value={houseAddressPlace?.fullDescription || ''}
                  onSelect={(p) => {
                    setHouseAddressPlace(p);
                    setHouseAddress(p.fullDescription);
                  }}
                  searchTypes="address"
                />
              </View>
            )}

            {/* 4. Confirmation code */}
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>CÓDIGO DE RESERVA</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
              placeholder="Ex: ABC123"
              placeholderTextColor={colors.muted}
              value={confirmationCode}
              onChangeText={setConfirmationCode}
              autoCapitalize="characters"
            />

            {/* 5. Confirmation document */}
            <DocAttachField
              label="CONFIRMAÇÃO DA RESERVA (OPCIONAL)"
              uri={confirmationDocUri}
              onPick={setConfirmationDocUri}
              onRemove={() => setConfirmationDocUri(null)}
            />

            <TouchableOpacity
              onPress={handleSave}
              disabled={!canSave}
              style={[styles.saveBtn, { backgroundColor: canSave ? '#1C3D2E' : colors.border }]}
            >
              <Text style={[styles.saveBtnText, { color: canSave ? '#fff' : colors.muted }]}>
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

// ─── Main Block ───────────────────────────────────────────────────────────────

interface AccommodationBlockProps {
  trip: Trip;
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
                        {acc.address && (
                          <Text style={styles.accAddress} numberOfLines={1}>{acc.address}</Text>
                        )}
                        {acc.confirmationDocUri && (
                          <View style={styles.docBadge}>
                            <Ionicons name="document-attach-outline" size={11} color="#52B788" />
                            <Text style={styles.docBadgeText}>Confirmação anexada</Text>
                          </View>
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

// ─── Styles ───────────────────────────────────────────────────────────────────

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
    fontSize: 22,
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
  accAddress: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    marginTop: 2,
  },
  docBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  docBadgeText: {
    color: '#52B788',
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
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(168,213,181,0.3)',
    borderStyle: 'dashed',
    alignSelf: 'flex-start',
  },
  addAccBtnText: {
    color: '#A8D5B5',
    fontSize: 13,
    fontWeight: '500',
  },
  // Modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  addSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    maxHeight: '92%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  addHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  addTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addScroll: {
    paddingHorizontal: 20,
  },
  typeRow: {
    marginBottom: 16,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  typeChipEmoji: {
    fontSize: 16,
  },
  typeChipLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 16,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  nightsBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 44,
  },
  nightsNum: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  nightsLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 9,
    fontWeight: '600',
  },
  saveBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
