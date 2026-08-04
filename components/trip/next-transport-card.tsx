import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Transport, Destination } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MODE_ICONS: Record<string, string> = {
  flight: 'airplane',
  train: 'train',
  bus: 'bus',
  ferry: 'boat',
  car: 'car',
  other: 'navigate',
};

function getStatusColors(colors: ThemeColorPalette): Record<string, string> {
  return {
    scheduled: colors.textAccent,
    delayed: colors.warning,
    boarding: colors.statusBoarding,
    departed: colors.statusDeparted,
    arrived: colors.statusArrived,
    cancelled: colors.error,
  };
}

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

function buildLegs(destinations: Destination[], originLabel: string): string[] {
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
  const legs = buildLegs(destinations, '');
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
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const STATUS_COLORS = useMemo(() => getStatusColors(colors), [colors]);
  const MODE_LABELS: Record<string, string> = {
    flight: t.transport.flight,
    train: t.transport.train,
    bus: t.transport.bus,
    ferry: t.transport.ferry,
    car: t.transport.car,
    other: t.transport.other,
  };
  const STATUS_LABELS: Record<string, string> = {
    scheduled: t.transport.statusScheduled,
    delayed: t.transport.statusDelayed,
    boarding: t.transport.statusBoarding,
    departed: t.transport.statusDeparted,
    arrived: t.transport.statusArrived,
    cancelled: t.transport.statusCancelled,
  };
  const next = getNextTransport(transports, destinations, startDate);

  // ── Empty state: no transports added yet ──────────────────────────────────
  if (!next) {
    return (
      <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="airplane-outline" size={15} color={colors.textAccent} />
            <Text style={styles.sectionTitle}>{t.common.nextTransport}</Text>
          </View>
          <View style={styles.addHint}>
            <Ionicons name="add-circle-outline" size={14} color={withAlpha(colors.textAccent, 0.7)} />
            <Text style={styles.addHintText}>{t.common.add}</Text>
          </View>
        </View>
        <Text style={styles.emptyText}>{t.transport.noTransport}</Text>
        <Text style={styles.emptySubText}>{t.transport.tapToConfigure}</Text>
      </TouchableOpacity>
    );
  }

  const f = next.flight;
  const modeIcon = MODE_ICONS[next.mode] || 'navigate';
  const modeLabel = MODE_LABELS[next.mode] || 'Transporte';
  const status = f?.status || 'scheduled';
  const statusColor = STATUS_COLORS[status] || colors.textAccent;
  const statusLabel = STATUS_LABELS[status] || 'No horário';

  // Days until departure
  const daysUntil = f?.departureTime ? getDaysUntil(f.departureTime) : null;
  let countdownLabel = '';
  if (daysUntil !== null) {
    if (daysUntil < 0) countdownLabel = t.common.done;
    else if (daysUntil === 0) countdownLabel = t.common.today;
    else if (daysUntil === 1) countdownLabel = t.common.tomorrow;
    else countdownLabel = t.common.inDays.replace('{n}', String(daysUntil));
  }

  // Origin / destination labels
  const origin = f?.origin || next.leg?.split(' → ')[0] || '---';
  const destination = f?.destination || next.leg?.split(' → ')[1] || '---';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name={`${modeIcon}-outline` as any} size={15} color={colors.textAccent} />
          <Text style={styles.sectionTitle}>{t.transport.saida.replace('SAÍDA', 'PRÓXIMO TRANSPORTE')}</Text>
        </View>
        <View style={styles.headerRight}>
          {countdownLabel ? (
            <View style={[styles.countdownBadge, daysUntil === 0 && styles.countdownToday]}>
              <Text style={[styles.countdownText, daysUntil === 0 && styles.countdownTodayText]}>
                {countdownLabel}
              </Text>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={14} color={colors.muted} />
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
            <Ionicons name={modeIcon as any} size={16} color={colors.textAccent} />
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

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.12),
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
    color: colors.muted,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  countdownBadge: {
    backgroundColor: withAlpha(colors.primary, 0.12),
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  countdownToday: {
    backgroundColor: withAlpha(colors.primary, 0.25),
  },
  countdownText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textAccent,
  },
  countdownTodayText: {
    color: colors.textAccent,
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
    color: colors.foreground,
    letterSpacing: 0.5,
  },
  timeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    marginTop: 2,
  },
  dateText: {
    fontSize: 11,
    color: colors.muted,
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
    color: colors.muted,
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
    backgroundColor: withAlpha(colors.primary, 0.4),
  },
  routeDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  flightNumberText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
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
    color: colors.muted,
    flex: 1,
  },
  gateRow: {
    flexDirection: 'row',
    gap: 6,
  },
  gateText: {
    fontSize: 11,
    color: colors.muted,
    backgroundColor: withAlpha(colors.foreground, 0.06),
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  // Empty state
  emptyText: {
    fontSize: 14,
    color: colors.muted,
    marginBottom: 4,
  },
  emptySubText: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 18,
  },
  addHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addHintText: {
    fontSize: 12,
    color: withAlpha(colors.textAccent, 0.7),
    fontWeight: '600',
  },
});

// ─── Transport Summary Card (for Geral tab) ───────────────────────────────────
// Shows ALL transports using the same detailed card style as the Transport tab.

import { Linking } from 'react-native';

function getSummaryStatusColors(colors: ThemeColorPalette): Record<string, string> {
  return {
    scheduled: colors.textAccent,
    delayed: colors.warning,
    boarding: colors.statusBoarding,
    departed: colors.statusDeparted,
    arrived: colors.statusArrived,
    cancelled: colors.error,
  };
}

function SummaryFlightCard({ transport }: { transport: Transport }) {
  const t = useTranslation();
  const colors = useColors();
  const summaryStyles = useMemo(() => createSummaryStyles(colors), [colors]);
  const FLIGHT_STATUS_COLORS_SUMMARY = useMemo(() => getSummaryStatusColors(colors), [colors]);
  const f = transport.flight!;
  const statusColor = FLIGHT_STATUS_COLORS_SUMMARY[f.status || 'scheduled'];
  const FLIGHT_STATUS_LABELS_LOCAL: Record<string, string> = {
    scheduled: t.transport.statusScheduled,
    delayed: t.transport.statusDelayed,
    boarding: t.transport.statusBoarding,
    departed: t.transport.statusDeparted,
    arrived: t.transport.statusArrived,
    cancelled: t.transport.statusCancelled,
  };
  const statusLabel = FLIGHT_STATUS_LABELS_LOCAL[f.status || 'scheduled'];
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
            <Ionicons name="airplane" size={13} color={colors.muted} />
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
  const t = useTranslation();
  const colors = useColors();
  const summaryStyles = useMemo(() => createSummaryStyles(colors), [colors]);
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
          <Ionicons name="car-outline" size={14} color={colors.textAccent} />
          <Text style={summaryStyles.airlineName}>{transport.leg || t.transport.car}</Text>
        </View>
      </View>
      <View style={summaryStyles.routeRow}>
        <View style={summaryStyles.endpoint}>
          <Text style={summaryStyles.labelSmall}>{t.transport.saida}</Text>
          <Text style={summaryStyles.time}>{fmt(c.departureTime || '')}</Text>
          <Text style={summaryStyles.address} numberOfLines={2}>{c.originAddress}</Text>
        </View>
        <View style={summaryStyles.middle}>
          <View style={summaryStyles.lineRow}>
            <View style={summaryStyles.dot} />
            <View style={summaryStyles.bar} />
            <Ionicons name="car" size={13} color={colors.muted} />
            <View style={summaryStyles.bar} />
            <View style={summaryStyles.dot} />
          </View>
          {c.travelDuration ? <Text style={summaryStyles.duration}>{c.travelDuration}</Text> : null}
        </View>
        <View style={[summaryStyles.endpoint, { alignItems: 'flex-end' }]}>
          <Text style={summaryStyles.labelSmall}>{t.transport.chegada}</Text>
          <Text style={summaryStyles.time}>{fmt(c.desiredArrivalTime || '')}</Text>
          <Text style={[summaryStyles.address, { textAlign: 'right' }]} numberOfLines={2}>{c.destinationAddress}</Text>
        </View>
      </View>
      {c.mapsUrl ? (
        <TouchableOpacity style={summaryStyles.mapsBtn} onPress={() => Linking.openURL(c.mapsUrl!)}>
          <Ionicons name="map-outline" size={12} color={colors.textAccent} />
          <Text style={summaryStyles.mapsBtnText}>{t.transport.openMaps}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function SummaryGenericCard({ transport }: { transport: Transport }) {
  const t = useTranslation();
  const colors = useColors();
  const summaryStyles = useMemo(() => createSummaryStyles(colors), [colors]);
  const modeIcons: Record<string, string> = {
    flight: 'airplane-outline', car: 'car-outline', train: 'train-outline',
    bus: 'bus-outline', ferry: 'boat-outline', other: 'navigate-outline',
  };
  const modeLabels: Record<string, string> = {
    flight: t.transport.flight, car: t.transport.car, train: t.transport.train,
    bus: t.transport.bus, ferry: t.transport.ferry, other: t.transport.other,
  };
  return (
    <View style={summaryStyles.flightCard}>
      <View style={summaryStyles.flightTopRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name={modeIcons[transport.mode] as any || 'navigate-outline'} size={14} color={colors.textAccent} />
          <Text style={summaryStyles.airlineName}>{modeLabels[transport.mode] || 'Transporte'}</Text>
        </View>
        {transport.travelTime ? <Text style={summaryStyles.duration}>{transport.travelTime}</Text> : null}
      </View>
      {transport.leg ? <Text style={summaryStyles.legLabel}>{transport.leg}</Text> : null}
    </View>
  );
}

export function TransportSummaryCard({ transports, destinations, startDate, onPress }: Props) {
  const t = useTranslation();
  const colors = useColors();
  const summaryStyles = useMemo(() => createSummaryStyles(colors), [colors]);
  const hasTransports = transports && transports.length > 0;

  return (
    <View style={summaryStyles.wrapper}>
      {/* Header */}
      <TouchableOpacity style={summaryStyles.header} onPress={onPress} activeOpacity={0.8}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="airplane-outline" size={15} color={colors.textAccent} />
          <Text style={summaryStyles.sectionTitle}>{t.transport.title.toUpperCase()}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={summaryStyles.addHintText}>{t.common.manage}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.muted} />
        </View>
      </TouchableOpacity>

      {!hasTransports ? (
        <TouchableOpacity style={summaryStyles.emptyRow} onPress={onPress} activeOpacity={0.8}>
          <Ionicons name="airplane-outline" size={20} color={colors.muted} />
          <Text style={summaryStyles.emptyText}>{t.transport.noTransport}</Text>
          <Text style={summaryStyles.emptyCta}>{t.transport.tapToConfigure}</Text>
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

const createSummaryStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  wrapper: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.12),
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
    color: colors.muted,
  },
  addHintText: {
    fontSize: 12,
    color: withAlpha(colors.textAccent, 0.7),
    fontWeight: '600',
  },
  emptyRow: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  emptyText: {
    fontSize: 13,
    color: colors.muted,
  },
  emptyCta: {
    fontSize: 12,
    color: withAlpha(colors.textAccent, 0.6),
  },
  flightCard: {
    backgroundColor: withAlpha(colors.foreground, 0.04),
    borderRadius: 14,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.08),
  },
  flightTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  airlineName: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '500',
  },
  flightNum: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
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
    color: colors.muted,
    marginBottom: 1,
  },
  iata: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.foreground,
    letterSpacing: 0.5,
  },
  time: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
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
    backgroundColor: colors.primary,
  },
  bar: {
    flex: 1,
    height: 1,
    backgroundColor: withAlpha(colors.primary, 0.35),
  },
  duration: {
    fontSize: 10,
    color: colors.muted,
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
    color: colors.muted,
    backgroundColor: withAlpha(colors.foreground, 0.06),
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
  },
  labelSmall: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.muted,
    marginBottom: 2,
  },
  address: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
    maxWidth: 90,
  },
  mapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: withAlpha(colors.primary, 0.1),
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  mapsBtnText: {
    fontSize: 11,
    color: colors.textAccent,
    fontWeight: '600',
  },
  legLabel: {
    fontSize: 12,
    color: colors.muted,
  },
});
