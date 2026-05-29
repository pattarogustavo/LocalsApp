import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Image, Modal, Linking, ActivityIndicator,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTripsStore } from '@/store/trips';
import { trpc } from '@/lib/trpc';
import type { Place, Destination } from '@/types/voyage';
import { generateId } from '@/utils/trip-helpers';

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
  onClose,
  isAdded,
  onAdd,
  onRemove,
}: {
  place: Place;
  onClose: () => void;
  isAdded: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
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
            <View style={[styles.placePhotoPlaceholder, { backgroundColor: 'rgba(82,183,136,0.12)' }]}>
              <Ionicons name={CATEGORY_ICONS[place.category] as any || 'location-outline'} size={40} color="rgba(82,183,136,0.4)" />
            </View>
          )}

          <View style={styles.detailContent}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={16} color="rgba(245,240,232,0.7)" />
            </TouchableOpacity>

            <Text style={styles.detailName}>{place.name}</Text>
            <Text style={styles.detailCategory}>{CATEGORY_LABELS[place.category] || place.category}</Text>

            {place.description ? (
              <Text style={styles.detailDesc}>{place.description}</Text>
            ) : null}

            {place.hours ? (
              <View style={styles.detailRow}>
                <Ionicons name="time-outline" size={15} color="rgba(245,240,232,0.4)" />
                <View>
                  <Text style={styles.detailRowLabel}>HORÁRIO</Text>
                  <Text style={styles.detailRowValue}>{place.hours}</Text>
                </View>
              </View>
            ) : null}

            {place.address ? (
              <View style={styles.detailRow}>
                <Ionicons name="location-outline" size={15} color="rgba(245,240,232,0.4)" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailRowLabel}>ENDEREÇO</Text>
                  <Text style={styles.detailRowValue}>{place.address}</Text>
                </View>
              </View>
            ) : null}

            {place.phone ? (
              <View style={styles.detailRow}>
                <Ionicons name="call-outline" size={15} color="rgba(245,240,232,0.4)" />
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
                    <Ionicons name="globe-outline" size={16} color="#F5F0E8" />
                    <Text style={styles.detailActionText}>Site</Text>
                  </TouchableOpacity>
                ) : null}
                {(place.address || (place.lat && place.lng)) ? (
                  <TouchableOpacity onPress={openMaps} style={styles.detailActionBtn}>
                    <Ionicons name="map-outline" size={16} color="#F5F0E8" />
                    <Text style={styles.detailActionText}>Maps</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {isAdded ? (
              <TouchableOpacity
                onPress={() => { onRemove(); onClose(); }}
                style={styles.removeActionBtn}
              >
                <Ionicons name="trash-outline" size={16} color="#E74C3C" />
                <Text style={styles.removeActionText}>Remover da Viagem</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => { onAdd(); onClose(); }}
                style={styles.addActionBtn}
              >
                <Ionicons name="add" size={18} color="#0F1F16" />
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
  return (
    <TouchableOpacity onPress={onPress} style={styles.myPlaceRow} activeOpacity={0.75}>
      {place.imageUrl ? (
        <Image source={{ uri: place.imageUrl }} style={styles.myPlaceThumb} resizeMode="cover" />
      ) : (
        <View style={[styles.myPlaceThumb, { backgroundColor: 'rgba(82,183,136,0.12)', alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name={CATEGORY_ICONS[place.category] as any || 'location-outline'} size={18} color="rgba(82,183,136,0.5)" />
        </View>
      )}
      <Text style={styles.myPlaceName} numberOfLines={1}>{place.name}</Text>
      <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
        <Ionicons name="trash-outline" size={15} color="#E74C3C" />
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
  return (
    <TouchableOpacity onPress={onPress} style={styles.availRow} activeOpacity={0.75}>
      {place.imageUrl ? (
        <Image source={{ uri: place.imageUrl }} style={styles.availThumb} resizeMode="cover" />
      ) : (
        <View style={[styles.availThumb, { backgroundColor: 'rgba(82,183,136,0.12)', alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name={CATEGORY_ICONS[place.category] as any || 'location-outline'} size={20} color="rgba(82,183,136,0.5)" />
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
          <Ionicons name="checkmark" size={12} color="#52B788" />
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
  addedPlaces,
  onAdd,
  onRemove,
  activeCategory,
  searchQuery,
}: {
  destination: Destination;
  addedPlaces: Place[];
  onAdd: (place: Place) => void;
  onRemove: (id: string) => void;
  activeCategory: string;
  searchQuery: string;
}) {
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const fetchedRef = useRef(false);

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
      });
      if (result?.places) {
        setSuggestions(result.places.map((p: any) => ({ ...p, id: generateId() })));
      }
    } catch (e) {
      console.error('AI suggest places error:', e);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [destination.name, destination.country]);

  // Auto-load on mount
  useEffect(() => {
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
        <ActivityIndicator size="small" color="#52B788" />
        <Text style={styles.aiLoadingText}>Buscando sugestões para {destination.name}...</Text>
      </View>
    );
  }

  if (loaded && filtered.length === 0) {
    return (
      <View style={styles.aiEmptyRow}>
        <Ionicons name="search-outline" size={16} color="rgba(245,240,232,0.3)" />
        <Text style={styles.aiEmptyText}>
          {searchQuery ? `Nenhum resultado para "${searchQuery}"` : 'Nenhuma sugestão disponível'}
        </Text>
        <TouchableOpacity
          onPress={() => { fetchedRef.current = false; loadSuggestions(); }}
          style={styles.aiRefreshBtn}
        >
          <Ionicons name="refresh-outline" size={14} color="#52B788" />
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

export function PlacesScreen({ tripId, places, destinations }: PlacesScreenProps) {
  const { addPlace, removePlace, setItinerary } = useTripsStore();
  const [activeCategory, setActiveCategory] = useState('all');
  const [activeDestFilter, setActiveDestFilter] = useState('all');
  const [availSearch, setAvailSearch] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [generatingItinerary, setGeneratingItinerary] = useState(false);

  const generateItinerary = trpc.ai.generateItinerary.useMutation();

  const handleAddPlace = useCallback(async (place: Place) => {
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
        {/* Header row: label + IA button */}
        <View style={styles.myViagemHeader}>
          <Text style={styles.sectionLabel}>MINHA VIAGEM</Text>
          {places.length > 0 && (
            <TouchableOpacity
              onPress={handleGenerateItinerary}
              style={styles.iaHeaderBtn}
              disabled={generatingItinerary}
            >
              {generatingItinerary ? (
                <ActivityIndicator size="small" color="#0F1F16" />
              ) : (
                <>
                  <Ionicons name="sparkles-outline" size={13} color="#0F1F16" />
                  <Text style={styles.iaHeaderBtnText}>Montar Roteiro</Text>
                </>
              )}
            </TouchableOpacity>
          )}
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
                size={12} color={activeCategory === cat.key ? '#52B788' : 'rgba(245,240,232,0.45)'} />
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
            <Ionicons name="location-outline" size={24} color="rgba(245,240,232,0.2)" />
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
          <Ionicons name="search-outline" size={15} color="rgba(245,240,232,0.4)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar lugares disponíveis..."
            placeholderTextColor="rgba(245,240,232,0.3)"
            value={availSearch}
            onChangeText={setAvailSearch}
            returnKeyType="search"
          />
          {availSearch.length > 0 && (
            <TouchableOpacity onPress={() => setAvailSearch('')}>
              <Ionicons name="close-circle" size={15} color="rgba(245,240,232,0.4)" />
            </TouchableOpacity>
          )}
        </View>

        {/* AI suggestions per destination — auto-loads */}
        {destinations.map((dest) => (
          <View key={dest.id} style={styles.destAiBlock}>
            {destinations.length > 1 && (
              <Text style={styles.destGroupLabel}>{dest.name}</Text>
            )}
            <AIPanel
              destination={dest}
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

const styles = StyleSheet.create({
  sectionBlock: { marginBottom: 20 },
  sectionLabel: {
    color: 'rgba(245,240,232,0.5)',
    fontSize: 11, fontWeight: '700', letterSpacing: 1.5,
  },

  // Minha Viagem header
  myViagemHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  iaHeaderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#52B788', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  iaHeaderBtnText: { fontSize: 12, fontWeight: '700', color: '#0F1F16' },

  // Available header
  availHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 },
  availSubtitle: { fontSize: 11, color: 'rgba(245,240,232,0.3)' },

  // Destination chips
  destChip: {
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  destChipActive: { backgroundColor: '#2D5A3D' },
  destChipText: { fontSize: 13, fontWeight: '500', color: 'rgba(245,240,232,0.6)' },
  destChipTextActive: { color: '#F5F0E8' },

  // Category chips
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'transparent',
  },
  catChipActive: { backgroundColor: 'rgba(82,183,136,0.15)', borderColor: '#52B788' },
  catChipText: { fontSize: 12, fontWeight: '500', color: 'rgba(245,240,232,0.45)' },
  catChipTextActive: { color: '#52B788' },

  // Search
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
    gap: 10, marginBottom: 12,
  },
  searchInput: { flex: 1, color: '#F5F0E8', fontSize: 14 },

  // Group labels
  destGroupLabel: {
    color: '#A8D5B5', fontSize: 12, fontWeight: '700',
    letterSpacing: 0.5, marginBottom: 6, marginTop: 4,
  },
  catGroupLabel: {
    color: 'rgba(245,240,232,0.35)', fontSize: 10, fontWeight: '700',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4, marginTop: 8,
  },

  // My place row
  myPlaceRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12, padding: 10, marginBottom: 6, gap: 10,
  },
  myPlaceThumb: { width: 40, height: 40, borderRadius: 8 },
  myPlaceName: { flex: 1, color: '#F5F0E8', fontSize: 14, fontWeight: '500' },
  removeBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: 'rgba(231,76,60,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Empty my places
  emptyMyPlaces: { alignItems: 'center', paddingVertical: 20, gap: 6 },
  emptyMyPlacesText: { color: 'rgba(245,240,232,0.35)', fontSize: 13 },

  // AI loading/empty
  aiLoadingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 16, justifyContent: 'center',
  },
  aiLoadingText: { fontSize: 13, color: 'rgba(245,240,232,0.4)' },
  aiEmptyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12,
  },
  aiEmptyText: { flex: 1, color: 'rgba(245,240,232,0.4)', fontSize: 13 },
  aiRefreshBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(82,183,136,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  destAiBlock: { marginBottom: 16 },

  // Available place row
  availRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  availThumb: { width: 44, height: 44, borderRadius: 10 },
  availInfo: { flex: 1 },
  availName: { color: '#F5F0E8', fontSize: 14, fontWeight: '500' },
  availDesc: { color: 'rgba(245,240,232,0.45)', fontSize: 12, marginTop: 2 },
  addChip: {
    backgroundColor: 'rgba(82,183,136,0.15)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(82,183,136,0.3)',
  },
  addChipText: { fontSize: 12, fontWeight: '600', color: '#52B788' },
  addedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(82,183,136,0.08)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6,
  },
  addedBadgeText: { fontSize: 12, fontWeight: '600', color: '#52B788' },

  // Place Detail Modal
  modalOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  detailSheet: {
    backgroundColor: '#1A2E22',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 32,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
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
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  detailName: {
    fontSize: 22, fontStyle: 'italic', fontWeight: '700',
    color: '#F5F0E8', paddingRight: 40, lineHeight: 28,
  },
  detailCategory: {
    fontSize: 13, color: 'rgba(245,240,232,0.5)', marginTop: 2, marginBottom: 12,
  },
  detailDesc: {
    fontSize: 14, color: 'rgba(245,240,232,0.7)', lineHeight: 20, marginBottom: 14,
  },
  detailRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12,
  },
  detailRowLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.5,
    color: 'rgba(245,240,232,0.4)', textTransform: 'uppercase',
  },
  detailRowValue: { fontSize: 14, color: '#F5F0E8', marginTop: 2 },
  detailActions: { flexDirection: 'row', gap: 10, marginBottom: 14, marginTop: 4 },
  detailActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12, paddingVertical: 10,
  },
  detailActionText: { fontSize: 14, fontWeight: '600', color: '#F5F0E8' },
  addActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#52B788', borderRadius: 14,
    paddingVertical: 14, marginTop: 4,
  },
  addActionText: { fontSize: 15, fontWeight: '700', color: '#0F1F16' },
  removeActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(231,76,60,0.12)',
    borderRadius: 14, paddingVertical: 14, marginTop: 4,
    borderWidth: 1, borderColor: 'rgba(231,76,60,0.3)',
  },
  removeActionText: { fontSize: 15, fontWeight: '700', color: '#E74C3C' },
});
