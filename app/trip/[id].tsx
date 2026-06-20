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
import { TransportSummaryCard } from '@/components/trip/next-transport-card';
import { useColors } from '@/hooks/use-colors';
import { generateId } from '@/utils/trip-helpers';
import * as ImagePicker from 'expo-image-picker';
import type { Destination } from '@/types/voyage';
import { DestinationAutocomplete } from '@/components/destination-autocomplete';
import { useTripsStore as useTripsStoreForDuration } from '@/store/trips';
import { trpc } from '@/lib/trpc';
import { ActivityIndicator } from 'react-native';
import { getCountryFlag } from '@/utils/trip-helpers';
import { useTranslation } from '@/hooks/use-translation';

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
  melbourne: 'https://images.unsplash.com/photo-1514395462725-fb4566210144?w=1200',
  'cape town': 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=1200',
  'cidade do cabo': 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=1200',
  marrakech: 'https://images.unsplash.com/photo-1539020140153-e479b8c22e70?w=1200',
  marrakesh: 'https://images.unsplash.com/photo-1539020140153-e479b8c22e70?w=1200',
  nairobi: 'https://images.unsplash.com/photo-1611348586804-61bf6c080437?w=1200',
  // Brazil
  florianopolis: 'https://images.unsplash.com/photo-1598977052544-c5e2a2a3e2e4?w=1200',
  florianópolis: 'https://images.unsplash.com/photo-1598977052544-c5e2a2a3e2e4?w=1200',
  'porto alegre': 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=1200',
  curitiba: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=1200',
  salvador: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200',
  recife: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200',
  fortaleza: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200',
  manaus: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?w=1200',
  brasilia: 'https://images.unsplash.com/photo-1589182373726-e4f658ab50f0?w=1200',
  brasília: 'https://images.unsplash.com/photo-1589182373726-e4f658ab50f0?w=1200',
  natal: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200',
  maceio: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200',
  maceió: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200',
  belem: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?w=1200',
  belém: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?w=1200',
  // Latin America
  medellin: 'https://images.unsplash.com/photo-1598977052544-c5e2a2a3e2e4?w=1200',
  medellín: 'https://images.unsplash.com/photo-1598977052544-c5e2a2a3e2e4?w=1200',
  cartagena: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200',
  'mexico city': 'https://images.unsplash.com/photo-1518105779142-d975f22f1b0a?w=1200',
  'cidade do mexico': 'https://images.unsplash.com/photo-1518105779142-d975f22f1b0a?w=1200',
  havana: 'https://images.unsplash.com/photo-1500759285222-a95626359a05?w=1200',
  habana: 'https://images.unsplash.com/photo-1500759285222-a95626359a05?w=1200',
  santiago: 'https://images.unsplash.com/photo-1518509562904-e7ef99cdcc86?w=1200',
  montevideo: 'https://images.unsplash.com/photo-1589182373726-e4f658ab50f0?w=1200',
  quito: 'https://images.unsplash.com/photo-1531968455001-5c5272a41129?w=1200',
  // More Europe
  porto: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=1200',
  milan: 'https://images.unsplash.com/photo-1513581166391-887a96ddeafd?w=1200',
  milao: 'https://images.unsplash.com/photo-1513581166391-887a96ddeafd?w=1200',
  milão: 'https://images.unsplash.com/photo-1513581166391-887a96ddeafd?w=1200',
  naples: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1200',
  napoles: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1200',
  nápoles: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1200',
  brussels: 'https://images.unsplash.com/photo-1559113202-c916b8e44373?w=1200',
  bruxelas: 'https://images.unsplash.com/photo-1559113202-c916b8e44373?w=1200',
  copenhagen: 'https://images.unsplash.com/photo-1513622470522-26c3c8a854bc?w=1200',
  copenhague: 'https://images.unsplash.com/photo-1513622470522-26c3c8a854bc?w=1200',
  stockholm: 'https://images.unsplash.com/photo-1509356843151-3e7d96241e11?w=1200',
  estocolmo: 'https://images.unsplash.com/photo-1509356843151-3e7d96241e11?w=1200',
  oslo: 'https://images.unsplash.com/photo-1513622470522-26c3c8a854bc?w=1200',
  helsinki: 'https://images.unsplash.com/photo-1513622470522-26c3c8a854bc?w=1200',
  edinburgh: 'https://images.unsplash.com/photo-1506377585622-bedcbb027afc?w=1200',
  edimburgo: 'https://images.unsplash.com/photo-1506377585622-bedcbb027afc?w=1200',
  // Middle East & Asia
  'abu dhabi': 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=1200',
  doha: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=1200',
  'hong kong': 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200',
  'hongkong': 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200',
  taipei: 'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=1200',
  hanoi: 'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=1200',
  'ho chi minh': 'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=1200',
  'kuala lumpur': 'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=1200',
  jakarta: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=1200',
  mumbai: 'https://images.unsplash.com/photo-1529253355930-ddbe423a2ac7?w=1200',
  delhi: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?w=1200',
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
    if (key !== 'default' && destName.includes(key)) return url;
  }
  // 4. Dynamic Unsplash query for any city not in the curated map
  if (destName) {
    const query = encodeURIComponent(`${destName} city travel landmark`);
    return `https://source.unsplash.com/1200x800/?${query}`;
  }
  return DESTINATION_IMAGES.default;
}

type TabKey = 'geral' | 'transporte' | 'hospedagem' | 'lugares' | 'fotos' | 'historia';

// TABS are now built dynamically inside the component using translations

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatDateDisplay(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Edit Date Modal ────────────────────────────────────────────────────────

function EditDateModal({
  visible,
  currentDate,
  currentDuration,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  currentDate: string;
  currentDuration: number;
  onClose: () => void;
  onConfirm: (newDate: string, newDuration: number) => void;
}) {
  const colors = useColors();
  const today = new Date();
  const [pickerDate, setPickerDate] = useState(new Date(currentDate));
  const [duration, setDuration] = useState(currentDuration);

  // Sync when modal opens
  React.useEffect(() => {
    if (visible) {
      setPickerDate(new Date(currentDate));
      setDuration(currentDuration);
    }
  }, [visible, currentDate, currentDuration]);

  const adjustDate = (delta: number) => {
    const d = new Date(pickerDate);
    d.setDate(d.getDate() + delta);
    if (d >= today) setPickerDate(d);
  };

  const adjustDuration = (delta: number) => {
    setDuration((prev) => Math.max(1, prev + delta));
  };

  // Compute end date preview
  const endDate = new Date(pickerDate);
  endDate.setDate(endDate.getDate() + duration - 1);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={[styles.editCard, { backgroundColor: colors.background }]}>
          <Text style={[styles.editCardTitle, { color: '#1C3D2E' }]}>Datas do Roteiro</Text>

          {/* Start date */}
          <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Data de Início</Text>
          <View style={styles.datePickerRow}>
            <TouchableOpacity onPress={() => adjustDate(-1)} style={[styles.arrowBtn, { backgroundColor: colors.surface }]}>
              <Ionicons name="chevron-back" size={20} color="#1C3D2E" />
            </TouchableOpacity>
            <View style={styles.dateCenter}>
              <Text style={[styles.dateDayNum, { color: colors.foreground }]}>{pickerDate.getDate()}</Text>
              <Text style={[styles.dateMonthText, { color: colors.muted }]}>
                {MONTHS[pickerDate.getMonth()]} {pickerDate.getFullYear()}
              </Text>
            </View>
            <TouchableOpacity onPress={() => adjustDate(1)} style={[styles.arrowBtn, { backgroundColor: colors.surface }]}>
              <Ionicons name="chevron-forward" size={20} color="#1C3D2E" />
            </TouchableOpacity>
          </View>

          {/* Duration */}
          <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginTop: 16 }}>Duração</Text>
          <View style={[styles.datePickerRow, { marginBottom: 8 }]}>
            <TouchableOpacity onPress={() => adjustDuration(-1)} style={[styles.arrowBtn, { backgroundColor: colors.surface }]}>
              <Ionicons name="chevron-back" size={20} color="#1C3D2E" />
            </TouchableOpacity>
            <View style={styles.dateCenter}>
              <Text style={[styles.dateDayNum, { color: colors.foreground }]}>{duration}</Text>
              <Text style={[styles.dateMonthText, { color: colors.muted }]}>dias</Text>
            </View>
            <TouchableOpacity onPress={() => adjustDuration(1)} style={[styles.arrowBtn, { backgroundColor: colors.surface }]}>
              <Ionicons name="chevron-forward" size={20} color="#1C3D2E" />
            </TouchableOpacity>
          </View>

          {/* End date preview */}
          <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', marginBottom: 20 }}>
            Término: {endDate.getDate()} de {MONTHS[endDate.getMonth()]} de {endDate.getFullYear()}
          </Text>

          <View style={styles.editCardActions}>
            <TouchableOpacity onPress={onClose} style={[styles.cancelBtn, { backgroundColor: colors.surface }]}>
              <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { onConfirm(pickerDate.toISOString(), duration); onClose(); }}
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
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Sync destinations when modal opens
  React.useEffect(() => {
    if (visible) setDestinations(trip.destinations);
  }, [visible, trip.destinations]);

  const totalDays = trip.totalDays;
  const allocatedDays = destinations.reduce((sum, d) => sum + d.days, 0);

  const handleUpdateDays = (id: string, delta: number) => {
    setDestinations((prev) =>
      prev.map((d) => (d.id === id ? { ...d, days: Math.max(1, d.days + delta) } : d))
    );
  };

  const handleRemove = (id: string) => {
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
    // Fetch details in background for lat/lng/imageUrl
    try {
      const res = await fetch(
        `/api/trpc/places.details?input=${encodeURIComponent(JSON.stringify({ json: { placeId: prediction.placeId } }))}`
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

          {/* Days summary */}
          <View style={{ paddingHorizontal: 24, marginBottom: 12 }}>
            <View style={[styles.daysSummaryRow, { backgroundColor: allocatedDays > totalDays ? 'rgba(192,57,43,0.12)' : 'rgba(28,61,46,0.08)' }]}>
              <Ionicons name="calendar-outline" size={14} color={allocatedDays > totalDays ? '#C0392B' : '#2D5A3D'} />
              <Text style={[styles.daysSummaryText, { color: allocatedDays > totalDays ? '#C0392B' : '#2D5A3D' }]}>
                {allocatedDays} de {totalDays} dias alocados
              </Text>
              {allocatedDays > totalDays && (
                <Text style={{ fontSize: 11, color: '#C0392B', marginLeft: 4 }}>— excede o roteiro</Text>
              )}
            </View>
          </View>

          <ScrollView style={styles.editSheetScroll} keyboardShouldPersistTaps="handled">
            {destinations.map((dest, idx) => (
              <View key={dest.id}>
                <View style={styles.destEditRow}>
                  {/* Reorder arrows */}
                  <View style={{ gap: 2, marginRight: 8 }}>
                    <TouchableOpacity
                      onPress={() => handleMoveUp(idx)}
                      style={[styles.miniBtn, { backgroundColor: idx === 0 ? 'transparent' : colors.surface }]}
                      disabled={idx === 0}
                    >
                      <Ionicons name="chevron-up" size={12} color={idx === 0 ? 'transparent' : '#1C3D2E'} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleMoveDown(idx)}
                      style={[styles.miniBtn, { backgroundColor: idx === destinations.length - 1 ? 'transparent' : colors.surface }]}
                      disabled={idx === destinations.length - 1}
                    >
                      <Ionicons name="chevron-down" size={12} color={idx === destinations.length - 1 ? 'transparent' : '#1C3D2E'} />
                    </TouchableOpacity>
                  </View>

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

            {/* Add new destination */}
            <View style={{ marginTop: 16, marginBottom: 8 }}>
              <Text style={[styles.destDaysLabel, { color: colors.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }]}>Adicionar destino</Text>
              <DestinationAutocomplete onSelect={handleAddDestination} placeholder="Buscar cidade ou região..." />
            </View>

            <TouchableOpacity
              onPress={handleSave}
              style={[styles.saveBtn, { backgroundColor: '#1C3D2E', marginTop: 16 }]}
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
  const t = useTranslation();
  const { getTripById, deleteTrip, updateStartDate, updateCoverImage, updateTrip } = useTripsStore();
  const trip = getTripById(id);
  const [activeTab, setActiveTab] = useState<TabKey>('geral');

  const TABS: { key: TabKey; label: string; icon: string }[] = [
    { key: 'geral', label: t.trip.tabs.overview, icon: 'location' },
    { key: 'transporte', label: t.transport.title, icon: 'airplane' },
    { key: 'hospedagem', label: t.accommodation.title, icon: 'bed' },
    { key: 'lugares', label: t.places.title, icon: 'map' },
    { key: 'fotos', label: t.photos.title, icon: 'images' },
    { key: 'historia', label: 'Info', icon: 'information-circle' },
  ];
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
        <Text style={{ color: '#1C3D2E', fontSize: 18 }}>{t.common.noResults}</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: '#3D5A47', fontSize: 16 }}>{t.common.back}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const heroImage = getHeroImage(trip);
  const tripName = getTripName(trip);
  const countryName = trip.destinations.map((d) => d.country || d.name).join(', ');

  const handleDelete = () => {
    Alert.alert(
      t.trip.deleteTrip,
      t.trip.deleteTripConfirm,
      [
        { text: t.common.cancel, style: 'cancel' },
        {
          text: t.common.delete,
          style: 'destructive',
          onPress: async () => {
            await deleteTrip(trip.id);
            router.back();
          },
        },
      ]
    );
  };

  const handleDateChange = async (newDate: string, newDuration: number) => {
    await updateStartDate(trip.id, newDate);
    // Also update totalDays and recalculate endDate
    const start = new Date(newDate);
    const end = new Date(start);
    end.setDate(end.getDate() + newDuration - 1);
    await updateTrip(trip.id, { totalDays: newDuration, endDate: end.toISOString() });
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
                  <TouchableOpacity onPress={() => router.push({ pathname: '/trip/share', params: { tripId: trip.id } } as any)} style={[styles.heroBtn, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
                    <Ionicons name="person-add-outline" size={16} color="#fff" />
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
        <View style={{ paddingHorizontal: 16, marginTop: 12, marginBottom: 4 }}>
          <View style={styles.actionBtnRow}>
            <TouchableOpacity
              onPress={() => setShowEditDate(true)}
              style={styles.actionBtn}
            >
              <Ionicons name="calendar-outline" size={14} color="#A8D5B5" />
              <Text style={styles.actionBtnText}>{t.trip.overview.dates}</Text>
              <Text style={styles.actionBtnValue} numberOfLines={1}>{formatDateDisplay(trip.startDate)}</Text>
            </TouchableOpacity>

            <View style={styles.actionBtnDivider} />

            <TouchableOpacity
              onPress={() => setShowEditDests(true)}
              style={styles.actionBtn}
            >
              <Ionicons name="location-outline" size={14} color="#A8D5B5" />
              <Text style={styles.actionBtnText}>{t.trip.overview.destination}</Text>
              <Text style={styles.actionBtnValue} numberOfLines={1}>
                {trip.destinations.map((d) => d.name).join(', ')}
              </Text>
            </TouchableOpacity>
          </View>
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
        currentDuration={trip.totalDays}
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
  // Aggregate all documents from all sources with source labels
  const allDocs = React.useMemo(() => {
    const docs: any[] = [];

    // Trip-level documents
    (trip.documents || []).forEach((d: any) => docs.push(d));

    // Transport boarding passes / contracts / tickets
    (trip.transport || []).forEach((t: any) => {
      const label = t.flight?.flightNumber || t.leg || 'Transporte';
      if (t.boardingPassUri) {
        docs.push({ id: `bp-${t.id}`, name: `Passagem — ${label}`, type: 'image', url: t.boardingPassUri, _source: 'transport' });
      }
      if (t.carContractUri) {
        docs.push({ id: `cc-${t.id}`, name: `Contrato de Carro — ${label}`, type: 'image', url: t.carContractUri, _source: 'transport' });
      }
      if (t.trainBusFerry?.ticketDocUri) {
        docs.push({ id: `tk-${t.id}`, name: `Passagem — ${label}`, type: 'image', url: t.trainBusFerry.ticketDocUri, _source: 'transport' });
      }
    });

    // Accommodation confirmations
    (trip.accommodations || []).forEach((acc: any) => {
      if (acc.confirmationDocUri) {
        docs.push({ id: `acc-${acc.id}`, name: `Confirmação — ${acc.name || 'Hotel'}`, type: 'image', url: acc.confirmationDocUri, _source: 'accommodation' });
      }
    });

    // Place attachments
    (trip.places || []).forEach((p: any) => {
      (p.attachments || []).forEach((att: any) => {
        docs.push({ ...att, id: `pl-${p.id}-${att.id}`, name: `${att.name} — ${p.name}`, _source: 'place' });
      });
    });

    return docs;
  }, [trip.documents, trip.transport, trip.accommodations, trip.places]);

  return (
    <View>
      {/* Transport Summary Card */}
      <TransportSummaryCard
        transports={trip.transport || []}
        destinations={trip.destinations || []}
        startDate={trip.startDate}
        onPress={onGoToTransport}
      />

      {/* Itinerary Block (AI Day-by-Day) */}
      <ItineraryBlock trip={trip} onGoToPlaces={onGoToPlaces} />

      {/* Documents Block — aggregated from all sources */}
      <DocumentsBlock tripId={trip.id} documents={allDocs} />

      {/* Expenses Block */}
      <ExpensesBlock tripId={trip.id} expenses={trip.expenses} currency={trip.currency} travelers={trip.travelers || []} />

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
  const t = useTranslation();
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
          <Text style={styles.emptyStateTitle}>{t.transport.noTransport}</Text>
          <Text style={styles.emptyStateSubtitle}>{t.transport.addTransport}</Text>
        </View>
      )}
    </View>
  );
}

function DestinationInfoCard({ destination, travelMonth }: { destination: Destination; travelMonth?: string }) {
  const generateInfo = trpc.destinationInfo.generate.useMutation();
  const [info, setInfo] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  const load = async () => {
    if (loaded || loading) return;
    setLoading(true);
    try {
      const result = await generateInfo.mutateAsync({
        destination: destination.name,
        country: destination.country,
        travelMonth,
      });
      setInfo(result.data);
      setLoaded(true);
    } catch {
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); }, []);

  const crowdColor = (level: string) => {
    if (!level) return '#52B788';
    const l = level.toLowerCase();
    if (l.includes('alto') || l.includes('high')) return '#EF4444';
    if (l.includes('médio') || l.includes('medium') || l.includes('medio')) return '#F59E0B';
    return '#52B788';
  };

  return (
    <View style={infoStyles.card}>
      {/* Destination header */}
      <View style={infoStyles.destHeader}>
        <Text style={infoStyles.destFlag}>{getCountryFlag(destination.country || destination.name) || '🌍'}</Text>
        <Text style={infoStyles.destName}>{destination.name}</Text>
        {travelMonth && <Text style={infoStyles.destMonth}>{travelMonth}</Text>}
      </View>

      {loading && (
        <View style={infoStyles.loadingRow}>
          <ActivityIndicator size="small" color="#52B788" />
          <Text style={infoStyles.loadingText}>Carregando informações...</Text>
        </View>
      )}

      {!loading && !info && loaded && (
        <View style={infoStyles.loadingRow}>
          <Ionicons name="alert-circle-outline" size={16} color="rgba(245,240,232,0.4)" />
          <Text style={infoStyles.loadingText}>Não foi possível carregar as informações.</Text>
        </View>
      )}

      {info && (
        <>
          {/* Climate */}
          <View style={infoStyles.section}>
            <View style={infoStyles.sectionHeader}>
              <Ionicons name="partly-sunny-outline" size={16} color="#F59E0B" />
              <Text style={infoStyles.sectionTitle}>Clima</Text>
              {info.climate?.avgTempC != null && (
                <View style={infoStyles.tempBadge}>
                  <Text style={infoStyles.tempText}>{info.climate.avgTempC}°C</Text>
                </View>
              )}
            </View>
            <Text style={infoStyles.sectionBody}>{info.climate?.description}</Text>
            {info.climate?.recommendation && (
              <View style={infoStyles.tipRow}>
                <Ionicons name="bulb-outline" size={13} color="#F59E0B" />
                <Text style={infoStyles.tipText}>{info.climate.recommendation}</Text>
              </View>
            )}
          </View>

          {/* Crowd */}
          <View style={infoStyles.section}>
            <View style={infoStyles.sectionHeader}>
              <Ionicons name="people-outline" size={16} color={crowdColor(info.crowd?.level)} />
              <Text style={infoStyles.sectionTitle}>Lotação</Text>
              {info.crowd?.level && (
                <View style={[infoStyles.levelBadge, { backgroundColor: crowdColor(info.crowd.level) + '22', borderColor: crowdColor(info.crowd.level) + '44' }]}>
                  <Text style={[infoStyles.levelText, { color: crowdColor(info.crowd.level) }]}>{info.crowd.level}</Text>
                </View>
              )}
            </View>
            <Text style={infoStyles.sectionBody}>{info.crowd?.description}</Text>
            {info.crowd?.tip && (
              <View style={infoStyles.tipRow}>
                <Ionicons name="bulb-outline" size={13} color="#52B788" />
                <Text style={infoStyles.tipText}>{info.crowd.tip}</Text>
              </View>
            )}
          </View>

          {/* Population */}
          {info.population?.count && (
            <View style={infoStyles.section}>
              <View style={infoStyles.sectionHeader}>
                <Ionicons name="business-outline" size={16} color="rgba(245,240,232,0.6)" />
                <Text style={infoStyles.sectionTitle}>Habitantes</Text>
              </View>
              <Text style={infoStyles.sectionBody}>{info.population.count} habitantes</Text>
            </View>
          )}

          {/* Health */}
          <View style={infoStyles.section}>
            <View style={infoStyles.sectionHeader}>
              <Ionicons name="medical-outline" size={16} color="#EF4444" />
              <Text style={infoStyles.sectionTitle}>Saúde</Text>
              <View style={[infoStyles.levelBadge, { backgroundColor: info.health?.waterSafe ? '#52B78822' : '#EF444422', borderColor: info.health?.waterSafe ? '#52B78844' : '#EF444444' }]}>
                <Text style={[infoStyles.levelText, { color: info.health?.waterSafe ? '#52B788' : '#EF4444' }]}>
                  {info.health?.waterSafe ? 'Água potável' : 'Água não potável'}
                </Text>
              </View>
            </View>
            {info.health?.vaccines?.length > 0 && (
              <View style={infoStyles.tagRow}>
                {info.health.vaccines.map((v: string, i: number) => (
                  <View key={i} style={infoStyles.tag}>
                    <Text style={infoStyles.tagText}>{v}</Text>
                  </View>
                ))}
              </View>
            )}
            {info.health?.notes && <Text style={[infoStyles.sectionBody, { marginTop: 6 }]}>{info.health.notes}</Text>}
          </View>

          {/* Visa */}
          <View style={infoStyles.section}>
            <View style={infoStyles.sectionHeader}>
              <Ionicons name="document-text-outline" size={16} color="#52B788" />
              <Text style={infoStyles.sectionTitle}>Visto</Text>
              <View style={[infoStyles.levelBadge, { backgroundColor: info.visa?.required ? '#EF444422' : '#52B78822', borderColor: info.visa?.required ? '#EF444444' : '#52B78844' }]}>
                <Text style={[infoStyles.levelText, { color: info.visa?.required ? '#EF4444' : '#52B788' }]}>
                  {info.visa?.required ? 'Necessário' : 'Não necessário'}
                </Text>
              </View>
            </View>
            <Text style={infoStyles.sectionBody}>{info.visa?.type}</Text>
            {info.visa?.notes && <Text style={[infoStyles.sectionBody, { marginTop: 4, opacity: 0.7 }]}>{info.visa.notes}</Text>}
          </View>

          {/* Tips */}
          {info.tips?.length > 0 && (
            <View style={infoStyles.section}>
              <View style={infoStyles.sectionHeader}>
                <Ionicons name="star-outline" size={16} color="#52B788" />
                <Text style={infoStyles.sectionTitle}>Dicas</Text>
              </View>
              {info.tips.map((tip: string, i: number) => (
                <View key={i} style={infoStyles.tipRow}>
                  <Text style={infoStyles.tipBullet}>•</Text>
                  <Text style={infoStyles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

function HistoryTab({ trip }: { trip: any }) {
  const travelMonth = trip.startDate
    ? new Date(trip.startDate).toLocaleString('pt-BR', { month: 'long' })
    : undefined;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
    >
      {trip.destinations.length === 0 ? (
        <View style={infoStyles.emptyState}>
          <Ionicons name="information-circle-outline" size={40} color="rgba(245,240,232,0.2)" />
          <Text style={infoStyles.emptyText}>Adicione destinos ao roteiro para ver as informações</Text>
        </View>
      ) : (
        trip.destinations.map((dest: Destination) => (
          <DestinationInfoCard key={dest.id} destination={dest} travelMonth={travelMonth} />
        ))
      )}
    </ScrollView>
  );
}

const infoStyles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  destHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  destFlag: { fontSize: 24 },
  destName: { flex: 1, fontSize: 18, fontWeight: '700', color: '#F5F0E8' },
  destMonth: {
    fontSize: 12,
    color: 'rgba(245,240,232,0.5)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  loadingText: { fontSize: 13, color: 'rgba(245,240,232,0.5)' },
  section: {
    marginBottom: 14,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: 'rgba(245,240,232,0.8)', flex: 1 },
  sectionBody: { fontSize: 13, color: 'rgba(245,240,232,0.65)', lineHeight: 18 },
  tempBadge: {
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 0.5,
    borderColor: 'rgba(245,158,11,0.3)',
  },
  tempText: { fontSize: 13, fontWeight: '700', color: '#F59E0B' },
  levelBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 0.5,
  },
  levelText: { fontSize: 11, fontWeight: '600' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  tag: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 0.5,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  tagText: { fontSize: 11, color: '#EF4444' },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  tipBullet: { fontSize: 13, color: '#52B788', lineHeight: 18 },
  tipText: { flex: 1, fontSize: 12, color: 'rgba(245,240,232,0.6)', lineHeight: 18 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 14, color: 'rgba(245,240,232,0.4)', textAlign: 'center', paddingHorizontal: 32 },
});

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
  daysSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  daysSummaryText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
