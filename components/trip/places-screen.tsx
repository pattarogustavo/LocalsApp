import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Pressable,
  ActivityIndicator,
  Linking,
  StyleSheet,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { trpc } from '@/lib/trpc';
import { useTripsStore } from '@/store/trips';
import { useColors } from '@/hooks/use-colors';
import { PaywallModal } from '@/components/paywall-modal';
import { generateId } from '@/utils/trip-helpers';
import type { Place, Destination } from '@/types/voyage';

interface PlacesScreenProps {
  tripId: string;
  places: Place[];
  destinations: Destination[];
}

const CATEGORIES = [
  { key: 'all', label: 'Todos', icon: 'grid-outline' },
  { key: 'attraction', label: 'Atrações', icon: 'camera-outline' },
  { key: 'restaurant', label: 'Restaurantes', icon: 'restaurant-outline' },
  { key: 'cafe', label: 'Cafés', icon: 'cafe-outline' },
  { key: 'museum', label: 'Museus', icon: 'book-outline' },
  { key: 'hidden_gem', label: 'Hidden Gems', icon: 'diamond-outline' },
];

const CATEGORY_LABELS: Record<string, string> = {
  attraction: 'Atrações',
  restaurant: 'Restaurantes',
  cafe: 'Cafés',
  museum: 'Museus',
  hidden_gem: 'Hidden Gems',
};

// ─── Place Detail Modal ──────────────────────────────────────────────────────

function PlaceDetailModal({
  place,
  onClose,
  onAdd,
  onRemove,
  isAdded,
}: {
  place: Place;
  onClose: () => void;
  onAdd?: () => void;
  onRemove?: () => void;
  isAdded: boolean;
}) {
  const colors = useColors();

  const openMaps = () => {
    if (place.lat && place.lng) {
      Linking.openURL(`https://maps.google.com/?q=${place.lat},${place.lng}`);
    } else if (place.address) {
      Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(place.address)}`);
    }
  };

  const openSite = () => {
    if (place.website) Linking.openURL(place.website);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.detailSheet, { backgroundColor: colors.background }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {/* Place image placeholder */}
          <View style={[styles.placeImagePlaceholder, { backgroundColor: '#1A3A2A' }]}>
            <Ionicons name="location" size={40} color="#52B788" />
          </View>

          <View style={styles.detailContent}>
            <Pressable onPress={onClose} style={[styles.closeBtn, { backgroundColor: colors.surface }]}>
              <Ionicons name="close" size={16} color={colors.foreground} />
            </Pressable>

            <Text style={[styles.detailName, { color: colors.foreground }]}>{place.name}</Text>
            {place.description && (
              <Text style={[styles.detailDesc, { color: colors.muted }]}>{place.description}</Text>
            )}

            {place.hours && (
              <View style={styles.detailRow}>
                <Ionicons name="time-outline" size={14} color={colors.muted} />
                <View>
                  <Text style={[styles.detailRowLabel, { color: colors.muted }]}>HORÁRIO</Text>
                  <Text style={[styles.detailRowValue, { color: colors.foreground }]}>{place.hours}</Text>
                </View>
              </View>
            )}

            {place.address && (
              <View style={styles.detailRow}>
                <Ionicons name="location-outline" size={14} color={colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.detailRowLabel, { color: colors.muted }]}>ENDEREÇO</Text>
                  <Text style={[styles.detailRowValue, { color: colors.foreground }]}>{place.address}</Text>
                </View>
              </View>
            )}

            <View style={styles.detailActions}>
              {(place.website) && (
                <TouchableOpacity onPress={openSite} style={[styles.detailActionBtn, { backgroundColor: colors.surface }]}>
                  <Ionicons name="globe-outline" size={16} color={colors.foreground} />
                  <Text style={[styles.detailActionText, { color: colors.foreground }]}>Site</Text>
                </TouchableOpacity>
              )}
              {(place.lat || place.address) && (
                <TouchableOpacity onPress={openMaps} style={[styles.detailActionBtn, { backgroundColor: colors.surface }]}>
                  <Ionicons name="map-outline" size={16} color={colors.foreground} />
                  <Text style={[styles.detailActionText, { color: colors.foreground }]}>Maps</Text>
                </TouchableOpacity>
              )}
            </View>

            {isAdded ? (
              <TouchableOpacity
                onPress={() => { onRemove?.(); onClose(); }}
                style={[styles.addBtn, { backgroundColor: '#C0392B22', borderColor: '#C0392B', borderWidth: 1 }]}
              >
                <Ionicons name="trash-outline" size={16} color="#C0392B" />
                <Text style={[styles.addBtnText, { color: '#C0392B' }]}>Remover da viagem</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => { onAdd?.(); onClose(); }}
                style={[styles.addBtn, { backgroundColor: '#1C3D2E' }]}
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={[styles.addBtnText, { color: '#fff' }]}>Adicionar à viagem</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── AI Places Panel ─────────────────────────────────────────────────────────

function AIPlacesPanel({
  destination,
  tripId,
  addedPlaces,
  onAdd,
  onRemove,
}: {
  destination: Destination;
  tripId: string;
  addedPlaces: Place[];
  onAdd: (place: Place) => void;
  onRemove: (placeId: string) => void;
}) {
  const colors = useColors();
  const { userPlan, updateUserPlan } = useTripsStore();
  const [showPaywall, setShowPaywall] = useState(false);
  const [aiPlaces, setAiPlaces] = useState<Record<string, Place[]>>({});
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [activeCategory, setActiveCategory] = useState('all');

  const suggestMutation = trpc.ai.suggestPlaces.useMutation({
    onSuccess: (data) => {
      if (data.places) {
        const mapped: Record<string, Place[]> = {};
        const categoryMap: Record<string, string> = {
          attractions: 'attraction',
          restaurants: 'restaurant',
          cafes: 'cafe',
          museums: 'museum',
          hidden_gems: 'hidden_gem',
        };
        for (const [rawKey, items] of Object.entries(data.places as Record<string, any[]>)) {
          const cat = categoryMap[rawKey] || rawKey;
          mapped[cat] = (items || []).map((item: any) => ({
            id: generateId(),
            name: item.name,
            category: cat as any,
            address: item.address,
            hours: item.hours,
            description: item.description,
            website: item.website,
            destinationId: destination.id,
            addedByAI: true,
          }));
        }
        setAiPlaces(mapped);
        if (userPlan.tier === 'free') {
          updateUserPlan({ aiCreditsUsed: userPlan.aiCreditsUsed + 1 });
        }
      }
    },
  });

  const handleLoadAI = () => {
    const canUseAI = userPlan.tier !== 'free' || userPlan.aiCreditsUsed < userPlan.aiCreditsLimit;
    if (!canUseAI) {
      setShowPaywall(true);
      return;
    }
    suggestMutation.mutate({
      destination: destination.name,
      country: destination.country,
      days: destination.days,
    });
  };

  const allAiPlaces = Object.values(aiPlaces).flat();
  const hasAiPlaces = allAiPlaces.length > 0;

  const filteredAiPlaces = activeCategory === 'all'
    ? allAiPlaces
    : (aiPlaces[activeCategory] || []);

  const isAdded = (place: Place) => addedPlaces.some((p) => p.name === place.name);

  return (
    <View style={[styles.aiPanel, { backgroundColor: '#1A3A2A' }]}>
      <View style={styles.aiPanelHeader}>
        <View style={styles.aiPanelTitleRow}>
          <Ionicons name="sparkles" size={14} color="#A8D5B5" />
          <Text style={styles.aiPanelTitle}>SUGESTÕES IA — {destination.name.toUpperCase()}</Text>
        </View>
        {!hasAiPlaces && (
          <TouchableOpacity
            onPress={handleLoadAI}
            disabled={suggestMutation.isPending}
            style={[styles.aiLoadBtn, { opacity: suggestMutation.isPending ? 0.7 : 1 }]}
          >
            {suggestMutation.isPending ? (
              <ActivityIndicator size="small" color="#A8D5B5" />
            ) : (
              <>
                <Ionicons name="sparkles" size={12} color="#A8D5B5" />
                <Text style={styles.aiLoadBtnText}>Sugerir lugares</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        {hasAiPlaces && (
          <TouchableOpacity
            onPress={handleLoadAI}
            style={styles.aiRefreshBtn}
          >
            <Ionicons name="refresh-outline" size={14} color="#A8D5B5" />
          </TouchableOpacity>
        )}
      </View>

      {hasAiPlaces && (
        <>
          {/* Category filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
            {CATEGORIES.map((cat) => {
              const count = cat.key === 'all' ? allAiPlaces.length : (aiPlaces[cat.key] || []).length;
              if (count === 0 && cat.key !== 'all') return null;
              return (
                <TouchableOpacity
                  key={cat.key}
                  onPress={() => setActiveCategory(cat.key)}
                  style={[
                    styles.catChip,
                    {
                      backgroundColor: activeCategory === cat.key ? 'rgba(82,183,136,0.3)' : 'rgba(255,255,255,0.07)',
                      borderColor: activeCategory === cat.key ? '#52B788' : 'transparent',
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Text style={[styles.catChipText, { color: activeCategory === cat.key ? '#52B788' : 'rgba(245,240,232,0.6)' }]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {filteredAiPlaces.map((place) => {
            const added = isAdded(place);
            return (
              <TouchableOpacity
                key={place.id}
                onPress={() => setSelectedPlace(place)}
                style={styles.placeRow}
              >
                <View style={[styles.placeIconBox, { backgroundColor: 'rgba(82,183,136,0.15)' }]}>
                  <Ionicons name="location" size={16} color="#52B788" />
                </View>
                <View style={styles.placeInfo}>
                  <Text style={styles.placeName}>{place.name}</Text>
                  {place.description && (
                    <Text style={styles.placeDesc} numberOfLines={1}>{place.description}</Text>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => added ? onRemove(addedPlaces.find((p) => p.name === place.name)!.id) : onAdd(place)}
                  style={[
                    styles.addChip,
                    { backgroundColor: added ? 'rgba(192,57,43,0.2)' : 'rgba(82,183,136,0.2)' },
                  ]}
                >
                  <Text style={[styles.addChipText, { color: added ? '#E74C3C' : '#52B788' }]}>
                    {added ? 'Remover' : 'Adicionar'}
                  </Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
        </>
      )}

      {!hasAiPlaces && !suggestMutation.isPending && (
        <Text style={styles.aiEmptyText}>
          Clique em "Sugerir lugares" para ver recomendações da IA para {destination.name}
        </Text>
      )}

      {selectedPlace && (
        <PlaceDetailModal
          place={selectedPlace}
          onClose={() => setSelectedPlace(null)}
          isAdded={isAdded(selectedPlace)}
          onAdd={() => onAdd(selectedPlace)}
          onRemove={() => {
            const added = addedPlaces.find((p) => p.name === selectedPlace.name);
            if (added) onRemove(added.id);
          }}
        />
      )}

      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} feature="sugestões de lugares" />
    </View>
  );
}

// ─── Main PlacesScreen ───────────────────────────────────────────────────────

export function PlacesScreen({ tripId, places, destinations }: PlacesScreenProps) {
  const colors = useColors();
  const { addPlace, removePlace } = useTripsStore();
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeDestFilter, setActiveDestFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);

  const handleAddPlace = useCallback(async (place: Place) => {
    const newPlace: Place = { ...place, id: generateId(), destinationId: place.destinationId };
    await addPlace(tripId, newPlace);
  }, [tripId, addPlace]);

  const handleRemovePlace = useCallback(async (placeId: string) => {
    await removePlace(tripId, placeId);
  }, [tripId, removePlace]);

  const filteredPlaces = places.filter((p) => {
    const matchCat = activeFilter === 'all' || p.category === activeFilter;
    const matchDest = activeDestFilter === 'all' || p.destinationId === activeDestFilter;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchDest && matchSearch;
  });

  // Group by destination
  const groupedByDest = destinations.reduce((acc, dest) => {
    const destPlaces = filteredPlaces.filter((p) => p.destinationId === dest.id);
    if (destPlaces.length > 0) {
      acc[dest.id] = { dest, places: destPlaces };
    }
    return acc;
  }, {} as Record<string, { dest: Destination; places: Place[] }>);

  // Group by category within each destination
  const getByCategory = (destPlaces: Place[]) => {
    return CATEGORIES.slice(1).reduce((acc, cat) => {
      const catPlaces = destPlaces.filter((p) => p.category === cat.key);
      if (catPlaces.length > 0) acc[cat.key] = catPlaces;
      return acc;
    }, {} as Record<string, Place[]>);
  };

  return (
    <View>
      {/* My Places Section */}
      {places.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={styles.sectionHeader}>MINHA VIAGEM</Text>

          {/* Dest filter */}
          {destinations.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
              <TouchableOpacity
                onPress={() => setActiveDestFilter('all')}
                style={[styles.destChip, { backgroundColor: activeDestFilter === 'all' ? '#2D5A3D' : 'rgba(255,255,255,0.1)' }]}
              >
                <Text style={[styles.destChipText, { color: activeDestFilter === 'all' ? '#fff' : 'rgba(245,240,232,0.6)' }]}>
                  Todos
                </Text>
              </TouchableOpacity>
              {destinations.map((dest) => (
                <TouchableOpacity
                  key={dest.id}
                  onPress={() => setActiveDestFilter(dest.id)}
                  style={[styles.destChip, { backgroundColor: activeDestFilter === dest.id ? '#2D5A3D' : 'rgba(255,255,255,0.1)' }]}
                >
                  <Text style={[styles.destChipText, { color: activeDestFilter === dest.id ? '#fff' : 'rgba(245,240,232,0.6)' }]}>
                    {dest.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Category filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.key}
                onPress={() => setActiveFilter(cat.key)}
                style={[
                  styles.catChip,
                  {
                    backgroundColor: activeFilter === cat.key ? 'rgba(82,183,136,0.3)' : 'rgba(255,255,255,0.07)',
                    borderColor: activeFilter === cat.key ? '#52B788' : 'transparent',
                    borderWidth: 1,
                  },
                ]}
              >
                <Ionicons name={cat.icon as any} size={12} color={activeFilter === cat.key ? '#52B788' : 'rgba(245,240,232,0.5)'} />
                <Text style={[styles.catChipText, { color: activeFilter === cat.key ? '#52B788' : 'rgba(245,240,232,0.5)' }]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {Object.values(groupedByDest).map(({ dest, places: destPlaces }) => {
            const byCategory = getByCategory(destPlaces);
            return (
              <View key={dest.id} style={{ marginBottom: 12 }}>
                {destinations.length > 1 && (
                  <Text style={styles.destGroupLabel}>{dest.name}</Text>
                )}
                {Object.entries(byCategory).map(([catKey, catPlaces]) => (
                  <View key={catKey}>
                    <Text style={styles.catGroupLabel}>{CATEGORY_LABELS[catKey] || catKey}</Text>
                    {catPlaces.map((place) => (
                      <TouchableOpacity
                        key={place.id}
                        onPress={() => setSelectedPlace(place)}
                        style={styles.myPlaceRow}
                      >
                        <View style={styles.myPlaceIcon}>
                          <Ionicons name="location" size={14} color="#52B788" />
                        </View>
                        <Text style={styles.myPlaceName}>{place.name}</Text>
                        <TouchableOpacity
                          onPress={() => handleRemovePlace(place.id)}
                          style={styles.removeBtn}
                        >
                          <Ionicons name="trash-outline" size={14} color="#E74C3C" />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </View>
            );
          })}

          {filteredPlaces.length === 0 && (
            <Text style={styles.emptyText}>Nenhum lugar encontrado com os filtros selecionados</Text>
          )}
        </View>
      )}

      {/* Search */}
      <View style={[styles.searchRow, { backgroundColor: 'rgba(255,255,255,0.07)' }]}>
        <Ionicons name="search-outline" size={16} color="rgba(245,240,232,0.4)" />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar lugares..."
          placeholderTextColor="rgba(245,240,232,0.4)"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color="rgba(245,240,232,0.4)" />
          </TouchableOpacity>
        )}
      </View>

      {/* AI Suggestions per destination */}
      <Text style={[styles.sectionHeader, { marginTop: 16 }]}>SUGESTÕES POR DESTINO</Text>
      {destinations.map((dest) => (
        <AIPlacesPanel
          key={dest.id}
          destination={dest}
          tripId={tripId}
          addedPlaces={places.filter((p) => p.destinationId === dest.id)}
          onAdd={(place) => handleAddPlace({ ...place, destinationId: dest.id })}
          onRemove={handleRemovePlace}
        />
      ))}

      {/* Place detail modal */}
      {selectedPlace && (
        <PlaceDetailModal
          place={selectedPlace}
          onClose={() => setSelectedPlace(null)}
          isAdded={places.some((p) => p.id === selectedPlace.id)}
          onRemove={() => handleRemovePlace(selectedPlace.id)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    color: 'rgba(245,240,232,0.5)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  destChip: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
  },
  destChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  catScroll: {
    marginBottom: 10,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  catChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  destGroupLabel: {
    color: '#A8D5B5',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 4,
  },
  catGroupLabel: {
    color: 'rgba(245,240,232,0.4)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  myPlaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    gap: 10,
  },
  myPlaceIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(82,183,136,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  myPlaceName: {
    flex: 1,
    color: '#F5F0E8',
    fontSize: 14,
    fontWeight: '500',
  },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(192,57,43,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 4,
  },
  searchInput: {
    flex: 1,
    color: '#F5F0E8',
    fontSize: 14,
  },
  emptyText: {
    color: 'rgba(245,240,232,0.4)',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 12,
  },
  // AI Panel
  aiPanel: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  aiPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  aiPanelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aiPanelTitle: {
    color: '#A8D5B5',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  aiLoadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(82,183,136,0.2)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  aiLoadBtnText: {
    color: '#A8D5B5',
    fontSize: 12,
    fontWeight: '600',
  },
  aiRefreshBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiEmptyText: {
    color: 'rgba(245,240,232,0.4)',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },
  placeIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeInfo: {
    flex: 1,
  },
  placeName: {
    color: '#F5F0E8',
    fontSize: 14,
    fontWeight: '500',
  },
  placeDesc: {
    color: 'rgba(245,240,232,0.5)',
    fontSize: 12,
    marginTop: 1,
  },
  addChip: {
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  addChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  // Place Detail Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  detailSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  placeImagePlaceholder: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    borderRadius: 16,
    marginBottom: 16,
  },
  detailContent: {
    paddingHorizontal: 20,
  },
  closeBtn: {
    position: 'absolute',
    right: 20,
    top: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailName: {
    fontSize: 22,
    fontStyle: 'italic',
    fontFamily: 'serif',
    fontWeight: '600',
    marginBottom: 4,
    paddingRight: 40,
  },
  detailDesc: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 12,
  },
  detailRowLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  detailRowValue: {
    fontSize: 14,
    marginTop: 2,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
    marginTop: 4,
  },
  detailActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 12,
  },
  detailActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
  },
  addBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
