import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTripsStore } from '@/store/trips';
import { trpc } from '@/lib/trpc';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { sheetScreenOptions } from '@/utils/sheet-presentation';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

/**
 * Preview of a custom Google Places search result (address/hours fetched
 * live) before the user confirms adding it to the trip — [0.6, 1.0] sheet,
 * same content as the old CustomPlacePreviewModal.
 */
export default function PlacePreviewScreen() {
  const { tripId, destId, resultData, canEdit: canEditParam, language } = useLocalSearchParams<{
    tripId: string;
    destId: string;
    resultData: string;
    canEdit?: string;
    language?: string;
  }>();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const canEdit = canEditParam === '1';
  const result = useMemo(() => JSON.parse(resultData), [resultData]);
  const upsertPlace = useTripsStore((s) => s.upsertPlace);

  const detailsQuery = trpc.places.curatedDetails.useQuery(
    { placeId: result.placeId, language },
    { enabled: !!result.placeId, staleTime: 1000 * 60 * 60 * 24 }
  );
  const details = detailsQuery.data as { address?: string; hours?: string; phone?: string } | undefined;
  const address = details?.address || result.address;
  const hours = details?.hours;

  const handleConfirm = async () => {
    if (!canEdit) return;
    Haptics.selectionAsync();
    await upsertPlace(tripId, {
      name: result.name,
      category: result.category,
      destinationId: destId,
      googlePlaceId: result.placeId,
      address: address,
      hours: hours,
      phone: details?.phone,
      lat: result.lat,
      lng: result.lng,
      imageUrl: result.imageUrl,
      rating: result.rating,
      addedByAI: false,
    });
    router.back();
  };

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors, [0.6, 1.0])} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} showsVerticalScrollIndicator={false}>
        <View style={styles.detailContent}>
          <Text style={styles.detailName}>{result.name}</Text>
          {result.rating ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, marginBottom: 12 }}>
              <Ionicons name="star" size={12} color={colors.accent} />
              <Text style={{ fontSize: 13, color: colors.accent }}>{result.rating.toFixed(1)}</Text>
            </View>
          ) : null}

          {detailsQuery.isFetching ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 }}>
              <ActivityIndicator size="small" color={colors.textAccent} />
              <Text style={{ color: colors.muted, fontSize: 13 }}>Carregando detalhes...</Text>
            </View>
          ) : (
            <>
              {address ? (
                <View style={styles.detailRow}>
                  <Ionicons name="location-outline" size={15} color={colors.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailRowLabel}>ENDEREÇO</Text>
                    <Text style={styles.detailRowValue}>{address}</Text>
                  </View>
                </View>
              ) : null}
              {hours ? (
                <View style={styles.detailRow}>
                  <Ionicons name="time-outline" size={15} color={colors.muted} />
                  <View>
                    <Text style={styles.detailRowLabel}>HORÁRIO</Text>
                    <Text style={styles.detailRowValue}>{hours}</Text>
                  </View>
                </View>
              ) : null}
            </>
          )}

          <TouchableOpacity onPress={handleConfirm} style={styles.addActionBtn}>
            <Ionicons name="add" size={18} color={colors.textOnPrimary} />
            <Text style={styles.addActionText}>Adicionar à Viagem</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  detailContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },
  detailName: { fontSize: 22, fontStyle: 'italic', fontWeight: '700', color: colors.foreground, lineHeight: 28 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  detailRowLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: colors.muted, textTransform: 'uppercase' },
  detailRowValue: { fontSize: 14, color: colors.foreground, marginTop: 2 },
  addActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, marginTop: 4 },
  addActionText: { fontSize: 15, fontWeight: '700', color: colors.textOnPrimary },
});
