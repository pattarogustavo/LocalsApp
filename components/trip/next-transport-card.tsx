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
