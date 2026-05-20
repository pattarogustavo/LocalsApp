import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  ScrollView, TextInput, Alert, Image, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { useTripsStore } from '@/store/trips';
import { generateId } from '@/utils/trip-helpers';
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

  // Boarding reminder: 2h before
  const boardingDate = new Date(depDate.getTime() - 2 * 60 * 60 * 1000);
  if (boardingDate > new Date()) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `Embarque em 2h: ${f.flightNumber}`,
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

  return (
    <View style={styles.transportCard}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={styles.modeIconBg}>
            <Ionicons name="airplane" size={16} color="#52B788" />
          </View>
          <View>
            <Text style={styles.flightNumber}>{f.flightNumber || 'Voo'}</Text>
            {f.airline ? <Text style={styles.airlineName}>{f.airline}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}22` }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          {hasNotifs && (
            <View style={styles.notifBadge}>
              <Ionicons name="notifications" size={11} color="#C4A35A" />
            </View>
          )}
          <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
            <Ionicons name="trash-outline" size={14} color="rgba(245,240,232,0.4)" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.routeRow}>
        <View style={styles.routeEndpoint}>
          <Text style={styles.routeCode}>{f.origin || '---'}</Text>
          <Text style={styles.routeTime}>{formatTime(f.departureTime)}</Text>
        </View>
        <View style={styles.routeMiddle}>
          <Text style={styles.routeDuration}>{f.duration || ''}</Text>
          <View style={styles.routeLine}>
            <View style={styles.routeDot} />
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(82,183,136,0.4)' }} />
            <Ionicons name="airplane" size={14} color="#52B788" />
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(82,183,136,0.4)' }} />
            <View style={styles.routeDot} />
          </View>
          {f.layovers && f.layovers.length > 0 && (
            <Text style={styles.layoverText}>{f.layovers.length} escala</Text>
          )}
        </View>
        <View style={[styles.routeEndpoint, { alignItems: 'flex-end' }]}>
          <Text style={styles.routeCode}>{f.destination || '---'}</Text>
          <Text style={styles.routeTime}>{formatTime(f.arrivalTime)}</Text>
        </View>
      </View>

      {(f.terminal || f.gate) && (
        <View style={styles.cardFooter}>
          {f.terminal && (
            <View style={styles.footerItem}>
              <Ionicons name="business-outline" size={12} color="rgba(245,240,232,0.4)" />
              <Text style={styles.footerText}>Terminal {f.terminal}</Text>
            </View>
          )}
          {f.gate && (
            <View style={styles.footerItem}>
              <Ionicons name="exit-outline" size={12} color="rgba(245,240,232,0.4)" />
              <Text style={styles.footerText}>Gate {f.gate}</Text>
            </View>
          )}
        </View>
      )}

      {/* Boarding pass row */}
      <View style={styles.boardingPassRow}>
        {transport.boardingPassUri ? (
          <TouchableOpacity style={styles.boardingPassBtn} onPress={onViewBoardingPass}>
            <Ionicons name="qr-code-outline" size={13} color="#52B788" />
            <Text style={styles.boardingPassText}>Ver passagem</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.boardingPassBtnEmpty} onPress={onAddBoardingPass}>
            <Ionicons name="qr-code-outline" size={13} color="rgba(245,240,232,0.35)" />
            <Text style={styles.boardingPassTextEmpty}>Adicionar passagem / QR</Text>
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
  const [mode, setMode] = useState<TransportMode>('flight');
  const [selectedLeg, setSelectedLeg] = useState(legs[0] || '');
  const [flightNumber, setFlightNumber] = useState('');
  const [airline, setAirline] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [departure, setDeparture] = useState('');
  const [arrival, setArrival] = useState('');
  const [duration, setDuration] = useState('');
  const [terminal, setTerminal] = useState('');
  const [gate, setGate] = useState('');
  const [travelTime, setTravelTime] = useState('');
  const [distance, setDistance] = useState('');
  const [trainNumber, setTrainNumber] = useState('');
  const [platform, setPlatform] = useState('');
  const [enableNotifs, setEnableNotifs] = useState(true);

  const reset = () => {
    setFlightNumber(''); setAirline(''); setOrigin(''); setDestination('');
    setDeparture(''); setArrival(''); setDuration(''); setTerminal(''); setGate('');
    setTravelTime(''); setDistance(''); setTrainNumber(''); setPlatform('');
    setMode('flight'); setEnableNotifs(true);
    setSelectedLeg(legs[0] || '');
  };

  const handleAdd = async () => {
    if (mode === 'flight' && !flightNumber.trim()) {
      Alert.alert('Número do voo obrigatório', 'Por favor, informe o número do voo (ex: LA8084).');
      return;
    }
    const t: Transport = {
      id: generateId(),
      mode,
      leg: selectedLeg || undefined,
      ...(mode === 'flight' ? {
        flight: {
          flightNumber: flightNumber.toUpperCase().trim(),
          airline,
          origin: origin.toUpperCase().trim(),
          destination: destination.toUpperCase().trim(),
          departureTime: departure,
          arrivalTime: arrival,
          duration,
          terminal: terminal || undefined,
          gate: gate || undefined,
          status: 'scheduled',
        },
      } : {
        travelTime: travelTime || undefined,
        distance: distance || undefined,
        trainNumber: trainNumber || undefined,
        platform: platform || undefined,
      }),
    };

    // Schedule notifications for flights
    if (mode === 'flight' && enableNotifs && departure) {
      try {
        const ids = await scheduleFlightNotifications(t);
        if (ids.length > 0) t.notificationIds = ids;
      } catch (_) {}
    }

    onAdd(t);
    reset();
  };

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
                  <TouchableOpacity key={m.key} onPress={() => setMode(m.key)}
                    style={[styles.modeChip, mode === m.key && styles.modeChipActive]}>
                    <Ionicons name={m.icon as any} size={16} color={mode === m.key ? '#0F1F16' : '#52B788'} />
                    <Text style={[styles.modeChipText, mode === m.key && { color: '#0F1F16' }]}>{m.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {mode === 'flight' ? (
              <>
                <InputRow
                  label="NÚMERO DO VOO *"
                  value={flightNumber}
                  onChange={setFlightNumber}
                  placeholder="LA8084"
                  autoCapitalize="characters"
                  hint="Obrigatório — ex: LA8084, G38271"
                />
                <InputRow label="COMPANHIA AÉREA" value={airline} onChange={setAirline} placeholder="LATAM Airlines" />
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}><InputRow label="ORIGEM (IATA)" value={origin} onChange={setOrigin} placeholder="GRU" autoCapitalize="characters" /></View>
                  <View style={{ flex: 1 }}><InputRow label="DESTINO (IATA)" value={destination} onChange={setDestination} placeholder="LHR" autoCapitalize="characters" /></View>
                </View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}><InputRow label="PARTIDA" value={departure} onChange={setDeparture} placeholder="22:30" /></View>
                  <View style={{ flex: 1 }}><InputRow label="CHEGADA" value={arrival} onChange={setArrival} placeholder="14:45" /></View>
                </View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}><InputRow label="DURAÇÃO" value={duration} onChange={setDuration} placeholder="12h15" /></View>
                  <View style={{ flex: 1 }}><InputRow label="TERMINAL" value={terminal} onChange={setTerminal} placeholder="T3" /></View>
                </View>
                <InputRow label="GATE (OPCIONAL)" value={gate} onChange={setGate} placeholder="B22" />

                {/* Notification toggle */}
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
                      <Text style={styles.notifToggleDesc}>Check-in 24h antes · Embarque 2h antes</Text>
                    </View>
                    <Ionicons name="notifications-outline" size={16} color="#C4A35A" />
                  </TouchableOpacity>
                )}
              </>
            ) : (
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
            <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
              <Text style={styles.addBtnText}>Adicionar</Text>
            </TouchableOpacity>
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
});
