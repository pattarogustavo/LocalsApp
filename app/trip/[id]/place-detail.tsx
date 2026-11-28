import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTripsStore } from '@/store/trips';
import { useTranslation } from '@/hooks/use-translation';
import type { Place, PlaceAttachment } from '@/types/voyage';
import { generateId } from '@/utils/trip-helpers';
import { DocAttachField } from '@/components/ui/doc-attach-field';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { sheetScreenOptions } from '@/utils/sheet-presentation';

// A secondary decorative accent (teal-green) used only for low-opacity icon/
// background tints — matches places-screen.tsx's own constant.
const ACCENT_TEAL = '#52B788';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

const CATEGORY_ICONS: Record<string, string> = {
  attraction: 'camera-outline',
  restaurant: 'restaurant-outline',
  cafe: 'cafe-outline',
  museum: 'book-outline',
  park: 'leaf-outline',
  beach: 'sunny-outline',
  market: 'basket-outline',
  neighborhood: 'navigate-outline',
  hidden_gem: 'diamond-outline',
  other: 'location-outline',
};

function getCategoryLabel(t: ReturnType<typeof useTranslation>, category: string): string {
  const map: Record<string, string> = {
    attraction: t.places.categories.attraction,
    restaurant: t.places.categories.restaurant,
    cafe: t.places.categories.cafe,
    museum: t.places.categories.museum,
    park: t.places.categories.park,
    beach: t.places.categories.beach,
    market: t.places.categories.market,
    neighborhood: t.places.categories.neighborhood,
    hidden_gem: t.places.categories.hiddenGem,
    other: t.places.categories.other,
  };
  return map[category] || category;
}

/**
 * Place detail sheet — native iOS form sheet ([0.6, 1.0] detents), replacing
 * the old hand-rolled Pan-gesture + Modal(transparent) sheet. Reached either
 * for an already-saved place (placeId — looked up live from the store, so
 * edits like attachments stay reactive) or an AI suggestion not yet saved
 * (placeData — a JSON-encoded Place, since it has no stable store id yet).
 */
export default function PlaceDetailScreen() {
  const { tripId, destinationId, placeId, placeData, canEdit: canEditParam } = useLocalSearchParams<{
    tripId: string;
    destinationId?: string;
    placeId?: string;
    placeData?: string;
    canEdit?: string;
  }>();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const t = useTranslation();
  const canEdit = canEditParam === '1';

  const trip = useTripsStore((s) => s.trips.find((tr) => tr.id === tripId));
  const upsertPlace = useTripsStore((s) => s.upsertPlace);
  const removePlace = useTripsStore((s) => s.removePlace);
  const updatePlace = useTripsStore((s) => s.updatePlace);

  const storedPlace = placeId ? trip?.places.find((p) => p.id === placeId) : undefined;
  const parsedSuggestion: Place | null = !storedPlace && placeData ? JSON.parse(placeData) : null;
  const place = storedPlace ?? parsedSuggestion;

  if (!place) {
    // Shouldn't happen in practice — the pushing screen always has one of
    // placeId/placeData — but never render with nothing to show.
    router.back();
    return null;
  }

  const addedMatch = storedPlace
    ? storedPlace
    : trip?.places.find((p) => (place.placeId && p.placeId === place.placeId) || p.name === place.name);
  const isAdded = !!addedMatch;

  const handleAdd = async () => {
    await upsertPlace(tripId, {
      name: place.name,
      category: place.category,
      destinationId: place.destinationId || destinationId || '',
      googlePlaceId: place.placeId,
      address: place.address,
      hours: place.hours,
      phone: place.phone,
      rating: place.rating,
      imageUrl: place.imageUrl,
      description: place.description,
      lat: place.lat,
      lng: place.lng,
      addedByAI: (place as any).addedByAI,
    });
    router.back();
  };

  const handleRemove = async () => {
    if (addedMatch) await removePlace(tripId, addedMatch.id);
    router.back();
  };

  const handleAddAttachment = async (uri: string) => {
    if (!storedPlace) return; // attachments only make sense for an already-saved place
    const newAtt: PlaceAttachment = {
      id: generateId(),
      name: uri.split('/').pop() || 'Documento',
      url: uri,
      type: uri.endsWith('.pdf') ? 'pdf' : 'image',
    };
    const current = storedPlace.attachments || [];
    await updatePlace(tripId, storedPlace.id, { attachments: [...current, newAtt] });
  };

  const handleRemoveAttachment = async (attId: string) => {
    if (!storedPlace) return;
    const updated = (storedPlace.attachments || []).filter((a) => a.id !== attId);
    await updatePlace(tripId, storedPlace.id, { attachments: updated });
  };

  const openMaps = () => {
    if (place.lat && place.lng) {
      Linking.openURL(`https://maps.google.com/?q=${place.lat},${place.lng}`);
    } else if (place.address) {
      Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(place.address)}`);
    }
  };

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors, [0.6, 1.0])} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} showsVerticalScrollIndicator={false}>
        {place.imageUrl ? (
          <Image source={{ uri: place.imageUrl }} style={styles.placePhoto} contentFit="cover" cachePolicy="memory-disk" transition={150} />
        ) : (
          <View style={[styles.placePhotoPlaceholder, { backgroundColor: withAlpha(colors.primary, 0.10) }]}>
            <Ionicons name={CATEGORY_ICONS[place.category] as any || 'location-outline'} size={40} color={withAlpha(ACCENT_TEAL, 0.4)} />
          </View>
        )}

        <View style={styles.detailContent}>
          <Text style={styles.detailName}>{place.name}</Text>
          <Text style={styles.detailCategory}>{getCategoryLabel(t, place.category)}</Text>

          {place.description ? <Text style={styles.detailDesc}>{place.description}</Text> : null}

          {place.hours ? (
            <View style={styles.detailRow}>
              <Ionicons name="time-outline" size={15} color={colors.muted} />
              <View>
                <Text style={styles.detailRowLabel}>HORÁRIO</Text>
                <Text style={styles.detailRowValue}>{place.hours}</Text>
              </View>
            </View>
          ) : null}

          {place.address ? (
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={15} color={colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.detailRowLabel}>ENDEREÇO</Text>
                <Text style={styles.detailRowValue}>{place.address}</Text>
              </View>
            </View>
          ) : null}

          {place.phone ? (
            <View style={styles.detailRow}>
              <Ionicons name="call-outline" size={15} color={colors.muted} />
              <View>
                <Text style={styles.detailRowLabel}>TELEFONE</Text>
                <Text style={styles.detailRowValue}>{place.phone}</Text>
              </View>
            </View>
          ) : null}

          {(place.website || place.address || (place.lat && place.lng)) ? (
            <View style={styles.detailActions}>
              {place.website ? (
                <TouchableOpacity onPress={() => Linking.openURL(place.website!)} style={styles.detailActionBtn}>
                  <Ionicons name="globe-outline" size={16} color={colors.foreground} />
                  <Text style={styles.detailActionText}>Site</Text>
                </TouchableOpacity>
              ) : null}
              {(place.address || (place.lat && place.lng)) ? (
                <TouchableOpacity onPress={openMaps} style={styles.detailActionBtn}>
                  <Ionicons name="map-outline" size={16} color={colors.foreground} />
                  <Text style={styles.detailActionText}>Maps</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {isAdded && (storedPlace?.attachments || []).length > 0 ? (
            <View style={styles.attachSection}>
              <Text style={styles.attachSectionLabel}>DOCUMENTOS ANEXADOS</Text>
              {(storedPlace?.attachments || []).map((att) => (
                <TouchableOpacity
                  key={att.id}
                  style={styles.attachRow}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (att.url) {
                      Linking.openURL(att.url).catch(() => Alert.alert('Erro', 'Não foi possível abrir o documento.'));
                    }
                  }}
                >
                  <Ionicons name={att.type === 'pdf' ? 'document-text-outline' : 'image-outline'} size={16} color={colors.muted} />
                  <Text style={styles.attachName} numberOfLines={1}>{att.name}</Text>
                  {att.url ? <Ionicons name="open-outline" size={13} color={withAlpha(ACCENT_TEAL, 0.6)} style={{ marginRight: 4 }} /> : null}
                  {canEdit ? (
                    <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); handleRemoveAttachment(att.id); }} style={styles.attachRemove}>
                      <Ionicons name="trash-outline" size={14} color={colors.error} />
                    </TouchableOpacity>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {isAdded && canEdit && storedPlace ? (
            <View style={styles.attachSection}>
              <DocAttachField label="Adicionar documento" uri={null} onPick={handleAddAttachment} onRemove={() => {}} />
            </View>
          ) : null}

          {canEdit && (isAdded ? (
            <TouchableOpacity onPress={handleRemove} style={styles.removeActionBtn}>
              <Ionicons name="trash-outline" size={16} color={colors.error} />
              <Text style={styles.removeActionText}>Remover da Viagem</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleAdd} style={styles.addActionBtn}>
              <Ionicons name="add" size={18} color={colors.textOnPrimary} />
              <Text style={styles.addActionText}>Adicionar à Viagem</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  placePhoto: { height: 180, marginHorizontal: 16, borderRadius: 16, marginTop: 12 },
  placePhotoPlaceholder: { height: 180, marginHorizontal: 16, borderRadius: 16, marginTop: 12, alignItems: 'center', justifyContent: 'center' },
  detailContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },
  detailName: { fontSize: 22, fontStyle: 'italic', fontWeight: '700', color: colors.foreground, lineHeight: 28 },
  detailCategory: { fontSize: 13, color: colors.muted, marginTop: 2, marginBottom: 12 },
  detailDesc: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 14 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  detailRowLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: colors.muted, textTransform: 'uppercase' },
  detailRowValue: { fontSize: 14, color: colors.foreground, marginTop: 2 },
  detailActions: { flexDirection: 'row', gap: 10, marginBottom: 14, marginTop: 4 },
  detailActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: withAlpha(colors.foreground, 0.08), borderRadius: 12, paddingVertical: 10 },
  detailActionText: { fontSize: 14, fontWeight: '600', color: colors.foreground },
  addActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, marginTop: 4 },
  addActionText: { fontSize: 15, fontWeight: '700', color: colors.textOnPrimary },
  removeActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: withAlpha(colors.error, 0.12), borderRadius: 14, paddingVertical: 14, marginTop: 4, borderWidth: 1, borderColor: withAlpha(colors.error, 0.3) },
  removeActionText: { fontSize: 15, fontWeight: '700', color: colors.error },
  attachSection: { marginTop: 12, marginBottom: 8, backgroundColor: withAlpha(colors.foreground, 0.04), borderRadius: 12, padding: 12, gap: 8 },
  attachSectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: colors.muted, textTransform: 'uppercase', marginBottom: 4 },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: withAlpha(colors.foreground, 0.06), borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  attachName: { flex: 1, fontSize: 13, color: colors.muted },
  attachRemove: { padding: 4 },
});
