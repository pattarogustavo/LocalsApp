import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Image, Modal, Linking, ActivityIndicator,
  FlatList, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTripsStore } from '@/store/trips';
import { trpc } from '@/lib/trpc';
import type { Place, Destination, PlaceAttachment } from '@/types/voyage';
import { generateId } from '@/utils/trip-helpers';
import { DocAttachField } from '@/components/ui/doc-attach-field';
import { useState as useLocalState } from 'react';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

// A secondary decorative accent (teal-green) used only for low-opacity icon/
// background tints — distinct from colors.primary, kept fixed across themes.
const ACCENT_TEAL = '#52B788';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'all',        label: 'Todos',       icon: 'grid-outline' },
  { key: 'attraction', label: 'Atrações',    icon: 'camera-outline' },
  { key: 'restaurant', label: 'Restaurantes', icon: 'restaurant-outline' },
  { key: 'cafe',       label: 'Cafés',       icon: 'cafe-outline' },
  { key: 'museum',     label: 'Museus',      icon: 'book-outline' },
  { key: 'hidden_gem', label: 'Escondidos',  icon: 'diamond-outline' },
  { key: 'other',      label: 'Outros',      icon: 'location-outline' },
];

const CATEGORY_LABELS: Record<string, string> = {
  attraction: 'Atrações',
  restaurant: 'Restaurantes',
  cafe: 'Cafés',
  museum: 'Museus',
  hidden_gem: 'Joias Escondidas',
  other: 'Outros',
};

const CATEGORY_ICONS: Record<string, string> = {
  attraction: 'camera-outline',
  restaurant: 'restaurant-outline',
  cafe: 'cafe-outline',
  museum: 'book-outline',
  hidden_gem: 'diamond-outline',
  other: 'location-outline',
};

// ─── Place Detail Modal ───────────────────────────────────────────────────────

function PlaceDetailModal({
  place,
  tripId,
  onClose,
  isAdded,
  onAdd,
  onRemove,
}: {
  place: Place;
  tripId: string;
  onClose: () => void;
  isAdded: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const { updatePlace } = useTripsStore();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [docPickerIdx, setDocPickerIdx] = useLocalState<number | null>(null);

  const handleAddAttachment = async (uri: string) => {
    const newAtt: PlaceAttachment = {
      id: generateId(),
      name: uri.split('/').pop() || 'Documento',
      url: uri,
      type: uri.endsWith('.pdf') ? 'pdf' : 'image',
    };
    const current = place.attachments || [];
    await updatePlace(tripId, place.id, { attachments: [...current, newAtt] });
    setDocPickerIdx(null);
  };

  const handleRemoveAttachment = async (attId: string) => {
    const updated = (place.attachments || []).filter((a) => a.id !== attId);
    await updatePlace(tripId, place.id, { attachments: updated });
  };

  const openMaps = () => {
    if (place.lat && place.lng) {
      Linking.openURL(`https://maps.google.com/?q=${place.lat},${place.lng}`);
    } else if (place.address) {
      Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(place.address)}`);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.detailSheet}>
          <View style={styles.handle} />

          {/* Photo */}
          {place.imageUrl ? (
            <Image source={{ uri: place.imageUrl }} style={styles.placePhoto} resizeMode="cover" />
          ) : (
            <View style={[styles.placePhotoPlaceholder, { backgroundColor: withAlpha(colors.primary, 0.10) }]}>
              <Ionicons name={CATEGORY_ICONS[place.category] as any || 'location-outline'} size={40} color={withAlpha(ACCENT_TEAL, 0.4)} />
            </View>
          )}

          <View style={styles.detailContent}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={16} color={colors.muted} />
            </TouchableOpacity>

            <Text style={styles.detailName}>{place.name}</Text>
            <Text style={styles.detailCategory}>{CATEGORY_LABELS[place.category] || place.category}</Text>

            {place.description ? (
              <Text style={styles.detailDesc}>{place.description}</Text>
            ) : null}

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

            {/* Attachments section */}
            {isAdded ? (
              <View style={styles.attachSection}>
                <Text style={styles.attachSectionLabel}>DOCUMENTOS ANEXADOS</Text>
                {(place.attachments || []).map((att, idx) => (
                  <TouchableOpacity
                    key={att.id}
                    style={styles.attachRow}
                    activeOpacity={0.7}
                    onPress={() => {
                      if (att.url) {
                        Linking.openURL(att.url).catch(() =>
                          Alert.alert('Erro', 'Não foi possível abrir o documento.')
                        );
                      }
                    }}
                  >
                    <Ionicons
                      name={att.type === 'pdf' ? 'document-text-outline' : 'image-outline'}
                      size={16} color={colors.muted}
                    />
                    <Text style={styles.attachName} numberOfLines={1}>{att.name}</Text>
                    {att.url ? (
                      <Ionicons name="open-outline" size={13} color={withAlpha(ACCENT_TEAL, 0.6)} style={{ marginRight: 4 }} />
                    ) : null}
                    <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); handleRemoveAttachment(att.id); }} style={styles.attachRemove}>
                      <Ionicons name="trash-outline" size={14} color={colors.error} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
                <DocAttachField
                  label="Adicionar documento"
                  uri={null}
                  onPick={handleAddAttachment}
                  onRemove={() => {}}
                />
              </View>
            ) : null}

            {isAdded ? (
              <TouchableOpacity
                onPress={() => { onRemove(); onClose(); }}
                style={styles.removeActionBtn}
              >
                <Ionicons name="trash-outline" size={16} color={colors.error} />
                <Text style={styles.removeActionText}>Remover da Viagem</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => { onAdd(); onClose(); }}
                style={styles.addActionBtn}
              >
                <Ionicons name="add" size={18} color={colors.textOnPrimary} />
                <Text style={styles.addActionText}>Adicionar à Viagem</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── My Place Row ─────────────────────────────────────────────────────────────

function MyPlaceRow({
  place,
  onPress,
  onRemove,
}: {
  place: Place;
  onPress: () => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <TouchableOpacity onPress={onPress} style={styles.myPlaceRow} activeOpacity={0.75}>
      {place.imageUrl ? (
        <Image source={{ uri: place.imageUrl }} style={styles.myPlaceThumb} resizeMode="cover" />
      ) : (
        <View style={[styles.myPlaceThumb, { backgroundColor: withAlpha(colors.primary, 0.10), alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name={CATEGORY_ICONS[place.category] as any || 'location-outline'} size={18} color={withAlpha(ACCENT_TEAL, 0.5)} />
        </View>
      )}
      <Text style={styles.myPlaceName} numberOfLines={1}>{place.name}</Text>
      <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
        <Ionicons name="trash-outline" size={15} color={colors.error} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Available Place Row ──────────────────────────────────────────────────────

function AvailPlaceRow({
  place,
  isAdded,
  onAdd,
  onRemove,
  onPress,
}: {
  place: Place;
  isAdded: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onPress: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <TouchableOpacity onPress={onPress} style={styles.availRow} activeOpacity={0.75}>
      {place.imageUrl ? (
        <Image source={{ uri: place.imageUrl }} style={styles.availThumb} resizeMode="cover" />
      ) : (
        <View style={[styles.availThumb, { backgroundColor: withAlpha(colors.primary, 0.10), alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name={CATEGORY_ICONS[place.category] as any || 'location-outline'} size={20} color={withAlpha(ACCENT_TEAL, 0.5)} />
        </View>
      )}
      <View style={styles.availInfo}>
        <Text style={styles.availName} numberOfLines={1}>{place.name}</Text>
        {place.description ? (
          <Text style={styles.availDesc} numberOfLines={1}>{place.description}</Text>
        ) : null}
      </View>
      {isAdded ? (
        <TouchableOpacity onPress={onRemove} style={styles.addedBadge}>
          <Ionicons name="checkmark" size={12} color={colors.textAccent} />
          <Text style={styles.addedBadgeText}>Adicionado</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={onAdd} style={styles.addChip}>
          <Text style={styles.addChipText}>Adicionar</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ─── AI Suggestions Panel (auto-loads) ───────────────────────────────────────

function AIPanel({
  destination,
  tripId,
  addedPlaces,
  onAdd,
  onRemove,
  activeCategory,
  searchQuery,
}: {
  destination: Destination;
  tripId: string;
  addedPlaces: Place[];
  onAdd: (place: Place) => void;
  onRemove: (id: string) => void;
  activeCategory: string;
  searchQuery: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const fetchedRef = useRef(false);
  const { updateDestinationSuggestedPlaces } = useTripsStore();

  const suggestPlaces = trpc.ai.suggestPlaces.useMutation();

  const loadSuggestions = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    try {
      const result = await suggestPlaces.mutateAsync({
        destinationName: destination.name,
        country: destination.country || '',
        categories: ['attraction', 'restaurant', 'cafe', 'museum', 'hidden_gem'],
        existingPlaces: addedPlaces.map((p) => p.name),
        lat: destination.lat,
        lng: destination.lng,
      });
      if (result?.places) {
        const withIds = result.places.map((p: any) => ({ ...p, id: generateId() }));
        setSuggestions(withIds);
        await updateDestinationSuggestedPlaces(tripId, destination.id, withIds);
      }
    } catch (e) {
      console.error('AI suggest places error:', e);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [destination.name, destination.country, destination.id, destination.lat, destination.lng, tripId]);

  // Auto-load on mount: hydrate from cache if this destination already has
  // saved AI suggestions, otherwise fetch once and persist the result.
  useEffect(() => {
    if (destination.aiSuggestedPlaces && destination.aiSuggestedPlaces.length > 0) {
      fetchedRef.current = true;
      setSuggestions(destination.aiSuggestedPlaces);
      setLoaded(true);
      return;
    }
    loadSuggestions();
  }, []);

  const filtered = useMemo(() => {
    return suggestions.filter((p) => {
      const matchCat = activeCategory === 'all' || p.category === activeCategory;
      const matchSearch = !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.description || '').toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [suggestions, activeCategory, searchQuery]);

  const isAdded = (place: Place) => addedPlaces.some((p) => p.name === place.name);

  if (loading) {
    return (
      <View style={styles.aiLoadingRow}>
        <ActivityIndicator size="small" color={colors.textAccent} />
        <Text style={styles.aiLoadingText}>Buscando sugestões para {destination.name}...</Text>
      </View>
    );
  }

  if (loaded && filtered.length === 0) {
    return (
      <View style={styles.aiEmptyRow}>
        <Ionicons name="search-outline" size={16} color={colors.muted} />
        <Text style={styles.aiEmptyText}>
          {searchQuery ? `Nenhum resultado para "${searchQuery}"` : 'Nenhuma sugestão disponível'}
        </Text>
        <TouchableOpacity
          onPress={() => { fetchedRef.current = false; loadSuggestions(); }}
          style={styles.aiRefreshBtn}
        >
          <Ionicons name="refresh-outline" size={14} color={colors.textAccent} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      {filtered.map((place) => (
        <AvailPlaceRow
          key={place.id}
          place={place}
          isAdded={isAdded(place)}
          onAdd={() => onAdd(place)}
          onRemove={() => {
            const added = addedPlaces.find((p) => p.name === place.name);
            if (added) onRemove(added.id);
          }}
          onPress={() => setSelectedPlace(place)}
        />
      ))}
      {selectedPlace && (
        <PlaceDetailModal
          place={selectedPlace}
          tripId=""
          onClose={() => setSelectedPlace(null)}
          isAdded={isAdded(selectedPlace)}
          onAdd={() => {
            onAdd(selectedPlace);
            setSelectedPlace(null);
          }}
          onRemove={() => {
            const added = addedPlaces.find((p) => p.name === selectedPlace.name);
            if (added) onRemove(added.id);
            setSelectedPlace(null);
          }}
        />
      )}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface PlacesScreenProps {
  tripId: string;
  places: Place[];
  destinations: Destination[];
}

// ─── Custom Place Search Result Row ─────────────────────────────────────────

function CustomSearchResultRow({
  result,
  onAdd,
  isAdded,
}: {
  result: any;
  onAdd: () => void;
  isAdded: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.customResultRow}>
      {result.imageUrl ? (
        <Image source={{ uri: result.imageUrl }} style={styles.customResultImg} />
      ) : (
        <View style={[styles.customResultImg, { backgroundColor: withAlpha(ACCENT_TEAL, 0.1), alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name="location-outline" size={20} color={withAlpha(ACCENT_TEAL, 0.5)} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.customResultName} numberOfLines={1}>{result.name}</Text>
        <Text style={styles.customResultAddr} numberOfLines={1}>{result.address}</Text>
        {result.rating ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
            <Ionicons name="star" size={10} color={colors.accent} />
            <Text style={{ fontSize: 11, color: colors.accent }}>{result.rating.toFixed(1)}</Text>
          </View>
        ) : null}
      </View>
      <TouchableOpacity
        onPress={onAdd}
        style={[styles.customResultAddBtn, isAdded && { backgroundColor: withAlpha(colors.primary, 0.12) }]}
      >
        <Ionicons name={isAdded ? 'checkmark' : 'add'} size={16} color={isAdded ? colors.textAccent : colors.textOnPrimary} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PlacesScreen({ tripId, places, destinations }: PlacesScreenProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { addPlace, removePlace, setItinerary } = useTripsStore();
  const [activeCategory, setActiveCategory] = useState('all');
  const [activeDestFilter, setActiveDestFilter] = useState('all');
  const [availSearch, setAvailSearch] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [generatingItinerary, setGeneratingItinerary] = useState(false);

  // Custom place search
  const [showCustomSearch, setShowCustomSearch] = useState(false);
  const [customQuery, setCustomQuery] = useState('');
  const [customDestId, setCustomDestId] = useState(destinations[0]?.id || '');
  const [customSearchEnabled, setCustomSearchEnabled] = useState(false);
  const customSearchQuery = trpc.places.textSearch.useQuery(
    {
      query: customQuery,
      locationBias: destinations.find((d) => d.id === customDestId)?.name || undefined,
    },
    { enabled: customSearchEnabled && customQuery.length >= 2 }
  );
  const customResults = customSearchQuery.data?.places || [];

  const handleCustomSearch = () => {
    if (customQuery.trim().length < 2) return;
    setCustomSearchEnabled(true);
  };

  const handleAddCustomPlace = async (result: any, destId: string) => {
    const place: Place = {
      id: generateId(),
      name: result.name,
      category: result.category as any,
      destinationId: destId,
      address: result.address,
      lat: result.lat,
      lng: result.lng,
      imageUrl: result.imageUrl,
      placeId: result.placeId,
      rating: result.rating,
      addedByAI: false,
    };
    Haptics.selectionAsync();
    await addPlace(tripId, place);
  };

  const generateItinerary = trpc.ai.generateItinerary.useMutation();

  const handleAddPlace = useCallback(async (place: Place) => {
    Haptics.selectionAsync();
    await addPlace(tripId, { ...place, id: generateId() });
  }, [tripId, addPlace]);

  const handleRemovePlace = useCallback(async (placeId: string) => {
    await removePlace(tripId, placeId);
  }, [tripId, removePlace]);

  // ── "Minha Viagem" filtered list ──
  const myPlaces = useMemo(() => {
    return places.filter((p) => {
      const matchCat  = activeCategory === 'all' || p.category === activeCategory;
      const matchDest = activeDestFilter === 'all' || p.destinationId === activeDestFilter;
      return matchCat && matchDest;
    });
  }, [places, activeCategory, activeDestFilter]);

  // Group my places by destination → category
  const grouped = useMemo(() => {
    return destinations.reduce((acc, dest) => {
      const destPlaces = myPlaces.filter((p) => p.destinationId === dest.id);
      if (destPlaces.length > 0) {
        const byCategory: Record<string, Place[]> = {};
        for (const cat of CATEGORIES.slice(1)) {
          const catPlaces = destPlaces.filter((p) => p.category === cat.key);
          if (catPlaces.length > 0) byCategory[cat.key] = catPlaces;
        }
        acc[dest.id] = { dest, byCategory };
      }
      return acc;
    }, {} as Record<string, { dest: Destination; byCategory: Record<string, Place[]> }>);
  }, [myPlaces, destinations]);

  const handleGenerateItinerary = async () => {
    if (places.length === 0) return;
    setGeneratingItinerary(true);
    try {
      const { trips } = useTripsStore.getState();
      const trip = trips.find((t) => t.id === tripId);
      if (!trip) return;
      const result = await generateItinerary.mutateAsync({
        tripId,
        startDate: trip.startDate,
        totalDays: trip.totalDays,
        destinations: trip.destinations.map((d) => ({ name: d.name, country: d.country, days: d.days })),
        selectedPlaces: places.map((p) => ({
          name: p.name,
          category: p.category,
          destinationName: trip.destinations.find((d) => d.id === p.destinationId)?.name || '',
          hours: p.hours,
          address: p.address,
        })),
        preferences: { pace: 'moderado', includeBreakfast: true, includeLunch: true, includeDinner: true },
      });
      if (result?.days) {
        await setItinerary(tripId, result.days);
      }
    } catch (e) {
      console.error('Itinerary generation error:', e);
    } finally {
      setGeneratingItinerary(false);
    }
  };

  return (
    <View>
      {/* ── MINHA VIAGEM ── */}
      <View style={styles.sectionBlock}>
        {/* Header row: label */}
        <View style={styles.myViagemHeader}>
          <Text style={styles.sectionLabel}>MINHA VIAGEM</Text>
        </View>

        {/* Destination filter */}
        {destinations.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}
            contentContainerStyle={{ gap: 6 }}>
            <TouchableOpacity
              onPress={() => setActiveDestFilter('all')}
              style={[styles.destChip, activeDestFilter === 'all' && styles.destChipActive]}
            >
              <Text style={[styles.destChipText, activeDestFilter === 'all' && styles.destChipTextActive]}>
                Todos
              </Text>
            </TouchableOpacity>
            {destinations.map((dest) => (
              <TouchableOpacity
                key={dest.id}
                onPress={() => setActiveDestFilter(dest.id)}
                style={[styles.destChip, activeDestFilter === dest.id && styles.destChipActive]}
              >
                <Text style={[styles.destChipText, activeDestFilter === dest.id && styles.destChipTextActive]}>
                  {dest.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Category filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}
          contentContainerStyle={{ gap: 6 }}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.key}
              onPress={() => setActiveCategory(cat.key)}
              style={[styles.catChip, activeCategory === cat.key && styles.catChipActive]}
            >
              <Ionicons name={cat.icon as any}
                size={12} color={activeCategory === cat.key ? colors.textAccent : colors.muted} />
              <Text style={[styles.catChipText, activeCategory === cat.key && styles.catChipTextActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Grouped places */}
        {Object.values(grouped).length > 0 ? (
          Object.values(grouped).map(({ dest, byCategory }) => (
            <View key={dest.id} style={{ marginBottom: 8 }}>
              {destinations.length > 1 && (
                <Text style={styles.destGroupLabel}>{dest.name}</Text>
              )}
              {Object.entries(byCategory).map(([catKey, catPlaces]) => (
                <View key={catKey}>
                  <Text style={styles.catGroupLabel}>{CATEGORY_LABELS[catKey] || catKey}</Text>
                  {catPlaces.map((place) => (
                    <MyPlaceRow
                      key={place.id}
                      place={place}
                      onPress={() => setSelectedPlace(place)}
                      onRemove={() => handleRemovePlace(place.id)}
                    />
                  ))}
                </View>
              ))}
            </View>
          ))
        ) : (
          <View style={styles.emptyMyPlaces}>
            <Ionicons name="location-outline" size={24} color={colors.muted} />
            <Text style={styles.emptyMyPlacesText}>
              {'Nenhum lugar adicionado ainda'}
            </Text>
          </View>
        )}
      </View>

      {/* ── DISPONÍVEIS (auto-loads) ── */}
      <View style={styles.sectionBlock}>
        <View style={styles.availHeader}>
          <Text style={styles.sectionLabel}>DISPONÍVEIS</Text>
          <Text style={styles.availSubtitle}>Sugestões para cada destino</Text>
        </View>

        {/* Search within Disponíveis */}
        <View style={[styles.searchRow, { marginBottom: 16 }]}>
          <Ionicons name="search-outline" size={15} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar lugares disponíveis..."
            placeholderTextColor={colors.muted}
            value={availSearch}
            onChangeText={setAvailSearch}
            returnKeyType="search"
          />
          {availSearch.length > 0 && (
            <TouchableOpacity onPress={() => setAvailSearch('')}>
              <Ionicons name="close-circle" size={15} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Pesquisa personalizada via Google Places ── */}
        <TouchableOpacity
          style={styles.customSearchToggleBtn}
          onPress={() => setShowCustomSearch(!showCustomSearch)}
        >
          <Ionicons name={showCustomSearch ? 'chevron-up' : 'add-circle-outline'} size={16} color={colors.textAccent} />
          <Text style={styles.customSearchToggleText}>
            {showCustomSearch ? 'Fechar pesquisa' : 'Pesquisar lugar que não aparece aqui'}
          </Text>
        </TouchableOpacity>

        {showCustomSearch && (
          <View style={styles.customSearchSection}>
            <View style={styles.customSearchHeader}>
              <Text style={styles.customSearchTitle}>PESQUISA PERSONALIZADA</Text>
              <Ionicons name="search" size={14} color={colors.textAccent} />
            </View>

            {/* Destination selector (if multiple) */}
            {destinations.length > 1 && (
              <View style={styles.customDestPicker}>
                {destinations.map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.customDestChip, customDestId === d.id && styles.customDestChipActive]}
                    onPress={() => { setCustomDestId(d.id); setCustomSearchEnabled(false); }}
                  >
                    <Text style={[styles.customDestChipText, customDestId === d.id && styles.customDestChipTextActive]}>
                      {d.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Search input + button */}
            <View style={styles.customSearchRow}>
              <TextInput
                style={styles.customSearchInput}
                placeholder="Ex: Museu do Louvre, restaurante italiano..."
                placeholderTextColor={colors.muted}
                value={customQuery}
                onChangeText={(t) => { setCustomQuery(t); setCustomSearchEnabled(false); }}
                returnKeyType="search"
                onSubmitEditing={handleCustomSearch}
              />
              <TouchableOpacity
                style={[styles.customSearchBtn, customQuery.trim().length < 2 && { opacity: 0.4 }]}
                onPress={handleCustomSearch}
                disabled={customQuery.trim().length < 2}
              >
                {customSearchQuery.isFetching ? (
                  <ActivityIndicator size="small" color={colors.textOnPrimary} />
                ) : (
                  <Text style={styles.customSearchBtnText}>Buscar</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Results */}
            {customSearchEnabled && !customSearchQuery.isFetching && customResults.length === 0 && customQuery.trim().length >= 2 && (
              <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: 12 }}>
                Nenhum resultado encontrado. Tente outros termos.
              </Text>
            )}
            {customResults.map((result: any) => (
              <CustomSearchResultRow
                key={result.placeId}
                result={result}
                isAdded={places.some((p) => p.placeId === result.placeId || p.name === result.name)}
                onAdd={() => handleAddCustomPlace(result, customDestId)}
              />
            ))}
          </View>
        )}

        {/* AI suggestions per destination — auto-loads */}
        {destinations.map((dest) => (
          <View key={dest.id} style={styles.destAiBlock}>
            {destinations.length > 1 && (
              <Text style={styles.destGroupLabel}>{dest.name}</Text>
            )}
            <AIPanel
              destination={dest}
              tripId={tripId}
              addedPlaces={places.filter((p) => p.destinationId === dest.id)}
              onAdd={(place) => handleAddPlace({ ...place, destinationId: dest.id })}
              onRemove={handleRemovePlace}
              activeCategory={activeCategory}
              searchQuery={availSearch}
            />
          </View>
        ))}
      </View>

      {/* My place detail modal */}
      {selectedPlace && (
        <PlaceDetailModal
          place={selectedPlace}
          tripId={tripId}
          onClose={() => setSelectedPlace(null)}
          isAdded={places.some((p) => p.id === selectedPlace.id)}
          onAdd={() => handleAddPlace({ ...selectedPlace, id: generateId() })}
          onRemove={() => handleRemovePlace(selectedPlace.id)}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  sectionBlock: { marginBottom: 20 },
  sectionLabel: {
    color: colors.muted,
    fontSize: 11, fontWeight: '700', letterSpacing: 1.5,
  },

  // Minha Viagem header
  myViagemHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  iaHeaderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.primary, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  iaHeaderBtnText: { fontSize: 12, fontWeight: '700', color: colors.textOnPrimary },

  // Available header
  availHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 },
  availSubtitle: { fontSize: 11, color: colors.muted },

  // Destination chips
  destChip: {
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
    backgroundColor: withAlpha(colors.foreground, 0.07),
  },
  // Selected-chip accent — a distinct fixed green, kept constant across themes.
  destChipActive: { backgroundColor: '#2D5A3D' },
  destChipText: { fontSize: 13, fontWeight: '500', color: colors.muted },
  destChipTextActive: { color: colors.textOnPrimary },

  // Category chips
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: withAlpha(colors.foreground, 0.06),
    borderWidth: 1, borderColor: 'transparent',
  },
  catChipActive: { backgroundColor: withAlpha(colors.primary, 0.12), borderColor: colors.primary },
  catChipText: { fontSize: 12, fontWeight: '500', color: colors.muted },
  catChipTextActive: { color: colors.textAccent },

  // Search
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: withAlpha(colors.foreground, 0.07),
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
    gap: 10, marginBottom: 12,
  },
  searchInput: { flex: 1, color: colors.foreground, fontSize: 14 },

  // Group labels
  destGroupLabel: {
    color: colors.textAccent, fontSize: 12, fontWeight: '700',
    letterSpacing: 0.5, marginBottom: 6, marginTop: 4,
  },
  catGroupLabel: {
    color: colors.muted, fontSize: 10, fontWeight: '700',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4, marginTop: 8,
  },

  // My place row
  myPlaceRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: withAlpha(colors.foreground, 0.06),
    borderRadius: 12, padding: 10, marginBottom: 6, gap: 10,
  },
  myPlaceThumb: { width: 40, height: 40, borderRadius: 8 },
  myPlaceName: { flex: 1, color: colors.foreground, fontSize: 14, fontWeight: '500' },
  removeBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: withAlpha(colors.error, 0.12),
    alignItems: 'center', justifyContent: 'center',
  },

  // Empty my places
  emptyMyPlaces: { alignItems: 'center', paddingVertical: 20, gap: 6 },
  emptyMyPlacesText: { color: colors.muted, fontSize: 13 },

  // AI loading/empty
  aiLoadingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 16, justifyContent: 'center',
  },
  aiLoadingText: { fontSize: 13, color: colors.muted },
  aiEmptyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12,
  },
  aiEmptyText: { flex: 1, color: colors.muted, fontSize: 13 },
  aiRefreshBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: withAlpha(colors.primary, 0.10),
    alignItems: 'center', justifyContent: 'center',
  },
  destAiBlock: { marginBottom: 16 },

  // Available place row
  availRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  availThumb: { width: 44, height: 44, borderRadius: 10 },
  availInfo: { flex: 1 },
  availName: { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  availDesc: { color: colors.muted, fontSize: 12, marginTop: 2 },
  addChip: {
    backgroundColor: withAlpha(colors.primary, 0.12),
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: withAlpha(colors.primary, 0.25),
  },
  addChipText: { fontSize: 12, fontWeight: '600', color: colors.textAccent },
  // Fixed decorative teal tint — matches the placeholder-icon accent, not theme-driven.
  addedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: withAlpha(ACCENT_TEAL, 0.08),
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6,
  },
  addedBadgeText: { fontSize: 12, fontWeight: '600', color: colors.textAccent },

  // Place Detail Modal
  // Full-screen backdrop scrim behind the bottom sheet — universal UI
  // pattern, intentionally theme-independent.
  modalOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: colors.overlayModal,
  },
  detailSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 32,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: withAlpha(colors.foreground, 0.2),
    alignSelf: 'center', marginTop: 12, marginBottom: 0,
  },
  placePhoto: { height: 180, marginHorizontal: 16, borderRadius: 16, marginTop: 12 },
  placePhotoPlaceholder: {
    height: 180, marginHorizontal: 16, borderRadius: 16, marginTop: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  detailContent: { paddingHorizontal: 20, paddingTop: 16 },
  closeBtn: {
    position: 'absolute', right: 0, top: 0,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: withAlpha(colors.foreground, 0.12),
    alignItems: 'center', justifyContent: 'center',
  },
  detailName: {
    fontSize: 22, fontStyle: 'italic', fontWeight: '700',
    color: colors.foreground, paddingRight: 40, lineHeight: 28,
  },
  detailCategory: {
    fontSize: 13, color: colors.muted, marginTop: 2, marginBottom: 12,
  },
  detailDesc: {
    fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 14,
  },
  detailRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12,
  },
  detailRowLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.5,
    color: colors.muted, textTransform: 'uppercase',
  },
  detailRowValue: { fontSize: 14, color: colors.foreground, marginTop: 2 },
  detailActions: { flexDirection: 'row', gap: 10, marginBottom: 14, marginTop: 4 },
  detailActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: withAlpha(colors.foreground, 0.08),
    borderRadius: 12, paddingVertical: 10,
  },
  detailActionText: { fontSize: 14, fontWeight: '600', color: colors.foreground },
  addActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: 14,
    paddingVertical: 14, marginTop: 4,
  },
  addActionText: { fontSize: 15, fontWeight: '700', color: colors.textOnPrimary },
  removeActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: withAlpha(colors.error, 0.12),
    borderRadius: 14, paddingVertical: 14, marginTop: 4,
    borderWidth: 1, borderColor: withAlpha(colors.error, 0.3),
  },
  removeActionText: { fontSize: 15, fontWeight: '700', color: colors.error },

  // Attachments
  attachSection: {
    marginTop: 12, marginBottom: 8,
    backgroundColor: withAlpha(colors.foreground, 0.04),
    borderRadius: 12, padding: 12, gap: 8,
  },
  attachSectionLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1,
    color: colors.muted, textTransform: 'uppercase', marginBottom: 4,
  },
  attachRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: withAlpha(colors.foreground, 0.06),
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
  },
  attachName: { flex: 1, fontSize: 13, color: colors.muted },
  attachRemove: { padding: 4 },

  // Custom search
  // Fixed decorative teal tint for the panel background, matches the
  // placeholder-icon accent used elsewhere in this file — not theme-driven.
  customSearchSection: {
    marginBottom: 16,
    backgroundColor: withAlpha(ACCENT_TEAL, 0.06),
    borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: withAlpha(colors.primary, 0.12),
  },
  customSearchHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
  },
  customSearchTitle: {
    fontSize: 12, fontWeight: '700', letterSpacing: 0.5, color: colors.textAccent,
  },
  customSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8,
  },
  customSearchInput: {
    flex: 1, backgroundColor: withAlpha(colors.foreground, 0.08),
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: colors.foreground, fontSize: 14,
    borderWidth: 1, borderColor: withAlpha(colors.foreground, 0.1),
  },
  customSearchBtn: {
    backgroundColor: colors.primary, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  customSearchBtnText: { fontSize: 13, fontWeight: '700', color: colors.textOnPrimary },
  customDestPicker: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10,
  },
  customDestChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, backgroundColor: withAlpha(colors.foreground, 0.08),
    borderWidth: 1, borderColor: withAlpha(colors.foreground, 0.12),
  },
  // Fixed decorative teal border — matches the placeholder-icon accent, not theme-driven.
  customDestChipActive: {
    backgroundColor: withAlpha(colors.primary, 0.15),
    borderColor: withAlpha(ACCENT_TEAL, 0.5),
  },
  customDestChipText: { fontSize: 12, color: colors.muted },
  customDestChipTextActive: { color: colors.textAccent, fontWeight: '600' },
  customResultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  customResultImg: { width: 44, height: 44, borderRadius: 8 },
  customResultName: { fontSize: 14, fontWeight: '500', color: colors.foreground },
  customResultAddr: { fontSize: 12, color: colors.muted, marginTop: 1 },
  customResultAddBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  customSearchToggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 4,
  },
  customSearchToggleText: {
    fontSize: 13, color: colors.textAccent, fontWeight: '600',
  },
});
