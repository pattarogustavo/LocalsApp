import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  ScrollView, TextInput, Alert, Image, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { useTripsStore } from '@/store/trips';
import { generateId } from '@/utils/trip-helpers';
import { trpc } from '@/lib/trpc';
import { DatePickerField } from '@/components/ui/date-picker-field';
import type { Transport, TransportMode, CityTransportMode, Destination } from '@/types/voyage';

// ─── Constants ────────────────────────────────────────────────────────────────

const BETWEEN_MODES: Array<{ key: TransportMode; label: string; icon: string }> = [
  { key: 'flight', label: 'Voo', icon: 'airplane-outline' },
  { key: 'train', label: 'Trem', icon: 'train-outline' },
  { key: 'bus', label: 'Ônibus', icon: 'bus-outline' },
  { key: 'ferry', label: 'Barco', icon: 'boat-outline' },
  { key: 'car', label: 'Carro', icon: 'car-outline' },
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
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (t: Transport) => void;
  legs: string[];
}) {
  // Transport type
  const [mode, setMode] = useState<TransportMode>('flight');
  const [selectedLeg, setSelectedLeg] = useState(legs[0] || '');

  // Search mode: 'route' = origin+dest+date, 'number' = flight number+date
  const [searchMode, setSearchMode] = useState<'route' | 'number'>('route');

  // Route search fields
  const [routeOrigin, setRouteOrigin] = useState('');
  const [routeDest, setRouteDest] = useState('');
  const [routeDate, setRouteDate] = useState<Date | null>(null);
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

  const lookupMutation = trpc.flights.lookup.useMutation();
  const searchByRouteMutation = trpc.flights.searchByRoute.useMutation();

  const isSearching = lookupMutation.isPending || searchByRouteMutation.isPending;

  const reset = () => {
    setMode('flight'); setSelectedLeg(legs[0] || '');
    setSearchMode('route');
    setRouteOrigin(''); setRouteDest(''); setRouteDate(null); setRouteResults([]); setRouteSearched(false);
    setFlightNumber(''); setFlightDate(null);
    setSelectedFlight(null); setSearchError('');
    setEnableNotifs(true);
    setTravelTime(''); setDistance(''); setTrainNumber(''); setPlatform('');
  };

  // Helper: format Date to YYYY-MM-DD for AviationStack
  const toApiDate = (d: Date) => d.toISOString().split('T')[0];

  const handleRouteSearch = async () => {
    const o = routeOrigin.trim().toUpperCase();
    const d = routeDest.trim().toUpperCase();
    if (o.length < 2 || d.length < 2) {
      setSearchError('Informe a origem e o destino (código IATA, ex: GRU, LHR).');
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
      setRouteResults(result.flights || []);
      setRouteSearched(true);
      if ((result.flights || []).length === 0) {
        setSearchError('Nenhum voo encontrado para essa rota e data. Tente o modo "Número do voo".');
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
      } : {
        travelTime: travelTime || undefined,
        distance: distance || undefined,
        trainNumber: trainNumber || undefined,
        platform: platform || undefined,
      }),
    };
    if (mode === 'flight' && enableNotifs && selectedFlight?.departureTime) {
      try {
        const ids = await scheduleFlightNotifications(t);
        if (ids.length > 0) t.notificationIds = ids;
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
                      // ── Route search ─────────────────────────────────────────
                      <>
                        <View style={styles.routeInputRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.inputLabel}>ORIGEM</Text>
                            <TextInput
                              value={routeOrigin}
                              onChangeText={(v) => { setRouteOrigin(v); setSearchError(''); }}
                              placeholder="GRU"
                              placeholderTextColor="rgba(245,240,232,0.25)"
                              autoCapitalize="characters"
                              maxLength={4}
                              style={[styles.textInput, { textAlign: 'center', letterSpacing: 2, fontSize: 18, fontWeight: '700' }]}
                            />
                          </View>
                          <View style={styles.routeArrow}>
                            <Ionicons name="airplane" size={18} color="rgba(82,183,136,0.5)" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.inputLabel}>DESTINO</Text>
                            <TextInput
                              value={routeDest}
                              onChangeText={(v) => { setRouteDest(v); setSearchError(''); }}
                              placeholder="LHR"
                              placeholderTextColor="rgba(245,240,232,0.25)"
                              autoCapitalize="characters"
                              maxLength={4}
                              style={[styles.textInput, { textAlign: 'center', letterSpacing: 2, fontSize: 18, fontWeight: '700' }]}
                            />
                          </View>
                        </View>
                        <View style={{ marginTop: 10 }}>
                          <DatePickerField
                            label="DATA DO VOO"
                            value={routeDate}
                            onChange={(d) => { setRouteDate(d); setSearchError(''); }}
                          />
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
            ) : (
              // ── Non-flight modes ─────────────────────────────────────────────
              <>
                <InputRow label="TEMPO DE VIAGEM" value={travelTime} onChange={setTravelTime} placeholder="2h30" />
                <InputRow label="DISTÂNCIA (OPCIONAL)" value={distance} onChange={setDistance} placeholder="180 km" />
                {(mode === 'train' || mode === 'bus') && (
                  <>
                    <InputRow label="NÚMERO" value={trainNumber} onChange={setTrainNumber} placeholder="IC 123" />
                    <InputRow label="PLATAFORMA" value={platform} onChange={setPlatform} placeholder="3A" />
                  </>
                )}
              </>
            )}

            {/* Add button */}
            {(mode !== 'flight' || selectedFlight) && (
              <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
                <Text style={styles.addBtnText}>Adicionar</Text>
              </TouchableOpacity>
            )}
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>
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
}: {
  tripId: string;
  transports: Transport[];
  destinations: Destination[];
  cityTransportMode?: CityTransportMode;
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
    alignItems: 'center',
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
});
