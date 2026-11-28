import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { useTripsStore } from '@/store/trips';
import { useAuthStore } from '@/store/auth';
import { generateId } from '@/utils/trip-helpers';
import type { Accommodation, AccommodationType } from '@/types/voyage';
import { PlacesAutocompleteInput, type PlaceResult } from '@/components/ui/places-autocomplete-input';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { DocAttachField } from '@/components/ui/doc-attach-field';
import { trpc } from '@/lib/trpc';
import { useTranslation } from '@/hooks/use-translation';
import { sheetScreenOptions } from '@/utils/sheet-presentation';
import { useDiscardConfirmation } from '@/hooks/use-discard-confirmation';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

const TYPE_OPTIONS: { id: AccommodationType; label: string; icon: string }[] = [
  { id: 'hotel', label: 'Hotel', icon: '🏨' },
  { id: 'house', label: 'Casa / Apartamento', icon: '🏠' },
  { id: 'other', label: 'Outro', icon: '📍' },
];

function nightsBetween(checkIn: string, checkOut: string) {
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)));
}

export default function AddAccommodationScreen() {
  const { tripId, destinationId } = useLocalSearchParams<{ tripId: string; destinationId: string }>();
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const trip = useTripsStore((s) => s.trips.find((tr) => tr.id === tripId));
  const addAccommodation = useTripsStore((s) => s.addAccommodation);
  const destination = trip?.destinations.find((d) => d.id === destinationId);

  const [type, setType] = useState<AccommodationType>('hotel');
  const [checkIn, setCheckIn] = useState<Date>(new Date(trip?.startDate ?? Date.now()));
  const [checkOut, setCheckOut] = useState<Date>(() => {
    const d = new Date(trip?.startDate ?? Date.now());
    d.setDate(d.getDate() + Math.max(1, (destination?.days ?? 1) - 1));
    return d;
  });

  const [hotelPlace, setHotelPlace] = useState<PlaceResult | null>(null);
  const [hotelName, setHotelName] = useState('');
  const [hotelAddress, setHotelAddress] = useState('');
  const [hotelPlaceId, setHotelPlaceId] = useState('');

  const [houseAddressPlace, setHouseAddressPlace] = useState<PlaceResult | null>(null);
  const [houseAddress, setHouseAddress] = useState('');

  const [otherName, setOtherName] = useState('');

  const [confirmationCode, setConfirmationCode] = useState('');
  const [confirmationDocUri, setConfirmationDocUri] = useState<string | null>(null);

  useDiscardConfirmation(
    hotelName.trim().length > 0 || houseAddress.trim().length > 0 || otherName.trim().length > 0 ||
    confirmationCode.trim().length > 0 || confirmationDocUri != null
  );

  const preferredLanguage = useAuthStore((s) => s.preferredLanguage);
  const detailsQuery = trpc.places.details.useQuery(
    { placeId: hotelPlaceId, language: preferredLanguage },
    { enabled: hotelPlaceId.length > 0, staleTime: 1000 * 60 * 60 * 24 }
  );

  useEffect(() => {
    if (detailsQuery.data?.address) setHotelAddress(detailsQuery.data.address);
  }, [detailsQuery.data]);

  if (!destination) return null;

  const isHouse = type === 'house';
  const canSave = isHouse ? houseAddress.trim().length > 0 : (hotelName.trim().length > 0 || otherName.trim().length > 0);

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
    router.back();
  };

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors, [0.8, 1.0])} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', color: colors.foreground, marginBottom: 20 }}>
          {t.accommodation.addTitle} {destination.name}
        </Text>

        <Text style={[styles.fieldLabel, { color: colors.muted }]}>{t.accommodation.type.toUpperCase()}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeRow} keyboardShouldPersistTaps="handled">
          {TYPE_OPTIONS.map((opt) => (
            <Pressable
              key={opt.id}
              onPress={() => setType(opt.id)}
              style={({ pressed }) => [
                styles.typeChip,
                { backgroundColor: type === opt.id ? colors.primary : colors.surface, borderColor: type === opt.id ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.typeChipEmoji}>{opt.icon}</Text>
              <Text style={[styles.typeChipLabel, { color: type === opt.id ? colors.textOnPrimary : colors.foreground }]}>{opt.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.dateRow}>
          <View style={{ flex: 1 }}>
            <DatePickerField
              label={t.accommodation.checkIn.toUpperCase()}
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
          <View style={[styles.nightsBadge, { backgroundColor: colors.primary }]}>
            <Text style={styles.nightsNum}>{nightsBetween(checkIn.toISOString(), checkOut.toISOString())}</Text>
            <Text style={styles.nightsLabel}>{t.accommodation.nights}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <DatePickerField
              label={t.accommodation.checkOut.toUpperCase()}
              value={checkOut}
              onChange={(d) => { if (d > checkIn) setCheckOut(d); }}
            />
          </View>
        </View>

        {type === 'hotel' && (
          <View style={{ marginBottom: 14 }}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>{t.accommodation.hotelName.toUpperCase()} *</Text>
            <PlacesAutocompleteInput
              placeholder={t.accommodation.hotelSearchPlaceholder}
              value={hotelPlace?.name || ''}
              onSelect={(p) => { setHotelPlace(p); setHotelName(p.name); setHotelPlaceId(p.placeId); }}
              searchTypes="establishment"
              biasLat={destination.lat}
              biasLng={destination.lng}
            />
          </View>
        )}

        {type === 'other' && (
          <View style={{ marginBottom: 14 }}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>{t.accommodation.localName.toUpperCase()} *</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
              placeholder={t.accommodation.localNamePlaceholder}
              placeholderTextColor={colors.muted}
              value={otherName}
              onChangeText={setOtherName}
            />
          </View>
        )}

        {type === 'hotel' && (
          <View style={{ marginBottom: 14 }}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>{t.accommodation.address.toUpperCase()}</Text>
            {detailsQuery.isFetching ? (
              <View style={[styles.input, { backgroundColor: colors.surface, justifyContent: 'center' }]}>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{t.accommodation.fetchingAddress}</Text>
              </View>
            ) : (
              <TextInput
                style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
                placeholder={t.accommodation.addressAutoFilled}
                placeholderTextColor={colors.muted}
                value={hotelAddress}
                onChangeText={setHotelAddress}
              />
            )}
          </View>
        )}

        {isHouse && (
          <View style={{ marginBottom: 14 }}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>{t.accommodation.address.toUpperCase()} *</Text>
            <PlacesAutocompleteInput
              placeholder={t.accommodation.addressSearchPlaceholder}
              value={houseAddressPlace?.fullDescription || ''}
              onSelect={(p) => { setHouseAddressPlace(p); setHouseAddress(p.fullDescription); }}
              searchTypes="address"
              biasLat={destination.lat}
              biasLng={destination.lng}
            />
          </View>
        )}

        <Text style={[styles.fieldLabel, { color: colors.muted }]}>{t.accommodation.confirmationCode.toUpperCase()}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground }]}
          placeholder={t.accommodation.confirmationCodePlaceholder}
          placeholderTextColor={colors.muted}
          value={confirmationCode}
          onChangeText={setConfirmationCode}
          autoCapitalize="characters"
        />

        <DocAttachField
          label={`${t.accommodation.confirmationDoc.toUpperCase()} (${t.common.optional.toUpperCase()})`}
          uri={confirmationDocUri}
          onPick={setConfirmationDocUri}
          onRemove={() => setConfirmationDocUri(null)}
        />

        <TouchableOpacity
          onPress={handleSave}
          disabled={!canSave}
          activeOpacity={0.7}
          style={[styles.saveBtn, { backgroundColor: canSave ? colors.primary : colors.border }]}
        >
          <Text style={[styles.saveBtnText, { color: canSave ? colors.textOnPrimary : colors.muted }]}>{t.accommodation.save}</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  fieldLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 1, marginBottom: 8 },
  typeRow: { marginBottom: 16 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, marginRight: 8 },
  typeChipEmoji: { fontSize: 16 },
  typeChipLabel: { fontSize: 13, fontWeight: '500' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  nightsBadge: { alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, minWidth: 44 },
  nightsNum: { color: '#fff', fontSize: 16, fontWeight: '700' },
  nightsLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 9, fontWeight: '600' },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 16 },
  saveBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8, marginBottom: 8 },
  saveBtnText: { fontSize: 15, fontWeight: '700' },
});
