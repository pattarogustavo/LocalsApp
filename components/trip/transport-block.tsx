import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  ScrollView, TextInput, Alert, Image, Platform, ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { useTripsStore } from '@/store/trips';
import { generateId } from '@/utils/trip-helpers';
import { trpc } from '@/lib/trpc';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { DateTimePickerField } from '@/components/ui/datetime-picker-field';
import * as Linking from 'expo-linking';
import type { Transport, TransportMode, CityTransportMode, Destination, Accommodation, CarInfo } from '@/types/voyage';
import { PlacesAutocompleteInput, type PlaceResult } from '@/components/ui/places-autocomplete-input';
import { DocAttachField } from '@/components/ui/doc-attach-field';
import { getApiBaseUrl } from '@/constants/oauth';

// ─── Constants ────────────────────────────────────────────────────────────────

const BETWEEN_MODES: Array<{ key: TransportMode; label: string; icon: string }> = [
  { key: 'flight', label: 'Voo', icon: 'airplane-outline' },
  { key: 'car', label: 'Carro', icon: 'car-outline' },
  { key: 'train', label: 'Trem', icon: 'train-outline' },
  { key: 'bus', label: 'Ônibus', icon: 'bus-outline' },
  { key: 'ferry', label: 'Barco', icon: 'boat-outline' },
  { key: 'other', label: 'Outro', icon: 'navigate-outline' },
];

const CITY_MODES: Array<{ key: CityTransportMode; label: string; icon: string; desc: string }> = [
  { key: 'public', label: 'Transporte Público', icon: 'subway-outline', desc: 'Metrô, ônibus, tram' },
  { key: 'uber', label: 'Uber / Táxi', icon: 'car-outline', desc: 'Aplicativo ou táxi' },
  { key: 'walk', label: 'A pé', icon: 'walk-outline', desc: 'Explorar caminhando' },
  { key: 'bike', label: 'Bicicleta', icon: 'bicycle-outline', desc: 'Bike compartilhada' },
  { key: 'car', label: 'Carro Próprio', icon: 'car-sport-outline', desc: 'Carro alugado ou próprio' },
  { key: 'taxi', label: 'Táxi', icon: 'car-outline', desc: 'Táxi convencional' },
];

const FLIGHT_STATUS_COLORS: Record<string, string> = {
  scheduled: '#52B788', delayed: '#F59E0B', boarding: '#3B82F6',
  departed: '#8B5CF6', arrived: '#10B981', cancelled: '#EF4444',
};
const FLIGHT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'No horário', delayed: 'Atrasado', boarding: 'Embarcando',
  departed: 'Partiu', arrived: 'Chegou', cancelled: 'Cancelado',
};

function formatTime(time: string): string {
  if (!time) return '--:--';
  if (time.includes('T')) {
    const d = new Date(time);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return time;
}

// ─── Build legs from destinations ─────────────────────────────────────────────
// Given [GRU, Roma, Paris], legs are: GRU→Roma, Roma→Paris, Paris→GRU (return)

function buildLegs(destinations: Destination[], originLabel = 'Origem'): string[] {
  if (destinations.length === 0) return [`${originLabel} → Destino`, `Destino → ${originLabel}`];
  const names = destinations.map((d) => d.name);
  const legs: string[] = [];
  // Outbound: origin → first dest, then between dests
  legs.push(`${originLabel} → ${names[0]}`);
  for (let i = 0; i < names.length - 1; i++) {
    legs.push(`${names[i]} → ${names[i + 1]}`);
  }
  // Return
  legs.push(`${names[names.length - 1]} → ${originLabel}`);
  return legs;
}

// ─── Notification helpers ─────────────────────────────────────────────────────

async function requestNotifPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  const { status: newStatus } = await Notifications.requestPermissionsAsync();
  return newStatus === 'granted';
}

async function scheduleFlightNotifications(transport: Transport): Promise<string[]> {
  const f = transport.flight;
  if (!f?.departureTime) return [];
  const granted = await requestNotifPermission();
  if (!granted) return [];

  const ids: string[] = [];
  const depDate = new Date(f.departureTime);

  // Check-in reminder: 24h before
  const checkInDate = new Date(depDate.getTime() - 24 * 60 * 60 * 1000);
  if (checkInDate > new Date()) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `Check-in: ${f.flightNumber}`,
        body: `Seu voo ${f.origin} → ${f.destination} parte amanhã. Faça o check-in agora!`,
        data: { type: 'checkin', transportId: transport.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: checkInDate },
    });
    ids.push(id);
  }

  // Boarding reminder: 4h before
  const boardingDate = new Date(depDate.getTime() - 4 * 60 * 60 * 1000);
  if (boardingDate > new Date()) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `Embarque em 4h: ${f.flightNumber}`,
        body: `${f.origin} → ${f.destination} às ${formatTime(f.departureTime)}${f.terminal ? ` · Terminal ${f.terminal}` : ''}${f.gate ? ` · Gate ${f.gate}` : ''}`,
        data: { type: 'boarding', transportId: transport.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: boardingDate },
    });
    ids.push(id);
  }

  return ids;
}

async function cancelFlightNotifications(ids: string[]) {
  for (const id of ids) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }
}

// ─── Flight Card ──────────────────────────────────────────────────────────────

function FlightCard({
  transport,
  onRemove,
  onAddBoardingPass,
  onViewBoardingPass,
}: {
  transport: Transport;
  onRemove: () => void;
  onAddBoardingPass: () => void;
  onViewBoardingPass: () => void;
}) {
  const f = transport.flight!;
  const statusColor = FLIGHT_STATUS_COLORS[f.status || 'scheduled'];
  const statusLabel = FLIGHT_STATUS_LABELS[f.status || 'scheduled'];
  const hasNotifs = (transport.notificationIds?.length ?? 0) > 0;

  // Show actual time if available and different from scheduled
  const depTime = f.departureActual && f.departureActual !== f.departureTime
    ? f.departureActual : f.departureTime;
  const arrTime = f.arrivalActual && f.arrivalActual !== f.arrivalTime
    ? f.arrivalActual : f.arrivalTime;

  return (
    <View style={styles.flightCard}>
      {/* Top row: remove + notification badges */}
      <View style={styles.flightCardTopRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {hasNotifs && (
            <View style={styles.notifBadge}>
              <Ionicons name="notifications" size={10} color="#C4A35A" />
            </View>
          )}
          {f.airline ? (
            <Text style={styles.flightAirlineName}>{f.airline}</Text>
          ) : null}
        </View>
        <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
          <Ionicons name="trash-outline" size={14} color="rgba(245,240,232,0.35)" />
        </TouchableOpacity>
      </View>

      {/* Main route row — city names top, IATA big, times below */}
      <View style={styles.flightRouteRow}>
        {/* Origin */}
        <View style={styles.flightEndpoint}>
          <Text style={styles.flightCityName} numberOfLines={1}>
            {f.originCity || f.origin || '---'}
          </Text>
          <Text style={styles.flightIATA}>{f.origin || '---'}</Text>
          <Text style={styles.flightTime}>{formatTime(depTime)}</Text>
        </View>

        {/* Middle: flight number + line + duration */}
        <View style={styles.flightMiddle}>
          <Text style={styles.flightNumberLabel}>{f.flightNumber}</Text>
          <View style={styles.flightLineRow}>
            <View style={styles.flightLineDot} />
            <View style={styles.flightLineBar} />
            <Ionicons name="airplane" size={14} color="rgba(245,240,232,0.6)" />
            <View style={styles.flightLineBar} />
            <View style={styles.flightLineDot} />
          </View>
          {f.duration ? (
            <Text style={styles.flightDurationLabel}>{f.duration}</Text>
          ) : null}
        </View>

        {/* Destination */}
        <View style={[styles.flightEndpoint, { alignItems: 'flex-end' }]}>
          <Text style={styles.flightCityName} numberOfLines={1}>
            {f.destinationCity || f.destination || '---'}
          </Text>
          <Text style={styles.flightIATA}>{f.destination || '---'}</Text>
          <Text style={styles.flightTime}>{formatTime(arrTime)}</Text>
        </View>
      </View>

      {/* Bottom row: status + terminal/gate + boarding pass */}
      <View style={styles.flightBottomRow}>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        {f.terminal ? (
          <Text style={styles.flightGateText}>T{f.terminal}</Text>
        ) : null}
        {f.gate ? (
          <Text style={styles.flightGateText}>Gate {f.gate}</Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {transport.boardingPassUri ? (
          <TouchableOpacity style={styles.boardingPassBtn} onPress={onViewBoardingPass}>
            <Ionicons name="qr-code-outline" size={12} color="#52B788" />
            <Text style={styles.boardingPassText}>Passagem</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.boardingPassBtnEmpty} onPress={onAddBoardingPass}>
            <Ionicons name="qr-code-outline" size={12} color="rgba(245,240,232,0.3)" />
            <Text style={styles.boardingPassTextEmpty}>+ QR</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Car Card ────────────────────────────────────────────────────────────────

function CarCard({ transport, onRemove }: { transport: Transport; onRemove: () => void }) {
  const c = transport.car!;

  const formatDT = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <View style={styles.carCard}>
      {/* Top row */}
      <View style={styles.flightCardTopRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={styles.modeIconBg}>
            <Ionicons name="car-outline" size={14} color="#52B788" />
          </View>
          <Text style={styles.flightAirlineName}>{transport.leg || 'Carro'}</Text>
        </View>
        <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
          <Ionicons name="trash-outline" size={14} color="rgba(245,240,232,0.35)" />
        </TouchableOpacity>
      </View>

      {/* Route */}
      <View style={styles.carRouteRow}>
        <View style={styles.carEndpoint}>
          <Text style={styles.carEndpointLabel}>SAÍDA</Text>
          <Text style={styles.carTime}>
            {c.departureTime ? formatDT(c.departureTime) : '--:--'}
          </Text>
          <Text style={styles.carAddress} numberOfLines={2}>{c.originAddress}</Text>
        </View>
        <View style={styles.carMiddle}>
          <View style={styles.carLineRow}>
            <View style={styles.carLineDot} />
            <View style={styles.carLineBar} />
            <Ionicons name="car" size={14} color="rgba(245,240,232,0.5)" />
            <View style={styles.carLineBar} />
            <View style={styles.carLineDot} />
          </View>
          {c.travelDuration ? (
            <Text style={styles.carDuration}>{c.travelDuration}</Text>
          ) : null}
          {c.distanceText ? (
            <Text style={styles.carDistance}>{c.distanceText}</Text>
          ) : null}
        </View>
        <View style={[styles.carEndpoint, { alignItems: 'flex-end' }]}>
          <Text style={styles.carEndpointLabel}>CHEGADA</Text>
          <Text style={styles.carTime}>{formatDT(c.desiredArrivalTime)}</Text>
          <Text style={[styles.carAddress, { textAlign: 'right' }]} numberOfLines={2}>{c.destinationAddress}</Text>
        </View>
      </View>

      {/* Footer: maps link */}
      {c.mapsUrl ? (
        <TouchableOpacity
          style={styles.carMapsBtn}
          onPress={() => Linking.openURL(c.mapsUrl!)}
        >
          <Ionicons name="map-outline" size={12} color="#52B788" />
          <Text style={styles.carMapsBtnText}>Abrir no Google Maps</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function GenericCard({ transport, onRemove }: { transport: Transport; onRemove: () => void }) {
  const modeInfo = BETWEEN_MODES.find((m) => m.key === transport.mode);
  return (
    <View style={styles.transportCard}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={styles.modeIconBg}>
            <Ionicons name={modeInfo?.icon as any || 'navigate-outline'} size={16} color="#52B788" />
          </View>
          <View>
            <Text style={styles.flightNumber}>{modeInfo?.label || 'Transporte'}</Text>
            {transport.travelTime ? <Text style={styles.airlineName}>{transport.travelTime}</Text> : null}
          </View>
        </View>
        <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
          <Ionicons name="trash-outline" size={14} color="rgba(245,240,232,0.4)" />
        </TouchableOpacity>
      </View>
      {transport.leg ? (
        <Text style={styles.legLabel}>{transport.leg}</Text>
      ) : null}
      {(transport.distance || transport.platform || transport.trainNumber) && (
        <View style={styles.cardFooter}>
          {transport.distance && (
            <View style={styles.footerItem}>
              <Ionicons name="navigate-outline" size={12} color="rgba(245,240,232,0.4)" />
              <Text style={styles.footerText}>{transport.distance}</Text>
            </View>
          )}
          {transport.trainNumber && (
            <View style={styles.footerItem}>
              <Ionicons name="train-outline" size={12} color="rgba(245,240,232,0.4)" />
              <Text style={styles.footerText}>#{transport.trainNumber}</Text>
            </View>
          )}
          {transport.platform && (
            <View style={styles.footerItem}>
              <Ionicons name="location-outline" size={12} color="rgba(245,240,232,0.4)" />
              <Text style={styles.footerText}>Plataforma {transport.platform}</Text>
            </View>
          )}
        </View>
      )}
      {transport.trainBusFerry?.ticketDocUri ? (
        <TouchableOpacity
          style={styles.boardingPassBtn}
          activeOpacity={0.7}
          onPress={() => Linking.openURL(transport.trainBusFerry!.ticketDocUri!).catch(() =>
            Alert.alert('Erro', 'Não foi possível abrir o documento.')
          )}
        >
          <Ionicons name="document-attach-outline" size={12} color="#52B788" />
          <Text style={styles.boardingPassText}>Bilhete anexado</Text>
          <Ionicons name="open-outline" size={11} color="rgba(82,183,136,0.7)" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── Add Transport Modal ───────────────────────────────────────────────────────

// ─── Mini flight result row ───────────────────────────────────────────────────
function FlightResultRow({
  flight,
  onSelect,
}: {
  flight: any;
  onSelect: () => void;
}) {
  return (
    <TouchableOpacity style={styles.flightResultRow} onPress={onSelect}>
      <View style={styles.flightResultLeft}>
        <Text style={styles.flightResultIATA}>{flight.origin}</Text>
        <Ionicons name="arrow-forward" size={12} color="rgba(245,240,232,0.35)" style={{ marginHorizontal: 4 }} />
        <Text style={styles.flightResultIATA}>{flight.destination}</Text>
      </View>
      <View style={styles.flightResultMid}>
        <Text style={styles.flightResultNum}>{flight.flightNumber}</Text>
        {flight.airline ? <Text style={styles.flightResultAirline} numberOfLines={1}>{flight.airline}</Text> : null}
      </View>
      <View style={styles.flightResultRight}>
        <Text style={styles.flightResultTime}>{formatTime(flight.departureTime)}</Text>
        {flight.duration ? <Text style={styles.flightResultDur}>{flight.duration}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={14} color="rgba(82,183,136,0.5)" />
    </TouchableOpacity>
  );
}

function AddTransportModal({
  visible,
  onClose,
  onAdd,
  legs,
  accommodations,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (t: Transport) => void;
  legs: string[];
  accommodations: Accommodation[];
}) {
  // Transport type
  const [mode, setMode] = useState<TransportMode>('flight');
  const [selectedLeg, setSelectedLeg] = useState(legs[0] || '');

  // Search mode: 'route' = origin+dest+date, 'number' = flight number+date
  const [searchMode, setSearchMode] = useState<'route' | 'number'>('route');

  // Route search fields
  const [routeOrigin, setRouteOrigin] = useState(''); // IATA code
  const [routeOriginQuery, setRouteOriginQuery] = useState(''); // display text
  const [routeOriginResults, setRouteOriginResults] = useState<any[]>([]);
  const [showOriginDropdown, setShowOriginDropdown] = useState(false);
  const [routeDest, setRouteDest] = useState(''); // IATA code
  const [routeDestQuery, setRouteDestQuery] = useState(''); // display text
  const [routeDestResults, setRouteDestResults] = useState<any[]>([]);
  const [showDestDropdown, setShowDestDropdown] = useState(false);
  const [routeDate, setRouteDate] = useState<Date | null>(null);
  const [routeAirline, setRouteAirline] = useState(''); // optional airline filter
  const [routeResults, setRouteResults] = useState<any[]>([]);
  const [routeSearched, setRouteSearched] = useState(false);
  const [airportSearchTimer, setAirportSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Number search fields
  const [flightNumber, setFlightNumber] = useState('');
  const [flightDate, setFlightDate] = useState<Date | null>(null);

  // Shared
  const [selectedFlight, setSelectedFlight] = useState<any>(null);
  const [searchError, setSearchError] = useState('');
  const [enableNotifs, setEnableNotifs] = useState(true);

  // Non-flight fields
  const [travelTime, setTravelTime] = useState('');
  const [distance, setDistance] = useState('');
  const [trainNumber, setTrainNumber] = useState('');
  const [platform, setPlatform] = useState('');

  // Train/Bus/Ferry/Other fields
  const [tbfOriginStation, setTbfOriginStation] = useState<PlaceResult | null>(null);
  const [tbfDestStation, setTbfDestStation] = useState<PlaceResult | null>(null);
  const [tbfDeparture, setTbfDeparture] = useState<Date | null>(null);
  const [tbfArrival, setTbfArrival] = useState<Date | null>(null);
  const [tbfTicketNumber, setTbfTicketNumber] = useState('');
  const [tbfNotifEnabled, setTbfNotifEnabled] = useState(true);
  const [tbfDocUri, setTbfDocUri] = useState<string | null>(null);
  const [otherName, setOtherName] = useState('');
  const [otherDeparture, setOtherDeparture] = useState<Date | null>(null);
  const [otherArrival, setOtherArrival] = useState<Date | null>(null);

  // Car contract
  const [carContractUri, setCarContractUri] = useState<string | null>(null);
  const [carOriginPlace, setCarOriginPlace] = useState<PlaceResult | null>(null);
  const [carDestPlace, setCarDestPlace] = useState<PlaceResult | null>(null);
  const [carOriginPlaceId, setCarOriginPlaceId] = useState('');
  const [carDestPlaceId, setCarDestPlaceId] = useState('');

  // Car-specific fields
  const [carOrigin, setCarOrigin] = useState('');
  const [carDest, setCarDest] = useState('');
  const [carArrival, setCarArrival] = useState<Date | null>(null);
  const [carRouteResult, setCarRouteResult] = useState<{ duration: string; durationSeconds: number; distance: string; mapsUrl: string } | null>(null);
  const [carRouteSearched, setCarRouteSearched] = useState(false);
  const [carRouteError, setCarRouteError] = useState('');
  const [carNotifEnabled, setCarNotifEnabled] = useState(true);

  const lookupMutation = trpc.flights.lookup.useMutation();
  const searchByRouteMutation = trpc.flights.searchByRoute.useMutation();
  // Airport search helpers
  const searchAirports = async (query: string, isOrigin: boolean) => {
    if (query.length < 2) {
      if (isOrigin) { setRouteOriginResults([]); setShowOriginDropdown(false); }
      else { setRouteDestResults([]); setShowDestDropdown(false); }
      return;
    }
    try {
      const base = getApiBaseUrl();
      const url = `${base}/api/trpc/airports.search?input=${encodeURIComponent(JSON.stringify({ json: { query } }))}`;
      const res = await fetch(url);
      const json = await res.json();
      const airports = json?.result?.data?.json?.airports || [];
      if (isOrigin) { setRouteOriginResults(airports); setShowOriginDropdown(airports.length > 0); }
      else { setRouteDestResults(airports); setShowDestDropdown(airports.length > 0); }
    } catch {
      if (isOrigin) { setRouteOriginResults([]); setShowOriginDropdown(false); }
      else { setRouteDestResults([]); setShowDestDropdown(false); }
    }
  };

  const handleOriginQueryChange = (text: string) => {
    setRouteOriginQuery(text);
    setRouteOrigin(''); // clear IATA until selected
    setSearchError('');
    if (airportSearchTimer) clearTimeout(airportSearchTimer);
    setAirportSearchTimer(setTimeout(() => searchAirports(text, true), 350));
  };

  const handleDestQueryChange = (text: string) => {
    setRouteDestQuery(text);
    setRouteDest(''); // clear IATA until selected
    setSearchError('');
    if (airportSearchTimer) clearTimeout(airportSearchTimer);
    setAirportSearchTimer(setTimeout(() => searchAirports(text, false), 350));
  };

  const selectOriginAirport = (airport: any) => {
    setRouteOrigin(airport.iata);
    setRouteOriginQuery(`${airport.city || airport.name} (${airport.iata})`);
    setShowOriginDropdown(false);
    setRouteOriginResults([]);
  };

  const selectDestAirport = (airport: any) => {
    setRouteDest(airport.iata);
    setRouteDestQuery(`${airport.city || airport.name} (${airport.iata})`);
    setShowDestDropdown(false);
    setRouteDestResults([]);
  };

  // Resolve formatted address for car origin when an establishment is selected
  const carOriginDetailsQuery = trpc.places.details.useQuery(
    { placeId: carOriginPlaceId },
    { enabled: carOriginPlaceId.length > 0 }
  );
  const carDestDetailsQuery = trpc.places.details.useQuery(
    { placeId: carDestPlaceId },
    { enabled: carDestPlaceId.length > 0 }
  );

  // When place details resolve, update the address used for routing
  useEffect(() => {
    if (carOriginDetailsQuery.data?.address) {
      setCarOrigin(carOriginDetailsQuery.data.address);
    }
  }, [carOriginDetailsQuery.data]);

  useEffect(() => {
    if (carDestDetailsQuery.data?.address) {
      setCarDest(carDestDetailsQuery.data.address);
    }
  }, [carDestDetailsQuery.data]);

  const isSearching = lookupMutation.isPending || searchByRouteMutation.isPending;

  const reset = () => {
    setMode('flight'); setSelectedLeg(legs[0] || '');
    setSearchMode('route');
    setRouteOrigin(''); setRouteDest(''); setRouteDate(null); setRouteAirline(''); setRouteResults([]); setRouteSearched(false);
    setFlightNumber(''); setFlightDate(null);
    setSelectedFlight(null); setSearchError('');
    setEnableNotifs(true);
    setTravelTime(''); setDistance(''); setTrainNumber(''); setPlatform('');
    setTbfOriginStation(null); setTbfDestStation(null);
    setTbfDeparture(null); setTbfArrival(null);
    setTbfTicketNumber(''); setTbfNotifEnabled(true); setTbfDocUri(null);
    setOtherName(''); setOtherDeparture(null); setOtherArrival(null);
    setCarContractUri(null); setCarOriginPlace(null); setCarDestPlace(null);
    setCarOriginPlaceId(''); setCarDestPlaceId('');
    setCarOrigin(''); setCarDest(''); setCarArrival(null);
    setCarRouteResult(null); setCarRouteSearched(false); setCarRouteError('');
    setCarNotifEnabled(true);
  };

  const handleCarRouteSearch = async () => {
    const o = carOrigin.trim();
    const d = carDest.trim();
    if (!o || !d) { setCarRouteError('Informe o endereço de origem e destino.'); return; }
    if (!carArrival) { setCarRouteError('Selecione o horário de chegada desejado.'); return; }
    setCarRouteError('');
    setCarRouteResult(null);
    setCarRouteSearched(false);
    try {
      // Use fetch directly to call the tRPC query endpoint
      const res = await fetch(`${getApiBaseUrl()}/api/trpc/directions.route?input=${encodeURIComponent(JSON.stringify({ json: { origin: o, destination: d, mode: 'driving' } }))}`);
      const json = await res.json();
      // tRPC with superjson: response is { result: { data: { json: { ... } } } }
      const data = json?.result?.data?.json ?? json?.result?.data;
      if (data?.found && data.durationText) {
        setCarRouteResult({
          duration: data.durationText,
          durationSeconds: data.durationSeconds || 0,
          distance: data.distanceText || '',
          mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}&travelmode=driving`,
        });
        setCarRouteSearched(true);
      } else {
        setCarRouteError('Não foi possível calcular a rota. Verifique os endereços.');
      }
    } catch {
      setCarRouteError('Erro ao calcular rota. Tente novamente.');
    }
  };

  // Helper: format Date to YYYY-MM-DD for AviationStack
  const toApiDate = (d: Date) => d.toISOString().split('T')[0];

  const handleRouteSearch = async () => {
    // Use selected IATA code, or fall back to typed text (user may type IATA directly)
    const o = (routeOrigin.trim() || routeOriginQuery.trim()).toUpperCase();
    const d = (routeDest.trim() || routeDestQuery.trim()).toUpperCase();
    if (o.length < 2) {
      setSearchError('Selecione ou digite o aeroporto de origem (ex: GRU, São Paulo).');
      return;
    }
    if (d.length < 2) {
      setSearchError('Selecione ou digite o aeroporto de destino (ex: LHR, Londres).');
      return;
    }
    if (!routeDate) {
      setSearchError('Selecione a data do voo.');
      return;
    }
    const dt = toApiDate(routeDate);
    setSearchError('');
    setRouteResults([]);
    setRouteSearched(false);
    try {
      const result = await searchByRouteMutation.mutateAsync({ origin: o, destination: d, date: dt });
      let flights = result.flights || [];
      // Client-side airline filter (optional)
      const airlineFilter = routeAirline.trim().toLowerCase();
      if (airlineFilter.length >= 2) {
        flights = flights.filter((f: any) =>
          (f.airline || '').toLowerCase().includes(airlineFilter) ||
          (f.flightNumber || '').toLowerCase().includes(airlineFilter)
        );
      }
      setRouteResults(flights);
      setRouteSearched(true);
      if (flights.length === 0) {
        const total = result.flights?.length ?? 0;
        if (total > 0 && airlineFilter.length >= 2) {
          setSearchError(`${total} voo${total > 1 ? 's' : ''} encontrado${total > 1 ? 's' : ''} nessa rota, mas nenhum da companhia "${routeAirline.trim()}". Tente outro nome ou deixe o campo em branco.`);
        } else {
          setSearchError('Nenhum voo encontrado. Certifique-se de selecionar um aeroporto da lista suspensa ou use o código IATA (ex: GRU, LHR).');
        }
      }
    } catch {
      setSearchError('Erro ao buscar voos. Tente novamente.');
    }
  };

  const handleNumberSearch = async () => {
    const fn = flightNumber.trim();
    if (!fn) { setSearchError('Informe o número do voo (ex: LA8084).'); return; }
    if (!flightDate) { setSearchError('Selecione a data do voo.'); return; }
    const dt = toApiDate(flightDate);
    setSearchError('');
    try {
      const result = await lookupMutation.mutateAsync({ flightNumber: fn, date: dt });
      if (result.found && result.flight) {
        setSelectedFlight(result.flight);
      } else {
        setSearchError('Voo não encontrado. Verifique o número e a data.');
      }
    } catch {
      setSearchError('Erro ao buscar voo. Tente novamente.');
    }
  };

  const handleAdd = async () => {
    if (mode === 'flight' && !selectedFlight) return;
    if (mode === 'car' && (!carOrigin.trim() || !carDest.trim() || !carArrival)) return;
    if ((mode === 'train' || mode === 'bus' || mode === 'ferry') && (!tbfOriginStation || !tbfDestStation || !tbfDeparture)) return;
    if (mode === 'other' && !otherName.trim()) return;

    let carInfo: CarInfo | undefined;
    if (mode === 'car') {
      const durationSec = carRouteResult?.durationSeconds || 0;
      const depTime = durationSec > 0
        ? new Date(carArrival!.getTime() - durationSec * 1000).toISOString()
        : undefined;
      carInfo = {
        originAddress: carOriginPlace?.fullDescription || carOrigin.trim(),
        destinationAddress: carDestPlace?.fullDescription || carDest.trim(),
        desiredArrivalTime: carArrival!.toISOString(),
        departureTime: depTime,
        travelDuration: carRouteResult?.duration,
        travelDurationSeconds: durationSec || undefined,
        distanceText: carRouteResult?.distance,
        mapsUrl: carRouteResult?.mapsUrl,
      };
    }

    const t: Transport = {
      id: generateId(),
      mode,
      leg: selectedLeg || undefined,
      ...(mode === 'flight' ? {
        flight: {
          flightNumber: selectedFlight.flightNumber,
          airline: selectedFlight.airline || '',
          origin: selectedFlight.origin,
          originCity: selectedFlight.originCity,
          destination: selectedFlight.destination,
          destinationCity: selectedFlight.destinationCity,
          departureTime: selectedFlight.departureTime,
          arrivalTime: selectedFlight.arrivalTime,
          departureActual: selectedFlight.departureActual,
          arrivalActual: selectedFlight.arrivalActual,
          duration: selectedFlight.duration,
          terminal: selectedFlight.terminal || undefined,
          gate: selectedFlight.gate || undefined,
          status: (selectedFlight.status as any) || 'scheduled',
        },
      } : mode === 'car' ? {
        car: carInfo,
        boardingPassUri: carContractUri || undefined,
      } : (mode === 'train' || mode === 'bus' || mode === 'ferry') ? {
        trainBusFerry: {
          originStation: tbfOriginStation!.name,
          originStationPlaceId: tbfOriginStation!.placeId,
          destinationStation: tbfDestStation!.name,
          destinationStationPlaceId: tbfDestStation!.placeId,
          departureTime: tbfDeparture!.toISOString(),
          arrivalTime: tbfArrival?.toISOString(),
          ticketNumber: tbfTicketNumber || undefined,
          notifyBeforeDeparture: tbfNotifEnabled,
          ticketDocUri: tbfDocUri || undefined,
        },
      } : mode === 'other' ? {
        other: {
          name: otherName.trim(),
          departureTime: otherDeparture?.toISOString(),
          arrivalTime: otherArrival?.toISOString(),
        },
      } : {
        travelTime: travelTime || undefined,
        distance: distance || undefined,
      }),
    };

    if (mode === 'flight' && enableNotifs && selectedFlight?.departureTime) {
      try {
        const ids = await scheduleFlightNotifications(t);
        if (ids.length > 0) t.notificationIds = ids;
      } catch (_) {}
    }

    // Car: schedule notification 1h before departure
    if (mode === 'car' && carNotifEnabled && carInfo?.departureTime && Platform.OS !== 'web') {
      try {
        const granted = await requestNotifPermission();
        if (granted) {
          const depDate = new Date(carInfo.departureTime);
          const alertDate = new Date(depDate.getTime() - 60 * 60 * 1000); // 1h before
          if (alertDate > new Date()) {
            const id = await Notifications.scheduleNotificationAsync({
              content: {
                title: '⏰ Hora de sair!',
                body: `Saia em 1 hora para chegar a tempo: ${carInfo.destinationAddress}`,
                data: { type: 'car_departure', transportId: t.id },
              },
              trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: alertDate },
            });
            t.notificationIds = [id];
          }
        }
      } catch (_) {}
    }

    // Train/Bus/Ferry: schedule notification 1h before departure
    if ((mode === 'train' || mode === 'bus' || mode === 'ferry') && tbfNotifEnabled && tbfDeparture && Platform.OS !== 'web') {
      try {
        const granted = await requestNotifPermission();
        if (granted) {
          const alertDate = new Date(tbfDeparture.getTime() - 60 * 60 * 1000);
          if (alertDate > new Date()) {
            const modeLabel = mode === 'train' ? 'Trem' : mode === 'bus' ? 'Ônibus' : 'Barco';
            const id = await Notifications.scheduleNotificationAsync({
              content: {
                title: `⏰ ${modeLabel} em 1 hora`,
                body: `Partida de ${tbfOriginStation!.name} → ${tbfDestStation!.name}`,
                data: { type: 'tbf_departure', transportId: t.id },
              },
              trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: alertDate },
            });
            t.notificationIds = [id];
          }
        }
      } catch (_) {}
    }

    onAdd(t);
    reset();
  };

  // ── Confirmed flight preview (shared by both search modes) ──────────────────
  const ConfirmedFlight = () => (
    <View style={styles.lookupResultCard}>
      <View style={styles.lookupResultHeader}>
        <Ionicons name="checkmark-circle" size={16} color="#52B788" />
        <Text style={styles.lookupResultTitle}>Voo selecionado</Text>
        <TouchableOpacity
          onPress={() => { setSelectedFlight(null); setRouteResults([]); setRouteSearched(false); }}
          style={{ marginLeft: 'auto' }}
        >
          <Text style={styles.lookupChangeText}>Alterar</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.lookupResultRoute}>
        <View style={{ alignItems: 'flex-start' }}>
          <Text style={styles.lookupResultCity}>{selectedFlight.originCity || selectedFlight.origin}</Text>
          <Text style={styles.lookupResultIATA}>{selectedFlight.origin}</Text>
          <Text style={styles.lookupResultTime}>{formatTime(selectedFlight.departureTime)}</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
          <Text style={styles.lookupResultFlightNum}>{selectedFlight.flightNumber}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', gap: 2 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(82,183,136,0.4)' }} />
            <Ionicons name="airplane" size={12} color="#52B788" />
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(82,183,136,0.4)' }} />
          </View>
          <Text style={styles.lookupResultDuration}>{selectedFlight.duration}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.lookupResultCity}>{selectedFlight.destinationCity || selectedFlight.destination}</Text>
          <Text style={styles.lookupResultIATA}>{selectedFlight.destination}</Text>
          <Text style={styles.lookupResultTime}>{formatTime(selectedFlight.arrivalTime)}</Text>
        </View>
      </View>
      {selectedFlight.airline ? (
        <Text style={styles.lookupResultAirline}>{selectedFlight.airline}</Text>
      ) : null}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Adicionar Transporte</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
              <Ionicons name="close" size={18} color="rgba(245,240,232,0.7)" />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* Leg selector */}
            <Text style={styles.inputLabel}>TRAJETO</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 2 }}>
                {legs.map((leg) => (
                  <TouchableOpacity
                    key={leg}
                    onPress={() => setSelectedLeg(leg)}
                    style={[styles.legChip, selectedLeg === leg && styles.legChipActive]}
                  >
                    <Text style={[styles.legChipText, selectedLeg === leg && { color: '#0F1F16' }]}>{leg}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Mode selector */}
            <Text style={styles.inputLabel}>TIPO</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 2 }}>
                {BETWEEN_MODES.map((m) => (
                  <TouchableOpacity
                    key={m.key}
                    onPress={() => { setMode(m.key); setSelectedFlight(null); setSearchError(''); }}
                    style={[styles.modeChip, mode === m.key && styles.modeChipActive]}
                  >
                    <Ionicons name={m.icon as any} size={16} color={mode === m.key ? '#0F1F16' : '#52B788'} />
                    <Text style={[styles.modeChipText, mode === m.key && { color: '#0F1F16' }]}>{m.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {mode === 'flight' ? (
              <>
                {selectedFlight ? (
                  // ── Confirmed flight + notification toggle ──────────────────
                  <>
                    <ConfirmedFlight />
                    {Platform.OS !== 'web' && (
                      <TouchableOpacity
                        style={styles.notifToggleRow}
                        onPress={() => setEnableNotifs(!enableNotifs)}
                      >
                        <View style={[styles.notifToggleBox, enableNotifs && styles.notifToggleBoxActive]}>
                          {enableNotifs && <Ionicons name="checkmark" size={13} color="#0F1F16" />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.notifToggleLabel}>Ativar lembretes de voo</Text>
                          <Text style={styles.notifToggleDesc}>Check-in 24h antes · Embarque 4h antes</Text>
                        </View>
                        <Ionicons name="notifications-outline" size={16} color="#C4A35A" />
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  // ── Search panel ────────────────────────────────────────────
                  <View style={styles.lookupCard}>
                    {/* Search mode toggle */}
                    <View style={styles.searchModeRow}>
                      <TouchableOpacity
                        style={[styles.searchModeBtn, searchMode === 'route' && styles.searchModeBtnActive]}
                        onPress={() => { setSearchMode('route'); setSearchError(''); setRouteResults([]); setRouteSearched(false); }}
                      >
                        <Ionicons name="swap-horizontal-outline" size={14} color={searchMode === 'route' ? '#0F1F16' : '#52B788'} />
                        <Text style={[styles.searchModeBtnText, searchMode === 'route' && { color: '#0F1F16' }]}>Origem / Destino</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.searchModeBtn, searchMode === 'number' && styles.searchModeBtnActive]}
                        onPress={() => { setSearchMode('number'); setSearchError(''); }}
                      >
                        <Ionicons name="barcode-outline" size={14} color={searchMode === 'number' ? '#0F1F16' : '#52B788'} />
                        <Text style={[styles.searchModeBtnText, searchMode === 'number' && { color: '#0F1F16' }]}>Número do voo</Text>
                      </TouchableOpacity>
                    </View>

                    {searchMode === 'route' ? (
                      // ── Route search ─────────────────────────────────────────────────────
                      <>
                        {/* Origin airport */}
                        <View style={{ marginTop: 4 }}>
                          <Text style={styles.inputLabel}>AEROPORTO DE ORIGEM</Text>
                          <View style={{ position: 'relative' }}>
                            <View style={[styles.textInput, { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 0, height: 48 }]}>
                              <Ionicons name="airplane-outline" size={16} color="rgba(82,183,136,0.6)" />
                              <TextInput
                                value={routeOriginQuery}
                                onChangeText={handleOriginQueryChange}
                                placeholder="São Paulo, GRU, Brasil..."
                                placeholderTextColor="rgba(245,240,232,0.25)"
                                style={{ flex: 1, color: '#F5F0E8', fontSize: 14 }}
                                returnKeyType="search"
                              />
                              {routeOrigin ? (
                                <View style={{ backgroundColor: 'rgba(82,183,136,0.2)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                                  <Text style={{ color: '#52B788', fontSize: 12, fontWeight: '700' }}>{routeOrigin}</Text>
                                </View>
                              ) : null}
                            </View>
                            {showOriginDropdown && routeOriginResults.length > 0 && (
                              <View style={styles.airportDropdown}>
                                {routeOriginResults.map((ap: any) => (
                                  <TouchableOpacity
                                    key={ap.iata}
                                    style={styles.airportDropdownItem}
                                    onPress={() => selectOriginAirport(ap)}
                                  >
                                    <View style={styles.airportIATABadge}>
                                      <Text style={styles.airportIATAText}>{ap.iata}</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                      <Text style={styles.airportName} numberOfLines={1}>{ap.name}</Text>
                                      <Text style={styles.airportCity} numberOfLines={1}>{ap.city}{ap.country ? ` · ${ap.country}` : ''}</Text>
                                    </View>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            )}
                          </View>
                        </View>

                        {/* Destination airport */}
                        <View style={{ marginTop: 10 }}>
                          <Text style={styles.inputLabel}>AEROPORTO DE DESTINO</Text>
                          <View style={{ position: 'relative' }}>
                            <View style={[styles.textInput, { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 0, height: 48 }]}>
                              <Ionicons name="airplane" size={16} color="rgba(82,183,136,0.6)" />
                              <TextInput
                                value={routeDestQuery}
                                onChangeText={handleDestQueryChange}
                                placeholder="Londres, LHR, Reino Unido..."
                                placeholderTextColor="rgba(245,240,232,0.25)"
                                style={{ flex: 1, color: '#F5F0E8', fontSize: 14 }}
                                returnKeyType="search"
                              />
                              {routeDest ? (
                                <View style={{ backgroundColor: 'rgba(82,183,136,0.2)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                                  <Text style={{ color: '#52B788', fontSize: 12, fontWeight: '700' }}>{routeDest}</Text>
                                </View>
                              ) : null}
                            </View>
                            {showDestDropdown && routeDestResults.length > 0 && (
                              <View style={styles.airportDropdown}>
                                {routeDestResults.map((ap: any) => (
                                  <TouchableOpacity
                                    key={ap.iata}
                                    style={styles.airportDropdownItem}
                                    onPress={() => selectDestAirport(ap)}
                                  >
                                    <View style={styles.airportIATABadge}>
                                      <Text style={styles.airportIATAText}>{ap.iata}</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                      <Text style={styles.airportName} numberOfLines={1}>{ap.name}</Text>
                                      <Text style={styles.airportCity} numberOfLines={1}>{ap.city}{ap.country ? ` · ${ap.country}` : ''}</Text>
                                    </View>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            )}
                          </View>
                        </View>

                        <View style={{ marginTop: 10 }}>
                          <DatePickerField
                            label="DATA DO VOO"
                            value={routeDate}
                            onChange={(d) => { setRouteDate(d); setSearchError(''); }}
                          />
                        </View>

                        {/* Airline filter (optional) */}
                        <View style={{ marginTop: 10 }}>
                          <Text style={styles.inputLabel}>COMPANHIA AÉREA <Text style={{ color: 'rgba(245,240,232,0.3)', fontWeight: '400', textTransform: 'none', letterSpacing: 0 }}>(opcional)</Text></Text>
                          <View style={[styles.textInput, { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 0, height: 48 }]}>
                            <Ionicons name="business-outline" size={16} color="rgba(82,183,136,0.6)" />
                            <TextInput
                              value={routeAirline}
                              onChangeText={(v) => { setRouteAirline(v); setSearchError(''); }}
                              placeholder="LATAM, Gol, Azul, TAP..."
                              placeholderTextColor="rgba(245,240,232,0.25)"
                              style={{ flex: 1, color: '#F5F0E8', fontSize: 14 }}
                              returnKeyType="search"
                            />
                            {routeAirline.length > 0 && (
                              <TouchableOpacity onPress={() => setRouteAirline('')}>
                                <Ionicons name="close-circle" size={16} color="rgba(245,240,232,0.3)" />
                              </TouchableOpacity>
                            )}
                          </View>
                          <Text style={{ fontSize: 11, color: 'rgba(245,240,232,0.3)', marginTop: 4 }}>
                            Filtra os resultados por companhia. Deixe em branco para ver todos.
                          </Text>
                        </View>
                      </>
                    ) : (
                      // ── Number search ─────────────────────────────────────────
                      <>
                        <View style={{ marginTop: 4 }}>
                          <Text style={styles.inputLabel}>NÚMERO DO VOO</Text>
                          <TextInput
                            value={flightNumber}
                            onChangeText={(v) => { setFlightNumber(v); setSearchError(''); }}
                            placeholder="LA8084"
                            placeholderTextColor="rgba(245,240,232,0.25)"
                            autoCapitalize="characters"
                            style={[styles.textInput, { letterSpacing: 2, fontSize: 18, fontWeight: '700' }]}
                          />
                        </View>
                        <View style={{ marginTop: 10 }}>
                          <DatePickerField
                            label="DATA DO VOO"
                            value={flightDate}
                            onChange={(d) => { setFlightDate(d); setSearchError(''); }}
                          />
                        </View>
                      </>
                    )}

                    {/* Error */}
                    {searchError ? (
                      <View style={[styles.lookupErrorRow, { marginTop: 10 }]}>
                        <Ionicons name="alert-circle-outline" size={14} color="#EF4444" />
                        <Text style={styles.lookupErrorText}>{searchError}</Text>
                      </View>
                    ) : null}

                    {/* Search button */}
                    <TouchableOpacity
                      style={[styles.lookupBtn, { marginTop: 14 }, isSearching && { opacity: 0.6 }]}
                      onPress={searchMode === 'route' ? handleRouteSearch : handleNumberSearch}
                      disabled={isSearching}
                    >
                      {isSearching ? (
                        <ActivityIndicator size="small" color="#0F1F16" />
                      ) : (
                        <Text style={styles.lookupBtnText}>
                          {searchMode === 'route' ? 'Buscar voos' : 'Buscar voo'}
                        </Text>
                      )}
                    </TouchableOpacity>

                    {/* Route results list */}
                    {routeSearched && routeResults.length > 0 && (
                      <View style={styles.routeResultsList}>
                        <Text style={[styles.inputLabel, { marginBottom: 8 }]}>
                          {routeResults.length} VOO{routeResults.length > 1 ? 'S' : ''} ENCONTRADO{routeResults.length > 1 ? 'S' : ''} — SELECIONE
                        </Text>
                        {routeResults.map((fl, idx) => (
                          <FlightResultRow
                            key={fl.flightNumber + idx}
                            flight={fl}
                            onSelect={() => setSelectedFlight(fl)}
                          />
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </>
            ) : mode === 'car' ? (
              // ── Car mode ────────────────────────────────────────────────────────────────────
              <>
                {/* Origin via Google Places */}
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.inputLabel}>ENDEREÇO DE ORIGEM</Text>
                  <PlacesAutocompleteInput
                    placeholder="Buscar endereço ou estabelecimento..."
                    value={carOriginPlace?.fullDescription || ''}
                    onSelect={(p) => {
                      setCarOriginPlace(p);
                      // If it has a placeId, resolve formatted_address via details
                      if (p.placeId) {
                        setCarOriginPlaceId(p.placeId);
                        // Optimistic: use fullDescription until details resolve
                        setCarOrigin(p.fullDescription);
                      } else {
                        setCarOriginPlaceId('');
                        setCarOrigin(p.fullDescription);
                      }
                      setCarRouteResult(null); setCarRouteSearched(false); setCarRouteError('');
                    }}
                    searchTypes="mixed"
                    dark
                  />
                  {/* Hotel suggestion chips */}
                  {accommodations.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {accommodations.filter(a => a.address).map((a) => (
                          <TouchableOpacity
                            key={a.id}
                            style={styles.hotelSuggestionChip}
                            onPress={() => {
                              setCarOrigin(a.address!);
                              setCarOriginPlace({ placeId: '', name: a.name || '', fullDescription: a.address!, country: '' });
                              setCarRouteResult(null); setCarRouteSearched(false); setCarRouteError('');
                            }}
                          >
                            <Ionicons name="bed-outline" size={11} color="#52B788" />
                            <Text style={styles.hotelSuggestionText} numberOfLines={1}>{a.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  )}
                </View>

                {/* Destination via Google Places */}
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.inputLabel}>ENDEREÇO DE DESTINO</Text>
                  <PlacesAutocompleteInput
                    placeholder="Buscar endereço ou estabelecimento..."
                    value={carDestPlace?.fullDescription || ''}
                    onSelect={(p) => {
                      setCarDestPlace(p);
                      // If it has a placeId, resolve formatted_address via details
                      if (p.placeId) {
                        setCarDestPlaceId(p.placeId);
                        // Optimistic: use fullDescription until details resolve
                        setCarDest(p.fullDescription);
                      } else {
                        setCarDestPlaceId('');
                        setCarDest(p.fullDescription);
                      }
                      setCarRouteResult(null); setCarRouteSearched(false); setCarRouteError('');
                    }}
                    searchTypes="mixed"
                    dark
                  />
                  {accommodations.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {accommodations.filter(a => a.address).map((a) => (
                          <TouchableOpacity
                            key={a.id}
                            style={styles.hotelSuggestionChip}
                            onPress={() => {
                              setCarDest(a.address!);
                              setCarDestPlace({ placeId: '', name: a.name || '', fullDescription: a.address!, country: '' });
                              setCarRouteResult(null); setCarRouteSearched(false); setCarRouteError('');
                            }}
                          >
                            <Ionicons name="bed-outline" size={11} color="#52B788" />
                            <Text style={styles.hotelSuggestionText} numberOfLines={1}>{a.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  )}
                </View>

                {/* Arrival time */}
                <DateTimePickerField
                  label="HORÁRIO DE CHEGADA DESEJADO"
                  value={carArrival}
                  onChange={(d) => { setCarArrival(d); setCarRouteResult(null); setCarRouteSearched(false); }}
                  hint="O app calculará quando você precisa sair"
                />

                {/* Calculate route button */}
                {!carRouteSearched && (
                  <TouchableOpacity
                    style={[styles.lookupBtn, { marginBottom: 12 }]}
                    onPress={handleCarRouteSearch}
                  >
                    <Ionicons name="navigate-outline" size={16} color="#0F1F16" />
                    <Text style={[styles.lookupBtnText, { marginLeft: 6 }]}>Calcular rota</Text>
                  </TouchableOpacity>
                )}

                {/* Route error */}
                {carRouteError ? (
                  <View style={[styles.lookupErrorRow, { marginBottom: 12 }]}>
                    <Ionicons name="alert-circle-outline" size={14} color="#EF4444" />
                    <Text style={styles.lookupErrorText}>{carRouteError}</Text>
                  </View>
                ) : null}

                {/* Route result */}
                {carRouteSearched && carRouteResult && (
                  <View style={styles.carRouteResultCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <Ionicons name="checkmark-circle" size={16} color="#52B788" />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#52B788' }}>Rota calculada</Text>
                      <TouchableOpacity onPress={() => { setCarRouteResult(null); setCarRouteSearched(false); }} style={{ marginLeft: 'auto' }}>
                        <Text style={{ fontSize: 12, color: 'rgba(245,240,232,0.4)', textDecorationLine: 'underline' }}>Recalcular</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 16 }}>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ fontSize: 22, fontWeight: '800', color: '#F5F0E8' }}>{carRouteResult.duration}</Text>
                        <Text style={{ fontSize: 11, color: 'rgba(245,240,232,0.45)', marginTop: 2 }}>Tempo estimado</Text>
                      </View>
                      {carRouteResult.distance ? (
                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <Text style={{ fontSize: 22, fontWeight: '800', color: '#F5F0E8' }}>{carRouteResult.distance}</Text>
                          <Text style={{ fontSize: 11, color: 'rgba(245,240,232,0.45)', marginTop: 2 }}>Distância</Text>
                        </View>
                      ) : null}
                    </View>
                    {carArrival && carRouteResult.durationSeconds > 0 && (
                      <View style={{ marginTop: 12, padding: 10, backgroundColor: 'rgba(196,163,90,0.1)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(196,163,90,0.2)' }}>
                        <Text style={{ fontSize: 12, color: '#C4A35A', fontWeight: '600' }}>
                          ⏰ Sair às {new Date(carArrival.getTime() - carRouteResult.durationSeconds * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                        <Text style={{ fontSize: 11, color: 'rgba(245,240,232,0.45)', marginTop: 2 }}>Lembrete 1h antes da saída</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Notification toggle */}
                {Platform.OS !== 'web' && (
                  <TouchableOpacity
                    style={styles.notifToggleRow}
                    onPress={() => setCarNotifEnabled(!carNotifEnabled)}
                  >
                    <View style={[styles.notifToggleBox, carNotifEnabled && styles.notifToggleBoxActive]}>
                      {carNotifEnabled && <Ionicons name="checkmark" size={13} color="#0F1F16" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.notifToggleLabel}>Lembrete de saída</Text>
                      <Text style={styles.notifToggleDesc}>Aviso 1 hora antes de precisar sair</Text>
                    </View>
                    <Ionicons name="notifications-outline" size={16} color="#C4A35A" />
                  </TouchableOpacity>
                )}

                {/* Car contract / rental document */}
                <DocAttachField
                  label="CONTRATO DE LOCAÇÃO (OPCIONAL)"
                  uri={carContractUri}
                  onPick={setCarContractUri}
                  onRemove={() => setCarContractUri(null)}
                />
              </>
            ) : (mode === 'train' || mode === 'bus' || mode === 'ferry') ? (
              // ── Train / Bus / Ferry mode ────────────────────────────────────────────────────────────────────
              <>
                {/* Origin station */}
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.inputLabel}>
                    {mode === 'ferry' ? 'PORTO DE EMBARQUE' : 'ESTAÇÃO DE ORIGEM'}
                  </Text>
                  <PlacesAutocompleteInput
                    placeholder={mode === 'ferry' ? 'Buscar porto de embarque...' : 'Buscar estação de origem...'}
                    value={tbfOriginStation?.name || ''}
                    onSelect={(p) => setTbfOriginStation(p)}
                    searchTypes="establishment"
                    dark
                  />
                </View>

                {/* Destination station */}
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.inputLabel}>
                    {mode === 'ferry' ? 'PORTO DE DESEMBARQUE' : 'ESTAÇÃO DE DESTINO'}
                  </Text>
                  <PlacesAutocompleteInput
                    placeholder={mode === 'ferry' ? 'Buscar porto de desembarque...' : 'Buscar estação de destino...'}
                    value={tbfDestStation?.name || ''}
                    onSelect={(p) => setTbfDestStation(p)}
                    searchTypes="establishment"
                    dark
                  />
                </View>

                {/* Departure time */}
                <DateTimePickerField
                  label="HORÁRIO DE SAÍDA"
                  value={tbfDeparture}
                  onChange={setTbfDeparture}
                />

                {/* Arrival time */}
                <DateTimePickerField
                  label="HORÁRIO DE CHEGADA (ESTIMADO)"
                  value={tbfArrival}
                  onChange={setTbfArrival}
                />

                {/* Ticket number */}
                <InputRow
                  label="NÚMERO DO BILHETE"
                  value={tbfTicketNumber}
                  onChange={setTbfTicketNumber}
                  placeholder="Ex: 12345678"
                />

                {/* Notification toggle */}
                {Platform.OS !== 'web' && (
                  <TouchableOpacity
                    style={styles.notifToggleRow}
                    onPress={() => setTbfNotifEnabled(!tbfNotifEnabled)}
                  >
                    <View style={[styles.notifToggleBox, tbfNotifEnabled && styles.notifToggleBoxActive]}>
                      {tbfNotifEnabled && <Ionicons name="checkmark" size={13} color="#0F1F16" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.notifToggleLabel}>Alerta 1h antes da saída</Text>
                      <Text style={styles.notifToggleDesc}>Aviso antes do horário de partida</Text>
                    </View>
                    <Ionicons name="notifications-outline" size={16} color="#C4A35A" />
                  </TouchableOpacity>
                )}

                {/* Ticket document */}
                <DocAttachField
                  label="BILHETE / RESERVA (OPCIONAL)"
                  uri={tbfDocUri}
                  onPick={setTbfDocUri}
                  onRemove={() => setTbfDocUri(null)}
                />
              </>
            ) : mode === 'other' ? (
              // ── Other mode ────────────────────────────────────────────────────────────────────
              <>
                <InputRow
                  label="NOME DO TRANSPORTE"
                  value={otherName}
                  onChange={setOtherName}
                  placeholder="Ex: Transfer privado, Van, Helicóptero..."
                />
                <DateTimePickerField
                  label="HORÁRIO DE SAÍDA"
                  value={otherDeparture}
                  onChange={setOtherDeparture}
                />
                <DateTimePickerField
                  label="HORÁRIO DE CHEGADA"
                  value={otherArrival}
                  onChange={setOtherArrival}
                />
              </>
            ) : null}

            {/* Add button */}
            {(
              (mode === 'flight' && !!selectedFlight) ||
              (mode === 'car' && carOrigin.trim() && carDest.trim() && !!carArrival) ||
              ((mode === 'train' || mode === 'bus' || mode === 'ferry') && !!tbfOriginStation && !!tbfDestStation && !!tbfDeparture) ||
              (mode === 'other' && otherName.trim().length > 0)
            ) && (
              <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
                <Text style={styles.addBtnText}>Adicionar</Text>
              </TouchableOpacity>
            )}
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InputRow({ label, value, onChange, placeholder, autoCapitalize, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  hint?: string;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder}
        placeholderTextColor="rgba(245,240,232,0.25)" autoCapitalize={autoCapitalize || 'sentences'}
        style={styles.textInput} />
      {hint ? <Text style={styles.inputHint}>{hint}</Text> : null}
    </View>
  );
}

// ─── Boarding Pass Viewer ─────────────────────────────────────────────────────

function BoardingPassModal({
  uri,
  visible,
  onClose,
  onReplace,
}: {
  uri: string;
  visible: boolean;
  onClose: () => void;
  onReplace: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.bpOverlay}>
        <TouchableOpacity style={styles.bpClose} onPress={onClose}>
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>
        <Image source={{ uri }} style={styles.bpImage} resizeMode="contain" />
        <TouchableOpacity style={styles.bpReplaceBtn} onPress={onReplace}>
          <Ionicons name="refresh-outline" size={14} color="rgba(245,240,232,0.7)" />
          <Text style={styles.bpReplaceText}>Substituir imagem</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── City Transport Section ────────────────────────────────────────────────────

function CityTransportSection({ tripId, cityMode }: { tripId: string; cityMode?: CityTransportMode }) {
  const { updateCityTransportMode } = useTripsStore();
  const selected = cityMode;

  return (
    <View style={styles.citySection}>
      <View style={styles.citySectionHeader}>
        <Ionicons name="map-outline" size={14} color="#52B788" />
        <Text style={styles.citySectionTitle}>DENTRO DA CIDADE</Text>
      </View>
      <Text style={styles.citySectionDesc}>
        Como você vai se locomover nos destinos? A IA usará essa informação para calcular trajetos no roteiro.
      </Text>
      <View style={styles.cityModeGrid}>
        {CITY_MODES.map((m) => {
          const isActive = selected === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              onPress={() => updateCityTransportMode(tripId, m.key)}
              style={[styles.cityModeCard, isActive && styles.cityModeCardActive]}
            >
              <Ionicons name={m.icon as any} size={20} color={isActive ? '#0F1F16' : '#52B788'} />
              <Text style={[styles.cityModeLabel, isActive && { color: '#0F1F16' }]}>{m.label}</Text>
              <Text style={[styles.cityModeDesc, isActive && { color: 'rgba(15,31,22,0.65)' }]}>{m.desc}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function TransportBlock({
  tripId,
  transports,
  destinations,
  cityTransportMode,
  accommodations,
}: {
  tripId: string;
  transports: Transport[];
  destinations: Destination[];
  cityTransportMode?: CityTransportMode;
  accommodations?: Accommodation[];
}) {
  const { addTransport, removeTransport, updateTransport } = useTripsStore();
  const [showModal, setShowModal] = useState(false);
  const [boardingPassTransportId, setBoardingPassTransportId] = useState<string | null>(null);
  const [viewingBoardingPass, setViewingBoardingPass] = useState<Transport | null>(null);
  const refreshMutation = trpc.flights.refreshStatus.useMutation();

  // Auto-refresh status of all flights when the tab is opened
  React.useEffect(() => {
    const flightTransports = transports.filter(
      (t) => t.mode === 'flight' && t.flight?.flightNumber && t.flight?.departureTime
    );
    if (flightTransports.length === 0) return;
    flightTransports.forEach(async (t) => {
      const f = t.flight!;
      const depDate = f.departureTime.split('T')[0] || f.departureTime.substring(0, 10);
      if (!depDate || depDate.length < 8) return;
      try {
        const result = await refreshMutation.mutateAsync({
          flightNumber: f.flightNumber,
          date: depDate,
        });
        if (result.updated) {
          const updates: Partial<Transport> = {
            flight: {
              ...f,
              status: (result.status as any) || f.status,
              terminal: result.terminal || f.terminal,
              gate: result.gate || f.gate,
              departureActual: result.departureActual || f.departureActual,
              arrivalActual: result.arrivalActual || f.arrivalActual,
            },
          };
          updateTransport(tripId, t.id, updates);
        }
      } catch (_) {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const legs = buildLegs(destinations);

  const handleAdd = async (t: Transport) => {
    await addTransport(tripId, t);
    setShowModal(false);
  };

  const handleRemove = (transport: Transport) => {
    Alert.alert('Remover', 'Remover este transporte?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          // Cancel scheduled notifications
          if (transport.notificationIds?.length) {
            await cancelFlightNotifications(transport.notificationIds);
          }
          removeTransport(tripId, transport.id);
        },
      },
    ]);
  };

  const handleAddBoardingPass = (transportId: string) => {
    setBoardingPassTransportId(transportId);
    Alert.alert('Passagem / QR Code', 'Escolha como adicionar', [
      {
        text: 'Câmera',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permissão necessária', 'Precisamos de acesso à câmera.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
          if (!result.canceled && result.assets[0]) {
            await updateTransport(tripId, transportId, { boardingPassUri: result.assets[0].uri });
          }
        },
      },
      {
        text: 'Galeria',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permissão necessária', 'Precisamos de acesso à galeria.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
          if (!result.canceled && result.assets[0]) {
            await updateTransport(tripId, transportId, { boardingPassUri: result.assets[0].uri });
          }
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  // Group transports by leg
  const byLeg: Record<string, Transport[]> = {};
  for (const t of transports) {
    const key = t.leg || 'Outros';
    if (!byLeg[key]) byLeg[key] = [];
    byLeg[key].push(t);
  }

  return (
    <View style={styles.container}>
      {/* ── Entre Destinos ── */}
      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="airplane-outline" size={15} color="#52B788" />
          <Text style={styles.sectionTitle}>ENTRE DESTINOS</Text>
        </View>
        <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addIconBtn}>
          <Ionicons name="add" size={18} color="#52B788" />
        </TouchableOpacity>
      </View>

      {transports.length === 0 ? (
        <TouchableOpacity onPress={() => setShowModal(true)} style={styles.emptyState}>
          <Ionicons name="airplane-outline" size={24} color="rgba(245,240,232,0.2)" />
          <Text style={styles.emptyText}>Adicione os transportes entre os destinos</Text>
          <Text style={styles.emptyCta}>Toque para configurar →</Text>
        </TouchableOpacity>
      ) : (
        <View style={{ gap: 16 }}>
          {legs.map((leg) => {
            const legTransports = byLeg[leg] || [];
            return (
              <View key={leg}>
                <View style={styles.legHeader}>
                  <View style={styles.legDot} />
                  <Text style={styles.legHeaderText}>{leg}</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(82,183,136,0.12)', marginLeft: 8 }} />
                </View>
                {legTransports.length === 0 ? (
                  <TouchableOpacity
                    style={styles.legEmptyRow}
                    onPress={() => setShowModal(true)}
                  >
                    <Ionicons name="add-circle-outline" size={16} color="rgba(82,183,136,0.4)" />
                    <Text style={styles.legEmptyText}>Adicionar transporte para este trajeto</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ gap: 10 }}>
                    {legTransports.map((t) =>
                      t.mode === 'flight' && t.flight ? (
                        <FlightCard
                          key={t.id}
                          transport={t}
                          onRemove={() => handleRemove(t)}
                          onAddBoardingPass={() => handleAddBoardingPass(t.id)}
                          onViewBoardingPass={() => setViewingBoardingPass(t)}
                        />
                      ) : t.mode === 'car' && t.car ? (
                        <CarCard key={t.id} transport={t} onRemove={() => handleRemove(t)} />
                      ) : (
                        <GenericCard key={t.id} transport={t} onRemove={() => handleRemove(t)} />
                      )
                    )}
                  </View>
                )}
              </View>
            );
          })}
          {/* Transports with no leg */}
          {byLeg['Outros'] && byLeg['Outros'].length > 0 && (
            <View>
              <View style={styles.legHeader}>
                <View style={styles.legDot} />
                <Text style={styles.legHeaderText}>Outros</Text>
              </View>
              <View style={{ gap: 10 }}>
              {byLeg['Outros'].map((t) =>
                t.mode === 'flight' && t.flight ? (
                  <FlightCard
                    key={t.id}
                    transport={t}
                    onRemove={() => handleRemove(t)}
                    onAddBoardingPass={() => handleAddBoardingPass(t.id)}
                    onViewBoardingPass={() => setViewingBoardingPass(t)}
                  />
                ) : t.mode === 'car' && t.car ? (
                  <CarCard key={t.id} transport={t} onRemove={() => handleRemove(t)} />
                ) : (
                  <GenericCard key={t.id} transport={t} onRemove={() => handleRemove(t)} />
                )
              )}
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── Dentro da Cidade ── */}
      <CityTransportSection tripId={tripId} cityMode={cityTransportMode} />

      {/* Modals */}
      <AddTransportModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onAdd={handleAdd}
        legs={legs}
        accommodations={accommodations || []}
      />

      {viewingBoardingPass && viewingBoardingPass.boardingPassUri && (
        <BoardingPassModal
          uri={viewingBoardingPass.boardingPassUri}
          visible={true}
          onClose={() => setViewingBoardingPass(null)}
          onReplace={() => {
            const id = viewingBoardingPass.id;
            setViewingBoardingPass(null);
            setTimeout(() => handleAddBoardingPass(id), 400);
          }}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: 'rgba(245,240,232,0.7)' },
  addIconBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(82,183,136,0.15)', alignItems: 'center', justifyContent: 'center' },
  emptyState: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 20, alignItems: 'center', gap: 6 },
  emptyText: { fontSize: 14, color: 'rgba(245,240,232,0.6)', textAlign: 'center', lineHeight: 20 },
  emptyCta: { fontSize: 13, color: '#52B788', fontWeight: '600' },

  // Leg grouping
  legHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  legDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#52B788' },
  legHeaderText: { fontSize: 12, fontWeight: '700', color: 'rgba(245,240,232,0.6)', letterSpacing: 0.5 },
  legEmptyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(82,183,136,0.1)', borderStyle: 'dashed' },
  legEmptyText: { fontSize: 13, color: 'rgba(245,240,232,0.35)' },

  // Transport cards
  transportCard: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(82,183,136,0.12)' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modeIconBg: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(82,183,136,0.15)', alignItems: 'center', justifyContent: 'center' },
  flightNumber: { fontSize: 15, fontWeight: '700', color: '#F5F0E8', letterSpacing: 0.5 },
  airlineName: { fontSize: 12, color: 'rgba(245,240,232,0.5)', marginTop: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
  notifBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(196,163,90,0.15)', alignItems: 'center', justifyContent: 'center' },
  removeBtn: { padding: 4 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  routeEndpoint: { alignItems: 'flex-start', minWidth: 48 },
  routeCode: { fontSize: 22, fontWeight: '800', color: '#F5F0E8', letterSpacing: 1 },
  routeTime: { fontSize: 12, color: 'rgba(245,240,232,0.5)', marginTop: 2 },
  routeMiddle: { flex: 1, alignItems: 'center', gap: 4 },
  routeDuration: { fontSize: 11, color: 'rgba(245,240,232,0.5)' },
  routeLine: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 2 },
  routeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(82,183,136,0.5)' },
  layoverText: { fontSize: 10, color: '#F59E0B' },
  cardFooter: { flexDirection: 'row', gap: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerText: { fontSize: 11, color: 'rgba(245,240,232,0.4)' },
  legLabel: { fontSize: 12, color: 'rgba(245,240,232,0.5)', marginBottom: 8, marginTop: -8 },

  // Boarding pass
  boardingPassRow: { marginTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 10 },
  boardingPassBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: 'rgba(82,183,136,0.12)', borderRadius: 10, alignSelf: 'flex-start' },
  boardingPassText: { fontSize: 12, color: '#52B788', fontWeight: '600' },
  boardingPassBtnEmpty: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderStyle: 'dashed', alignSelf: 'flex-start' },
  boardingPassTextEmpty: { fontSize: 12, color: 'rgba(245,240,232,0.35)' },

  // Boarding pass viewer
  bpOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  bpClose: { position: 'absolute', top: 56, right: 20, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: 8 },
  bpImage: { width: '90%', height: '70%' },
  bpReplaceBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12 },
  bpReplaceText: { color: 'rgba(245,240,232,0.6)', fontSize: 13 },

  // City transport
  citySection: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(82,183,136,0.1)' },
  citySectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  citySectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: 'rgba(245,240,232,0.7)' },
  citySectionDesc: { fontSize: 12, color: 'rgba(245,240,232,0.45)', lineHeight: 17, marginBottom: 14 },
  cityModeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cityModeCard: { width: '47%', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 12, gap: 4, borderWidth: 1, borderColor: 'rgba(82,183,136,0.1)' },
  cityModeCardActive: { backgroundColor: '#52B788', borderColor: '#52B788' },
  cityModeLabel: { fontSize: 13, fontWeight: '700', color: '#F5F0E8', marginTop: 4 },
  cityModeDesc: { fontSize: 11, color: 'rgba(245,240,232,0.45)', lineHeight: 15 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#1A2E22', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: '92%' },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#F5F0E8', fontStyle: 'italic' },
  modalCloseBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  inputLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: 'rgba(245,240,232,0.4)', marginBottom: 6 },
  inputHint: { fontSize: 11, color: 'rgba(245,240,232,0.35)', marginTop: 4 },
  textInput: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 12, fontSize: 15, color: '#F5F0E8', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },

  // Leg chips (modal)
  legChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(82,183,136,0.1)', borderWidth: 1, borderColor: 'rgba(82,183,136,0.2)' },
  legChipActive: { backgroundColor: '#52B788', borderColor: '#52B788' },
  legChipText: { fontSize: 12, fontWeight: '600', color: '#52B788' },

  // Mode chips
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(82,183,136,0.1)', borderWidth: 1, borderColor: 'rgba(82,183,136,0.2)' },
  modeChipActive: { backgroundColor: '#52B788', borderColor: '#52B788' },
  modeChipText: { fontSize: 13, fontWeight: '600', color: '#52B788' },

  // Notification toggle
  notifToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: 'rgba(196,163,90,0.08)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(196,163,90,0.2)', marginBottom: 16 },
  notifToggleBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: 'rgba(245,240,232,0.3)', alignItems: 'center', justifyContent: 'center' },
  notifToggleBoxActive: { backgroundColor: '#52B788', borderColor: '#52B788' },
  notifToggleLabel: { fontSize: 13, fontWeight: '600', color: '#F5F0E8' },
  notifToggleDesc: { fontSize: 11, color: 'rgba(245,240,232,0.45)', marginTop: 1 },

  addBtn: { backgroundColor: '#52B788', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8, marginBottom: 8 },
  addBtnText: { fontSize: 16, fontWeight: '700', color: '#0F1F16' },

  // ── New FlightCard (reference-style) ──────────────────────────────────────
  flightCard: {
    backgroundColor: '#0F1F16',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.18)',
  },
  flightCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  flightAirlineName: {
    fontSize: 12,
    color: 'rgba(245,240,232,0.45)',
    letterSpacing: 0.3,
  },
  flightRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  flightEndpoint: {
    alignItems: 'flex-start',
    minWidth: 64,
  },
  flightCityName: {
    fontSize: 11,
    color: 'rgba(245,240,232,0.5)',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  flightIATA: {
    fontSize: 32,
    fontWeight: '800',
    color: '#F5F0E8',
    letterSpacing: 1,
    lineHeight: 36,
  },
  flightTime: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.7)',
    marginTop: 4,
  },
  flightMiddle: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  flightNumberLabel: {
    fontSize: 11,
    color: 'rgba(245,240,232,0.45)',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  flightLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 2,
  },
  flightLineDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(245,240,232,0.4)',
  },
  flightLineBar: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(245,240,232,0.2)',
  },
  flightDurationLabel: {
    fontSize: 11,
    color: 'rgba(245,240,232,0.4)',
    marginTop: 2,
  },
  flightBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    flexWrap: 'wrap',
  },
  flightGateText: {
    fontSize: 11,
    color: 'rgba(245,240,232,0.4)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },

  // ── Lookup modal card ─────────────────────────────────────────────────────
  lookupCard: {
    backgroundColor: 'rgba(82,183,136,0.06)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.15)',
    marginBottom: 16,
    alignSelf: 'stretch',
    gap: 6,
  },
  lookupIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(82,183,136,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  lookupTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5F0E8',
  },
  lookupDesc: {
    fontSize: 12,
    color: 'rgba(245,240,232,0.5)',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 8,
  },
  lookupBtn: {
    backgroundColor: '#52B788',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 32,
    alignItems: 'center',
    marginTop: 4,
    width: '100%',
  },
  lookupBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F1F16',
  },
  lookupErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 10,
    padding: 10,
    width: '100%',
  },
  lookupErrorText: {
    fontSize: 12,
    color: '#EF4444',
    flex: 1,
  },
  lookupResultCard: {
    backgroundColor: 'rgba(82,183,136,0.08)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.2)',
    marginBottom: 14,
  },
  lookupResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  lookupResultTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#52B788',
  },
  lookupChangeText: {
    fontSize: 12,
    color: 'rgba(245,240,232,0.4)',
    textDecorationLine: 'underline',
  },
  lookupResultRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lookupResultCity: {
    fontSize: 10,
    color: 'rgba(245,240,232,0.45)',
    marginBottom: 1,
  },
  lookupResultIATA: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F5F0E8',
    letterSpacing: 1,
    lineHeight: 28,
  },
  lookupResultTime: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.7)',
    marginTop: 3,
  },
  lookupResultFlightNum: {
    fontSize: 10,
    color: 'rgba(245,240,232,0.4)',
    letterSpacing: 0.5,
  },
  lookupResultDuration: {
    fontSize: 10,
    color: 'rgba(245,240,232,0.4)',
  },
  lookupResultAirline: {
    fontSize: 11,
    color: 'rgba(245,240,232,0.4)',
    marginTop: 8,
    textAlign: 'center',
  },

  // ── Dual search mode styles ────────────────────────────────────────────────
  searchModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    width: '100%',
  },
  searchModeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(82,183,136,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.2)',
  },
  searchModeBtnActive: {
    backgroundColor: '#52B788',
    borderColor: '#52B788',
  },
  searchModeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#52B788',
  },
  routeInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  routeArrow: {
    paddingBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeResultsList: {
    marginTop: 14,
    gap: 6,
    width: '100%',
  },
  flightResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.15)',
    gap: 8,
  },
  flightResultLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 80,
  },
  flightResultIATA: {
    fontSize: 15,
    fontWeight: '800',
    color: '#F5F0E8',
    letterSpacing: 0.5,
  },
  flightResultMid: {
    flex: 1,
    gap: 2,
  },
  flightResultNum: {
    fontSize: 13,
    fontWeight: '700',
    color: '#52B788',
  },
  flightResultAirline: {
    fontSize: 10,
    color: 'rgba(245,240,232,0.4)',
  },
  flightResultRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  flightResultTime: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.7)',
  },
  flightResultDur: {
    fontSize: 10,
    color: 'rgba(245,240,232,0.35)',
  },

  // Car Card
  carCard: { backgroundColor: '#0F1F16', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(82,183,136,0.18)' },
  carRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  carEndpoint: { flex: 1, alignItems: 'flex-start' },
  carEndpointLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: 'rgba(245,240,232,0.4)', marginBottom: 3 },
  carTime: { fontSize: 14, fontWeight: '700', color: '#F5F0E8', lineHeight: 18 },
  carAddress: { fontSize: 10, color: 'rgba(245,240,232,0.45)', marginTop: 3, lineHeight: 14 },
  carMiddle: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  carLineRow: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 2 },
  carLineDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(245,240,232,0.4)' },
  carLineBar: { flex: 1, height: 1, backgroundColor: 'rgba(245,240,232,0.2)' },
  carDuration: { fontSize: 11, color: 'rgba(245,240,232,0.5)' },
  carDistance: { fontSize: 10, color: 'rgba(245,240,232,0.35)' },
  carMapsBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: 'rgba(82,183,136,0.1)', borderRadius: 10, alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(82,183,136,0.2)' },
  carMapsBtnText: { fontSize: 12, color: '#52B788', fontWeight: '600' },

  // Car route result card
  carRouteResultCard: { backgroundColor: 'rgba(82,183,136,0.06)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(82,183,136,0.15)', marginBottom: 14 },

  // Hotel suggestion chips
  hotelSuggestionChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(82,183,136,0.1)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(82,183,136,0.2)' },
  hotelSuggestionText: { fontSize: 11, color: '#52B788', fontWeight: '600', maxWidth: 120 },
  airportDropdown: {
    position: 'absolute', top: 52, left: 0, right: 0, zIndex: 999,
    backgroundColor: '#1A2E22', borderRadius: 10, borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.25)', overflow: 'hidden', maxHeight: 220,
  },
  airportDropdownItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(82,183,136,0.15)',
  },
  airportIATABadge: {
    backgroundColor: 'rgba(82,183,136,0.2)', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3, minWidth: 40, alignItems: 'center',
  },
  airportIATAText: { color: '#52B788', fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  airportName: { color: '#F5F0E8', fontSize: 13, fontWeight: '600' },
  airportCity: { color: 'rgba(245,240,232,0.5)', fontSize: 11, marginTop: 1 },
});

