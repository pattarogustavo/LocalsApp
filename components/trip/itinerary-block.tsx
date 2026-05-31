import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Linking, ActivityIndicator, Modal, Alert, TextInput, FlatList,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { Swipeable } from 'react-native-gesture-handler';
import { useTripsStore } from '@/store/trips';
import { trpc } from '@/lib/trpc';
import type { Trip, DayItinerary, TravelPace, Accommodation, Place, ItineraryStop } from '@/types/voyage';

// ─── Category helpers ─────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  attraction: 'camera-outline',
  restaurant: 'restaurant-outline',
  cafe: 'cafe-outline',
  museum: 'book-outline',
  hidden_gem: 'diamond-outline',
  hotel: 'bed-outline',
  other: 'location-outline',
};

const CATEGORY_COLORS: Record<string, string> = {
  attraction: '#52B788',
  restaurant: '#E07B5A',
  cafe: '#C4A35A',
  museum: '#7B9FD4',
  hidden_gem: '#B88BF5',
  hotel: '#7B9FD4',
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

// ─── Hotel helper ───────────────────────────────────────────────────────────

/**
 * Returns the active accommodation for a given date (YYYY-MM-DD).
 * An accommodation is active if checkIn <= date <= checkOut.
 */
function getHotelForDay(date: string, accommodations: Accommodation[]): Accommodation | null {
  if (!date || !accommodations?.length) return null;
  const d = date.split('T')[0];
  for (const acc of accommodations) {
    const ci = acc.checkIn?.split('T')[0];
    const co = acc.checkOut?.split('T')[0];
    if (!ci || !co) continue;
    if (d >= ci && d <= co && acc.address) return acc;
  }
  return null;
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
  prevStop,
  cityTransportMode,
  onDelete,
  onTimeChange,
  onMove,
  isDragging,
  dragHandleProps,
}: {
  stop: StopLike;
  isLast: boolean;
  prevStop?: StopLike | null;
  cityTransportMode?: string;
  onDelete?: () => void;
  onTimeChange?: (t: string) => void;
  onMove?: () => void;
  isDragging?: boolean;
  dragHandleProps?: any;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingTime, setEditingTime] = useState(false);
  const [timeInput, setTimeInput] = useState(stop.time || '');
  const swipeableRef = useRef<Swipeable>(null);

  const name = stop.placeName || stop.activity || '';
  const desc = stop.description || stop.tip || '';
  const cat  = stop.placeCategory || 'other';
  const catIcon  = CATEGORY_ICONS[cat] || 'location-outline';
  const catColor = CATEGORY_COLORS[cat] || '#52B788';

  const openMaps = () => {
    const destCoord = stop.lat && stop.lng ? `${stop.lat},${stop.lng}` : stop.address;
    if (!destCoord) return;
    const travelmode = toDirectionsMode(cityTransportMode);
    const originCoord = prevStop
      ? (prevStop.lat && prevStop.lng ? `${prevStop.lat},${prevStop.lng}` : prevStop.address)
      : null;
    if (originCoord) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originCoord)}&destination=${encodeURIComponent(destCoord)}&travelmode=${travelmode}`
      );
    } else {
      Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(destCoord)}`);
    }
  };

  const renderRightActions = () => (
    <TouchableOpacity
      onPress={() => {
        swipeableRef.current?.close();
        onDelete?.();
      }}
      style={styles.swipeDeleteAction}
    >
      <Ionicons name="trash-outline" size={20} color="#fff" />
      <Text style={styles.swipeDeleteText}>Excluir</Text>
    </TouchableOpacity>
  );

  const stopContent = (
    <View style={styles.stopAnimatedBg}>
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        style={styles.stopRow}
        activeOpacity={0.75}
      >
        {/* Drag handle — six dots on the far left, long-press to drag */}
        {dragHandleProps ? (
          <TouchableOpacity
            style={styles.dragHandle}
            onLongPress={dragHandleProps.onLongPress}
            delayLongPress={300}
            activeOpacity={0.6}
          >
            <View style={styles.dragDot} />
            <View style={styles.dragDot} />
            <View style={styles.dragDot} />
            <View style={styles.dragDot} />
            <View style={styles.dragDot} />
            <View style={styles.dragDot} />
          </TouchableOpacity>
        ) : null}
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
          {/* Drag handle — shown on right side */}
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
                {onDelete ? (
                  <TouchableOpacity onPress={onDelete} style={styles.stopActionBtn}>
                    <Ionicons name="trash-outline" size={13} color="#E74C3C" />
                    <Text style={[styles.stopActionText, { color: '#E74C3C' }]}>Remover</Text>
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

  // Virtual stops (hotel) are not swipeable
  if (!stop.id || !onDelete) {
    return stopContent;
  }

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      rightThreshold={40}
      overshootRight={false}
      friction={2}
    >
      {stopContent}
    </Swipeable>
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
  totalDays,
  cityTransportMode,
  accommodations,
  onGoToPlaces,
  startDate,
}: {
  day: DayItinerary | undefined;
  dayIndex: number;
  tripId: string;
  totalDays: number;
  cityTransportMode?: string;
  accommodations?: Accommodation[];
  onGoToPlaces: () => void;
  startDate: string;
}) {
  const { removeItineraryStop, updateItineraryStop, moveItineraryStop, reorderItineraryStops, removeItineraryStopAndPlace } = useTripsStore();
  const batchRoute = trpc.directions.batchRoute.useMutation();
  const [updatingRoutes, setUpdatingRoutes] = useState(false);
  const [stopToMove, setStopToMove] = useState<StopLike | null>(null);
  const [showMoveModal, setShowMoveModal] = useState(false);
  // Support both new stops[] format and legacy morning/afternoon/evening
  const rawStops: StopLike[] = day
    ? ((day as any).stops && (day as any).stops.length > 0
        ? (day as any).stops
        : [
            day.morning   ? { id: 'm', time: day.morning.time   || '09:00', placeName: day.morning.activity,   placeCategory: 'attraction', description: day.morning.tip   } : null,
            day.afternoon ? { id: 'a', time: day.afternoon.time || '14:00', placeName: day.afternoon.activity, placeCategory: 'restaurant', description: day.afternoon.tip } : null,
            day.evening   ? { id: 'e', time: day.evening.time   || '19:00', placeName: day.evening.activity,   placeCategory: 'other',      description: day.evening.tip   } : null,
          ].filter(Boolean) as StopLike[])
    : [];

  // Inject hotel as a virtual first stop if there's an active accommodation for this day
  const dayDate = day?.date || '';
  const hotelForDay = getHotelForDay(dayDate, accommodations || []);
  const hotelStop: StopLike | null = hotelForDay ? {
    id: undefined, // virtual — not persisted
    time: '',
    placeName: hotelForDay.name || 'Hospedagem',
    placeCategory: 'hotel' as any,
    description: hotelForDay.address,
    address: hotelForDay.address,
  } : null;

  // Full stops list: hotel (virtual) + real stops
  const stops: StopLike[] = hotelStop ? [hotelStop, ...rawStops] : rawStops;

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
    // Find the placeId to also remove from Places tab
    const placeId = (stop as any).placeId as string | undefined;
    Alert.alert(
      'Remover parada',
      `Deseja remover "${stop.placeName || stop.activity || 'esta parada'}" do roteiro e da aba Lugares?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover',
          style: 'destructive',
          onPress: () => removeItineraryStopAndPlace(tripId, dayIndex, stop.id!, placeId),
        },
      ]
    );
  };

  const handleTimeChange = (stop: StopLike, newTime: string) => {
    if (!stop.id) return;
    updateItineraryStop(tripId, dayIndex, stop.id, { time: newTime });
  };

  const handleMoveStop = async (toDayIndex: number) => {
    if (!stopToMove?.id) return;
    setShowMoveModal(false);
    await moveItineraryStop(tripId, dayIndex, toDayIndex, stopToMove.id);
    setStopToMove(null);
    // Recalculate routes for both days after a brief delay
    setTimeout(() => handleUpdateRoutes(), 300);
  };

  const handleUpdateRoutes = async () => {
    // Use all stops with location (including virtual hotel stop as origin)
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
      // Note: hotel stop has no id (virtual), so we skip it but still consume its pair result
      let pairIdx = 0;
      for (let i = 0; i < stopsWithLocation.length - 1; i++) {
        const s = stopsWithLocation[i];
        const r = result.results[pairIdx];
        pairIdx++;
        if (!s.id) continue; // virtual hotel stop — skip persisting but still advance pairIdx
        if (r?.found) {
          updateItineraryStop(tripId, dayIndex, s.id, {
            travelTimeToNext: r.durationText,
            travelModeToNext: mode as any,
            mapsUrlToNext: r.mapsUrl,
          });
        }
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
      {/* Hotel stop (virtual, not draggable) */}
      {hotelStop && (
        <StopItem
          stop={hotelStop}
          isLast={rawStops.length === 0}
          prevStop={null}
          cityTransportMode={cityTransportMode}
        />
      )}

      {/* Real stops — draggable list */}
      {rawStops.length > 0 && (
        <DraggableFlatList
            data={rawStops as ItineraryStop[]}
            keyExtractor={(item) => item.id || `stop-${Math.random()}`}
            onDragEnd={({ data }) => {
              reorderItineraryStops(tripId, dayIndex, data);
              setTimeout(() => handleUpdateRoutes(), 300);
            }}
            scrollEnabled={false}
            activationDistance={10}
            renderItem={({ item: s, getIndex, drag, isActive }: RenderItemParams<ItineraryStop>) => {
              const i = (getIndex() ?? 0) + (hotelStop ? 1 : 0);
              const prevS = i > 0 ? stops[i - 1] : null;
              return (
                <ScaleDecorator activeScale={1.02}>
                  <StopItem
                    stop={s}
                    isLast={!hotelStop ? (getIndex() ?? 0) === rawStops.length - 1 : (getIndex() ?? 0) === rawStops.length - 1}
                    prevStop={prevS}
                    cityTransportMode={cityTransportMode}
                    onDelete={s.id ? () => handleDeleteStop(s) : undefined}
                    onTimeChange={s.id ? (t) => handleTimeChange(s, t) : undefined}
                    onMove={s.id ? () => { setStopToMove(s); setShowMoveModal(true); } : undefined}
                    isDragging={isActive}
                    dragHandleProps={{ onLongPress: drag }}
                  />
                </ScaleDecorator>
              );
            }}
          />
      )}
      {day?.tips ? (
        <View style={styles.dayTip}>
          <Ionicons name="bulb-outline" size={14} color="#C4A35A" />
          <Text style={styles.dayTipText}>{day.tips}</Text>
        </View>
      ) : null}

      {/* Move stop between days modal */}
      <Modal visible={showMoveModal} transparent animationType="fade" onRequestClose={() => setShowMoveModal(false)}>
        <View style={styles.paceModalOverlay}>
          <View style={styles.paceModalCard}>
            <Text style={styles.paceModalTitle}>Mover para qual dia?</Text>
            <Text style={styles.paceModalSubtitle}>
              {stopToMove ? `"${stopToMove.placeName || stopToMove.activity || 'Parada'}"` : ''}
            </Text>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
              {Array.from({ length: totalDays }, (_, i) => {
                if (i === dayIndex) return null;
                const base = new Date(startDate);
                base.setDate(base.getDate() + i);
                const label = `Dia ${i + 1} — ${DAY_NAMES[base.getDay()]}, ${base.getDate()} ${MONTH_NAMES[base.getMonth()]}`;
                return (
                  <TouchableOpacity
                    key={i}
                    onPress={() => handleMoveStop(i)}
                    style={[styles.paceModalOption, { marginBottom: 8 }]}
                  >
                    <Ionicons name="calendar-outline" size={16} color="#52B788" />
                    <Text style={styles.paceModalOptionLabel}>{label}</Text>
                    <Ionicons name="chevron-forward" size={16} color="rgba(245,240,232,0.3)" />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              onPress={() => { setShowMoveModal(false); setStopToMove(null); }}
              style={[styles.paceModalBtn, { backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 8 }]}
            >
              <Text style={{ color: 'rgba(245,240,232,0.7)', fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface ItineraryBlockProps {
  trip: Trip;
  onGoToPlaces: () => void;
  cityTransportMode?: string;
}

// ─── Unscheduled Place Row ──────────────────────────────────────────────────────

function UnscheduledPlaceRow({ place, onAdd }: { place: Place; onAdd: () => void }) {
  const cat = place.category || 'other';
  const catIcon = CATEGORY_ICONS[cat] || 'location-outline';
  const catColor = CATEGORY_COLORS[cat] || '#52B788';
  const catLabels: Record<string, string> = {
    attraction: 'Atração', restaurant: 'Restaurante', cafe: 'Café',
    museum: 'Museu', hidden_gem: 'Joia oculta', hotel: 'Hotel', other: 'Outro',
  };
  return (
    <View style={styles.unscheduledRow}>
      <View style={[styles.unscheduledIcon, { backgroundColor: `${catColor}22` }]}>
        <Ionicons name={catIcon as any} size={15} color={catColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.unscheduledName} numberOfLines={1}>{place.name}</Text>
        <Text style={styles.unscheduledCat}>{catLabels[cat] || cat}</Text>
      </View>
      <TouchableOpacity onPress={onAdd} style={styles.unscheduledAddBtn}>
        <Ionicons name="add" size={18} color="#52B788" />
      </TouchableOpacity>
    </View>
  );
}

// ─── Travel style options for profile questions ───────────────────────────────
const TRAVEL_STYLES = [
  { id: 'cultura', label: 'Cultura', icon: 'library-outline' },
  { id: 'gastronomia', label: 'Gastronomia', icon: 'restaurant-outline' },
  { id: 'natureza', label: 'Natureza', icon: 'leaf-outline' },
  { id: 'aventura', label: 'Aventura', icon: 'bicycle-outline' },
  { id: 'compras', label: 'Compras', icon: 'bag-outline' },
  { id: 'relaxamento', label: 'Relaxamento', icon: 'sunny-outline' },
  { id: 'vida_noturna', label: 'Vida noturna', icon: 'moon-outline' },
  { id: 'arte', label: 'Arte', icon: 'color-palette-outline' },
];

const BUDGET_OPTIONS = [
  { id: 'econômico', label: 'Econômico', desc: 'Hostels, street food, transporte público', icon: 'wallet-outline' },
  { id: 'moderado', label: 'Moderado', desc: 'Hotéis 3★, restaurantes locais', icon: 'card-outline' },
  { id: 'luxo', label: 'Luxo', desc: 'Hotéis 5★, restaurantes premiados', icon: 'diamond-outline' },
];

const PROFILE_OPTIONS = [
  { id: 'casal', label: 'Casal', icon: 'heart-outline' },
  { id: 'família', label: 'Família', icon: 'people-outline' },
  { id: 'solo', label: 'Solo', icon: 'person-outline' },
  { id: 'amigos', label: 'Amigos', icon: 'happy-outline' },
  { id: 'negócios', label: 'Negócios', icon: 'briefcase-outline' },
];

export function ItineraryBlock({ trip, onGoToPlaces, cityTransportMode }: ItineraryBlockProps) {
  const { setItinerary, addPlace, addItineraryStop } = useTripsStore();
  const [selectedDay, setSelectedDay] = useState(0);
  const [pace, setPace] = useState<TravelPace>('moderado');
  const [generating, setGenerating] = useState(false);

  // Three-mode creation modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Profile questions modal (for AI from scratch)
  const [showProfileModal, setShowProfileModal] = useState(false);
  // Manual mode: show inline place picker
  const [showManualPicker, setShowManualPicker] = useState(false);
  // Manual mode: selected day for each place (placeId -> dayIndex)
  const [manualPickerDays, setManualPickerDays] = useState<Record<string, number>>({});
  // Profile state
  const [profileTravelStyles, setProfileTravelStyles] = useState<string[]>([]);
  const [profileBudget, setProfileBudget] = useState<'econômico' | 'moderado' | 'luxo'>('moderado');
  const [profileTravelProfile, setProfileTravelProfile] = useState<'casal' | 'família' | 'solo' | 'amigos' | 'negócios'>('casal');
  const [profileInterests, setProfileInterests] = useState('');
  const [profileWakeUp, setProfileWakeUp] = useState('08:00');

  const generateItinerary = trpc.ai.generateItinerary.useMutation();
  const generateFromScratch = trpc.ai.generateFromScratch.useMutation();

  const hasItinerary = trip.itinerary && trip.itinerary.length > 0;
  const totalDays = trip.totalDays || 1;

  // Merge real itinerary days with empty placeholders
  const displayDays: (DayItinerary | undefined)[] = Array.from({ length: totalDays }, (_, i) => {
    return trip.itinerary?.[i] ?? undefined;
  });

  // Compute unscheduled places: places saved in the trip but not yet in any itinerary stop
  const scheduledPlaceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const day of trip.itinerary || []) {
      for (const stop of (day as any).stops || []) {
        if (stop.placeId) ids.add(stop.placeId);
      }
    }
    return ids;
  }, [trip.itinerary]);

  const unscheduledPlaces = useMemo(
    () => trip.places.filter((p) => !scheduledPlaceIds.has(p.id)),
    [trip.places, scheduledPlaceIds]
  );

  const handleGenerateFromPlaces = async () => {
    // If no places selected, redirect to Lugares tab
    if (trip.places.length === 0) {
      setShowCreateModal(false);
      Alert.alert(
        'Nenhum lugar selecionado',
        'Adicione lugares na aba Lugares antes de criar o roteiro com IA.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Ir para Lugares', onPress: () => onGoToPlaces() },
        ]
      );
      return;
    }
    setShowCreateModal(false);
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
        // Patch placeId in stops to reference the local place by name match
        // Also add any AI-generated stops that don't match an existing place to the Places tab
        const patchedDays = await Promise.all((result.days as any[]).map(async (day: any) => ({
          ...day,
          stops: await Promise.all((day.stops || []).map(async (stop: any) => {
            // Try exact name match first
            let matchedPlace = trip.places.find(
              (p) => p.name.toLowerCase() === (stop.placeName || '').toLowerCase()
            );
            // If no match, try partial match
            if (!matchedPlace) {
              matchedPlace = trip.places.find(
                (p) => (stop.placeName || '').toLowerCase().includes(p.name.toLowerCase()) ||
                        p.name.toLowerCase().includes((stop.placeName || '').toLowerCase())
              );
            }
            if (matchedPlace) {
              return { ...stop, placeId: matchedPlace.id };
            }
            // No match: add this place to the Places tab so delete cascade works
            const newPlaceId = `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const destId = trip.destinations[0]?.id || '';
            await addPlace(trip.id, {
              id: newPlaceId,
              name: stop.placeName || stop.activity || 'Lugar',
              category: stop.placeCategory || 'attraction',
              destinationId: destId,
              address: stop.address,
              hours: stop.hours,
              description: stop.description,
              lat: stop.lat,
              lng: stop.lng,
              addedByAI: true,
            });
            return { ...stop, placeId: newPlaceId };
          })),
        })));
        await setItinerary(trip.id, patchedDays);
        setSelectedDay(0);
      }
    } catch (e) {
      console.error('Itinerary generation error:', e);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateFromScratch = async () => {
    setShowProfileModal(false);
    setGenerating(true);
    try {
      const result = await generateFromScratch.mutateAsync({
        tripId: trip.id,
        startDate: trip.startDate,
        totalDays,
        destinations: trip.destinations.map((d) => ({ name: d.name, country: d.country, days: d.days })),
        cityTransportMode: cityTransportMode || trip.cityTransportMode,
        profile: {
          travelStyle: profileTravelStyles.length > 0 ? profileTravelStyles : ['cultura', 'gastronomia'],
          budget: profileBudget,
          pace,
          travelProfile: profileTravelProfile,
          interests: profileInterests || undefined,
          wakeUpTime: profileWakeUp,
        },
      });
      if (result?.days && result.days.length > 0) {
        // Build a map of AI place id -> local place id for cross-referencing
        const placeIdMap: Record<string, string> = {};
        if (result.suggestedPlaces && result.suggestedPlaces.length > 0) {
          for (const sp of result.suggestedPlaces) {
            const localId = sp.id && sp.id.length > 4 ? sp.id : `sp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            placeIdMap[sp.id || sp.name] = localId;
            const destId = trip.destinations.find(
              (d) => d.name.toLowerCase() === (sp.destinationName || '').toLowerCase()
            )?.id || trip.destinations[0]?.id || '';
            await addPlace(trip.id, {
              id: localId,
              name: sp.name,
              category: sp.category || 'attraction',
              destinationId: destId,
              address: sp.address,
              hours: sp.hours,
              description: sp.description,
              lat: sp.lat,
              lng: sp.lng,
              addedByAI: true,
            });
          }
        }
        // Patch placeId in stops to reference the local place id
        const patchedDays = result.days.map((day: any) => ({
          ...day,
          stops: (day.stops || []).map((stop: any) => ({
            ...stop,
            placeId: stop.placeId ? (placeIdMap[stop.placeId] || stop.placeId) : undefined,
          })),
        }));
        await setItinerary(trip.id, patchedDays);
        setSelectedDay(0);
      }
    } catch (e) {
      console.error('Generate from scratch error:', e);
    } finally {
      setGenerating(false);
    }
  };

  const toggleTravelStyle = (id: string) => {
    setProfileTravelStyles((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleAddUnscheduledPlace = (place: Place, targetDay?: number) => {
    const dayIdx = targetDay !== undefined ? targetDay : selectedDay;
    // Auto-suggest time: last stop time + 1h30, or 09:00 if no stops
    const dayStops: ItineraryStop[] = (trip.itinerary?.[dayIdx] as any)?.stops || [];
    let suggestedTime = '09:00';
    if (dayStops.length > 0) {
      const lastTime = dayStops[dayStops.length - 1].time || '09:00';
      const [hStr, mStr] = lastTime.split(':');
      const totalMins = parseInt(hStr || '9', 10) * 60 + parseInt(mStr || '0', 10) + 90;
      const h = Math.min(Math.floor(totalMins / 60), 22);
      const m = totalMins % 60;
      suggestedTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    const newStop: ItineraryStop = {
      id: `stop-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      time: suggestedTime,
      placeId: place.id,
      placeName: place.name,
      placeCategory: place.category as any,
      description: place.description,
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      website: place.website,
      hours: place.hours,
    };
    addItineraryStop(trip.id, dayIdx, newStop);
  };

  return (
    <View style={styles.container}>
      {/* Header — no Regerar button */}
      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="calendar-outline" size={15} color="#52B788" />
          <Text style={styles.sectionTitle}>ROTEIRO DIA-A-DIA</Text>
        </View>
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
          totalDays={totalDays}
          startDate={trip.startDate}
          cityTransportMode={cityTransportMode || trip.cityTransportMode}
          accommodations={trip.accommodations}
          onGoToPlaces={onGoToPlaces}
        />

        {/* Create/Edit button — at the BOTTOM of the itinerary content */}
        <TouchableOpacity
          onPress={() => {
            if (hasItinerary) {
              Alert.alert(
                'Recriar roteiro',
                'Isso vai substituir o roteiro atual. Deseja continuar?',
                [
                  { text: 'Cancelar', style: 'cancel' },
                  { text: 'Continuar', onPress: () => setShowCreateModal(true) },
                ]
              );
            } else {
              setShowCreateModal(true);
            }
          }}
          style={[styles.createItineraryBtn, { marginTop: 16, marginBottom: 0 }]}
          disabled={generating}
        >
          {generating ? (
            <>
              <ActivityIndicator size="small" color="#0F1F16" />
              <Text style={styles.createItineraryBtnText}>Criando roteiro...</Text>
            </>
          ) : (
            <>
              <Ionicons name="sparkles" size={15} color="#0F1F16" />
              <Text style={styles.createItineraryBtnText}>
                {hasItinerary ? 'Editar / Recriar Roteiro' : 'Criar Roteiro'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Unscheduled places panel */}
      {unscheduledPlaces.length > 0 && (
        <View style={styles.unscheduledPanel}>
          <View style={styles.unscheduledHeader}>
            <Ionicons name="location-outline" size={14} color="#C4A35A" />
            <Text style={styles.unscheduledTitle}>LUGARES NÃO AGENDADOS</Text>
            <Text style={styles.unscheduledCount}>{unscheduledPlaces.length}</Text>
          </View>
          <Text style={styles.unscheduledSubtitle}>Toque em + para adicionar ao dia selecionado</Text>
          {unscheduledPlaces.map((place) => (
            <UnscheduledPlaceRow
              key={place.id}
              place={place}
              onAdd={() => handleAddUnscheduledPlace(place)}
            />
          ))}
        </View>
      )}

      {/* ── Three-mode creation modal ── */}
      <Modal visible={showCreateModal} transparent animationType="fade" onRequestClose={() => setShowCreateModal(false)}>
        <View style={styles.paceModalOverlay}>
          <View style={styles.paceModalCard}>
            {/* Header with close button */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
              <Text style={styles.paceModalTitle}>Como criar o roteiro?</Text>
              <TouchableOpacity
                onPress={() => setShowCreateModal(false)}
                style={{ padding: 4, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)' }}
              >
                <Ionicons name="close" size={18} color="rgba(245,240,232,0.7)" />
              </TouchableOpacity>
            </View>
            <Text style={styles.paceModalSubtitle}>Escolha como a IA vai montar seu dia-a-dia</Text>

            {/* Pace selector (shared by all AI modes) */}
            <View style={{ marginBottom: 4 }}>
              <Text style={styles.unscheduledSubtitle}>Ritmo da viagem</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                {PACE_OPTIONS.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => setPace(p.id)}
                    style={[
                      styles.paceMiniChip,
                      pace === p.id && styles.paceMiniChipActive,
                    ]}
                  >
                    <Text style={[styles.paceMiniChipText, pace === p.id && { color: '#0F1F16' }]}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Mode options */}
            <TouchableOpacity
              onPress={() => { setShowCreateModal(false); setShowProfileModal(true); }}
              style={styles.createModeOption}
            >
              <View style={[styles.createModeIcon, { backgroundColor: 'rgba(82,183,136,0.15)' }]}>
                <Ionicons name="sparkles" size={20} color="#52B788" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.createModeLabel}>IA do zero</Text>
                <Text style={styles.createModeDesc}>A IA cria tudo com base no seu perfil de viajante</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="rgba(245,240,232,0.3)" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleGenerateFromPlaces}
              style={styles.createModeOption}
            >
              <View style={[styles.createModeIcon, { backgroundColor: 'rgba(196,163,90,0.15)' }]}>
                <Ionicons name="map" size={20} color="#C4A35A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.createModeLabel}>IA com meus lugares</Text>
                <Text style={styles.createModeDesc}>
                  {trip.places.length > 0
                    ? `Usa seus ${trip.places.length} lugares salvos como base`
                    : 'Adicione lugares na aba Lugares primeiro'}
                </Text>
              </View>
              {trip.places.length === 0 ? (
                <Ionicons name="lock-closed-outline" size={16} color="rgba(245,240,232,0.3)" />
              ) : (
                <Ionicons name="chevron-forward" size={16} color="rgba(245,240,232,0.3)" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setShowCreateModal(false);
                if (trip.places.length > 0) {
                  // Has saved places — open inline picker
                  setShowManualPicker(true);
                } else {
                  // No places — redirect to Lugares tab
                  onGoToPlaces();
                }
              }}
              style={styles.createModeOption}
            >
              <View style={[styles.createModeIcon, { backgroundColor: 'rgba(123,159,212,0.15)' }]}>
                <Ionicons name="list" size={20} color="#7B9FD4" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.createModeLabel}>Montar manualmente</Text>
                <Text style={styles.createModeDesc}>
                  {trip.places.length > 0
                    ? `Adicione seus ${trip.places.length} lugares salvos ao roteiro`
                    : 'Você será direcionado para a aba Lugares'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="rgba(245,240,232,0.3)" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowCreateModal(false)}
              style={[styles.paceModalBtn, { backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 4 }]}
            >
              <Text style={{ color: 'rgba(245,240,232,0.7)', fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Profile questions modal (AI from scratch) ── */}
      <Modal visible={showProfileModal} transparent animationType="slide" onRequestClose={() => setShowProfileModal(false)}>
        <View style={[styles.paceModalOverlay, { justifyContent: 'flex-end', padding: 0 }]}>
          <View style={[styles.paceModalCard, { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '90%' }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.paceModalTitle}>Seu perfil de viajante</Text>
              <Text style={styles.paceModalSubtitle}>A IA vai personalizar o roteiro com base nas suas respostas</Text>

              {/* Travel styles */}
              <Text style={styles.profileSectionLabel}>Estilo de viagem (escolha vários)</Text>
              <View style={styles.profileChipRow}>
                {TRAVEL_STYLES.map((s) => {
                  const active = profileTravelStyles.includes(s.id);
                  return (
                    <TouchableOpacity
                      key={s.id}
                      onPress={() => toggleTravelStyle(s.id)}
                      style={[styles.profileChip, active && styles.profileChipActive]}
                    >
                      <Ionicons name={s.icon as any} size={13} color={active ? '#0F1F16' : '#52B788'} />
                      <Text style={[styles.profileChipText, active && { color: '#0F1F16' }]}>{s.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Budget */}
              <Text style={styles.profileSectionLabel}>Orçamento</Text>
              {BUDGET_OPTIONS.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  onPress={() => setProfileBudget(b.id as any)}
                  style={[styles.paceModalOption, profileBudget === b.id && styles.paceModalOptionActive, { marginBottom: 8 }]}
                >
                  <Ionicons name={b.icon as any} size={18} color={profileBudget === b.id ? '#0F1F16' : '#52B788'} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.paceModalOptionLabel, profileBudget === b.id && { color: '#0F1F16' }]}>{b.label}</Text>
                    <Text style={[styles.paceModalOptionDesc, profileBudget === b.id && { color: 'rgba(15,31,22,0.7)' }]}>{b.desc}</Text>
                  </View>
                  {profileBudget === b.id && <Ionicons name="checkmark" size={18} color="#0F1F16" />}
                </TouchableOpacity>
              ))}

              {/* Travel profile */}
              <Text style={styles.profileSectionLabel}>Tipo de viagem</Text>
              <View style={styles.profileChipRow}>
                {PROFILE_OPTIONS.map((p) => {
                  const active = profileTravelProfile === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => setProfileTravelProfile(p.id as any)}
                      style={[styles.profileChip, active && styles.profileChipActive]}
                    >
                      <Ionicons name={p.icon as any} size={13} color={active ? '#0F1F16' : '#52B788'} />
                      <Text style={[styles.profileChipText, active && { color: '#0F1F16' }]}>{p.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Pace */}
              <Text style={styles.profileSectionLabel}>Ritmo da viagem</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {PACE_OPTIONS.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => setPace(p.id)}
                    style={[styles.paceMiniChip, { flex: 1 }, pace === p.id && styles.paceMiniChipActive]}
                  >
                    <Ionicons name={p.icon as any} size={14} color={pace === p.id ? '#0F1F16' : '#52B788'} />
                    <Text style={[styles.paceMiniChipText, pace === p.id && { color: '#0F1F16' }]}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Wake up time */}
              <Text style={styles.profileSectionLabel}>Horário de acordar</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {['07:00', '08:00', '09:00', '10:00'].map((t) => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setProfileWakeUp(t)}
                    style={[styles.paceMiniChip, profileWakeUp === t && styles.paceMiniChipActive]}
                  >
                    <Text style={[styles.paceMiniChipText, profileWakeUp === t && { color: '#0F1F16' }]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Interests */}
              <Text style={styles.profileSectionLabel}>Interesses específicos (opcional)</Text>
              <TextInput
                value={profileInterests}
                onChangeText={setProfileInterests}
                placeholder="Ex: vinhos, arquitetura modernista, praias desertas..."
                placeholderTextColor="rgba(245,240,232,0.25)"
                style={styles.profileTextInput}
                multiline
                numberOfLines={2}
                returnKeyType="done"
              />

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 8 }}>
                <TouchableOpacity
                  onPress={() => setShowProfileModal(false)}
                  style={[styles.paceModalBtn, { backgroundColor: 'rgba(255,255,255,0.08)', flex: 1 }]}
                >
                  <Text style={{ color: 'rgba(245,240,232,0.7)', fontWeight: '600' }}>Voltar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleGenerateFromScratch}
                  style={[styles.paceModalBtn, { backgroundColor: '#52B788', flex: 1.5 }]}
                  disabled={generating}
                >
                  <Ionicons name="sparkles-outline" size={15} color="#0F1F16" />
                  <Text style={{ color: '#0F1F16', fontWeight: '700' }}>Criar Roteiro</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Manual place picker modal ── */}
      <Modal visible={showManualPicker} transparent animationType="slide" onRequestClose={() => setShowManualPicker(false)}>
        <View style={[styles.paceModalOverlay, { justifyContent: 'flex-end', padding: 0 }]}>
          <View style={[styles.paceModalCard, { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '85%' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={styles.paceModalTitle}>Adicionar ao Dia {selectedDay + 1}</Text>
              <TouchableOpacity onPress={() => setShowManualPicker(false)}>
                <Ionicons name="close" size={22} color="rgba(245,240,232,0.6)" />
              </TouchableOpacity>
            </View>
            <Text style={styles.paceModalSubtitle}>
              Toque em + para adicionar o lugar ao dia selecionado
            </Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: 8 }}>
              {trip.places.length === 0 ? (
                <Text style={[styles.paceModalSubtitle, { textAlign: 'center', marginTop: 24 }]}>
                  Nenhum lugar salvo. Adicione lugares na aba Lugares primeiro.
                </Text>
              ) : (
                trip.places.map((place) => {
                  const alreadyScheduled = scheduledPlaceIds.has(place.id);
                  const cat = place.category || 'other';
                  const catIcon = CATEGORY_ICONS[cat] || 'location-outline';
                  const catColor = CATEGORY_COLORS[cat] || '#52B788';
                  const pickerDay = manualPickerDays[place.id] ?? 0;
                  return (
                    <View key={place.id} style={[styles.manualPickerRow, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
                      {/* Place info row */}
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={[styles.stopIconBg, { backgroundColor: `${catColor}22`, marginRight: 10 }]}>
                          <Ionicons name={catIcon as any} size={15} color={catColor} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.stopName}>{place.name}</Text>
                          {place.address ? <Text style={styles.stopDesc} numberOfLines={1}>{place.address}</Text> : null}
                        </View>
                        {alreadyScheduled && (
                          <View style={styles.manualPickerScheduled}>
                            <Ionicons name="checkmark-circle" size={16} color="#52B788" />
                            <Text style={{ fontSize: 11, color: '#52B788', marginLeft: 3 }}>Agendado</Text>
                          </View>
                        )}
                      </View>
                      {/* Day selector + add button */}
                      {!alreadyScheduled && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 6 }}>
                            {Array.from({ length: totalDays }, (_, di) => {
                              const base = new Date(trip.startDate);
                              base.setDate(base.getDate() + di);
                              const isSelected = pickerDay === di;
                              return (
                                <TouchableOpacity
                                  key={di}
                                  onPress={() => setManualPickerDays((prev) => ({ ...prev, [place.id]: di }))}
                                  style={[
                                    styles.manualDayChip,
                                    isSelected && styles.manualDayChipActive,
                                  ]}
                                >
                                  <Text style={[styles.manualDayChipText, isSelected && { color: '#0F1F16' }]}>
                                    Dia {di + 1}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </ScrollView>
                          <TouchableOpacity
                            onPress={() => { handleAddUnscheduledPlace(place, pickerDay); }}
                            style={styles.unscheduledAddBtn}
                          >
                            <Ionicons name="add" size={18} color="#0F1F16" />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
              <View style={{ height: 24 }} />
            </ScrollView>
            <TouchableOpacity
              onPress={() => setShowManualPicker(false)}
              style={[styles.paceModalBtn, { backgroundColor: '#52B788', marginTop: 8 }]}
            >
              <Text style={{ color: '#0F1F16', fontWeight: '700' }}>Concluído</Text>
            </TouchableOpacity>
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
  stopAnimatedBg: { backgroundColor: '#1A2E22' }, // opaque so swipe-delete bg doesn't show through
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

  // Create mode options
  createModeOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: 8 },
  createModeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  createModeLabel: { fontSize: 15, fontWeight: '700', color: '#F5F0E8', marginBottom: 2 },
  createModeDesc: { fontSize: 12, color: 'rgba(245,240,232,0.5)', lineHeight: 16 },

  // Pace mini chips (for create modal)
  paceMiniChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center' },
  paceMiniChipActive: { backgroundColor: '#52B788' },
  paceMiniChipText: { fontSize: 12, fontWeight: '600', color: '#52B788' },

  // Profile questions
  profileSectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: 'rgba(245,240,232,0.5)', marginTop: 12, marginBottom: 8 },
  profileChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  profileChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.06)' },
  profileChipActive: { backgroundColor: '#52B788' },
  profileChipText: { fontSize: 13, fontWeight: '600', color: '#52B788' },
  profileTextInput: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 12, fontSize: 14, color: '#F5F0E8', borderWidth: 1, borderColor: 'rgba(82,183,136,0.2)', lineHeight: 20, minHeight: 64 },

  // Manual picker
  manualDayChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(82,183,136,0.2)' },
  manualDayChipActive: { backgroundColor: '#52B788', borderColor: '#52B788' },
  manualDayChipText: { fontSize: 12, fontWeight: '600', color: 'rgba(245,240,232,0.7)' },
  manualPickerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(245,240,232,0.06)' },
  manualPickerScheduled: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(82,183,136,0.1)' },

  // Drag handle
  dragHandle: { width: 20, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, flexWrap: 'wrap', flexDirection: 'row', gap: 3, marginRight: 2 },
  dragDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(245,240,232,0.25)' },

  // Swipe-to-delete
  swipeDeleteAction: { backgroundColor: '#E74C3C', alignItems: 'center', justifyContent: 'center', width: 80, borderRadius: 12, gap: 4 },
  swipeDeleteText: { fontSize: 11, fontWeight: '700', color: '#fff' },

  // Create itinerary button (below day selector)
  createItineraryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#52B788', borderRadius: 14, paddingVertical: 11, paddingHorizontal: 16, marginBottom: 16 },
  createItineraryBtnText: { fontSize: 14, fontWeight: '700', color: '#0F1F16' },

  // Unscheduled places panel
  unscheduledPanel: { marginTop: 12, backgroundColor: 'rgba(196,163,90,0.06)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(196,163,90,0.15)' },
  unscheduledHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  unscheduledTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: '#C4A35A', flex: 1 },
  unscheduledCount: { fontSize: 11, fontWeight: '700', color: '#C4A35A', backgroundColor: 'rgba(196,163,90,0.2)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  unscheduledSubtitle: { fontSize: 12, color: 'rgba(245,240,232,0.4)', marginBottom: 10, lineHeight: 16 },
  unscheduledRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  unscheduledIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  unscheduledName: { fontSize: 14, fontWeight: '600', color: '#F5F0E8' },
  unscheduledCat: { fontSize: 11, color: 'rgba(245,240,232,0.4)', marginTop: 1 },
  unscheduledAddBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(82,183,136,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(82,183,136,0.3)' },
});
