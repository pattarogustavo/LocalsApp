import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ImageBackground,
  Dimensions,
  Alert,
  Modal,
  StyleSheet,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTripsStore } from '@/store/trips';
import { getTripName, formatDate, getCurrencySymbol, getTripCurrencies } from '@/utils/trip-helpers';
import { TransportBlock } from '@/components/trip/transport-block';
import { DocumentsBlock } from '@/components/trip/documents-block';
import { ExpensesBlock } from '@/components/trip/expenses-block';
import { TravelersBlock } from '@/components/trip/travelers-block';
import { PlacesScreen } from '@/components/trip/places-screen';
import { ItineraryBlock } from '@/components/trip/itinerary-block';
import { AccommodationBlock } from '@/components/trip/accommodation-block';
import { TripPhotosBlock } from '@/components/trip/photos-block';
import { NextTransportCard } from '@/components/trip/next-transport-card';
import { useColors } from '@/hooks/use-colors';
import { generateId } from '@/utils/trip-helpers';
import * as ImagePicker from 'expo-image-picker';
import type { Destination } from '@/types/voyage';

const { height } = Dimensions.get('window');
const HERO_HEIGHT = height * 0.38;

const DESTINATION_IMAGES: Record<string, string> = {
  // Europe
  paris: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=1200',
  roma: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1200',
  rome: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1200',
  london: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200',
  londres: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200',
  barcelona: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=1200',
  amsterdam: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=1200',
  lisbon: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=1200',
  lisboa: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=1200',
  madrid: 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=1200',
  berlin: 'https://images.unsplash.com/photo-1560969184-10fe8719e047?w=1200',
  berlim: 'https://images.unsplash.com/photo-1560969184-10fe8719e047?w=1200',
  vienna: 'https://images.unsplash.com/photo-1516550893923-42d28e5677af?w=1200',
  viena: 'https://images.unsplash.com/photo-1516550893923-42d28e5677af?w=1200',
  prague: 'https://images.unsplash.com/photo-1541849546-216549ae216d?w=1200',
  praga: 'https://images.unsplash.com/photo-1541849546-216549ae216d?w=1200',
  florence: 'https://images.unsplash.com/photo-1541370976299-4d24be63b9e3?w=1200',
  florença: 'https://images.unsplash.com/photo-1541370976299-4d24be63b9e3?w=1200',
  venice: 'https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?w=1200',
  veneza: 'https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?w=1200',
  athens: 'https://images.unsplash.com/photo-1555993539-1732b0258235?w=1200',
  atenas: 'https://images.unsplash.com/photo-1555993539-1732b0258235?w=1200',
  santorini: 'https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?w=1200',
  zurich: 'https://images.unsplash.com/photo-1515488764276-beab7607c1e6?w=1200',
  zurique: 'https://images.unsplash.com/photo-1515488764276-beab7607c1e6?w=1200',
  // Asia
  tokyo: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1200',
  tóquio: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1200',
  dubai: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=1200',
  bali: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=1200',
  bangkok: 'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=1200',
  singapore: 'https://images.unsplash.com/photo-1525625293386-3f8f99389edd?w=1200',
  cingapura: 'https://images.unsplash.com/photo-1525625293386-3f8f99389edd?w=1200',
  kyoto: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=1200',
  osaka: 'https://images.unsplash.com/photo-1590559899731-a382839e5549?w=1200',
  seoul: 'https://images.unsplash.com/photo-1538485399081-7191377e8241?w=1200',
  seul: 'https://images.unsplash.com/photo-1538485399081-7191377e8241?w=1200',
  istanbul: 'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=1200',
  istambul: 'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=1200',
  maldives: 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=1200',
  maldivas: 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=1200',
  // Americas
  'new york': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1200',
  'nova york': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1200',
  miami: 'https://images.unsplash.com/photo-1506966953602-c20cc11f75e3?w=1200',
  'los angeles': 'https://images.unsplash.com/photo-1534190760961-74e8c1c5c3da?w=1200',
  chicago: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1200',
  cancun: 'https://images.unsplash.com/photo-1552074284-5e88ef1aef18?w=1200',
  'buenos aires': 'https://images.unsplash.com/photo-1589909202802-8f4aadce1849?w=1200',
  'rio de janeiro': 'https://images.unsplash.com/photo-1483729558449-99ef09a8c325?w=1200',
  rio: 'https://images.unsplash.com/photo-1483729558449-99ef09a8c325?w=1200',
  'são paulo': 'https://images.unsplash.com/photo-1578002171197-b8f0f2e1b5e2?w=1200',
  'sao paulo': 'https://images.unsplash.com/photo-1578002171197-b8f0f2e1b5e2?w=1200',
  lima: 'https://images.unsplash.com/photo-1531968455001-5c5272a41129?w=1200',
  bogota: 'https://images.unsplash.com/photo-1597476173484-e8e6c1e4e1e5?w=1200',
  // Africa & Oceania
  sydney: 'https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?w=1200',
  'cape town': 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=1200',
  'cidade do cabo': 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=1200',
  marrakech: 'https://images.unsplash.com/photo-1539020140153-e479b8c22e70?w=1200',
  marrakesh: 'https://images.unsplash.com/photo-1539020140153-e479b8c22e70?w=1200',
  default: 'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=1200',
};

function getHeroImage(trip: any): string {
  // 1. Use explicit cover image if set
  if (trip?.coverImageUrl) return trip.coverImageUrl;
  // 2. Use Google Places photo from first destination if available
  if (trip?.destinations?.[0]?.imageUrl) return trip.destinations[0].imageUrl;
  // 3. Fall back to curated Unsplash map by destination name
  const destName = trip?.destinations?.[0]?.name?.toLowerCase() || '';
  for (const [key, url] of Object.entries(DESTINATION_IMAGES)) {
    if (destName.includes(key)) return url;
  }
  return DESTINATION_IMAGES.default;
}

type TabKey = 'geral' | 'transporte' | 'hospedagem' | 'lugares' | 'fotos' | 'historia';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'geral', label: 'Geral', icon: 'location' },
  { key: 'transporte', label: 'Transporte', icon: 'airplane' },
  { key: 'hospedagem', label: 'Hospedagem', icon: 'bed' },
  { key: 'lugares', label: 'Lugares', icon: 'map' },
  { key: 'fotos', label: 'Fotos', icon: 'images' },
  { key: 'historia', label: 'História', icon: 'book' },
];

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatDateDisplay(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Edit Date Modal ────────────────────────────────────────────────────────

function EditDateModal({
  visible,
  currentDate,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  currentDate: string;
  onClose: () => void;
  onConfirm: (newDate: string) => void;
}) {
  const colors = useColors();
  const today = new Date();
  const [pickerDate, setPickerDate] = useState(new Date(currentDate));

  const adjust = (delta: number) => {
    const d = new Date(pickerDate);
    d.setDate(d.getDate() + delta);
    if (d >= today) setPickerDate(d);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={[styles.editCard, { backgroundColor: colors.background }]}>
          <Text style={[styles.editCardTitle, { color: '#1C3D2E' }]}>Alterar Data de Início</Text>
          <View style={styles.datePickerRow}>
            <TouchableOpacity onPress={() => adjust(-1)} style={[styles.arrowBtn, { backgroundColor: colors.surface }]}>
              <Ionicons name="chevron-back" size={20} color="#1C3D2E" />
            </TouchableOpacity>
            <View style={styles.dateCenter}>
              <Text style={[styles.dateDayNum, { color: colors.foreground }]}>{pickerDate.getDate()}</Text>
              <Text style={[styles.dateMonthText, { color: colors.muted }]}>
                {MONTHS[pickerDate.getMonth()]} {pickerDate.getFullYear()}
              </Text>
            </View>
            <TouchableOpacity onPress={() => adjust(1)} style={[styles.arrowBtn, { backgroundColor: colors.surface }]}>
              <Ionicons name="chevron-forward" size={20} color="#1C3D2E" />
            </TouchableOpacity>
          </View>
          <View style={styles.editCardActions}>
            <TouchableOpacity onPress={onClose} style={[styles.cancelBtn, { backgroundColor: colors.surface }]}>
              <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { onConfirm(pickerDate.toISOString()); onClose(); }}
              style={[styles.confirmBtn, { backgroundColor: '#1C3D2E' }]}
            >
              <Text style={styles.confirmBtnText}>Confirmar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Edit Destinations Modal ─────────────────────────────────────────────────

function EditDestinationsModal({
  visible,
  trip,
  onClose,
}: {
  visible: boolean;
  trip: any;
  onClose: () => void;
}) {
  const colors = useColors();
  const { updateDestinations } = useTripsStore();
  const [destinations, setDestinations] = useState<Destination[]>(trip.destinations);

  const handleUpdateDays = (id: string, delta: number) => {
    setDestinations((prev) =>
      prev.map((d) => (d.id === id ? { ...d, days: Math.max(1, d.days + delta) } : d))
    );
  };

  const handleRemove = (id: string) => {
    setDestinations((prev) => prev.filter((d) => d.id !== id));
  };

  const handleSave = async () => {
    await updateDestinations(trip.id, destinations);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={[styles.editSheet, { backgroundColor: colors.background }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.editSheetHeader}>
            <Text style={[styles.editSheetTitle, { color: '#1C3D2E' }]}>Editar Destinos</Text>
            <Pressable onPress={onClose} style={[styles.closeBtn, { backgroundColor: colors.surface }]}>
              <Ionicons name="close" size={16} color="#1C3D2E" />
            </Pressable>
          </View>

          <ScrollView style={styles.editSheetScroll} keyboardShouldPersistTaps="handled">
            {destinations.map((dest, idx) => (
              <View key={dest.id}>
                <View style={styles.destEditRow}>
                  <View style={styles.destDot} />
                  <View style={styles.destEditInfo}>
                    <Text style={[styles.destEditName, { color: colors.foreground }]}>{dest.name}</Text>
                    {dest.country ? (
                      <Text style={[styles.destEditCountry, { color: colors.muted }]}>{dest.country}</Text>
                    ) : null}
                  </View>
                  <View style={styles.destDaysRow}>
                    <TouchableOpacity
                      onPress={() => handleUpdateDays(dest.id, -1)}
                      style={[styles.miniBtn, { backgroundColor: colors.surface }]}
                    >
                      <Ionicons name="remove" size={12} color="#1C3D2E" />
                    </TouchableOpacity>
                    <Text style={[styles.destDaysNum, { color: colors.foreground }]}>{dest.days}</Text>
                    <Text style={[styles.destDaysLabel, { color: colors.muted }]}>dias</Text>
                    <TouchableOpacity
                      onPress={() => handleUpdateDays(dest.id, 1)}
                      style={[styles.miniBtn, { backgroundColor: colors.surface }]}
                    >
                      <Ionicons name="add" size={12} color="#1C3D2E" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleRemove(dest.id)}
                      style={[styles.miniBtn, { backgroundColor: colors.surface, marginLeft: 4 }]}
                    >
                      <Ionicons name="close" size={12} color="#C0392B" />
                    </TouchableOpacity>
                  </View>
                </View>
                {idx < destinations.length - 1 && (
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                )}
              </View>
            ))}

            <TouchableOpacity
              onPress={handleSave}
              style={[styles.saveBtn, { backgroundColor: '#1C3D2E' }]}
            >
              <Text style={styles.saveBtnText}>Salvar Alterações</Text>
            </TouchableOpacity>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getTripById, deleteTrip, updateStartDate, updateCoverImage } = useTripsStore();
  const trip = getTripById(id);
  const [activeTab, setActiveTab] = useState<TabKey>('geral');
  const [showEditDate, setShowEditDate] = useState(false);
  const [showEditDests, setShowEditDests] = useState(false);

  const handlePickCoverPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão necessária', 'Precisamos de acesso à sua galeria para alterar a foto de capa.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      await updateCoverImage(trip!.id, result.assets[0].uri);
    }
  };

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

  const handleDateChange = async (newDate: string) => {
    await updateStartDate(trip.id, newDate);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0F1F16' }}>
      <ScrollView showsVerticalScrollIndicator={false} stickyHeaderIndices={[1]}>
        {/* Hero */}
        <View style={{ height: HERO_HEIGHT }}>
          <ImageBackground source={{ uri: heroImage }} style={{ flex: 1 }}>
            <LinearGradient
              colors={['rgba(0,0,0,0.15)', 'rgba(15,31,22,0.95)']}
              style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: 20, paddingHorizontal: 20 }}
            >
              {/* Top bar */}
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
                  style={styles.heroBtn}
                >
                  <Ionicons name="chevron-back" size={20} color="#fff" />
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity onPress={handlePickCoverPhoto} style={[styles.heroBtn, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
                    <Ionicons name="camera-outline" size={16} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleDelete} style={[styles.heroBtn, { backgroundColor: 'rgba(192,57,43,0.5)' }]}>
                    <Ionicons name="trash-outline" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Trip title row with currency badges in column */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={[styles.heroTitle, { flex: 1, marginBottom: 0, marginRight: 10 }]}>{tripName}</Text>
                {/* Currency column — one badge per unique currency, stacked vertically */}
                <View style={{ flexDirection: 'column', gap: 4, flexShrink: 0, alignItems: 'flex-end', paddingBottom: 2 }}>
                  {getTripCurrencies(trip.destinations).map((c) => (
                    <View key={c.currency} style={styles.currencyBadge}>
                      <Text style={{ fontSize: 13, lineHeight: 16 }}>{c.flag}</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '500' }}>{c.symbol}</Text>
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 }}>{c.currency}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Text style={styles.heroSubtitle}>{countryName}</Text>
            </LinearGradient>
          </ImageBackground>
        </View>

        {/* Action buttons row: Data + Destinos */}
        <View style={[styles.actionBtnRow, { backgroundColor: '#0F1F16' }]}>
          <TouchableOpacity
            onPress={() => setShowEditDate(true)}
            style={styles.actionBtn}
          >
            <Ionicons name="calendar-outline" size={14} color="#A8D5B5" />
            <Text style={styles.actionBtnText}>Data</Text>
            <Text style={styles.actionBtnValue}>{formatDateDisplay(trip.startDate)}</Text>
          </TouchableOpacity>

          <View style={styles.actionBtnDivider} />

          <TouchableOpacity
            onPress={() => setShowEditDests(true)}
            style={styles.actionBtn}
          >
            <Ionicons name="location-outline" size={14} color="#A8D5B5" />
            <Text style={styles.actionBtnText}>Destinos</Text>
            <Text style={styles.actionBtnValue} numberOfLines={1}>
              {trip.destinations.map((d) => d.name).join(', ')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tabs - sticky */}
        <View style={{ backgroundColor: '#0F1F16', paddingVertical: 4 }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 8 }}
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  style={[
                    styles.tabBtn,
                    {
                      backgroundColor: isActive ? 'rgba(82,183,136,0.25)' : 'rgba(255,255,255,0.08)',
                      borderWidth: isActive ? 1 : 0,
                      borderColor: isActive ? '#52B788' : 'transparent',
                    },
                  ]}
                >
                  <Ionicons
                    name={tab.icon as any}
                    size={16}
                    color={isActive ? '#52B788' : 'rgba(245,240,232,0.5)'}
                  />
                  <Text
                    style={[
                      styles.tabBtnText,
                      { color: isActive ? '#52B788' : 'rgba(245,240,232,0.5)', fontWeight: isActive ? '600' : '400' },
                    ]}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Tab Content */}
        <View style={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
          {activeTab === 'geral' && <GeralTab trip={trip} onGoToPlaces={() => setActiveTab('lugares')} onGoToTransport={() => setActiveTab('transporte')} />}
          {activeTab === 'transporte' && <TransportTab trip={trip} />}
          {activeTab === 'hospedagem' && <AccommodationBlock trip={trip} />}
          {activeTab === 'lugares' && (
            <PlacesScreen tripId={trip.id} places={trip.places} destinations={trip.destinations} />
          )}
          {activeTab === 'fotos' && <FotosTab trip={trip} />}
          {activeTab === 'historia' && <HistoryTab trip={trip} />}
        </View>
      </ScrollView>

      {/* Edit Date Modal */}
      <EditDateModal
        visible={showEditDate}
        currentDate={trip.startDate}
        onClose={() => setShowEditDate(false)}
        onConfirm={handleDateChange}
      />

      {/* Edit Destinations Modal */}
      <EditDestinationsModal
        visible={showEditDests}
        trip={trip}
        onClose={() => setShowEditDests(false)}
      />
    </View>
  );
}

// ─── Geral Tab ────────────────────────────────────────────────────────────────

function GeralTab({ trip, onGoToPlaces, onGoToTransport }: { trip: any; onGoToPlaces: () => void; onGoToTransport: () => void }) {
  return (
    <View>
      {/* Next Transport Card */}
      <NextTransportCard
        transports={trip.transport || []}
        destinations={trip.destinations || []}
        startDate={trip.startDate}
        onPress={onGoToTransport}
      />

      {/* Itinerary Block (AI Day-by-Day) */}
      <ItineraryBlock trip={trip} onGoToPlaces={onGoToPlaces} />

      {/* Documents Block */}
      <DocumentsBlock tripId={trip.id} documents={trip.documents} />

      {/* Playlist Block */}
      <View style={styles.playlistBlock}>
        <View style={styles.playlistHeader}>
          <Ionicons name="musical-notes-outline" size={16} color="#52B788" />
          <Text style={styles.playlistTitle}>PLAYLIST DO DESTINO</Text>
        </View>
        <Text style={styles.playlistSubtitle}>
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

function FotosTab({ trip }: { trip: any }) {
  return (
    <View style={{ paddingTop: 4 }}>
      <TripPhotosBlock tripId={trip.id} tripName={trip.name || ''} fullPage />
    </View>
  );
}

function TransportTab({ trip }: { trip: any }) {
  return (
    <View>
      <TransportBlock
        tripId={trip.id}
        transports={trip.transport}
        destinations={trip.destinations}
        cityTransportMode={trip.cityTransportMode}
        accommodations={trip.accommodations}
      />
      {trip.transport.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="airplane-outline" size={48} color="rgba(245,240,232,0.2)" />
          <Text style={styles.emptyStateTitle}>Nenhum transporte adicionado</Text>
          <Text style={styles.emptyStateSubtitle}>Adicione voos, carros ou trens à sua viagem</Text>
        </View>
      )}
    </View>
  );
}

function HistoryTab({ trip }: { trip: any }) {
  const destName = trip.destinations[0]?.name || 'seu destino';
  return (
    <View style={styles.historyBlock}>
      <View style={styles.historyHeader}>
        <Ionicons name="book-outline" size={18} color="#52B788" />
        <Text style={styles.historyTitle}>História de {destName}</Text>
      </View>
      <Text style={styles.historyText}>
        Explore a história, cultura e curiosidades sobre {destName}. Esta seção será preenchida com informações
        sobre os destinos da sua viagem.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heroBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  currencyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  heroTitle: {
    color: '#F5F0E8',
    fontSize: 28,
    fontFamily: 'serif',
    fontStyle: 'italic',
    fontWeight: '600',
    marginBottom: 4,
  },
  heroSubtitle: {
    color: 'rgba(245,240,232,0.7)',
    fontSize: 14,
  },
  // Action buttons row
  actionBtnRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionBtnDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginVertical: 8,
  },
  actionBtnText: {
    color: '#A8D5B5',
    fontSize: 12,
    fontWeight: '600',
  },
  actionBtnValue: {
    color: 'rgba(245,240,232,0.6)',
    fontSize: 11,
    flex: 1,
  },
  actionBtnValueText: {
    color: 'rgba(245,240,232,0.6)',
    fontSize: 11,
    flex: 1,
  },
  // Tabs
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  tabBtnText: {
    fontSize: 13,
  },
  // Geral tab
  playlistBlock: {
    backgroundColor: 'rgba(28,61,46,0.85)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  playlistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  playlistTitle: {
    color: '#F5F0E8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  playlistSubtitle: {
    color: 'rgba(245,240,232,0.5)',
    fontSize: 13,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateTitle: {
    color: 'rgba(245,240,232,0.4)',
    fontSize: 16,
    marginTop: 12,
  },
  emptyStateSubtitle: {
    color: 'rgba(245,240,232,0.3)',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  historyBlock: {
    backgroundColor: 'rgba(28,61,46,0.85)',
    borderRadius: 20,
    padding: 20,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  historyTitle: {
    color: '#F5F0E8',
    fontSize: 16,
    fontWeight: '600',
  },
  historyText: {
    color: 'rgba(245,240,232,0.6)',
    fontSize: 14,
    lineHeight: 22,
  },
  // Edit Date Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  editCard: {
    borderRadius: 24,
    padding: 24,
    width: 300,
  },
  editCardTitle: {
    fontSize: 18,
    fontStyle: 'italic',
    fontFamily: 'serif',
    fontWeight: '600',
    marginBottom: 20,
  },
  datePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  arrowBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateCenter: {
    alignItems: 'center',
  },
  dateDayNum: {
    fontSize: 36,
    fontWeight: '700',
  },
  dateMonthText: {
    fontSize: 14,
    marginTop: 2,
  },
  editCardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  // Edit Destinations Modal
  editSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  editSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  editSheetTitle: {
    fontSize: 20,
    fontStyle: 'italic',
    fontFamily: 'serif',
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editSheetScroll: {
    paddingHorizontal: 24,
  },
  destEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  destDot: {
    width: 4,
    height: 20,
    borderRadius: 2,
    backgroundColor: '#2D5A3D',
    marginRight: 12,
  },
  destEditInfo: {
    flex: 1,
  },
  destEditName: {
    fontSize: 15,
    fontWeight: '600',
  },
  destEditCountry: {
    fontSize: 12,
    marginTop: 1,
  },
  destDaysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destDaysNum: {
    fontSize: 14,
    fontWeight: '700',
    minWidth: 16,
    textAlign: 'center',
  },
  destDaysLabel: {
    fontSize: 11,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },
  saveBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
