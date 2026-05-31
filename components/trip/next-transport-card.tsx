import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Transport, Destination } from '@/types/voyage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MODE_ICONS: Record<string, string> = {
  flight: 'airplane',
  train: 'train',
  bus: 'bus',
  ferry: 'boat',
  car: 'car',
  other: 'navigate',
};

const MODE_LABELS: Record<string, string> = {
  flight: 'Voo',
  train: 'Trem',
  bus: 'Ônibus',
  ferry: 'Barco',
  car: 'Carro',
  other: 'Transporte',
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: '#52B788',
  delayed: '#F59E0B',
  boarding: '#3B82F6',
  departed: '#8B5CF6',
  arrived: '#10B981',
  cancelled: '#EF4444',
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'No horário',
  delayed: 'Atrasado',
  boarding: 'Embarcando',
  departed: 'Partiu',
  arrived: 'Chegou',
  cancelled: 'Cancelado',
};

function formatTime(iso: string): string {
  if (!iso) return '--:--';
  if (iso.includes('T')) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return iso;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${day} ${months[d.getMonth()]}`;
}

function getDaysUntil(iso: string): number | null {
  if (!iso) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Build ordered legs from destinations ─────────────────────────────────────

function buildLegs(destinations: Destination[], originLabel = 'Origem'): string[] {
  if (destinations.length === 0) return [];
  const names = destinations.map((d) => d.name);
  const legs: string[] = [];
  legs.push(`${originLabel} → ${names[0]}`);
  for (let i = 0; i < names.length - 1; i++) {
    legs.push(`${names[i]} → ${names[i + 1]}`);
  }
  legs.push(`${names[names.length - 1]} → ${originLabel}`);
  return legs;
}

// ─── Find the next upcoming transport ─────────────────────────────────────────
// Returns the first transport whose departureTime is in the future,
// or — if none has a departureTime — the first one whose leg matches
// the earliest upcoming destination (by trip.startDate + cumulative days).

function getNextTransport(
  transports: Transport[],
  destinations: Destination[],
  startDate: string,
): Transport | null {
  if (!transports || transports.length === 0) return null;

  const now = new Date();

  // 1. Prefer transports with a real departureTime that hasn't passed yet
  const withTime = transports.filter(
    (t) => t.flight?.departureTime && new Date(t.flight.departureTime) > now,
  );
  if (withTime.length > 0) {
    // Sort ascending by departure time
    withTime.sort(
      (a, b) =>
        new Date(a.flight!.departureTime!).getTime() -
        new Date(b.flight!.departureTime!).getTime(),
    );
    return withTime[0];
  }

  // 2. Fall back: use leg ordering based on destination sequence
  const legs = buildLegs(destinations);
  for (const leg of legs) {
    const match = transports.find((t) => t.leg === leg);
    if (match) return match;
  }

  // 3. Last resort: first transport in array
  return transports[0];
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  transports: Transport[];
  destinations: Destination[];
  startDate: string;
  onPress: () => void; // navigate to Transporte tab
}

export function NextTransportCard({ transports, destinations, startDate, onPress }: Props) {
  const next = getNextTransport(transports, destinations, startDate);

  // ── Empty state: no transports added yet ──────────────────────────────────
  if (!next) {
    return (
      <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="airplane-outline" size={15} color="#52B788" />
            <Text style={styles.sectionTitle}>PRÓXIMO TRANSPORTE</Text>
          </View>
          <View style={styles.addHint}>
            <Ionicons name="add-circle-outline" size={14} color="rgba(82,183,136,0.7)" />
            <Text style={styles.addHintText}>Adicionar</Text>
          </View>
        </View>
        <Text style={styles.emptyText}>Nenhum transporte cadastrado ainda.</Text>
        <Text style={styles.emptySubText}>Toque para adicionar voos, trens ou outros meios.</Text>
      </TouchableOpacity>
    );
  }

  const f = next.flight;
  const modeIcon = MODE_ICONS[next.mode] || 'navigate';
  const modeLabel = MODE_LABELS[next.mode] || 'Transporte';
  const status = f?.status || 'scheduled';
  const statusColor = STATUS_COLORS[status] || '#52B788';
  const statusLabel = STATUS_LABELS[status] || 'No horário';

  // Days until departure
  const daysUntil = f?.departureTime ? getDaysUntil(f.departureTime) : null;
  let countdownLabel = '';
  if (daysUntil !== null) {
    if (daysUntil < 0) countdownLabel = 'Concluído';
    else if (daysUntil === 0) countdownLabel = 'Hoje';
    else if (daysUntil === 1) countdownLabel = 'Amanhã';
    else countdownLabel = `em ${daysUntil} dias`;
  }

  // Origin / destination labels
  const origin = f?.origin || next.leg?.split(' → ')[0] || '---';
  const destination = f?.destination || next.leg?.split(' → ')[1] || '---';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name={`${modeIcon}-outline` as any} size={15} color="#52B788" />
          <Text style={styles.sectionTitle}>PRÓXIMO TRANSPORTE</Text>
        </View>
        <View style={styles.headerRight}>
          {countdownLabel ? (
            <View style={[styles.countdownBadge, daysUntil === 0 && styles.countdownToday]}>
              <Text style={[styles.countdownText, daysUntil === 0 && styles.countdownTodayText]}>
                {countdownLabel}
              </Text>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={14} color="rgba(245,240,232,0.3)" />
        </View>
      </View>

      {/* Route row */}
      <View style={styles.routeRow}>
        {/* Origin */}
        <View style={styles.endpoint}>
          <Text style={styles.airportCode}>{origin}</Text>
          {f?.departureTime ? (
            <Text style={styles.timeText}>{formatTime(f.departureTime)}</Text>
          ) : null}
          {f?.departureTime ? (
            <Text style={styles.dateText}>{formatDate(f.departureTime)}</Text>
          ) : null}
        </View>

        {/* Middle */}
        <View style={styles.routeMiddle}>
          {f?.duration ? <Text style={styles.durationText}>{f.duration}</Text> : null}
          <View style={styles.routeLine}>
            <View style={styles.routeDot} />
            <View style={styles.routeLineBar} />
            <Ionicons name={modeIcon as any} size={16} color="#52B788" />
            <View style={styles.routeLineBar} />
            <View style={styles.routeDot} />
          </View>
          {f?.flightNumber ? (
            <Text style={styles.flightNumberText}>{f.flightNumber}</Text>
          ) : (
            <Text style={styles.flightNumberText}>{modeLabel}</Text>
          )}
        </View>

        {/* Destination */}
        <View style={[styles.endpoint, { alignItems: 'flex-end' }]}>
          <Text style={styles.airportCode}>{destination}</Text>
          {f?.arrivalTime ? (
            <Text style={styles.timeText}>{formatTime(f.arrivalTime)}</Text>
          ) : null}
          {f?.arrivalTime ? (
            <Text style={styles.dateText}>{formatDate(f.arrivalTime)}</Text>
          ) : null}
        </View>
      </View>

      {/* Status + airline row */}
      <View style={styles.footer}>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}22` }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        {f?.airline ? (
          <Text style={styles.airlineText}>{f.airline}</Text>
        ) : null}
        {(f?.terminal || f?.gate) ? (
          <View style={styles.gateRow}>
            {f?.terminal ? (
              <Text style={styles.gateText}>T{f.terminal}</Text>
            ) : null}
            {f?.gate ? (
              <Text style={styles.gateText}>Gate {f.gate}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(28,61,46,0.85)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.15)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: 'rgba(245,240,232,0.6)',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  countdownBadge: {
    backgroundColor: 'rgba(82,183,136,0.15)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  countdownToday: {
    backgroundColor: 'rgba(82,183,136,0.3)',
  },
  countdownText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#52B788',
  },
  countdownTodayText: {
    color: '#A8D5B5',
  },
  // Route
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  endpoint: {
    alignItems: 'flex-start',
    minWidth: 56,
  },
  airportCode: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F5F0E8',
    letterSpacing: 0.5,
  },
  timeText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.75)',
    marginTop: 2,
  },
  dateText: {
    fontSize: 11,
    color: 'rgba(245,240,232,0.4)',
    marginTop: 1,
  },
  routeMiddle: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 4,
  },
  durationText: {
    fontSize: 11,
    color: 'rgba(245,240,232,0.4)',
  },
  routeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 2,
  },
  routeLineBar: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(82,183,136,0.4)',
  },
  routeDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#52B788',
  },
  flightNumberText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.45)',
    letterSpacing: 0.5,
  },
  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  airlineText: {
    fontSize: 12,
    color: 'rgba(245,240,232,0.45)',
    flex: 1,
  },
  gateRow: {
    flexDirection: 'row',
    gap: 6,
  },
  gateText: {
    fontSize: 11,
    color: 'rgba(245,240,232,0.4)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  // Empty state
  emptyText: {
    fontSize: 14,
    color: 'rgba(245,240,232,0.5)',
    marginBottom: 4,
  },
  emptySubText: {
    fontSize: 12,
    color: 'rgba(245,240,232,0.3)',
    lineHeight: 18,
  },
  addHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addHintText: {
    fontSize: 12,
    color: 'rgba(82,183,136,0.7)',
    fontWeight: '600',
  },
});

// ─── Transport Summary Card (for Geral tab) ───────────────────────────────────
// Shows ALL transports using the same detailed card style as the Transport tab.

import { Linking } from 'react-native';

const FLIGHT_STATUS_COLORS: Record<string, string> = {
  scheduled: '#52B788', delayed: '#F59E0B', boarding: '#3B82F6',
  departed: '#8B5CF6', arrived: '#10B981', cancelled: '#EF4444',
};
const FLIGHT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'No horário', delayed: 'Atrasado', boarding: 'Embarcando',
  departed: 'Partiu', arrived: 'Chegou', cancelled: 'Cancelado',
};

function SummaryFlightCard({ transport }: { transport: Transport }) {
  const f = transport.flight!;
  const statusColor = FLIGHT_STATUS_COLORS[f.status || 'scheduled'];
  const statusLabel = FLIGHT_STATUS_LABELS[f.status || 'scheduled'];
  const depTime = f.departureActual && f.departureActual !== f.departureTime ? f.departureActual : f.departureTime;
  const arrTime = f.arrivalActual && f.arrivalActual !== f.arrivalTime ? f.arrivalActual : f.arrivalTime;

  return (
    <View style={summaryStyles.flightCard}>
      <View style={summaryStyles.flightTopRow}>
        <Text style={summaryStyles.airlineName}>{f.airline || ''}</Text>
        <Text style={summaryStyles.flightNum}>{f.flightNumber}</Text>
      </View>
      <View style={summaryStyles.routeRow}>
        <View style={summaryStyles.endpoint}>
          <Text style={summaryStyles.cityName} numberOfLines={1}>{f.originCity || f.origin || '---'}</Text>
          <Text style={summaryStyles.iata}>{f.origin || '---'}</Text>
          <Text style={summaryStyles.time}>{formatTime(depTime)}</Text>
        </View>
        <View style={summaryStyles.middle}>
          <View style={summaryStyles.lineRow}>
            <View style={summaryStyles.dot} />
            <View style={summaryStyles.bar} />
            <Ionicons name="airplane" size={13} color="rgba(245,240,232,0.5)" />
            <View style={summaryStyles.bar} />
            <View style={summaryStyles.dot} />
          </View>
          {f.duration ? <Text style={summaryStyles.duration}>{f.duration}</Text> : null}
        </View>
        <View style={[summaryStyles.endpoint, { alignItems: 'flex-end' }]}>
          <Text style={summaryStyles.cityName} numberOfLines={1}>{f.destinationCity || f.destination || '---'}</Text>
          <Text style={summaryStyles.iata}>{f.destination || '---'}</Text>
          <Text style={summaryStyles.time}>{formatTime(arrTime)}</Text>
        </View>
      </View>
      <View style={summaryStyles.footer}>
        <View style={[summaryStyles.statusBadge, { backgroundColor: `${statusColor}22` }]}>
          <View style={[summaryStyles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[summaryStyles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        {f.terminal ? <Text style={summaryStyles.gateText}>T{f.terminal}</Text> : null}
        {f.gate ? <Text style={summaryStyles.gateText}>Gate {f.gate}</Text> : null}
      </View>
    </View>
  );
}

function SummaryCarCard({ transport }: { transport: Transport }) {
  const c = transport.car!;
  const fmt = (iso: string) => {
    if (!iso) return '--:--';
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  return (
    <View style={summaryStyles.flightCard}>
      <View style={summaryStyles.flightTopRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="car-outline" size={14} color="#52B788" />
          <Text style={summaryStyles.airlineName}>{transport.leg || 'Carro'}</Text>
        </View>
      </View>
      <View style={summaryStyles.routeRow}>
        <View style={summaryStyles.endpoint}>
          <Text style={summaryStyles.labelSmall}>SAÍDA</Text>
          <Text style={summaryStyles.time}>{fmt(c.departureTime || '')}</Text>
          <Text style={summaryStyles.address} numberOfLines={2}>{c.originAddress}</Text>
        </View>
        <View style={summaryStyles.middle}>
          <View style={summaryStyles.lineRow}>
            <View style={summaryStyles.dot} />
            <View style={summaryStyles.bar} />
            <Ionicons name="car" size={13} color="rgba(245,240,232,0.5)" />
            <View style={summaryStyles.bar} />
            <View style={summaryStyles.dot} />
          </View>
          {c.travelDuration ? <Text style={summaryStyles.duration}>{c.travelDuration}</Text> : null}
        </View>
        <View style={[summaryStyles.endpoint, { alignItems: 'flex-end' }]}>
          <Text style={summaryStyles.labelSmall}>CHEGADA</Text>
          <Text style={summaryStyles.time}>{fmt(c.desiredArrivalTime || '')}</Text>
          <Text style={[summaryStyles.address, { textAlign: 'right' }]} numberOfLines={2}>{c.destinationAddress}</Text>
        </View>
      </View>
      {c.mapsUrl ? (
        <TouchableOpacity style={summaryStyles.mapsBtn} onPress={() => Linking.openURL(c.mapsUrl!)}>
          <Ionicons name="map-outline" size={12} color="#52B788" />
          <Text style={summaryStyles.mapsBtnText}>Abrir no Google Maps</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function SummaryGenericCard({ transport }: { transport: Transport }) {
  const modeIcons: Record<string, string> = {
    flight: 'airplane-outline', car: 'car-outline', train: 'train-outline',
    bus: 'bus-outline', ferry: 'boat-outline', other: 'navigate-outline',
  };
  const modeLabels: Record<string, string> = {
    flight: 'Voo', car: 'Carro', train: 'Trem', bus: 'Ônibus', ferry: 'Barco', other: 'Transporte',
  };
  return (
    <View style={summaryStyles.flightCard}>
      <View style={summaryStyles.flightTopRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name={modeIcons[transport.mode] as any || 'navigate-outline'} size={14} color="#52B788" />
          <Text style={summaryStyles.airlineName}>{modeLabels[transport.mode] || 'Transporte'}</Text>
        </View>
        {transport.travelTime ? <Text style={summaryStyles.duration}>{transport.travelTime}</Text> : null}
      </View>
      {transport.leg ? <Text style={summaryStyles.legLabel}>{transport.leg}</Text> : null}
    </View>
  );
}

export function TransportSummaryCard({ transports, destinations, startDate, onPress }: Props) {
  const hasTransports = transports && transports.length > 0;

  return (
    <View style={summaryStyles.wrapper}>
      {/* Header */}
      <TouchableOpacity style={summaryStyles.header} onPress={onPress} activeOpacity={0.8}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="airplane-outline" size={15} color="#52B788" />
          <Text style={summaryStyles.sectionTitle}>TRANSPORTE</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={summaryStyles.addHintText}>Gerenciar</Text>
          <Ionicons name="chevron-forward" size={14} color="rgba(245,240,232,0.3)" />
        </View>
      </TouchableOpacity>

      {!hasTransports ? (
        <TouchableOpacity style={summaryStyles.emptyRow} onPress={onPress} activeOpacity={0.8}>
          <Ionicons name="airplane-outline" size={20} color="rgba(245,240,232,0.2)" />
          <Text style={summaryStyles.emptyText}>Nenhum transporte cadastrado ainda.</Text>
          <Text style={summaryStyles.emptyCta}>Toque para adicionar →</Text>
        </TouchableOpacity>
      ) : (
        <View style={{ gap: 10 }}>
          {transports.map((t) =>
            t.mode === 'flight' && t.flight ? (
              <SummaryFlightCard key={t.id} transport={t} />
            ) : t.mode === 'car' && t.car ? (
              <SummaryCarCard key={t.id} transport={t} />
            ) : (
              <SummaryGenericCard key={t.id} transport={t} />
            )
          )}
        </View>
      )}
    </View>
  );
}

const summaryStyles = StyleSheet.create({
  wrapper: {
    backgroundColor: 'rgba(28,61,46,0.85)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.15)',
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: 'rgba(245,240,232,0.6)',
  },
  addHintText: {
    fontSize: 12,
    color: 'rgba(82,183,136,0.7)',
    fontWeight: '600',
  },
  emptyRow: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  emptyText: {
    fontSize: 13,
    color: 'rgba(245,240,232,0.4)',
  },
  emptyCta: {
    fontSize: 12,
    color: 'rgba(82,183,136,0.6)',
  },
  flightCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.08)',
  },
  flightTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  airlineName: {
    fontSize: 12,
    color: 'rgba(245,240,232,0.5)',
    fontWeight: '500',
  },
  flightNum: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(245,240,232,0.6)',
    letterSpacing: 0.5,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  endpoint: {
    alignItems: 'flex-start',
    minWidth: 60,
  },
  cityName: {
    fontSize: 11,
    color: 'rgba(245,240,232,0.4)',
    marginBottom: 1,
  },
  iata: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F5F0E8',
    letterSpacing: 0.5,
  },
  time: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.7)',
    marginTop: 2,
  },
  middle: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 4,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 2,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#52B788',
  },
  bar: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(82,183,136,0.35)',
  },
  duration: {
    fontSize: 10,
    color: 'rgba(245,240,232,0.35)',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  statusDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  gateText: {
    fontSize: 10,
    color: 'rgba(245,240,232,0.4)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
  },
  labelSmall: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    color: 'rgba(245,240,232,0.35)',
    marginBottom: 2,
  },
  address: {
    fontSize: 10,
    color: 'rgba(245,240,232,0.35)',
    marginTop: 2,
    maxWidth: 90,
  },
  mapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(82,183,136,0.1)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  mapsBtnText: {
    fontSize: 11,
    color: '#52B788',
    fontWeight: '600',
  },
  legLabel: {
    fontSize: 12,
    color: 'rgba(245,240,232,0.45)',
  },
});
