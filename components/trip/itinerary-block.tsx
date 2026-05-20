import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Linking, ActivityIndicator, Modal, Alert, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTripsStore } from '@/store/trips';
import { trpc } from '@/lib/trpc';
import type { Trip, DayItinerary, TravelPace } from '@/types/voyage';

// ─── Category helpers ─────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  attraction: 'camera-outline',
  restaurant: 'restaurant-outline',
  cafe: 'cafe-outline',
  museum: 'book-outline',
  hidden_gem: 'diamond-outline',
  other: 'location-outline',
};

const CATEGORY_COLORS: Record<string, string> = {
  attraction: '#52B788',
  restaurant: '#E07B5A',
  cafe: '#C4A35A',
  museum: '#7B9FD4',
  hidden_gem: '#B88BF5',
  other: '#A8D5B5',
};

const PACE_OPTIONS: { id: TravelPace; label: string; icon: string; desc: string }[] = [
  { id: 'relaxado', label: 'Relaxado', icon: 'sunny-outline', desc: '2–3 paradas/dia' },
  { id: 'moderado', label: 'Moderado', icon: 'partly-sunny-outline', desc: '4–5 paradas/dia' },
  { id: 'intenso', label: 'Intenso', icon: 'flash-outline', desc: '6+ paradas/dia' },
];

const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const DAY_NAMES   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

// ─── Build empty day placeholders ─────────────────────────────────────────────

function buildEmptyDays(totalDays: number, startDate: string): DayItinerary[] {
  return Array.from({ length: totalDays }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return {
      date: d.toISOString().split('T')[0],
      destination: '',
      title: '',
      tips: '',
      estimatedCost: 0,
    } as DayItinerary;
  });
}

// ─── Day Selector ─────────────────────────────────────────────────────────────

function DaySelector({
  totalDays, selectedIndex, onSelect, startDate,
}: {
  totalDays: number; selectedIndex: number; onSelect: (i: number) => void; startDate: string;
}) {
  return (
    <ScrollView
      horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 2, paddingBottom: 4 }}
      style={{ marginBottom: 16 }}
    >
      {Array.from({ length: totalDays }, (_, i) => {
        const base = new Date(startDate);
        base.setDate(base.getDate() + i);
        const isSelected = i === selectedIndex;
        return (
          <TouchableOpacity
            key={i} onPress={() => onSelect(i)}
            style={[styles.dayChip, isSelected && styles.dayChipActive]}
          >
            <Text style={[styles.dayChipName, isSelected && styles.dayChipNameActive]}>
              {DAY_NAMES[base.getDay()]}
            </Text>
            <Text style={[styles.dayChipNum, isSelected && styles.dayChipNumActive]}>
              {base.getDate()}
            </Text>
            <Text style={[styles.dayChipMonth, isSelected && styles.dayChipMonthActive]}>
              {MONTH_NAMES[base.getMonth()]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ─── Stop Item ────────────────────────────────────────────────────────────────

interface StopLike {
  id?: string;
  time: string;
  placeName?: string;
  activity?: string;
  placeCategory?: string;
  description?: string;
  tip?: string;
  hours?: string;
  address?: string;
  website?: string;
  lat?: number;
  lng?: number;
  travelTimeToNext?: string;
  travelModeToNext?: string;
}

function StopItem({
  stop,
  isLast,
  onDelete,
  onTimeChange,
}: {
  stop: StopLike;
  isLast: boolean;
  onDelete?: () => void;
  onTimeChange?: (newTime: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingTime, setEditingTime] = useState(false);
  const [timeInput, setTimeInput] = useState(stop.time || '');
  const name = stop.placeName || stop.activity || '';
  const desc = stop.description || stop.tip || '';
  const cat  = stop.placeCategory || 'other';
  const catIcon  = CATEGORY_ICONS[cat] || 'location-outline';
  const catColor = CATEGORY_COLORS[cat] || '#52B788';

  const openMaps = () => {
    if (stop.lat && stop.lng) {
      Linking.openURL(`https://maps.google.com/?q=${stop.lat},${stop.lng}`);
    } else if (stop.address) {
      Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(stop.address)}`);
    }
  };

  return (
    <View>
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        onLongPress={onDelete}
        style={styles.stopRow}
        activeOpacity={0.75}
      >
        {/* Time — tap to edit */}
        <View style={styles.timeCol}>
          <TouchableOpacity
            onPress={() => { setTimeInput(stop.time || ''); setEditingTime(true); }}
            style={styles.timeBtn}
          >
            <Text style={styles.stopTime}>{stop.time || '--:--'}</Text>
          </TouchableOpacity>
        </View>

        {/* Time Edit Modal */}
        <Modal visible={editingTime} transparent animationType="fade" onRequestClose={() => setEditingTime(false)}>
          <View style={styles.timeModalOverlay}>
            <View style={styles.timeModalSheet}>
              <Text style={styles.timeModalTitle}>Editar horário</Text>
              <TextInput
                style={styles.timeModalInput}
                value={timeInput}
                onChangeText={setTimeInput}
                placeholder="09:30"
                placeholderTextColor="rgba(245,240,232,0.3)"
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (onTimeChange && timeInput.match(/^\d{1,2}:\d{2}$/)) {
                    onTimeChange(timeInput);
                  }
                  setEditingTime(false);
                }}
              />
              <Text style={styles.timeModalHint}>Formato: HH:MM (ex: 09:30)</Text>
              <View style={styles.timeModalActions}>
                <TouchableOpacity style={styles.timeModalCancel} onPress={() => setEditingTime(false)}>
                  <Text style={styles.timeModalCancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.timeModalConfirm}
                  onPress={() => {
                    if (onTimeChange && timeInput.trim()) {
                      onTimeChange(timeInput.trim());
                    }
                    setEditingTime(false);
                  }}
                >
                  <Text style={styles.timeModalConfirmText}>Salvar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        {/* Icon + vertical line */}
        <View style={styles.iconCol}>
          <View style={[styles.stopIconBg, { backgroundColor: `${catColor}22` }]}>
            <Ionicons name={catIcon as any} size={16} color={catColor} />
          </View>
          {!isLast && <View style={styles.vertLine} />}
        </View>
        {/* Content */}
        <View style={styles.stopContent}>
          <Text style={styles.stopName}>{name}</Text>
          {desc ? (
            <Text style={styles.stopDesc} numberOfLines={expanded ? undefined : 1}>{desc}</Text>
          ) : null}
          {expanded && (
            <View style={styles.stopExpanded}>
              {stop.hours ? (
                <View style={styles.stopDetail}>
                  <Ionicons name="time-outline" size={12} color="rgba(245,240,232,0.4)" />
                  <Text style={styles.stopDetailText}>{stop.hours}</Text>
                </View>
              ) : null}
              {stop.address ? (
                <View style={styles.stopDetail}>
                  <Ionicons name="location-outline" size={12} color="rgba(245,240,232,0.4)" />
                  <Text style={styles.stopDetailText}>{stop.address}</Text>
                </View>
              ) : null}
              <View style={styles.stopActions}>
                {(stop.lat || stop.address) ? (
                  <TouchableOpacity onPress={openMaps} style={styles.stopActionBtn}>
                    <Ionicons name="map-outline" size={13} color="#52B788" />
                    <Text style={styles.stopActionText}>Maps</Text>
                  </TouchableOpacity>
                ) : null}
                {stop.website ? (
                  <TouchableOpacity onPress={() => Linking.openURL(stop.website!)} style={styles.stopActionBtn}>
                    <Ionicons name="globe-outline" size={13} color="#52B788" />
                    <Text style={styles.stopActionText}>Site</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Travel to next */}
      {!isLast && stop.travelTimeToNext ? (
        <TouchableOpacity
          style={styles.travelRow}
          onPress={() => {
            const url = (stop as any).mapsUrlToNext;
            if (url) Linking.openURL(url);
          }}
          activeOpacity={(stop as any).mapsUrlToNext ? 0.7 : 1}
        >
          <View style={styles.timeCol} />
          <View style={styles.iconCol}>
            <View style={styles.travelIconBg}>
              <Ionicons
                name={travelModeIcon(stop.travelModeToNext) as any}
                size={11}
                color="rgba(245,240,232,0.4)"
              />
            </View>
          </View>
          <Text style={styles.travelText}>{stop.travelTimeToNext}</Text>
          {(stop as any).mapsUrlToNext ? (
            <Ionicons name="open-outline" size={10} color="rgba(82,183,136,0.5)" style={{ marginLeft: 4 }} />
          ) : null}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── Day View ─────────────────────────────────────────────────────────────────

// Map CityTransportMode to Google Directions travel mode
function toDirectionsMode(mode?: string): 'driving' | 'walking' | 'transit' | 'bicycling' {
  if (mode === 'walk') return 'walking';
  if (mode === 'bike') return 'bicycling';
  if (mode === 'public') return 'transit';
  return 'driving';
}

// Map travel mode to display icon
function travelModeIcon(mode?: string): string {
  if (mode === 'walking' || mode === 'walk') return 'walk-outline';
  if (mode === 'bicycling' || mode === 'bike') return 'bicycle-outline';
  if (mode === 'transit' || mode === 'public') return 'bus-outline';
  return 'car-outline';
}

function DayView({
  day,
  dayIndex,
  tripId,
  cityTransportMode,
  onGoToPlaces,
}: {
  day: DayItinerary | undefined;
  dayIndex: number;
  tripId: string;
  cityTransportMode?: string;
  onGoToPlaces: () => void;
}) {
  const { removeItineraryStop, updateItineraryStop } = useTripsStore();
  const batchRoute = trpc.directions.batchRoute.useMutation();
  const [updatingRoutes, setUpdatingRoutes] = useState(false);
  // Support both new stops[] format and legacy morning/afternoon/evening
  const stops: StopLike[] = day
    ? ((day as any).stops && (day as any).stops.length > 0
        ? (day as any).stops
        : [
            day.morning   ? { id: 'm', time: day.morning.time   || '09:00', placeName: day.morning.activity,   placeCategory: 'attraction', description: day.morning.tip   } : null,
            day.afternoon ? { id: 'a', time: day.afternoon.time || '14:00', placeName: day.afternoon.activity, placeCategory: 'restaurant', description: day.afternoon.tip } : null,
            day.evening   ? { id: 'e', time: day.evening.time   || '19:00', placeName: day.evening.activity,   placeCategory: 'other',      description: day.evening.tip   } : null,
          ].filter(Boolean) as StopLike[])
    : [];

  if (stops.length === 0) {
    return (
      <View style={styles.emptyDay}>
        <Text style={styles.emptyDayText}>Nenhuma atividade para este dia</Text>
        <TouchableOpacity onPress={onGoToPlaces} style={styles.goToPlacesBtn}>
          <Ionicons name="location-outline" size={14} color="#0F1F16" />
          <Text style={styles.goToPlacesBtnText}>Adicionar lugares</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleDeleteStop = (stop: StopLike) => {
    if (!stop.id) return;
    Alert.alert('Remover parada', `Deseja remover "${stop.placeName || stop.activity || 'esta parada'}" do roteiro?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => removeItineraryStop(tripId, dayIndex, stop.id!),
      },
    ]);
  };

  const handleTimeChange = (stop: StopLike, newTime: string) => {
    if (!stop.id) return;
    updateItineraryStop(tripId, dayIndex, stop.id, { time: newTime });
  };

  const handleUpdateRoutes = async () => {
    // Only update stops that have coordinates or addresses
    const stopsWithLocation = stops.filter((s) => (s.lat && s.lng) || s.address);
    if (stopsWithLocation.length < 2) return;
    setUpdatingRoutes(true);
    try {
      const mode = toDirectionsMode(cityTransportMode);
      const pairs = [];
      for (let i = 0; i < stopsWithLocation.length - 1; i++) {
        const from = stopsWithLocation[i];
        const to   = stopsWithLocation[i + 1];
        const origin      = from.lat && from.lng ? `${from.lat},${from.lng}` : (from.address || '');
        const destination = to.lat   && to.lng   ? `${to.lat},${to.lng}`     : (to.address   || '');
        if (origin && destination) pairs.push({ origin, destination, mode });
      }
      if (pairs.length === 0) return;
      const result = await batchRoute.mutateAsync({ pairs });
      // Apply results back to the stops that have IDs
      let pairIdx = 0;
      for (let i = 0; i < stopsWithLocation.length - 1; i++) {
        const s = stopsWithLocation[i];
        if (!s.id) { pairIdx++; continue; }
        const r = result.results[pairIdx];
        if (r?.found) {
          updateItineraryStop(tripId, dayIndex, s.id, {
            travelTimeToNext: r.durationText,
            travelModeToNext: mode as any,
            mapsUrlToNext: r.mapsUrl,
          });
        }
        pairIdx++;
      }
    } catch (e) {
      console.error('Directions error:', e);
    } finally {
      setUpdatingRoutes(false);
    }
  };

  return (
    <View>
      {/* Update routes button */}
      {stops.length >= 2 && (
        <TouchableOpacity
          onPress={handleUpdateRoutes}
          disabled={updatingRoutes}
          style={styles.updateRoutesBtn}
        >
          {updatingRoutes ? (
            <ActivityIndicator size="small" color="#52B788" />
          ) : (
            <Ionicons name="navigate-outline" size={13} color="#52B788" />
          )}
          <Text style={styles.updateRoutesBtnText}>
            {updatingRoutes ? 'Calculando...' : 'Atualizar trajetos'}
          </Text>
        </TouchableOpacity>
      )}
      {stops.map((s, i) => (
        <StopItem
          key={s.id || i}
          stop={s}
          isLast={i === stops.length - 1}
          onDelete={s.id ? () => handleDeleteStop(s) : undefined}
          onTimeChange={s.id ? (t) => handleTimeChange(s, t) : undefined}
        />
      ))}
      {day?.tips ? (
        <View style={styles.dayTip}>
          <Ionicons name="bulb-outline" size={14} color="#C4A35A" />
          <Text style={styles.dayTipText}>{day.tips}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface ItineraryBlockProps {
  trip: Trip;
  onGoToPlaces: () => void;
  cityTransportMode?: string;
}

export function ItineraryBlock({ trip, onGoToPlaces, cityTransportMode }: ItineraryBlockProps) {
  const { setItinerary } = useTripsStore();
  const [selectedDay, setSelectedDay] = useState(0);
  const [pace, setPace] = useState<TravelPace>('moderado');
  const [generating, setGenerating] = useState(false);
  const [showPaceModal, setShowPaceModal] = useState(false);

  const generateItinerary = trpc.ai.generateItinerary.useMutation();

  const hasItinerary = trip.itinerary && trip.itinerary.length > 0;
  const totalDays = trip.totalDays || 1;

  // Merge real itinerary days with empty placeholders
  const displayDays: (DayItinerary | undefined)[] = Array.from({ length: totalDays }, (_, i) => {
    return trip.itinerary?.[i] ?? undefined;
  });

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await generateItinerary.mutateAsync({
        tripId: trip.id,
        destinations: trip.destinations.map((d) => ({ name: d.name, country: d.country, days: d.days })),
        selectedPlaces: trip.places.map((p) => ({
          name: p.name,
          category: p.category,
          destinationName: trip.destinations.find((d) => d.id === p.destinationId)?.name || '',
          hours: p.hours,
          address: p.address,
          lat: p.lat,
          lng: p.lng,
        })),
        totalDays,
        startDate: trip.startDate,
        cityTransportMode: cityTransportMode || trip.cityTransportMode,
        preferences: {
          pace,
          includeBreakfast: true,
          includeLunch: true,
          includeDinner: true,
        },
      });
      if (result?.days && result.days.length > 0) {
        await setItinerary(trip.id, result.days);
        setSelectedDay(0);
      }
    } catch (e) {
      console.error('Itinerary generation error:', e);
    } finally {
      setGenerating(false);
      setShowPaceModal(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="calendar-outline" size={15} color="#52B788" />
          <Text style={styles.sectionTitle}>ROTEIRO DIA-A-DIA</Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowPaceModal(true)}
          style={styles.regenBtn}
          disabled={generating}
        >
          {generating ? (
            <ActivityIndicator size="small" color="#52B788" />
          ) : (
            <>
              <Ionicons name="sparkles-outline" size={14} color="#52B788" />
              <Text style={styles.regenBtnText}>{hasItinerary ? 'Regerar' : 'Criar com IA'}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Day selector — always visible */}
      <View style={styles.itineraryCard}>
        <DaySelector
          totalDays={totalDays}
          selectedIndex={selectedDay}
          onSelect={setSelectedDay}
          startDate={trip.startDate}
        />
        <DayView
          day={displayDays[selectedDay]}
          dayIndex={selectedDay}
          tripId={trip.id}
          cityTransportMode={cityTransportMode || trip.cityTransportMode}
          onGoToPlaces={onGoToPlaces}
        />
        {generating && (
          <View style={styles.generatingRow}>
            <ActivityIndicator size="small" color="#52B788" />
            <Text style={styles.loadingText}>A IA está criando seu roteiro...</Text>
          </View>
        )}
      </View>

      {/* Pace modal */}
      <Modal visible={showPaceModal} transparent animationType="fade" onRequestClose={() => setShowPaceModal(false)}>
        <View style={styles.paceModalOverlay}>
          <View style={styles.paceModalCard}>
            <Text style={styles.paceModalTitle}>Ritmo da Viagem</Text>
            <Text style={styles.paceModalSubtitle}>
              {trip.places.length > 0
                ? `${trip.places.length} lugares selecionados serão incluídos no roteiro.`
                : 'A IA vai sugerir os melhores lugares para cada dia.'}
            </Text>
            {PACE_OPTIONS.map((p) => (
              <TouchableOpacity
                key={p.id} onPress={() => setPace(p.id)}
                style={[styles.paceModalOption, pace === p.id && styles.paceModalOptionActive]}
              >
                <Ionicons name={p.icon as any} size={18} color={pace === p.id ? '#0F1F16' : '#52B788'} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.paceModalOptionLabel, pace === p.id && { color: '#0F1F16' }]}>{p.label}</Text>
                  <Text style={[styles.paceModalOptionDesc, pace === p.id && { color: 'rgba(15,31,22,0.7)' }]}>{p.desc}</Text>
                </View>
                {pace === p.id && <Ionicons name="checkmark" size={18} color="#0F1F16" />}
              </TouchableOpacity>
            ))}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <TouchableOpacity
                onPress={() => setShowPaceModal(false)}
                style={[styles.paceModalBtn, { backgroundColor: 'rgba(255,255,255,0.08)', flex: 1 }]}
              >
                <Text style={{ color: 'rgba(245,240,232,0.7)', fontWeight: '600' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleGenerate}
                style={[styles.paceModalBtn, { backgroundColor: '#52B788', flex: 1.5 }]}
                disabled={generating}
              >
                {generating ? (
                  <ActivityIndicator size="small" color="#0F1F16" />
                ) : (
                  <>
                    <Ionicons name="sparkles-outline" size={15} color="#0F1F16" />
                    <Text style={{ color: '#0F1F16', fontWeight: '700' }}>
                      {hasItinerary ? 'Regerar' : 'Criar Roteiro'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: 'rgba(245,240,232,0.7)' },
  regenBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(82,183,136,0.12)', minWidth: 80, justifyContent: 'center' },
  regenBtnText: { fontSize: 12, color: '#52B788', fontWeight: '600' },

  itineraryCard: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: 'rgba(82,183,136,0.1)' },

  // Day selector chips
  dayChip: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', minWidth: 52 },
  dayChipActive: { backgroundColor: '#52B788' },
  dayChipName: { fontSize: 11, color: 'rgba(245,240,232,0.5)', fontWeight: '600', marginBottom: 2 },
  dayChipNameActive: { color: '#0F1F16' },
  dayChipNum: { fontSize: 20, fontWeight: '800', color: '#F5F0E8', lineHeight: 24 },
  dayChipNumActive: { color: '#0F1F16' },
  dayChipMonth: { fontSize: 10, color: 'rgba(245,240,232,0.4)', marginTop: 1 },
  dayChipMonthActive: { color: 'rgba(15,31,22,0.7)' },

  // Stop item
  stopRow: { flexDirection: 'row', paddingVertical: 6 },
  timeCol: { width: 44, alignItems: 'flex-end', paddingRight: 10, paddingTop: 6 },
  stopTime: { fontSize: 12, color: 'rgba(245,240,232,0.4)', fontWeight: '500' },
  iconCol: { width: 36, alignItems: 'center' },
  stopIconBg: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  vertLine: { flex: 1, width: 1, backgroundColor: 'rgba(82,183,136,0.2)', marginTop: 4, minHeight: 16 },
  stopContent: { flex: 1, paddingLeft: 10, paddingBottom: 8 },
  stopName: { fontSize: 15, fontWeight: '700', color: '#F5F0E8', lineHeight: 20 },
  stopDesc: { fontSize: 13, color: 'rgba(245,240,232,0.55)', marginTop: 2, lineHeight: 18 },
  stopExpanded: { marginTop: 8, gap: 6 },
  stopDetail: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  stopDetailText: { fontSize: 12, color: 'rgba(245,240,232,0.5)', flex: 1, lineHeight: 16 },
  stopActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  stopActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(82,183,136,0.12)' },
  stopActionText: { fontSize: 12, color: '#52B788', fontWeight: '600' },

  // Travel between stops
  travelRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  travelIconBg: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  travelText: { fontSize: 11, color: 'rgba(245,240,232,0.35)', paddingLeft: 10 },

  // Day tip
  dayTip: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12, padding: 10, backgroundColor: 'rgba(196,163,90,0.1)', borderRadius: 10, borderLeftWidth: 2, borderLeftColor: '#C4A35A' },
  dayTipText: { flex: 1, fontSize: 12, color: 'rgba(245,240,232,0.6)', lineHeight: 18 },

  // Empty day
  emptyDay: { paddingVertical: 20, alignItems: 'center', gap: 12 },
  emptyDayText: { fontSize: 14, color: 'rgba(245,240,232,0.4)', textAlign: 'center' },
  goToPlacesBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#52B788', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  goToPlacesBtnText: { fontSize: 13, fontWeight: '700', color: '#0F1F16' },

  // Generating
  generatingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, justifyContent: 'center' },
  loadingText: { fontSize: 12, color: 'rgba(245,240,232,0.4)', textAlign: 'center' },

  // Pace modal
  paceModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  paceModalCard: { backgroundColor: '#1A2E22', borderRadius: 20, padding: 20, gap: 10 },
  paceModalTitle: { fontSize: 18, fontWeight: '700', color: '#F5F0E8', fontStyle: 'italic', marginBottom: 2 },
  paceModalSubtitle: { fontSize: 13, color: 'rgba(245,240,232,0.5)', lineHeight: 18, marginBottom: 4 },
  paceModalOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  paceModalOptionActive: { backgroundColor: '#52B788' },
  paceModalOptionLabel: { fontSize: 15, fontWeight: '700', color: '#F5F0E8' },
  paceModalOptionDesc: { fontSize: 12, color: 'rgba(245,240,232,0.5)', marginTop: 1 },
  paceModalBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12, borderRadius: 12 },

  // Time edit
  timeBtn: { paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(82,183,136,0.2)' },
  timeModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 32 },
  timeModalSheet: { backgroundColor: '#1A2E22', borderRadius: 20, padding: 20, gap: 12 },
  timeModalTitle: { fontSize: 17, fontWeight: '700', color: '#F5F0E8', textAlign: 'center' },
  timeModalInput: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 14, fontSize: 28, fontWeight: '700', color: '#F5F0E8', textAlign: 'center', borderWidth: 1, borderColor: 'rgba(82,183,136,0.3)', letterSpacing: 4 },
  timeModalHint: { fontSize: 12, color: 'rgba(245,240,232,0.35)', textAlign: 'center' },
  timeModalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  timeModalCancel: { flex: 1, paddingVertical: 13, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center' },
  timeModalCancelText: { color: 'rgba(245,240,232,0.6)', fontSize: 15, fontWeight: '500' },
  timeModalConfirm: { flex: 2, paddingVertical: 13, borderRadius: 14, backgroundColor: '#52B788', alignItems: 'center' },
  timeModalConfirmText: { color: '#0F1F16', fontSize: 15, fontWeight: '700' },

  // Update routes button
  updateRoutesBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(82,183,136,0.1)', marginBottom: 10, borderWidth: 1, borderColor: 'rgba(82,183,136,0.2)' },
  updateRoutesBtnText: { fontSize: 11, color: '#52B788', fontWeight: '600' },
});
