import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  ScrollView,
  Image,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTripsStore } from '@/store/trips';
import { generateId } from '@/utils/trip-helpers';
import type { Place, Destination } from '@/types/voyage';

interface PlacesScreenProps {
  tripId: string;
  places: Place[];
  destinations: Destination[];
}

const CATEGORIES = [
  { key: 'all', label: 'Todos', icon: 'grid' },
  { key: 'attraction', label: 'Atrações', icon: 'camera' },
  { key: 'restaurant', label: 'Restaurantes', icon: 'restaurant' },
  { key: 'cafe', label: 'Cafés', icon: 'cafe' },
  { key: 'museum', label: 'Museus', icon: 'book' },
  { key: 'hidden_gem', label: 'Hidden Gems', icon: 'diamond' },
];

// Sample suggested places per destination
const SUGGESTED_PLACES: Record<string, Place[]> = {
  london: [
    { id: 'bg1', name: 'Big Ben', category: 'attraction', address: 'Westminster, London SW1A 0AA', hours: '09:00 - 17:30', description: 'Icônico relógio do Parlamento britânico', lat: 51.5007, lng: -0.1246, destinationId: '', imageUrl: 'https://images.unsplash.com/photo-1529655683826-aba9b3e77383?w=400' },
    { id: 'le1', name: 'London Eye', category: 'attraction', address: 'Riverside Building, County Hall, London SE1 7PB', hours: '10:00 - 20:30', description: 'A maior roda-gigante da Europa', lat: 51.5033, lng: -0.1196, destinationId: '', imageUrl: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=400' },
    { id: 'tl1', name: 'Tower of London', category: 'attraction', address: "St Katharine's & Wapping, London EC3N 4AB", hours: '09:00 - 17:30', description: 'Fortaleza histórica às margens do Tâmisa', lat: 51.5081, lng: -0.0759, destinationId: '', imageUrl: 'https://images.unsplash.com/photo-1526129318478-62ed807ebdf9?w=400' },
    { id: 'sk1', name: 'Sketch', category: 'restaurant', address: '9 Conduit St, London W1S 2XG', hours: '12:00 - 23:00', description: 'Restaurante e galeria de arte icônico', lat: 51.5118, lng: -0.1424, destinationId: '', imageUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400' },
  ],
  paris: [
    { id: 'et1', name: 'Torre Eiffel', category: 'attraction', address: 'Champ de Mars, 5 Av. Anatole France, 75007 Paris', hours: '09:00 - 23:45', description: 'O monumento mais famoso de Paris', lat: 48.8584, lng: 2.2945, destinationId: '', imageUrl: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=400' },
    { id: 'lv1', name: 'Museu do Louvre', category: 'museum', address: 'Rue de Rivoli, 75001 Paris', hours: '09:00 - 18:00', description: 'O maior museu de arte do mundo', lat: 48.8606, lng: 2.3376, destinationId: '', imageUrl: 'https://images.unsplash.com/photo-1565799557186-4e9d1f6e1e2f?w=400' },
    { id: 'nd1', name: 'Notre-Dame', category: 'attraction', address: '6 Parvis Notre-Dame - Pl. Jean-Paul II, 75004 Paris', hours: '08:00 - 18:45', description: 'Catedral gótica medieval', lat: 48.8530, lng: 2.3499, destinationId: '', imageUrl: 'https://images.unsplash.com/photo-1550340499-a6c60fc8287c?w=400' },
  ],
  rome: [
    { id: 'co1', name: 'Coliseu', category: 'attraction', address: 'Piazza del Colosseo, 1, 00184 Roma RM', hours: '09:00 - 19:00', description: 'O anfiteatro romano mais famoso do mundo', lat: 41.8902, lng: 12.4922, destinationId: '', imageUrl: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=400' },
    { id: 'vt1', name: 'Fontana di Trevi', category: 'attraction', address: 'Piazza di Trevi, 00187 Roma RM', hours: '00:00 - 24:00', description: 'A maior fonte barroca de Roma', lat: 41.9009, lng: 12.4833, destinationId: '', imageUrl: 'https://images.unsplash.com/photo-1555992828-ca4dbe41d294?w=400' },
  ],
};

function getSuggestedPlaces(destinations: Destination[]): Place[] {
  const result: Place[] = [];
  for (const dest of destinations) {
    const key = dest.name.toLowerCase();
    for (const [k, places] of Object.entries(SUGGESTED_PLACES)) {
      if (key.includes(k)) {
        result.push(...places.map((p) => ({ ...p, destinationId: dest.id })));
      }
    }
  }
  return result;
}

export function PlacesScreen({ tripId, places, destinations }: PlacesScreenProps) {
  const addPlace = useTripsStore((s) => s.addPlace);
  const removePlace = useTripsStore((s) => s.removePlace);
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeDestFilter, setActiveDestFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const insets = useSafeAreaInsets();

  const suggestedPlaces = getSuggestedPlaces(destinations).filter(
    (sp) => !places.find((p) => p.name === sp.name)
  );

  const filteredPlaces = places.filter((p) => {
    const matchCat = activeFilter === 'all' || p.category === activeFilter;
    const matchDest = activeDestFilter === 'all' || p.destinationId === activeDestFilter;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchDest && matchSearch;
  });

  const filteredSuggested = suggestedPlaces.filter((p) => {
    const matchCat = activeFilter === 'all' || p.category === activeFilter;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const handleAddPlace = async (place: Place) => {
    const newPlace = { ...place, id: generateId() };
    await addPlace(tripId, newPlace);
  };

  const groupedByDest = destinations.reduce((acc, dest) => {
    const destPlaces = filteredPlaces.filter((p) => p.destinationId === dest.id);
    if (destPlaces.length > 0) {
      acc[dest.id] = { dest, places: destPlaces };
    }
    return acc;
  }, {} as Record<string, { dest: Destination; places: Place[] }>);

  const ungroupedPlaces = filteredPlaces.filter((p) => !destinations.find((d) => d.id === p.destinationId));

  return (
    <View>
      {/* My Places */}
      {places.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text style={{ color: 'rgba(245,240,232,0.5)', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
            Minha Viagem
          </Text>

          {/* Destination filter */}
          {destinations.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <FilterChip label="Todos" active={activeDestFilter === 'all'} onPress={() => setActiveDestFilter('all')} />
                {destinations.map((d) => (
                  <FilterChip key={d.id} label={d.name} active={activeDestFilter === d.id} onPress={() => setActiveDestFilter(d.id)} />
                ))}
              </View>
            </ScrollView>
          )}

          {Object.values(groupedByDest).map(({ dest, places: destPlaces }) => (
            <View key={dest.id} style={{ marginBottom: 12 }}>
              <Text style={{ color: 'rgba(245,240,232,0.6)', fontSize: 13, fontWeight: '600', marginBottom: 8 }}>
                {dest.name}
              </Text>

              {/* Group by category */}
              {['attraction', 'restaurant', 'cafe', 'museum', 'hidden_gem', 'other'].map((cat) => {
                const catPlaces = destPlaces.filter((p) => p.category === cat);
                if (catPlaces.length === 0) return null;
                const catInfo = CATEGORIES.find((c) => c.key === cat);
                return (
                  <View key={cat} style={{ marginBottom: 8 }}>
                    <Text style={{ color: 'rgba(245,240,232,0.4)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                      {catInfo?.label || cat}
                    </Text>
                    {catPlaces.map((place) => (
                      <PlaceRow
                        key={place.id}
                        place={place}
                        onPress={() => setSelectedPlace(place)}
                        onRemove={() => removePlace(tripId, place.id)}
                        showRemove
                      />
                    ))}
                  </View>
                );
              })}
            </View>
          ))}

          {ungroupedPlaces.map((place) => (
            <PlaceRow
              key={place.id}
              place={place}
              onPress={() => setSelectedPlace(place)}
              onRemove={() => removePlace(tripId, place.id)}
              showRemove
            />
          ))}
        </View>
      )}

      {/* Search */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(245,240,232,0.1)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }}>
        <Ionicons name="search" size={16} color="rgba(245,240,232,0.5)" />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar lugares"
          placeholderTextColor="rgba(245,240,232,0.4)"
          style={{ flex: 1, color: '#F5F0E8', fontSize: 14 }}
        />
      </View>

      {/* Category filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.key}
              onPress={() => setActiveFilter(cat.key)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 20,
                backgroundColor: activeFilter === cat.key ? 'rgba(82,183,136,0.25)' : 'rgba(245,240,232,0.08)',
                borderWidth: activeFilter === cat.key ? 1 : 0,
                borderColor: '#52B788',
              }}
            >
              <Ionicons name={cat.icon as any} size={14} color={activeFilter === cat.key ? '#52B788' : 'rgba(245,240,232,0.5)'} />
              <Text style={{ color: activeFilter === cat.key ? '#52B788' : 'rgba(245,240,232,0.5)', fontSize: 12 }}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Suggested places */}
      {filteredSuggested.length > 0 && (
        <View>
          <Text style={{ color: 'rgba(245,240,232,0.5)', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
            Disponíveis
          </Text>
          {filteredSuggested.map((place) => (
            <PlaceRow
              key={place.id}
              place={place}
              onPress={() => setSelectedPlace(place)}
              onAdd={() => handleAddPlace(place)}
              showAdd
            />
          ))}
        </View>
      )}

      {places.length === 0 && filteredSuggested.length === 0 && (
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <Ionicons name="location-outline" size={48} color="rgba(245,240,232,0.2)" />
          <Text style={{ color: 'rgba(245,240,232,0.4)', fontSize: 16, marginTop: 12 }}>
            Nenhum lugar ainda
          </Text>
          <Text style={{ color: 'rgba(245,240,232,0.3)', fontSize: 13, marginTop: 4, textAlign: 'center' }}>
            Adicione destinos para ver sugestões de lugares
          </Text>
        </View>
      )}

      {/* Place Detail Modal */}
      <Modal visible={!!selectedPlace} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          {selectedPlace && (
            <PlaceDetailModal
              place={selectedPlace}
              isAdded={!!places.find((p) => p.name === selectedPlace.name)}
              onClose={() => setSelectedPlace(null)}
              onAdd={() => {
                handleAddPlace(selectedPlace);
                setSelectedPlace(null);
              }}
              onRemove={() => {
                const existing = places.find((p) => p.name === selectedPlace.name);
                if (existing) removePlace(tripId, existing.id);
                setSelectedPlace(null);
              }}
              insets={insets}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

function PlaceRow({
  place,
  onPress,
  onRemove,
  onAdd,
  showRemove,
  showAdd,
}: {
  place: Place;
  onPress: () => void;
  onRemove?: () => void;
  onAdd?: () => void;
  showRemove?: boolean;
  showAdd?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: 'rgba(245,240,232,0.06)',
        borderRadius: 14,
        padding: 12,
        marginBottom: 8,
      }}
    >
      {place.imageUrl ? (
        <Image
          source={{ uri: place.imageUrl }}
          style={{ width: 44, height: 44, borderRadius: 10 }}
        />
      ) : (
        <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(82,183,136,0.2)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="location" size={20} color="#52B788" />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#F5F0E8', fontSize: 14, fontWeight: '600' }}>{place.name}</Text>
        {place.hours && <Text style={{ color: 'rgba(245,240,232,0.5)', fontSize: 12, marginTop: 1 }}>{place.hours}</Text>}
      </View>
      {showRemove && onRemove && (
        <TouchableOpacity
          onPress={onRemove}
          style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(192,57,43,0.15)', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="trash" size={14} color="#C0392B" />
        </TouchableOpacity>
      )}
      {showAdd && onAdd && (
        <TouchableOpacity
          onPress={onAdd}
          style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: 'rgba(82,183,136,0.2)', borderWidth: 1, borderColor: '#52B788' }}
        >
          <Text style={{ color: '#52B788', fontSize: 12, fontWeight: '600' }}>Adicionar</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 20,
        backgroundColor: active ? 'rgba(82,183,136,0.25)' : 'rgba(245,240,232,0.08)',
        borderWidth: active ? 1 : 0,
        borderColor: '#52B788',
      }}
    >
      <Text style={{ color: active ? '#52B788' : 'rgba(245,240,232,0.5)', fontSize: 12, fontWeight: active ? '600' : '400' }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function PlaceDetailModal({
  place,
  isAdded,
  onClose,
  onAdd,
  onRemove,
  insets,
}: {
  place: Place;
  isAdded: boolean;
  onClose: () => void;
  onAdd: () => void;
  onRemove: () => void;
  insets: any;
}) {
  const openMaps = () => {
    if (place.lat && place.lng) {
      Linking.openURL(`https://maps.google.com/?q=${place.lat},${place.lng}`);
    } else if (place.address) {
      Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(place.address)}`);
    }
  };

  const openWebsite = () => {
    if (place.website) Linking.openURL(place.website);
  };

  const catInfo = CATEGORIES.find((c) => c.key === place.category);

  return (
    <View
      style={{
        backgroundColor: '#F5F0E8',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        overflow: 'hidden',
        maxHeight: '85%',
      }}
    >
      {/* Place image */}
      {place.imageUrl && (
        <Image
          source={{ uri: place.imageUrl }}
          style={{ width: '100%', height: 200 }}
          resizeMode="cover"
        />
      )}

      <ScrollView style={{ padding: 24 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <Text style={{ fontSize: 24, fontFamily: 'serif', fontStyle: 'italic', color: '#1C3D2E', flex: 1, marginRight: 12 }}>
            {place.name}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#EDE8DC', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={16} color="#1C3D2E" />
          </TouchableOpacity>
        </View>

        <Text style={{ color: '#6B7C72', fontSize: 14, marginBottom: 16 }}>
          {catInfo?.label || place.category}
        </Text>

        {place.hours && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <Ionicons name="time-outline" size={16} color="#3D5A47" style={{ marginTop: 2 }} />
            <View>
              <Text style={{ color: '#6B7C72', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' }}>Horário</Text>
              <Text style={{ color: '#1C3D2E', fontSize: 14 }}>{place.hours}</Text>
            </View>
          </View>
        )}

        {place.address && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
            <Ionicons name="location-outline" size={16} color="#3D5A47" style={{ marginTop: 2 }} />
            <View>
              <Text style={{ color: '#6B7C72', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' }}>Endereço</Text>
              <Text style={{ color: '#1C3D2E', fontSize: 14 }}>{place.address}</Text>
            </View>
          </View>
        )}

        {place.description && (
          <Text style={{ color: '#3D5A47', fontSize: 14, lineHeight: 22, marginBottom: 16 }}>
            {place.description}
          </Text>
        )}

        {/* Action buttons */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
          {place.website && (
            <TouchableOpacity
              onPress={openWebsite}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#EDE8DC', borderRadius: 14, paddingVertical: 12 }}
            >
              <Ionicons name="globe-outline" size={16} color="#1C3D2E" />
              <Text style={{ color: '#1C3D2E', fontWeight: '600' }}>Site</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={openMaps}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#EDE8DC', borderRadius: 14, paddingVertical: 12 }}
          >
            <Ionicons name="location-outline" size={16} color="#1C3D2E" />
            <Text style={{ color: '#1C3D2E', fontWeight: '600' }}>Maps</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={isAdded ? onRemove : onAdd}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            backgroundColor: isAdded ? 'rgba(192,57,43,0.1)' : '#EDE8DC',
            borderRadius: 14,
            paddingVertical: 14,
            marginBottom: insets.bottom + 8,
          }}
        >
          <Ionicons name={isAdded ? 'trash-outline' : 'add-circle-outline'} size={18} color={isAdded ? '#C0392B' : '#1C3D2E'} />
          <Text style={{ color: isAdded ? '#C0392B' : '#1C3D2E', fontWeight: '600', fontSize: 15 }}>
            {isAdded ? 'Remover da Viagem' : 'Adicionar arquivo'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
