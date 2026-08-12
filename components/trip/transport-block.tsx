import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  ScrollView, TextInput, Alert, Image, Platform, ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { ScalePressable } from '@/components/ui/scale-pressable';
import { useTripsStore } from '@/store/trips';
import { generateId } from '@/utils/trip-helpers';
import { trpc } from '@/lib/trpc';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { DateTimePickerField } from '@/components/ui/datetime-picker-field';
import * as Linking from 'expo-linking';
import type { Transport, TransportMode, CityTransportMode, Destination, Accommodation, CarInfo } from '@/types/voyage';
import { PlacesAutocompleteInput, type PlaceResult } from '@/components/ui/places-autocomplete-input';
import { AirportSearchModal, type AirportResult } from '@/components/ui/airport-search-modal';
import { DocAttachField } from '@/components/ui/doc-attach-field';
import { getApiBaseUrl } from '@/constants/api';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BETWEEN_MODE_KEYS: Array<{ key: TransportMode; icon: string }> = [
  { key: 'flight', icon: 'airplane-outline' },
  { key: 'car', icon: 'car-outline' },
  { key: 'train', icon: 'train-outline' },
  { key: 'bus', icon: 'bus-outline' },
  { key: 'ferry', icon: 'boat-outline' },
  { key: 'other', icon: 'navigate-outline' },
];

const CITY_MODE_KEYS: Array<{ key: CityTransportMode; icon: string }> = [
  { key: 'public', icon: 'subway-outline' },
  { key: 'uber', icon: 'car-outline' },
  { key: 'walk', icon: 'walk-outline' },
  { key: 'bike', icon: 'bicycle-outline' },
  { key: 'car', icon: 'car-sport-outline' },
  { key: 'taxi', icon: 'car-outline' },
];

function getFlightStatusColors(colors: ThemeColorPalette): Record<string, string> {
  // Drawn directly as text/dot color (see `statusText` below), so every
  // entry must be a token that stays legible in both schemes — `primary` is
  // constant across schemes and fails contrast as text in dark mode, so
  // "scheduled" uses `textAccent` instead.
  return {
    scheduled: colors.textAccent, delayed: colors.warning, boarding: colors.statusBoarding,
    departed: colors.statusDeparted, arrived: colors.statusArrived, cancelled: colors.error,
  };
}

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
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const FLIGHT_STATUS_COLORS = useMemo(() => getFlightStatusColors(colors), [colors]);
  const f = transport.flight!;
  const statusColor = FLIGHT_STATUS_COLORS[f.status || 'scheduled'];
  const FLIGHT_STATUS_LABELS: Record<string, string> = {
    scheduled: t.transport.statusScheduled,
    delayed: t.transport.statusDelayed,
    boarding: t.transport.statusBoarding,
    departed: t.transport.statusDeparted,
    arrived: t.transport.statusArrived,
    cancelled: t.transport.statusCancelled,
  };
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
              <Ionicons name="notifications" size={10} color={colors.accent} />
            </View>
          )}
          {f.airline ? (
            <Text style={styles.flightAirlineName}>{f.airline}</Text>
          ) : null}
        </View>
        <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
          <Ionicons name="trash-outline" size={14} color={colors.muted} />
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
            <Ionicons name="airplane" size={14} color={colors.muted} />
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
            <Ionicons name="qr-code-outline" size={12} color={colors.textAccent} />
            <Text style={styles.boardingPassText}>Passagem</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.boardingPassBtnEmpty} onPress={onAddBoardingPass}>
            <Ionicons name="qr-code-outline" size={12} color={colors.muted} />
            <Text style={styles.boardingPassTextEmpty}>+ QR</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Car Card ────────────────────────────────────────────────────────────────

function CarCard({ transport, onRemove }: { transport: Transport; onRemove: () => void }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
            <Ionicons name="car-outline" size={14} color={colors.textAccent} />
          </View>
          <Text style={styles.flightAirlineName}>{transport.leg || 'Carro'}</Text>
        </View>
        <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
          <Ionicons name="trash-outline" size={14} color={colors.muted} />
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
            <Ionicons name="car" size={14} color={colors.muted} />
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
          <Ionicons name="map-outline" size={12} color={colors.textAccent} />
          <Text style={styles.carMapsBtnText}>Abrir no Google Maps</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function GenericCard({ transport, onRemove }: { transport: Transport; onRemove: () => void }) {
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const BETWEEN_MODES_LOCAL = BETWEEN_MODE_KEYS.map((m) => ({
    ...m,
    label: (t.transport as any)[m.key] as string || m.key,
  }));
  const modeInfo = BETWEEN_MODES_LOCAL.find((m) => m.key === transport.mode);
  return (
    <View style={styles.transportCard}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={styles.modeIconBg}>
            <Ionicons name={modeInfo?.icon as any || 'navigate-outline'} size={16} color={colors.textAccent} />
          </View>
          <View>
            <Text style={styles.flightNumber}>{modeInfo?.label || 'Transporte'}</Text>
            {transport.travelTime ? <Text style={styles.airlineName}>{transport.travelTime}</Text> : null}
          </View>
        </View>
        <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
          <Ionicons name="trash-outline" size={14} color={colors.muted} />
        </TouchableOpacity>
      </View>
      {transport.leg ? (
        <Text style={styles.legLabel}>{transport.leg}</Text>
      ) : null}
      {(transport.distance || transport.platform || transport.trainNumber) && (
        <View style={styles.cardFooter}>
          {transport.distance && (
            <View style={styles.footerItem}>
              <Ionicons name="navigate-outline" size={12} color={colors.muted} />
              <Text style={styles.footerText}>{transport.distance}</Text>
            </View>
          )}
          {transport.trainNumber && (
            <View style={styles.footerItem}>
              <Ionicons name="train-outline" size={12} color={colors.muted} />
              <Text style={styles.footerText}>#{transport.trainNumber}</Text>
            </View>
          )}
          {transport.platform && (
            <View style={styles.footerItem}>
              <Ionicons name="location-outline" size={12} color={colors.muted} />
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
          <Ionicons name="document-attach-outline" size={12} color={colors.textAccent} />
          <Text style={styles.boardingPassText}>Bilhete anexado</Text>
          <Ionicons name="open-outline" size={11} color={withAlpha(colors.primary, 0.7)} />
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
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <TouchableOpacity style={styles.flightResultRow} onPress={onSelect}>
      <View style={styles.flightResultLeft}>
        <Text style={styles.flightResultIATA}>{flight.origin}</Text>
        <Ionicons name="arrow-forward" size={12} color={colors.muted} style={{ marginHorizontal: 4 }} />
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
      <Ionicons name="chevron-forward" size={14} color={withAlpha(colors.primary, 0.5)} />
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
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Build translated mode arrays
  const BETWEEN_MODES = BETWEEN_MODE_KEYS.map((m) => ({
    ...m,
    label: t.transport[`${m.key}` as 'flight' | 'car' | 'train' | 'bus' | 'ferry' | 'other'] as string || m.key,
  }));

  // Transport type
  const [mode, setMode] = useState<TransportMode>('flight');
  const [selectedLeg, setSelectedLeg] = useState(legs[0] || '');

  // Search mode: 'route' = origin+dest+date, 'number' = flight number+date
  const [searchMode, setSearchMode] = useState<'route' | 'number'>('route');

  // Route search fields
  const [routeOrigin, setRouteOrigin] = useState(''); // IATA code
  const [routeOriginQuery, setRouteOriginQuery] = useState(''); // display text
  const [routeDest, setRouteDest] = useState(''); // IATA code
  const [routeDestQuery, setRouteDestQuery] = useState(''); // display text
  const [routeDate, setRouteDate] = useState<Date | null>(null);
  const [routeAirline, setRouteAirline] = useState(''); // optional airline filter
  const [routeResults, setRouteResults] = useState<any[]>([]);
  const [routeSearched, setRouteSearched] = useState(false);

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

  const selectOriginAirport = (airport: AirportResult) => {
    setRouteOrigin(airport.iata);
    setRouteOriginQuery(`${airport.city || airport.name} (${airport.iata})`);
    setSearchError('');
  };

  const selectDestAirport = (airport: AirportResult) => {
    setRouteDest(airport.iata);
    setRouteDestQuery(`${airport.city || airport.name} (${airport.iata})`);
    setSearchError('');
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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
        <Ionicons name="checkmark-circle" size={16} color={colors.textAccent} />
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
            <View style={{ flex: 1, height: 1, backgroundColor: withAlpha(colors.primary, 0.4) }} />
            <Ionicons name="airplane" size={12} color={colors.textAccent} />
            <View style={{ flex: 1, height: 1, backgroundColor: withAlpha(colors.primary, 0.4) }} />
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
              <Ionicons name="close" size={18} color={colors.muted} />
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
                    <Text style={[styles.legChipText, selectedLeg === leg && { color: colors.textOnPrimary }]}>{leg}</Text>
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
                    <Ionicons name={m.icon as any} size={16} color={mode === m.key ? colors.textOnPrimary : colors.textAccent} />
                    <Text style={[styles.modeChipText, mode === m.key && { color: colors.textOnPrimary }]}>{m.label}</Text>
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
                          {enableNotifs && <Ionicons name="checkmark" size={13} color={colors.textOnPrimary} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.notifToggleLabel}>Ativar lembretes de voo</Text>
                          <Text style={styles.notifToggleDesc}>Check-in 24h antes · Embarque 4h antes</Text>
                        </View>
                        <Ionicons name="notifications-outline" size={16} color={colors.accent} />
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
                        <Ionicons name="swap-horizontal-outline" size={14} color={searchMode === 'route' ? colors.textOnPrimary : colors.textAccent} />
                        <Text style={[styles.searchModeBtnText, searchMode === 'route' && { color: colors.textOnPrimary }]}>Origem / Destino</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.searchModeBtn, searchMode === 'number' && styles.searchModeBtnActive]}
                        onPress={() => { setSearchMode('number'); setSearchError(''); }}
                      >
                        <Ionicons name="barcode-outline" size={14} color={searchMode === 'number' ? colors.textOnPrimary : colors.textAccent} />
                        <Text style={[styles.searchModeBtnText, searchMode === 'number' && { color: colors.textOnPrimary }]}>Número do voo</Text>
                      </TouchableOpacity>
                    </View>

                    {searchMode === 'route' ? (
                      // ── Route search ─────────────────────────────────────────────────────
                      <>
                        {/* Origin airport */}
                        <View style={{ marginTop: 4 }}>
                          <Text style={styles.inputLabel}>AEROPORTO DE ORIGEM</Text>
                          <AirportSearchModal
                            placeholder="São Paulo, GRU, Brasil..."
                            value={routeOriginQuery}
                            onSelect={selectOriginAirport}
                            icon="airplane-outline"
                            dark
                          />
                        </View>

                        {/* Destination airport */}
                        <View style={{ marginTop: 10 }}>
                          <Text style={styles.inputLabel}>AEROPORTO DE DESTINO</Text>
                          <AirportSearchModal
                            placeholder="Londres, LHR, Reino Unido..."
                            value={routeDestQuery}
                            onSelect={selectDestAirport}
                            icon="airplane"
                            dark
                          />
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
                          <Text style={styles.inputLabel}>COMPANHIA AÉREA <Text style={{ color: colors.muted, fontWeight: '400', textTransform: 'none', letterSpacing: 0 }}>(opcional)</Text></Text>
                          <View style={[styles.textInput, { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 0, height: 48 }]}>
                            <Ionicons name="business-outline" size={16} color={withAlpha(colors.primary, 0.6)} />
                            <TextInput
                              value={routeAirline}
                              onChangeText={(v) => { setRouteAirline(v); setSearchError(''); }}
                              placeholder="LATAM, Gol, Azul, TAP..."
                              placeholderTextColor={colors.muted}
                              style={{ flex: 1, color: colors.foreground, fontSize: 14 }}
                              returnKeyType="search"
                            />
                            {routeAirline.length > 0 && (
                              <TouchableOpacity onPress={() => setRouteAirline('')}>
                                <Ionicons name="close-circle" size={16} color={colors.muted} />
                              </TouchableOpacity>
                            )}
                          </View>
                          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
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
                            placeholderTextColor={colors.muted}
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
                        <Ionicons name="alert-circle-outline" size={14} color={colors.error} />
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
                        <ActivityIndicator size="small" color={colors.textOnPrimary} />
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
                            <Ionicons name="bed-outline" size={11} color={colors.textAccent} />
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
                            <Ionicons name="bed-outline" size={11} color={colors.textAccent} />
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
                    <Ionicons name="navigate-outline" size={16} color={colors.textOnPrimary} />
                    <Text style={[styles.lookupBtnText, { marginLeft: 6 }]}>Calcular rota</Text>
                  </TouchableOpacity>
                )}

                {/* Route error */}
                {carRouteError ? (
                  <View style={[styles.lookupErrorRow, { marginBottom: 12 }]}>
                    <Ionicons name="alert-circle-outline" size={14} color={colors.error} />
                    <Text style={styles.lookupErrorText}>{carRouteError}</Text>
                  </View>
                ) : null}

                {/* Route result */}
                {carRouteSearched && carRouteResult && (
                  <View style={styles.carRouteResultCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <Ionicons name="checkmark-circle" size={16} color={colors.textAccent} />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textAccent }}>Rota calculada</Text>
                      <TouchableOpacity onPress={() => { setCarRouteResult(null); setCarRouteSearched(false); }} style={{ marginLeft: 'auto' }}>
                        <Text style={{ fontSize: 12, color: colors.muted, textDecorationLine: 'underline' }}>Recalcular</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 16 }}>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.foreground }}>{carRouteResult.duration}</Text>
                        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>Tempo estimado</Text>
                      </View>
                      {carRouteResult.distance ? (
                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.foreground }}>{carRouteResult.distance}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>Distância</Text>
                        </View>
                      ) : null}
                    </View>
                    {carArrival && carRouteResult.durationSeconds > 0 && (
                      <View style={{ marginTop: 12, padding: 10, backgroundColor: withAlpha(colors.accent, 0.1), borderRadius: 10, borderWidth: 1, borderColor: withAlpha(colors.accent, 0.2) }}>
                        <Text style={{ fontSize: 12, color: colors.accent, fontWeight: '600' }}>
                          ⏰ Sair às {new Date(carArrival.getTime() - carRouteResult.durationSeconds * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>Lembrete 1h antes da saída</Text>
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
                      {carNotifEnabled && <Ionicons name="checkmark" size={13} color={colors.textOnPrimary} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.notifToggleLabel}>Lembrete de saída</Text>
                      <Text style={styles.notifToggleDesc}>Aviso 1 hora antes de precisar sair</Text>
                    </View>
                    <Ionicons name="notifications-outline" size={16} color={colors.accent} />
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
                      {tbfNotifEnabled && <Ionicons name="checkmark" size={13} color={colors.textOnPrimary} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.notifToggleLabel}>Alerta 1h antes da saída</Text>
                      <Text style={styles.notifToggleDesc}>Aviso antes do horário de partida</Text>
                    </View>
                    <Ionicons name="notifications-outline" size={16} color={colors.accent} />
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
              <ScalePressable style={styles.addBtn} onPress={handleAdd}>
                <Text style={styles.addBtnText}>Adicionar</Text>
              </ScalePressable>
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
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder}
        placeholderTextColor={colors.muted} autoCapitalize={autoCapitalize || 'sentences'}
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
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.bpOverlay}>
        <TouchableOpacity style={styles.bpClose} onPress={onClose}>
          <Ionicons name="close" size={22} color={colors.textOnPrimary} />
        </TouchableOpacity>
        <Image source={{ uri }} style={styles.bpImage} resizeMode="contain" />
        <TouchableOpacity style={styles.bpReplaceBtn} onPress={onReplace}>
          {/* Fixed light icon: sits on the always-dark boarding-pass viewer scrim, not theme-driven */}
          <Ionicons name="refresh-outline" size={14} color={colors.textOnPrimary} />
          <Text style={styles.bpReplaceText}>Substituir imagem</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── City Transport Section ────────────────────────────────────────────────────

export function CityTransportSection({ tripId, cityMode }: { tripId: string; cityMode?: CityTransportMode }) {
  const { updateCityTransportMode } = useTripsStore();
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const selected = cityMode;

  const CITY_MODES = CITY_MODE_KEYS.map((m) => ({
    ...m,
    label: (t.transport as any)[`mode${m.key.charAt(0).toUpperCase() + m.key.slice(1)}`] as string || m.key,
    desc: (t.transport as any)[`mode${m.key.charAt(0).toUpperCase() + m.key.slice(1)}Desc`] as string || '',
  }));

  return (
    <View style={styles.citySection}>
      <View style={styles.citySectionHeader}>
        <Ionicons name="map-outline" size={14} color={colors.textAccent} />
        <Text style={styles.citySectionTitle}>{t.transport.cityTitle}</Text>
      </View>
      <Text style={styles.citySectionDesc}>{t.transport.cityDesc}</Text>
      <View style={styles.cityModeGrid}>
        {CITY_MODES.map((m) => {
          const isActive = selected === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              onPress={() => updateCityTransportMode(tripId, m.key)}
              style={[styles.cityModeCard, isActive && styles.cityModeCardActive]}
            >
              <Ionicons name={m.icon as any} size={20} color={isActive ? colors.textOnPrimary : colors.textAccent} />
              <Text style={[styles.cityModeLabel, isActive && { color: colors.textOnPrimary }]}>{m.label}</Text>
              <Text style={[styles.cityModeDesc, isActive && { color: withAlpha(colors.textOnPrimary, 0.7) }]}>{m.desc}</Text>
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
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
          <Ionicons name="airplane-outline" size={15} color={colors.textAccent} />
          <Text style={styles.sectionTitle}>ENTRE DESTINOS</Text>
        </View>
        <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addIconBtn}>
          <Ionicons name="add" size={18} color={colors.textAccent} />
        </TouchableOpacity>
      </View>

      {transports.length === 0 ? (
        <TouchableOpacity onPress={() => setShowModal(true)} style={styles.emptyState}>
          <Ionicons name="airplane-outline" size={24} color={colors.muted} />
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
                  <View style={{ flex: 1, height: 1, backgroundColor: withAlpha(colors.primary, 0.10), marginLeft: 8 }} />
                </View>
                {legTransports.length === 0 ? (
                  <TouchableOpacity
                    style={styles.legEmptyRow}
                    onPress={() => setShowModal(true)}
                  >
                    <Ionicons name="add-circle-outline" size={16} color={withAlpha(colors.primary, 0.4)} />
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

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  container: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: colors.muted },
  addIconBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: withAlpha(colors.primary, 0.12), alignItems: 'center', justifyContent: 'center' },
  emptyState: { backgroundColor: withAlpha(colors.foreground, 0.05), borderRadius: 16, padding: 20, alignItems: 'center', gap: 6 },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  emptyCta: { fontSize: 13, color: colors.textAccent, fontWeight: '600' },

  // Leg grouping
  legHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  legDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  legHeaderText: { fontSize: 12, fontWeight: '700', color: colors.muted, letterSpacing: 0.5 },
  legEmptyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: withAlpha(colors.foreground, 0.03), borderRadius: 12, borderWidth: 1, borderColor: withAlpha(colors.primary, 0.1), borderStyle: 'dashed' },
  legEmptyText: { fontSize: 13, color: colors.muted },

  // Transport cards
  transportCard: { backgroundColor: withAlpha(colors.foreground, 0.06), borderRadius: 16, padding: 16, borderWidth: 1, borderColor: withAlpha(colors.primary, 0.10) },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modeIconBg: { width: 32, height: 32, borderRadius: 10, backgroundColor: withAlpha(colors.primary, 0.12), alignItems: 'center', justifyContent: 'center' },
  flightNumber: { fontSize: 15, fontWeight: '700', color: colors.foreground, letterSpacing: 0.5 },
  airlineName: { fontSize: 12, color: colors.muted, marginTop: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
  notifBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: withAlpha(colors.accent, 0.15), alignItems: 'center', justifyContent: 'center' },
  removeBtn: { padding: 4 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  routeEndpoint: { alignItems: 'flex-start', minWidth: 48 },
  routeCode: { fontSize: 22, fontWeight: '800', color: colors.foreground, letterSpacing: 1 },
  routeTime: { fontSize: 12, color: colors.muted, marginTop: 2 },
  routeMiddle: { flex: 1, alignItems: 'center', gap: 4 },
  routeDuration: { fontSize: 11, color: colors.muted },
  routeLine: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 2 },
  routeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: withAlpha(colors.primary, 0.5) },
  layoverText: { fontSize: 10, color: colors.warning },
  cardFooter: { flexDirection: 'row', gap: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: withAlpha(colors.foreground, 0.06) },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerText: { fontSize: 11, color: colors.muted },
  legLabel: { fontSize: 12, color: colors.muted, marginBottom: 8, marginTop: -8 },

  // Boarding pass
  boardingPassRow: { marginTop: 10, borderTopWidth: 1, borderTopColor: withAlpha(colors.foreground, 0.06), paddingTop: 10 },
  boardingPassBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: withAlpha(colors.primary, 0.10), borderRadius: 10, alignSelf: 'flex-start' },
  boardingPassText: { fontSize: 12, color: colors.textAccent, fontWeight: '600' },
  boardingPassBtnEmpty: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: withAlpha(colors.foreground, 0.04), borderRadius: 10, borderWidth: 1, borderColor: withAlpha(colors.foreground, 0.08), borderStyle: 'dashed', alignSelf: 'flex-start' },
  boardingPassTextEmpty: { fontSize: 12, color: colors.muted },

  // Boarding pass viewer
  bpOverlay: { flex: 1, backgroundColor: colors.overlayScrim, justifyContent: 'center', alignItems: 'center' },
  bpClose: { position: 'absolute', top: 56, right: 20, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: 8 },
  bpImage: { width: '90%', height: '70%' },
  bpReplaceBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12 },
  // Fixed light text: sits on the always-dark boarding-pass viewer scrim, not theme-driven
  bpReplaceText: { color: colors.textOnPrimary, fontSize: 13 },

  // City transport
  citySection: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: withAlpha(colors.primary, 0.1) },
  citySectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  citySectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: colors.muted },
  citySectionDesc: { fontSize: 12, color: colors.muted, lineHeight: 17, marginBottom: 14 },
  cityModeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cityModeCard: { width: '47%', backgroundColor: withAlpha(colors.foreground, 0.05), borderRadius: 14, padding: 12, gap: 4, borderWidth: 1, borderColor: withAlpha(colors.primary, 0.1) },
  cityModeCardActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  cityModeLabel: { fontSize: 13, fontWeight: '700', color: colors.foreground, marginTop: 4 },
  cityModeDesc: { fontSize: 11, color: colors.muted, lineHeight: 15 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: colors.overlayModal, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: '92%' },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: withAlpha(colors.foreground, 0.2), alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.foreground, fontStyle: 'italic' },
  modalCloseBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: withAlpha(colors.foreground, 0.1), alignItems: 'center', justifyContent: 'center' },
  inputLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: colors.muted, marginBottom: 6 },
  inputHint: { fontSize: 11, color: colors.muted, marginTop: 4 },
  textInput: { backgroundColor: withAlpha(colors.foreground, 0.07), borderRadius: 12, padding: 12, fontSize: 15, color: colors.foreground, borderWidth: 1, borderColor: withAlpha(colors.foreground, 0.08) },

  // Leg chips (modal)
  legChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: withAlpha(colors.primary, 0.1), borderWidth: 1, borderColor: withAlpha(colors.primary, 0.15) },
  legChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  legChipText: { fontSize: 12, fontWeight: '600', color: colors.textAccent },

  // Mode chips
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: withAlpha(colors.primary, 0.1), borderWidth: 1, borderColor: withAlpha(colors.primary, 0.15) },
  modeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeChipText: { fontSize: 13, fontWeight: '600', color: colors.textAccent },

  // Notification toggle
  notifToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: withAlpha(colors.accent, 0.08), borderRadius: 14, borderWidth: 1, borderColor: withAlpha(colors.accent, 0.2), marginBottom: 16 },
  notifToggleBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  notifToggleBoxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  notifToggleLabel: { fontSize: 13, fontWeight: '600', color: colors.foreground },
  notifToggleDesc: { fontSize: 11, color: colors.muted, marginTop: 1 },

  addBtn: { backgroundColor: colors.primary, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8, marginBottom: 8 },
  addBtnText: { fontSize: 16, fontWeight: '700', color: colors.textOnPrimary },

  // ── New FlightCard (reference-style) ──────────────────────────────────────
  flightCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.18),
  },
  flightCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  flightAirlineName: {
    fontSize: 12,
    color: colors.muted,
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
    color: colors.muted,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  flightIATA: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.foreground,
    letterSpacing: 1,
    lineHeight: 36,
  },
  flightTime: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
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
    color: colors.muted,
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
    backgroundColor: colors.border,
  },
  flightLineBar: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  flightDurationLabel: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  flightBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: withAlpha(colors.foreground, 0.06),
    flexWrap: 'wrap',
  },
  flightGateText: {
    fontSize: 11,
    color: colors.muted,
    backgroundColor: withAlpha(colors.foreground, 0.06),
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },

  // ── Lookup modal card ─────────────────────────────────────────────────────
  lookupCard: {
    backgroundColor: withAlpha(colors.primary, 0.06),
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.12),
    marginBottom: 16,
    alignSelf: 'stretch',
    gap: 6,
  },
  lookupIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: withAlpha(colors.primary, 0.10),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  lookupTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.foreground,
  },
  lookupDesc: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 8,
  },
  lookupBtn: {
    backgroundColor: colors.primary,
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
    color: colors.textOnPrimary,
  },
  lookupErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: withAlpha(colors.error, 0.1),
    borderRadius: 10,
    padding: 10,
    width: '100%',
  },
  lookupErrorText: {
    fontSize: 12,
    color: colors.error,
    flex: 1,
  },
  lookupResultCard: {
    backgroundColor: withAlpha(colors.primary, 0.08),
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.15),
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
    color: colors.textAccent,
  },
  lookupChangeText: {
    fontSize: 12,
    color: colors.muted,
    textDecorationLine: 'underline',
  },
  lookupResultRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lookupResultCity: {
    fontSize: 10,
    color: colors.muted,
    marginBottom: 1,
  },
  lookupResultIATA: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.foreground,
    letterSpacing: 1,
    lineHeight: 28,
  },
  lookupResultTime: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    marginTop: 3,
  },
  lookupResultFlightNum: {
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  lookupResultDuration: {
    fontSize: 10,
    color: colors.muted,
  },
  lookupResultAirline: {
    fontSize: 11,
    color: colors.muted,
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
    backgroundColor: withAlpha(colors.primary, 0.08),
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.15),
  },
  searchModeBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  searchModeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textAccent,
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
    backgroundColor: withAlpha(colors.foreground, 0.05),
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.12),
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
    color: colors.foreground,
    letterSpacing: 0.5,
  },
  flightResultMid: {
    flex: 1,
    gap: 2,
  },
  flightResultNum: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textAccent,
  },
  flightResultAirline: {
    fontSize: 10,
    color: colors.muted,
  },
  flightResultRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  flightResultTime: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  flightResultDur: {
    fontSize: 10,
    color: colors.muted,
  },

  // Car Card
  carCard: { backgroundColor: colors.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: withAlpha(colors.primary, 0.18) },
  carRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  carEndpoint: { flex: 1, alignItems: 'flex-start' },
  carEndpointLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: colors.muted, marginBottom: 3 },
  carTime: { fontSize: 14, fontWeight: '700', color: colors.foreground, lineHeight: 18 },
  carAddress: { fontSize: 10, color: colors.muted, marginTop: 3, lineHeight: 14 },
  carMiddle: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  carLineRow: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 2 },
  carLineDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.border },
  carLineBar: { flex: 1, height: 1, backgroundColor: colors.border },
  carDuration: { fontSize: 11, color: colors.muted },
  carDistance: { fontSize: 10, color: colors.muted },
  carMapsBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: withAlpha(colors.primary, 0.1), borderRadius: 10, alignSelf: 'flex-start', borderWidth: 1, borderColor: withAlpha(colors.primary, 0.15) },
  carMapsBtnText: { fontSize: 12, color: colors.textAccent, fontWeight: '600' },

  // Car route result card
  carRouteResultCard: { backgroundColor: withAlpha(colors.primary, 0.06), borderRadius: 16, padding: 14, borderWidth: 1, borderColor: withAlpha(colors.primary, 0.12), marginBottom: 14 },

  // Hotel suggestion chips
  hotelSuggestionChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: withAlpha(colors.primary, 0.1), borderRadius: 20, borderWidth: 1, borderColor: withAlpha(colors.primary, 0.15) },
  hotelSuggestionText: { fontSize: 11, color: colors.textAccent, fontWeight: '600', maxWidth: 120 },
});

