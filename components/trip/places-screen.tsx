import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Modal,
  TextInput, ActivityIndicator, Linking, StyleSheet, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { trpc } from '@/lib/trpc';
import { useTripsStore } from '@/store/trips';
import { PaywallModal } from '@/components/paywall-modal';
import { generateId } from '@/utils/trip-helpers';
import type { Place, Destination } from '@/types/voyage';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'all',        label: 'Todos',        icon: 'grid-outline' as const },
  { key: 'attraction', label: 'Atrações',     icon: 'camera-outline' as const },
  { key: 'restaurant', label: 'Restaurantes', icon: 'restaurant-outline' as const },
  { key: 'cafe',       label: 'Cafés',        icon: 'cafe-outline' as const },
  { key: 'museum',     label: 'Museus',       icon: 'book-outline' as const },
  { key: 'hidden_gem', label: 'Hidden Gems',  icon: 'diamond-outline' as const },
];

const CATEGORY_LABELS: Record<string, string> = {
  attraction: 'Atrações',
  restaurant: 'Restaurantes',
  cafe: 'Cafés',
  museum: 'Museus',
  hidden_gem: 'Hidden Gems',
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

const CATEGORY_COLORS: Record<string, string> = {
  attraction: '#52B788',
  restaurant: '#E07B5A',
  cafe: '#C4A35A',
  museum: '#7B9FD4',
  hidden_gem: '#B88BF5',
  other: '#A8D5B5',
};

// ─── Place Detail Modal ───────────────────────────────────────────────────────

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
  const catColor = CATEGORY_COLORS[place.category] || '#52B788';

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
            <View style={[styles.placePhotoPlaceholder, { backgroundColor: `${catColor}18` }]}>
              <Ionicons name={CATEGORY_ICONS[place.category] as any} size={40} color={catColor} />
            </View>
          )}

          <View style={styles.detailContent}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={16} color="#F5F0E8" />
            </TouchableOpacity>

            <Text style={styles.detailName}>{place.name}</Text>
            <Text style={styles.detailCategory}>{CATEGORY_LABELS[place.category] || place.category}</Text>

            {place.description ? (
              <Text style={styles.detailDesc}>{place.description}</Text>
            ) : null}

            {place.hours ? (
              <View style={styles.detailRow}>
                <Ionicons name="time-outline" size={14} color="rgba(245,240,232,0.4)" />
                <View>
                  <Text style={styles.detailRowLabel}>HORÁRIO</Text>
                  <Text style={styles.detailRowValue}>{place.hours}</Text>
                </View>
              </View>
            ) : null}

            {place.address ? (
              <View style={styles.detailRow}>
                <Ionicons name="location-outline" size={14} color="rgba(245,240,232,0.4)" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailRowLabel}>ENDEREÇO</Text>
                  <Text style={styles.detailRowValue}>{place.address}</Text>
                </View>
              </View>
            ) : null}

            {place.phone ? (
              <View style={styles.detailRow}>
                <Ionicons name="call-outline" size={14} color="rgba(245,240,232,0.4)" />
                <View>
                  <Text style={styles.detailRowLabel}>TELEFONE</Text>
                  <Text style={styles.detailRowValue}>{place.phone}</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.detailActions}>
              {(place.website) ? (
                <TouchableOpacity onPress={() => Linking.openURL(place.website!)} style={styles.detailActionBtn}>
                  <Ionicons name="globe-outline" size={16} color="#F5F0E8" />
                  <Text style={styles.detailActionText}>Site</Text>
                </TouchableOpacity>
              ) : null}
              {(place.lat || place.address) ? (
                <TouchableOpacity onPress={openMaps} style={styles.detailActionBtn}>
                  <Ionicons name="map-outline" size={16} color="#F5F0E8" />
                  <Text style={styles.detailActionText}>Maps</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {isAdded ? (
              <TouchableOpacity
                onPress={() => { onRemove?.(); onClose(); }}
                style={styles.removeActionBtn}
              >
                <Ionicons name="trash-outline" size={16} color="#E74C3C" />
                <Text style={styles.removeActionText}>Remover da viagem</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => { onAdd?.(); onClose(); }}
                style={styles.addActionBtn}
              >
                <Ionicons name="add" size={18} color="#0F1F16" />
                <Text style={styles.addActionText}>Adicionar à viagem</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Place Row (Minha Viagem) ─────────────────────────────────────────────────

function MyPlaceRow({
  place,
  onPress,
  onRemove,
}: {
  place: Place;
  onPress: () => void;
  onRemove: () => void;
}) {
  const catColor = CATEGORY_COLORS[place.category] || '#52B788';
  const catIcon  = CATEGORY_ICONS[place.category] || 'location-outline';

  return (
    <TouchableOpacity onPress={onPress} style={styles.myPlaceRow} activeOpacity={0.75}>
      {place.imageUrl ? (
        <Image source={{ uri: place.imageUrl }} style={styles.myPlaceThumb} />
      ) : (
        <View style={[styles.myPlaceThumb, { backgroundColor: `${catColor}20`, alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name={catIcon as any} size={16} color={catColor} />
        </View>
      )}
      <Text style={styles.myPlaceName} numberOfLines={1}>{place.name}</Text>
      <TouchableOpacity onPress={onRemove} style={styles.removeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="trash-outline" size={15} color="#E74C3C" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Available Place Row ──────────────────────────────────────────────────────

function AvailablePlaceRow({
  place,
  isAdded,
  onAdd,
  onPress,
}: {
  place: Place;
  isAdded: boolean;
  onAdd: () => void;
  onPress: () => void;
}) {
  const catColor = CATEGORY_COLORS[place.category] || '#52B788';
  const catIcon  = CATEGORY_ICONS[place.category] || 'location-outline';

  return (
    <TouchableOpacity onPress={onPress} style={styles.availRow} activeOpacity={0.75}>
      {place.imageUrl ? (
        <Image source={{ uri: place.imageUrl }} style={styles.availThumb} />
      ) : (
        <View style={[styles.availThumb, { backgroundColor: `${catColor}20`, alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name={catIcon as any} size={18} color={catColor} />
        </View>
      )}
      <View style={styles.availInfo}>
        <Text style={styles.availName} numberOfLines={1}>{place.name}</Text>
        {place.description ? (
          <Text style={styles.availDesc} numberOfLines={1}>{place.description}</Text>
        ) : null}
      </View>
      {!isAdded ? (
        <TouchableOpacity onPress={onAdd} style={styles.addChip} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={styles.addChipText}>Adicionar</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.addedBadge}>
          <Ionicons name="checkmark" size={12} color="#52B788" />
          <Text style={styles.addedBadgeText}>Adicionado</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── AI Suggestions Panel ─────────────────────────────────────────────────────

function AIPanel({
  destination,
  addedPlaces,
  onAdd,
  onRemove,
  activeCategory,
}: {
  destination: Destination;
  addedPlaces: Place[];
  onAdd: (place: Place) => void;
  onRemove: (placeId: string) => void;
  activeCategory: string;
}) {
  const { userPlan, updateUserPlan } = useTripsStore();
  const [showPaywall, setShowPaywall] = useState(false);
  const [aiPlaces, setAiPlaces] = useState<Place[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);

  const suggestMutation = trpc.ai.suggestPlaces.useMutation({
    onSuccess: (data) => {
      if (!data?.places) return;
      const categoryMap: Record<string, string> = {
        attractions: 'attraction',
        restaurants: 'restaurant',
        cafes: 'cafe',
        museums: 'museum',
        hidden_gems: 'hidden_gem',
      };
      const all: Place[] = [];
      for (const [rawKey, items] of Object.entries(data.places as Record<string, any[]>)) {
        const cat = categoryMap[rawKey] || rawKey;
        for (const item of (items || [])) {
          all.push({
            id: generateId(),
            name: item.name,
            category: cat as any,
            address: item.address,
            hours: item.hours,
            description: item.description || item.tip,
            website: item.website,
            imageUrl: item.imageUrl,
            destinationId: destination.id,
            addedByAI: true,
          });
        }
      }
      setAiPlaces(all);
      if (userPlan.tier === 'free') {
        updateUserPlan({ aiCreditsUsed: userPlan.aiCreditsUsed + 1 });
      }
    },
  });

  const handleLoad = () => {
    const canUse = userPlan.tier !== 'free' || userPlan.aiCreditsUsed < userPlan.aiCreditsLimit;
    if (!canUse) { setShowPaywall(true); return; }
    suggestMutation.mutate({ destination: destination.name, country: destination.country, days: destination.days });
  };

  const filtered = activeCategory === 'all'
    ? aiPlaces
    : aiPlaces.filter((p) => p.category === activeCategory);

  const isAdded = (p: Place) => addedPlaces.some((a) => a.name === p.name);

  return (
    <View>
      {aiPlaces.length === 0 ? (
        <View style={styles.aiEmptyRow}>
          {suggestMutation.isPending ? (
            <>
              <ActivityIndicator size="small" color="#52B788" />
              <Text style={styles.aiEmptyText}>A IA está buscando lugares em {destination.name}...</Text>
            </>
          ) : (
            <>
              <Ionicons name="sparkles-outline" size={14} color="rgba(245,240,232,0.4)" />
              <Text style={styles.aiEmptyText}>Nenhuma sugestão carregada</Text>
              <TouchableOpacity onPress={handleLoad} style={styles.aiLoadBtn}>
                <Ionicons name="sparkles" size={12} color="#0F1F16" />
                <Text style={styles.aiLoadBtnText}>Sugerir com IA</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : (
        <>
          <View style={styles.aiHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="sparkles" size={12} color="#52B788" />
              <Text style={styles.aiHeaderText}>Sugestões IA · {destination.name}</Text>
            </View>
            <TouchableOpacity onPress={handleLoad} style={styles.aiRefreshBtn} disabled={suggestMutation.isPending}>
              {suggestMutation.isPending
                ? <ActivityIndicator size="small" color="#52B788" />
                : <Ionicons name="refresh-outline" size={14} color="#52B788" />}
            </TouchableOpacity>
          </View>
          {filtered.map((place) => (
            <AvailablePlaceRow
              key={place.id}
              place={place}
              isAdded={isAdded(place)}
              onAdd={() => onAdd({ ...place, id: generateId() })}
              onPress={() => setSelectedPlace(place)}
            />
          ))}
          {filtered.length === 0 && (
            <Text style={[styles.aiEmptyText, { paddingVertical: 8 }]}>
              Nenhuma sugestão nesta categoria
            </Text>
          )}
        </>
      )}

      {selectedPlace && (
        <PlaceDetailModal
          place={selectedPlace}
          onClose={() => setSelectedPlace(null)}
          isAdded={isAdded(selectedPlace)}
          onAdd={() => onAdd({ ...selectedPlace, id: generateId() })}
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

// ─── Main PlacesScreen ────────────────────────────────────────────────────────

interface PlacesScreenProps {
  tripId: string;
  places: Place[];
  destinations: Destination[];
}

export function PlacesScreen({ tripId, places, destinations }: PlacesScreenProps) {
  const { addPlace, removePlace } = useTripsStore();
  const [activeCategory, setActiveCategory] = useState('all');
  const [activeDestFilter, setActiveDestFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);

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
      const matchSrch = !search || p.name.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchDest && matchSrch;
    });
  }, [places, activeCategory, activeDestFilter, search]);

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

  return (
    <View>
      {/* ── MINHA VIAGEM ── */}
      <View style={styles.sectionBlock}>
        <Text style={styles.sectionLabel}>MINHA VIAGEM</Text>

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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}
          contentContainerStyle={{ gap: 6 }}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.key}
              onPress={() => setActiveCategory(cat.key)}
              style={[styles.catChip, activeCategory === cat.key && styles.catChipActive]}
            >
              <Ionicons name={cat.icon} size={12}
                color={activeCategory === cat.key ? '#52B788' : 'rgba(245,240,232,0.45)'} />
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
              {search ? 'Nenhum lugar encontrado' : 'Nenhum lugar adicionado ainda'}
            </Text>
          </View>
        )}
      </View>

      {/* ── BUSCAR / DISPONÍVEIS ── */}
      <View style={styles.sectionBlock}>
        <Text style={styles.sectionLabel}>DISPONÍVEIS</Text>

        {/* Search */}
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={16} color="rgba(245,240,232,0.4)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar lugares..."
            placeholderTextColor="rgba(245,240,232,0.35)"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color="rgba(245,240,232,0.4)" />
            </TouchableOpacity>
          )}
        </View>

        {/* AI suggestions per destination */}
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
            />
          </View>
        ))}
      </View>

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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sectionBlock: { marginBottom: 20 },
  sectionLabel: {
    color: 'rgba(245,240,232,0.5)',
    fontSize: 11, fontWeight: '700', letterSpacing: 1.5,
    marginBottom: 12,
  },

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

  // Search
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    gap: 10, marginBottom: 16,
  },
  searchInput: { flex: 1, color: '#F5F0E8', fontSize: 14 },

  // AI panel
  destAiBlock: { marginBottom: 16 },
  aiHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  aiHeaderText: { fontSize: 11, fontWeight: '700', color: '#52B788', letterSpacing: 0.5 },
  aiRefreshBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(82,183,136,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  aiEmptyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10,
  },
  aiEmptyText: { flex: 1, color: 'rgba(245,240,232,0.4)', fontSize: 13 },
  aiLoadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#52B788', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  aiLoadBtnText: { fontSize: 12, fontWeight: '700', color: '#0F1F16' },

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
    position: 'absolute', right: 20, top: 0,
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
