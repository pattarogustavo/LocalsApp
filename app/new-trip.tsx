import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Stack, router } from 'expo-router';
import { ScalePressable } from '@/components/ui/scale-pressable';
import { useTripsStore } from '@/store/trips';
import { useAuthStore } from '@/store/auth';
import { generateId, getCurrencyForCountry } from '@/utils/trip-helpers';
import { PlacesAutocompleteInput } from '@/components/ui/places-autocomplete-input';
import { getApiBaseUrl } from '@/constants/api';
import type { Trip, Destination } from '@/types/voyage';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { useTranslation } from '@/hooks/use-translation';
import { sheetScreenOptions } from '@/utils/sheet-presentation';
import { useDiscardConfirmation } from '@/hooks/use-discard-confirmation';

export default function NewTripScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const t = useTranslation();
  const addTrip = useTripsStore((s) => s.addTrip);

  const [startDate, setStartDate] = useState<Date | null>(null);
  const [totalDays, setTotalDays] = useState(3);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  useDiscardConfirmation((startDate !== null || destinations.length > 0) && !isCreating);

  const distributedDays = destinations.reduce((sum, d) => sum + d.days, 0);
  const canCreate = startDate !== null && destinations.length > 0;

  const handleSelectDestination = async (prediction: { placeId: string; name: string; fullDescription: string; country: string }) => {
    if (destinations.find((d) => d.placeId === prediction.placeId)) return;
    const remainingDays = Math.max(1, totalDays - distributedDays);
    const tempId = generateId();
    const newDest: Destination = { id: tempId, name: prediction.name, country: prediction.country, days: remainingDays, placeId: prediction.placeId };
    setDestinations((prev) => [...prev, newDest]);

    try {
      const language = useAuthStore.getState().preferredLanguage;
      const res = await fetch(
        `${getApiBaseUrl()}/api/trpc/places.details?input=${encodeURIComponent(JSON.stringify({ json: { placeId: prediction.placeId, language } }))}`
      );
      const json = await res.json();
      const details = json?.result?.data?.json;
      if (details?.imageUrl || details?.lat || details?.name) {
        setDestinations((prev) =>
          prev.map((d) =>
            d.id === tempId
              ? { ...d, lat: details.lat, lng: details.lng, imageUrl: details.imageUrl, name: details.name || d.name, country: details.country || d.country }
              : d
          )
        );
      }
    } catch {
      // Non-critical — hero image will use Unsplash fallback
    }
  };

  const handleUpdateDestDays = (id: string, delta: number) => {
    setDestinations((prev) => prev.map((d) => (d.id === id ? { ...d, days: Math.max(1, d.days + delta) } : d)));
  };

  const handleRemoveDest = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDestinations((prev) => prev.filter((d) => d.id !== id));
  };

  const handleCreate = async () => {
    if (!startDate || destinations.length === 0) return;
    setIsCreating(true);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + totalDays - 1);

    const firstName = destinations[0].name;
    const dayLabel = totalDays === 1 ? t.trip.oneDay : t.trip.multiDay.replace('{days}', String(totalDays));
    const tripName = destinations.length === 1 ? `${dayLabel} ${t.trip.in} ${firstName}` : destinations.map((d) => d.name).join(' + ');

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
      travelers: [],
      accommodations: [],
      itinerary: [],
      currency: getCurrencyForCountry(destinations[0].country),
      cityTransportMode: 'public',
      contentLanguage: useAuthStore.getState().preferredLanguage,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await addTrip(trip);
    setIsCreating(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
    router.push({ pathname: '/trip/[id]', params: { id: trip.id } });
  };

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors, [0.85, 1.0])} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: colors.foreground }]}>{t.createTrip.title}</Text>

        <Text style={[styles.sectionLabel, { color: colors.muted }]}>{t.createTrip.startDate.toUpperCase()}</Text>
        <View style={styles.dateRow}>
          <View style={{ flex: 1 }}>
            <DatePickerField value={startDate} onChange={(d) => setStartDate(d)} minimumDate={new Date()} compact />
          </View>
          <View style={[styles.daysStepper, { backgroundColor: colors.surface }]}>
            <TouchableOpacity onPress={() => setTotalDays(Math.max(1, totalDays - 1))} style={[styles.stepperBtn, { backgroundColor: colors.background }]}>
              <Ionicons name="remove" size={14} color={colors.foreground} />
            </TouchableOpacity>
            <View style={styles.stepperCenter}>
              <Text style={[styles.stepperNum, { color: colors.foreground }]}>{totalDays}</Text>
              <Text style={[styles.stepperLabel, { color: colors.muted }]}>{t.common.days.toUpperCase()}</Text>
            </View>
            <TouchableOpacity onPress={() => setTotalDays(totalDays + 1)} style={[styles.stepperBtn, { backgroundColor: colors.background }]}>
              <Ionicons name="add" size={14} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.muted }]}>{t.createTrip.destination.toUpperCase()}</Text>

        {destinations.length > 0 && (
          <View style={[styles.destList, { backgroundColor: colors.surface }]}>
            {destinations.map((dest, idx) => (
              <View key={dest.id}>
                <View style={styles.destRow}>
                  <View style={styles.destDot} />
                  <View style={styles.destInfo}>
                    <Text style={[styles.destName, { color: colors.foreground }]}>{dest.name}</Text>
                    {dest.country ? <Text style={[styles.destCountry, { color: colors.muted }]}>{dest.country}</Text> : null}
                  </View>
                  <View style={styles.destDaysRow}>
                    <TouchableOpacity onPress={() => handleUpdateDestDays(dest.id, -1)} style={[styles.miniBtn, { backgroundColor: colors.background }]}>
                      <Ionicons name="remove" size={12} color={colors.foreground} />
                    </TouchableOpacity>
                    <Text style={[styles.destDaysNum, { color: colors.foreground }]}>{dest.days}</Text>
                    <Text style={[styles.destDaysLabel, { color: colors.muted }]}>{t.common.days}</Text>
                    <TouchableOpacity onPress={() => handleUpdateDestDays(dest.id, 1)} style={[styles.miniBtn, { backgroundColor: colors.background }]}>
                      <Ionicons name="add" size={12} color={colors.foreground} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleRemoveDest(dest.id)} style={[styles.miniBtn, { backgroundColor: colors.background, marginLeft: 4 }]}>
                      <Ionicons name="close" size={12} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
                {idx < destinations.length - 1 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
              </View>
            ))}
            <View style={[styles.daysDistRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.daysDistLabel, { color: colors.muted }]}>{t.trip.daysDistributed}</Text>
              <Text style={[styles.daysDistValue, { color: distributedDays > totalDays ? colors.error : colors.success }]}>
                {distributedDays}/{totalDays}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.autocompleteWrapper}>
          <PlacesAutocompleteInput onSelect={handleSelectDestination} placeholder={t.createTrip.destinationPlaceholder} searchTypes="cities" />
        </View>

        <ScalePressable
          onPress={canCreate ? handleCreate : undefined}
          disabled={!canCreate || isCreating}
          style={[styles.createBtn, { backgroundColor: canCreate ? colors.primary : colors.surface }]}
        >
          <Text style={[styles.createBtnText, { color: canCreate ? colors.textOnPrimary : colors.muted }]}>
            {!startDate
              ? t.createTrip.startDate
              : destinations.length === 0
              ? t.createTrip.destinationPlaceholder
              : isCreating
              ? t.createTrip.generating
              : t.createTrip.createBtn}
          </Text>
        </ScalePressable>
      </ScrollView>
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  title: { fontSize: 26, fontStyle: 'italic', fontFamily: 'serif', fontWeight: '600', marginBottom: 24 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  dateRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  daysStepper: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingHorizontal: 12, height: 52 },
  stepperBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepperCenter: { alignItems: 'center', minWidth: 36 },
  stepperNum: { fontSize: 18, fontWeight: '700' },
  stepperLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
  destList: { borderRadius: 14, marginBottom: 12, overflow: 'hidden' },
  destRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  destDot: { width: 4, height: 20, borderRadius: 2, backgroundColor: colors.primary, marginRight: 12 },
  destInfo: { flex: 1 },
  destName: { fontSize: 15, fontWeight: '600' },
  destCountry: { fontSize: 12, marginTop: 1 },
  destDaysRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniBtn: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  destDaysNum: { fontSize: 14, fontWeight: '700', minWidth: 16, textAlign: 'center' },
  destDaysLabel: { fontSize: 11 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  daysDistRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  daysDistLabel: { fontSize: 12 },
  daysDistValue: { fontSize: 12, fontWeight: '700' },
  autocompleteWrapper: { marginBottom: 16, zIndex: 200 },
  createBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  createBtnText: { fontSize: 16, fontWeight: '700' },
});
