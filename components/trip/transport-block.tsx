import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  ScrollView, TextInput, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTripsStore } from '@/store/trips';
import { generateId } from '@/utils/trip-helpers';
import type { Transport, TransportMode } from '@/types/voyage';

const TRANSPORT_MODES: Array<{ key: TransportMode; label: string; icon: string }> = [
  { key: 'flight', label: 'Voo', icon: 'airplane-outline' },
  { key: 'car', label: 'Carro', icon: 'car-outline' },
  { key: 'train', label: 'Trem', icon: 'train-outline' },
  { key: 'bus', label: 'Ônibus', icon: 'bus-outline' },
  { key: 'ferry', label: 'Barco', icon: 'boat-outline' },
  { key: 'other', label: 'Outro', icon: 'navigate-outline' },
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
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  return time;
}

function FlightCard({ transport, onRemove }: { transport: Transport; onRemove: () => void }) {
  const f = transport.flight!;
  const statusColor = FLIGHT_STATUS_COLORS[f.status || 'scheduled'];
  const statusLabel = FLIGHT_STATUS_LABELS[f.status || 'scheduled'];
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
    </View>
  );
}

function GenericCard({ transport, onRemove }: { transport: Transport; onRemove: () => void }) {
  const modeInfo = TRANSPORT_MODES.find((m) => m.key === transport.mode);
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

function AddTransportModal({ visible, onClose, onAdd }: {
  visible: boolean; onClose: () => void; onAdd: (t: Transport) => void;
}) {
  const [mode, setMode] = useState<TransportMode>('flight');
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

  const reset = () => {
    setFlightNumber(''); setAirline(''); setOrigin(''); setDestination('');
    setDeparture(''); setArrival(''); setDuration(''); setTerminal(''); setGate('');
    setTravelTime(''); setDistance(''); setTrainNumber(''); setPlatform('');
    setMode('flight');
  };

  const handleAdd = () => {
    const t: Transport = {
      id: generateId(), mode,
      ...(mode === 'flight' ? {
        flight: {
          flightNumber: flightNumber.toUpperCase(), airline,
          origin: origin.toUpperCase(), destination: destination.toUpperCase(),
          departureTime: departure, arrivalTime: arrival, duration,
          terminal: terminal || undefined, gate: gate || undefined, status: 'scheduled',
        },
      } : {
        travelTime: travelTime || undefined, distance: distance || undefined,
        trainNumber: trainNumber || undefined, platform: platform || undefined,
      }),
    };
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
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.inputLabel}>TIPO</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 2 }}>
                {TRANSPORT_MODES.map((m) => (
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
                <InputRow label="NÚMERO DO VOO" value={flightNumber} onChange={setFlightNumber} placeholder="LA8084" autoCapitalize="characters" />
                <InputRow label="COMPANHIA AÉREA" value={airline} onChange={setAirline} placeholder="LATAM Airlines" />
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}><InputRow label="ORIGEM" value={origin} onChange={setOrigin} placeholder="GRU" autoCapitalize="characters" /></View>
                  <View style={{ flex: 1 }}><InputRow label="DESTINO" value={destination} onChange={setDestination} placeholder="LHR" autoCapitalize="characters" /></View>
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
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function InputRow({ label, value, onChange, placeholder, autoCapitalize }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder}
        placeholderTextColor="rgba(245,240,232,0.25)" autoCapitalize={autoCapitalize || 'sentences'}
        style={styles.textInput} />
    </View>
  );
}

export function TransportBlock({ tripId, transports }: { tripId: string; transports: Transport[] }) {
  const { addTransport, removeTransport } = useTripsStore();
  const [showModal, setShowModal] = useState(false);

  const handleAdd = async (t: Transport) => { await addTransport(tripId, t); setShowModal(false); };
  const handleRemove = (id: string) => {
    Alert.alert('Remover', 'Remover este transporte?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover', style: 'destructive', onPress: () => removeTransport(tripId, id) },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="airplane-outline" size={15} color="#52B788" />
          <Text style={styles.sectionTitle}>TRANSPORTE</Text>
        </View>
        <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addIconBtn}>
          <Ionicons name="add" size={18} color="#52B788" />
        </TouchableOpacity>
      </View>
      {transports.length === 0 ? (
        <TouchableOpacity onPress={() => setShowModal(true)} style={styles.emptyState}>
          <Text style={styles.emptyText}>Adicione o meio de transporte para sua viagem</Text>
          <Text style={styles.emptyCta}>Toque para configurar →</Text>
        </TouchableOpacity>
      ) : (
        <View style={{ gap: 12 }}>
          {transports.map((t) =>
            t.mode === 'flight' && t.flight
              ? <FlightCard key={t.id} transport={t} onRemove={() => handleRemove(t.id)} />
              : <GenericCard key={t.id} transport={t} onRemove={() => handleRemove(t.id)} />
          )}
        </View>
      )}
      <AddTransportModal visible={showModal} onClose={() => setShowModal(false)} onAdd={handleAdd} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: 'rgba(245,240,232,0.7)' },
  addIconBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(82,183,136,0.15)', alignItems: 'center', justifyContent: 'center' },
  emptyState: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 20, alignItems: 'center', gap: 6 },
  emptyText: { fontSize: 14, color: 'rgba(245,240,232,0.6)', textAlign: 'center', lineHeight: 20 },
  emptyCta: { fontSize: 13, color: '#E05C5C', fontWeight: '600' },
  transportCard: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(82,183,136,0.12)' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modeIconBg: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(82,183,136,0.15)', alignItems: 'center', justifyContent: 'center' },
  flightNumber: { fontSize: 15, fontWeight: '700', color: '#F5F0E8', letterSpacing: 0.5 },
  airlineName: { fontSize: 12, color: 'rgba(245,240,232,0.5)', marginTop: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#1A2E22', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: '90%' },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#F5F0E8', fontStyle: 'italic' },
  modalCloseBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  inputLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: 'rgba(245,240,232,0.4)', marginBottom: 6 },
  textInput: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 12, fontSize: 15, color: '#F5F0E8', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(82,183,136,0.1)', borderWidth: 1, borderColor: 'rgba(82,183,136,0.2)' },
  modeChipActive: { backgroundColor: '#52B788', borderColor: '#52B788' },
  modeChipText: { fontSize: 13, fontWeight: '600', color: '#52B788' },
  addBtn: { backgroundColor: '#52B788', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8, marginBottom: 8 },
  addBtnText: { fontSize: 16, fontWeight: '700', color: '#0F1F16' },
});
