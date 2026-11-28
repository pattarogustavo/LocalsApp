import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ScalePressable } from '@/components/ui/scale-pressable';
import { PlacesAutocompleteInput } from '@/components/ui/places-autocomplete-input';
import { useTripsStore } from '@/store/trips';
import { useTranslation } from '@/hooks/use-translation';
import type { Destination } from '@/types/voyage';
import { generateId } from '@/utils/trip-helpers';
import { getApiBaseUrl } from '@/constants/api';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { sheetScreenOptions } from '@/utils/sheet-presentation';
import { useDiscardConfirmation } from '@/hooks/use-discard-confirmation';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

export default function EditDestinationsScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const t = useTranslation();
  const trip = useTripsStore((s) => s.trips.find((tr) => tr.id === tripId));
  const updateDestinations = useTripsStore((s) => s.updateDestinations);

  const [destinations, setDestinations] = useState<Destination[]>(trip?.destinations ?? []);

  const isDirty = JSON.stringify(destinations) !== JSON.stringify(trip?.destinations ?? []);
  useDiscardConfirmation(isDirty);

  if (!trip) return null;

  const totalDays = trip.totalDays;
  const allocatedDays = destinations.reduce((sum, d) => sum + d.days, 0);

  const handleUpdateDays = (id: string, delta: number) => {
    setDestinations((prev) => prev.map((d) => (d.id === id ? { ...d, days: Math.max(1, d.days + delta) } : d)));
  };

  const handleRemove = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDestinations((prev) => prev.filter((d) => d.id !== id));
  };

  const handleMoveUp = (idx: number) => {
    if (idx === 0) return;
    setDestinations((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const handleMoveDown = (idx: number) => {
    setDestinations((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const handleAddDestination = async (prediction: { placeId: string; name: string; fullDescription: string; country: string }) => {
    if (destinations.find((d) => d.placeId === prediction.placeId)) return;
    const newDest: Destination = {
      id: generateId(),
      name: prediction.name,
      country: prediction.country,
      days: 1,
      placeId: prediction.placeId,
    };
    setDestinations((prev) => [...prev, newDest]);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/trpc/places.details?input=${encodeURIComponent(JSON.stringify({ json: { placeId: prediction.placeId } }))}`
      );
      const json = await res.json();
      const details = json?.result?.data?.json;
      if (details?.imageUrl || details?.lat) {
        setDestinations((prev) =>
          prev.map((d) =>
            d.placeId === prediction.placeId
              ? { ...d, lat: details.lat, lng: details.lng, imageUrl: details.imageUrl, country: details.country || d.country }
              : d
          )
        );
      }
    } catch {
      // Non-critical
    }
  };

  const handleSave = async () => {
    await updateDestinations(tripId, destinations);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors, [0.7, 1.0])} />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={styles.editSheetHeader}>
          <Text style={[styles.editSheetTitle, { color: colors.foreground }]}>{t.tripEdit.destsTitle}</Text>
        </View>

        <View style={{ paddingHorizontal: 24, marginBottom: 12 }}>
          <View style={[styles.daysSummaryRow, { backgroundColor: allocatedDays > totalDays ? withAlpha(colors.error, 0.12) : withAlpha(colors.primary, 0.08) }]}>
            <Ionicons name="calendar-outline" size={14} color={allocatedDays > totalDays ? colors.error : colors.textAccent} />
            <Text style={[styles.daysSummaryText, { color: allocatedDays > totalDays ? colors.error : colors.textAccent }]}>
              {allocatedDays} de {totalDays} {t.tripEdit.daysAllocated}
            </Text>
            {allocatedDays > totalDays && (
              <Text style={{ fontSize: 11, color: colors.error, marginLeft: 4 }}>{t.tripEdit.exceedsItinerary}</Text>
            )}
          </View>
        </View>

        <ScrollView style={styles.editSheetScroll} keyboardShouldPersistTaps="handled">
          {destinations.map((dest, idx) => (
            <View key={dest.id}>
              <View style={styles.destEditRow}>
                <View style={{ gap: 2, marginRight: 8 }}>
                  <TouchableOpacity
                    onPress={() => handleMoveUp(idx)}
                    style={[styles.miniBtn, { backgroundColor: idx === 0 ? 'transparent' : colors.surface }]}
                    disabled={idx === 0}
                  >
                    <Ionicons name="chevron-up" size={12} color={idx === 0 ? 'transparent' : colors.foreground} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleMoveDown(idx)}
                    style={[styles.miniBtn, { backgroundColor: idx === destinations.length - 1 ? 'transparent' : colors.surface }]}
                    disabled={idx === destinations.length - 1}
                  >
                    <Ionicons name="chevron-down" size={12} color={idx === destinations.length - 1 ? 'transparent' : colors.foreground} />
                  </TouchableOpacity>
                </View>

                <View style={styles.destEditInfo}>
                  <Text style={[styles.destEditName, { color: colors.foreground }]}>{dest.name}</Text>
                  {dest.country ? (
                    <Text style={[styles.destEditCountry, { color: colors.muted }]}>{dest.country}</Text>
                  ) : null}
                </View>

                <View style={styles.destDaysRow}>
                  <TouchableOpacity onPress={() => handleUpdateDays(dest.id, -1)} style={[styles.miniBtn, { backgroundColor: colors.surface }]}>
                    <Ionicons name="remove" size={12} color={colors.foreground} />
                  </TouchableOpacity>
                  <Text style={[styles.destDaysNum, { color: colors.foreground }]}>{dest.days}</Text>
                  <Text style={[styles.destDaysLabel, { color: colors.muted }]}>{t.tripEdit.durationUnit}</Text>
                  <TouchableOpacity onPress={() => handleUpdateDays(dest.id, 1)} style={[styles.miniBtn, { backgroundColor: colors.surface }]}>
                    <Ionicons name="add" size={12} color={colors.foreground} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleRemove(dest.id)} style={[styles.miniBtn, { backgroundColor: colors.surface, marginLeft: 4 }]}>
                    <Ionicons name="close" size={12} color={colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
              {idx < destinations.length - 1 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
            </View>
          ))}

          <View style={{ marginTop: 16, marginBottom: 8 }}>
            <Text style={[styles.destDaysLabel, { color: colors.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }]}>{t.tripEdit.addDestination}</Text>
            <PlacesAutocompleteInput onSelect={handleAddDestination} placeholder={t.tripEdit.searchCity} searchTypes="cities" />
          </View>

          <ScalePressable onPress={handleSave} style={[styles.saveBtn, { backgroundColor: '#2C2416', marginTop: 16 }]}>
            <Text style={styles.saveBtnText}>{t.tripEdit.saveChanges}</Text>
          </ScalePressable>
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  editSheetHeader: { paddingHorizontal: 24, paddingTop: 20, marginBottom: 16 },
  editSheetTitle: { fontSize: 20, fontStyle: 'italic', fontFamily: 'serif', fontWeight: '600' },
  editSheetScroll: { paddingHorizontal: 24 },
  destEditRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  destEditInfo: { flex: 1 },
  destEditName: { fontSize: 15, fontWeight: '600' },
  destEditCountry: { fontSize: 12, marginTop: 1 },
  destDaysRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniBtn: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  destDaysNum: { fontSize: 14, fontWeight: '700', minWidth: 16, textAlign: 'center' },
  destDaysLabel: { fontSize: 11 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  saveBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  daysSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  daysSummaryText: { fontSize: 13, fontWeight: '600' },
});
