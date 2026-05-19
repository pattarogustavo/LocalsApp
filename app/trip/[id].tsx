import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ImageBackground,
  Dimensions,
  Animated,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTripsStore } from '@/store/trips';
import { getTripName, formatDate, getCurrencySymbol } from '@/utils/trip-helpers';
import { TransportBlock } from '@/components/trip/transport-block';
import { DocumentsBlock } from '@/components/trip/documents-block';
import { ExpensesBlock } from '@/components/trip/expenses-block';
import { TravelersBlock } from '@/components/trip/travelers-block';
import { PlacesScreen } from '@/components/trip/places-screen';

const { width, height } = Dimensions.get('window');
const HERO_HEIGHT = height * 0.38;

const DESTINATION_IMAGES: Record<string, string> = {
  paris: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=1200',
  rome: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1200',
  london: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200',
  tokyo: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1200',
  'new york': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1200',
  barcelona: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=1200',
  amsterdam: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=1200',
  lisbon: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=1200',
  default: 'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=1200',
};

function getHeroImage(trip: any): string {
  if (trip?.coverImageUrl) return trip.coverImageUrl;
  const destName = trip?.destinations?.[0]?.name?.toLowerCase() || '';
  for (const [key, url] of Object.entries(DESTINATION_IMAGES)) {
    if (destName.includes(key)) return url;
  }
  return DESTINATION_IMAGES.default;
}

type TabKey = 'destinos' | 'transporte' | 'hospedagem' | 'lugares' | 'historia';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'destinos', label: 'Destinos', icon: 'location' },
  { key: 'transporte', label: 'Transporte', icon: 'airplane' },
  { key: 'hospedagem', label: 'Hospedagem', icon: 'bed' },
  { key: 'lugares', label: 'Lugares', icon: 'camera' },
  { key: 'historia', label: 'História', icon: 'book' },
];

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getTripById, deleteTrip } = useTripsStore();
  const trip = getTripById(id);
  const [activeTab, setActiveTab] = useState<TabKey>('destinos');
  const [showPlaces, setShowPlaces] = useState(false);

  useEffect(() => {
    if (activeTab === 'lugares') {
      setShowPlaces(true);
    } else {
      setShowPlaces(false);
    }
  }, [activeTab]);

  if (!trip) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F5F0E8', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#1C3D2E', fontSize: 18 }}>Viagem não encontrada</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: '#3D5A47', fontSize: 16 }}>Voltar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const heroImage = getHeroImage(trip);
  const tripName = getTripName(trip);
  const destName = trip.destinations.map((d) => d.name).join(', ');
  const countryName = trip.destinations.map((d) => d.country || d.name).join(', ');

  const handleDelete = () => {
    Alert.alert(
      'Excluir Viagem',
      `Tem certeza que deseja excluir "${tripName}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            await deleteTrip(trip.id);
            router.back();
          },
        },
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0F1F16' }}>
      <ScrollView showsVerticalScrollIndicator={false} stickyHeaderIndices={[1]}>
        {/* Hero Section */}
        <View style={{ height: HERO_HEIGHT }}>
          <ImageBackground
            source={{ uri: heroImage }}
            style={{ flex: 1 }}
          >
            <LinearGradient
              colors={['rgba(0,0,0,0.2)', 'rgba(15,31,22,0.95)']}
              style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: 20, paddingHorizontal: 20 }}
            >
              {/* Back button + currency */}
              <View
                style={{
                  position: 'absolute',
                  top: insets.top + 8,
                  left: 16,
                  right: 16,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <TouchableOpacity
                  onPress={() => router.back()}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: 'rgba(0,0,0,0.4)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="chevron-back" size={20} color="#fff" />
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: 'rgba(0,0,0,0.4)',
                      borderRadius: 20,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                    }}
                  >
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>
                      {getCurrencySymbol(trip.currency)}
                    </Text>
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                      {trip.currency}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleDelete}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: 'rgba(192,57,43,0.5)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="trash-outline" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Trip title */}
              <Text
                style={{
                  color: '#F5F0E8',
                  fontSize: 28,
                  fontFamily: 'serif',
                  fontStyle: 'italic',
                  fontWeight: '600',
                  marginBottom: 4,
                }}
              >
                {tripName}
              </Text>
              <Text style={{ color: 'rgba(245,240,232,0.7)', fontSize: 14 }}>
                {countryName}
              </Text>
            </LinearGradient>
          </ImageBackground>
        </View>

        {/* Tabs - sticky */}
        <View style={{ backgroundColor: '#0F1F16', paddingVertical: 4 }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 8 }}
          >
            {TABS.map((tab) => (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 14,
                  backgroundColor: activeTab === tab.key ? 'rgba(82,183,136,0.25)' : 'rgba(255,255,255,0.08)',
                  borderWidth: activeTab === tab.key ? 1 : 0,
                  borderColor: activeTab === tab.key ? '#52B788' : 'transparent',
                }}
              >
                <Ionicons
                  name={tab.icon as any}
                  size={16}
                  color={activeTab === tab.key ? '#52B788' : 'rgba(245,240,232,0.5)'}
                />
                <Text
                  style={{
                    color: activeTab === tab.key ? '#52B788' : 'rgba(245,240,232,0.5)',
                    fontSize: 13,
                    fontWeight: activeTab === tab.key ? '600' : '400',
                  }}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Content */}
        <View style={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
          {activeTab === 'destinos' && (
            <DestinationsTab trip={trip} />
          )}
          {activeTab === 'transporte' && (
            <TransportTab trip={trip} />
          )}
          {activeTab === 'hospedagem' && (
            <AccommodationTab trip={trip} />
          )}
          {activeTab === 'lugares' && (
            <PlacesScreen tripId={trip.id} places={trip.places} destinations={trip.destinations} />
          )}
          {activeTab === 'historia' && (
            <HistoryTab trip={trip} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function DestinationsTab({ trip }: { trip: any }) {
  return (
    <View>
      {/* Transport Block */}
      <TransportBlock tripId={trip.id} transports={trip.transport} />

      {/* Documents Block */}
      <DocumentsBlock tripId={trip.id} documents={trip.documents} />

      {/* Playlist Block */}
      <View
        style={{
          backgroundColor: 'rgba(28,61,46,0.85)',
          borderRadius: 20,
          padding: 16,
          marginBottom: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Ionicons name="musical-notes-outline" size={16} color="#52B788" />
          <Text style={{ color: '#F5F0E8', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>
            Playlist do Destino
          </Text>
        </View>
        <Text style={{ color: 'rgba(245,240,232,0.5)', fontSize: 13 }}>
          Sons mais tocados em {trip.destinations[0]?.name || 'seu destino'}
        </Text>
      </View>

      {/* Expenses Block */}
      <ExpensesBlock tripId={trip.id} expenses={trip.expenses} currency={trip.currency} />

      {/* Travelers Block */}
      <TravelersBlock tripId={trip.id} travelers={trip.travelers} />
    </View>
  );
}

function TransportTab({ trip }: { trip: any }) {
  return (
    <View>
      <TransportBlock tripId={trip.id} transports={trip.transport} />
      {trip.transport.length === 0 && (
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <Ionicons name="airplane-outline" size={48} color="rgba(245,240,232,0.2)" />
          <Text style={{ color: 'rgba(245,240,232,0.4)', fontSize: 16, marginTop: 12 }}>
            Nenhum transporte adicionado
          </Text>
          <Text style={{ color: 'rgba(245,240,232,0.3)', fontSize: 13, marginTop: 4, textAlign: 'center' }}>
            Adicione voos, carros ou trens à sua viagem
          </Text>
        </View>
      )}
    </View>
  );
}

function AccommodationTab({ trip }: { trip: any }) {
  return (
    <View>
      {trip.accommodations.length === 0 ? (
        <View
          style={{
            backgroundColor: 'rgba(28,61,46,0.85)',
            borderRadius: 20,
            padding: 20,
            alignItems: 'center',
          }}
        >
          <Ionicons name="bed-outline" size={40} color="rgba(245,240,232,0.3)" />
          <Text style={{ color: 'rgba(245,240,232,0.6)', fontSize: 16, marginTop: 12, fontWeight: '500' }}>
            Nenhuma hospedagem
          </Text>
          <Text style={{ color: 'rgba(245,240,232,0.4)', fontSize: 13, marginTop: 4, textAlign: 'center' }}>
            Adicione hotéis, Airbnb ou outras acomodações
          </Text>
          <TouchableOpacity
            style={{
              marginTop: 16,
              backgroundColor: '#52B788',
              borderRadius: 20,
              paddingHorizontal: 20,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: '#0F1F16', fontWeight: '600' }}>+ Adicionar Hospedagem</Text>
          </TouchableOpacity>
        </View>
      ) : (
        trip.accommodations.map((acc: any) => (
          <View
            key={acc.id}
            style={{ backgroundColor: 'rgba(28,61,46,0.85)', borderRadius: 20, padding: 16, marginBottom: 12 }}
          >
            <Text style={{ color: '#F5F0E8', fontSize: 16, fontWeight: '600' }}>{acc.name}</Text>
            {acc.address && <Text style={{ color: 'rgba(245,240,232,0.6)', fontSize: 13, marginTop: 4 }}>{acc.address}</Text>}
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 10 }}>
              <View>
                <Text style={{ color: 'rgba(245,240,232,0.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Check-in</Text>
                <Text style={{ color: '#F5F0E8', fontSize: 13, fontWeight: '600' }}>{formatDate(acc.checkIn, 'short')}</Text>
              </View>
              <View>
                <Text style={{ color: 'rgba(245,240,232,0.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Check-out</Text>
                <Text style={{ color: '#F5F0E8', fontSize: 13, fontWeight: '600' }}>{formatDate(acc.checkOut, 'short')}</Text>
              </View>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function HistoryTab({ trip }: { trip: any }) {
  const destName = trip.destinations[0]?.name || 'seu destino';
  return (
    <View
      style={{
        backgroundColor: 'rgba(28,61,46,0.85)',
        borderRadius: 20,
        padding: 20,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Ionicons name="book-outline" size={18} color="#52B788" />
        <Text style={{ color: '#F5F0E8', fontSize: 16, fontWeight: '600' }}>
          História de {destName}
        </Text>
      </View>
      <Text style={{ color: 'rgba(245,240,232,0.6)', fontSize: 14, lineHeight: 22 }}>
        Explore a rica história e cultura de {destName}. Informações históricas, curiosidades e contexto cultural serão exibidos aqui conforme você adiciona destinos à sua viagem.
      </Text>
    </View>
  );
}
