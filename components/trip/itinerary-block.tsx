import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Linking, ActivityIndicator, Modal, Alert, TextInput, FlatList,
  Platform, Animated, Image, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useTripsStore } from '@/store/trips';
import { trpc } from '@/lib/trpc';
import type { Trip, DayItinerary, TravelPace, Accommodation, Place, ItineraryStop } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';

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
  attraction: '#3D5A2E',
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
  imageUrl?: string;
  placeId?: string;
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
  onEdit,
  animIndex = 0,
  linkedPlace,
}: {
  stop: StopLike;
  isLast: boolean;
  prevStop?: StopLike | null;
  cityTransportMode?: string;
  onDelete?: () => void;
  onTimeChange?: (t: string) => void;
  onMove?: () => void;
  onEdit?: (updates: Partial<ItineraryStop>) => void;
  animIndex?: number;
  linkedPlace?: Place | null;
}) {
  const t = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [editingTime, setEditingTime] = useState(false);
  const [timeInput, setTimeInput] = useState(stop.time || '');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState(stop.placeName || stop.activity || '');
  const [editDesc, setEditDesc] = useState(stop.description || stop.tip || '');
  const [editCat, setEditCat] = useState(stop.placeCategory || 'other');
  const [editNotes, setEditNotes] = useState((stop as any).notes || '');
  const swipeableRef = useRef<Swipeable>(null);

  // Animated entry: fade + slide-in from right
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, delay: animIndex * 80, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 280, delay: animIndex * 80, useNativeDriver: true }),
    ]).start();
  }, []);

  const name = stop.placeName || stop.activity || '';
  const desc = stop.description || stop.tip || '';
  const cat  = stop.placeCategory || 'other';
  const catIcon  = CATEGORY_ICONS[cat] || 'location-outline';
  const catColor = CATEGORY_COLORS[cat] || '#3D5A2E';

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

  // Swipe-left reveals the delete button on the right
  const renderRightActions = () => (
    <TouchableOpacity
      onPress={() => {
        swipeableRef.current?.close();
        onDelete?.();
      }}
      style={styles.swipeDeleteAction}
    >
      <Ionicons name="trash-outline" size={20} color="#fff" />
      <Text style={styles.swipeDeleteText}>{t.common.delete}</Text>
    </TouchableOpacity>
  );

  const stopContent = (
    <Animated.View style={[styles.stopAnimatedBg, { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }]}>
      {/* ── Main row: icon-col | content-col | time+move-col ── */}
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.75}
        style={styles.stopRow}
      >
        {/* Left: icon circle + thin vertical line */}
        <View style={styles.gmIconCol}>
          <View style={[styles.gmIconCircle, { backgroundColor: `${catColor}20`, borderColor: `${catColor}50` }]}>
            <Ionicons name={catIcon as any} size={15} color={catColor} />
          </View>
          {!isLast && <View style={styles.gmVertLine} />}
        </View>

        {/* Center: name + description */}
        <View style={styles.gmContent}>
          <Text style={styles.stopName}>{name}</Text>
          {desc ? (
            <Text style={styles.stopDesc} numberOfLines={expanded ? undefined : 1}>{desc}</Text>
          ) : null}
          {expanded && (
            <View style={styles.stopExpanded}>
              {/* Place photo — from stop or linked Place */}
              {(stop.imageUrl || linkedPlace?.imageUrl) ? (
                <Image
                  source={{ uri: stop.imageUrl || linkedPlace?.imageUrl }}
                  style={styles.stopPhoto}
                  resizeMode="cover"
                />
              ) : null}

              {stop.hours ? (
                <View style={styles.stopDetail}>
                  <Ionicons name="time-outline" size={12} color="rgba(240,235,224,0.9)" />
                  <Text style={styles.stopDetailText}>{stop.hours}</Text>
                </View>
              ) : null}
              {stop.address ? (
                <View style={styles.stopDetail}>
                  <Ionicons name="location-outline" size={12} color="rgba(240,235,224,0.9)" />
                  <Text style={styles.stopDetailText}>{stop.address}</Text>
                </View>
              ) : null}

              {/* Attachments from linked Place */}
              {(linkedPlace?.attachments && linkedPlace.attachments.length > 0) ? (
                <View style={styles.stopAttachList}>
                  {linkedPlace.attachments.map((att) => (
                    <TouchableOpacity
                      key={att.id}
                      style={styles.stopAttachChip}
                      onPress={() => att.url ? Linking.openURL(att.url) : null}
                    >
                      <Ionicons
                        name={att.type === 'pdf' ? 'document-text-outline' : 'image-outline'}
                        size={12}
                        color="rgba(196,163,90,0.8)"
                      />
                      <Text style={styles.stopAttachChipText} numberOfLines={1}>{att.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              <View style={styles.stopActions}>
                {(stop.lat || stop.address) ? (
                  <TouchableOpacity onPress={openMaps} style={styles.stopActionBtn}>
                    <Ionicons name="map-outline" size={13} color="#3D5A2E" />
                    <Text style={styles.stopActionText}>Maps</Text>
                  </TouchableOpacity>
                ) : null}
                {/* Website — from stop or linked Place */}
                {(stop.website || linkedPlace?.website) ? (
                  <TouchableOpacity
                    onPress={() => Linking.openURL(stop.website || linkedPlace?.website || '')}
                    style={styles.stopActionBtn}
                  >
                    <Ionicons name="globe-outline" size={13} color="#3D5A2E" />
                    <Text style={styles.stopActionText}>Site</Text>
                  </TouchableOpacity>
                ) : null}
                {onEdit ? (
                  <TouchableOpacity
                    onPress={(e) => { e.stopPropagation?.(); setShowEditModal(true); }}
                    style={[styles.stopActionBtn, { borderColor: 'rgba(196,163,90,0.4)', backgroundColor: 'rgba(196,163,90,0.1)' }]}
                  >
                    <Ionicons name="pencil-outline" size={13} color="#C4A35A" />
                    <Text style={[styles.stopActionText, { color: '#C4A35A' }]}>{t.common.edit}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}
        </View>

        {/* Right: time (tap to edit) + move button */}
        <View style={styles.gmRightCol}>
          {/* Time — tap to edit */}
          {stop.time ? (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation?.(); setTimeInput(stop.time || ''); setEditingTime(true); }}
              style={styles.gmTimeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.gmTimeText}>{stop.time}</Text>
            </TouchableOpacity>
          ) : null}
          {/* Move button — only for real stops */}
          {onMove ? (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation?.(); onMove(); }}
              style={styles.gmMoveBtn}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="swap-vertical-outline" size={16} color="rgba(240,235,224,0.9)" />
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>

      {/* Time Edit Modal */}
      <Modal visible={editingTime} transparent animationType="fade" onRequestClose={() => setEditingTime(false)}>
        <View style={styles.timeModalOverlay}>
          <View style={styles.timeModalSheet}>
            <Text style={styles.timeModalTitle}>{t.itinerary.stopTime}</Text>
            <TextInput
              style={styles.timeModalInput}
              value={timeInput}
              onChangeText={setTimeInput}
              placeholder="09:30"
              placeholderTextColor="rgba(240,235,224,0.9)"
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
            <Text style={styles.timeModalHint}>{t.itinerary.stopTime}: HH:MM</Text>
            <View style={styles.timeModalActions}>
              <TouchableOpacity style={styles.timeModalCancel} onPress={() => setEditingTime(false)}>
                <Text style={styles.timeModalCancelText}>{t.common.cancel}</Text>
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
                <Text style={styles.timeModalConfirmText}>{t.common.save}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Transit connector to next stop */}
      {!isLast && stop.travelTimeToNext ? (
        <TouchableOpacity
          style={styles.gmTransitRow}
          onPress={() => {
            const url = (stop as any).mapsUrlToNext;
            if (url) Linking.openURL(url);
          }}
          activeOpacity={(stop as any).mapsUrlToNext ? 0.7 : 1}
        >
          {/* Align with the vertical line */}
          <View style={styles.gmTransitIconWrap}>
            <View style={styles.gmTransitIconBg}>
              <Ionicons
                name={travelModeIcon(stop.travelModeToNext) as any}
                size={11}
                color="rgba(240,235,224,0.9)"
              />
            </View>
          </View>
          <Text style={styles.gmTransitText}>{stop.travelTimeToNext}</Text>
          {(stop as any).mapsUrlToNext ? (
            <Ionicons name="open-outline" size={10} color="rgba(82,183,136,0.5)" style={{ marginLeft: 4 }} />
          ) : null}
        </TouchableOpacity>
      ) : null}

      {/* ── Edit Stop Modal ── */}
      {onEdit ? (
        <Modal visible={showEditModal} transparent animationType="slide" onRequestClose={() => setShowEditModal(false)}>
          <KeyboardAvoidingView
            style={{ flex: 1, justifyContent: 'flex-end' }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
          <View style={styles.editStopOverlay}>
            <View style={styles.editStopSheet}>
              {/* Header */}
              <View style={styles.editStopHeader}>
                <Text style={styles.editStopTitle}>{t.itinerary.editStop}</Text>
                <TouchableOpacity onPress={() => setShowEditModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={22} color="rgba(240,235,224,0.9)" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
                {/* Name */}
                <Text style={styles.editStopLabel}>{t.itinerary.stopName}</Text>
                <TextInput
                  style={styles.editStopInput}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder={t.itinerary.stopNamePlaceholder}
                  placeholderTextColor="rgba(240,235,224,0.9)"
                  returnKeyType="next"
                />

                {/* Category */}
                <Text style={styles.editStopLabel}>{t.expenses.category}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {Object.entries(CATEGORY_ICONS).map(([key, icon]) => {
                      const color = CATEGORY_COLORS[key] || '#3D5A2E';
                      const isActive = editCat === key;
                      return (
                        <TouchableOpacity
                          key={key}
                          onPress={() => setEditCat(key)}
                          style={[styles.editCatChip, { borderColor: isActive ? color : 'rgba(255,255,255,0.12)', backgroundColor: isActive ? `${color}20` : 'transparent' }]}
                        >
                          <Ionicons name={icon as any} size={14} color={isActive ? color : 'rgba(240,235,224,0.9)'} />
                          <Text style={[styles.editCatChipText, { color: isActive ? color : 'rgba(240,235,224,0.9)' }]}>
                            {key === 'attraction' ? t.places.categories.attraction : key === 'restaurant' ? t.places.categories.restaurant : key === 'cafe' ? 'Café' : key === 'museum' ? 'Museu' : key === 'hidden_gem' ? 'Joia' : key === 'hotel' ? t.places.categories.hotel : t.places.categories.all}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>

                {/* Description */}
                <Text style={styles.editStopLabel}>{t.places.details.description}</Text>
                <TextInput
                  style={[styles.editStopInput, { height: 72, textAlignVertical: 'top' }]}
                  value={editDesc}
                  onChangeText={setEditDesc}
                  placeholder={t.places.details.description + '...'}
                  placeholderTextColor="rgba(240,235,224,0.9)"
                  multiline
                  numberOfLines={3}
                />

                {/* Notes */}
                <Text style={styles.editStopLabel}>{t.itinerary.stopNotes}</Text>
                <TextInput
                  style={[styles.editStopInput, { height: 72, textAlignVertical: 'top' }]}
                  value={editNotes}
                  onChangeText={setEditNotes}
                  placeholder={t.itinerary.stopNotesPlaceholder}
                  placeholderTextColor="rgba(240,235,224,0.9)"
                  multiline
                  numberOfLines={3}
                />
              </ScrollView>

              {/* Actions */}
              <View style={styles.editStopActions}>
                <TouchableOpacity
                  style={styles.editStopCancel}
                  onPress={() => setShowEditModal(false)}
                >
                  <Text style={styles.editStopCancelText}>{t.common.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.editStopSave}
                  onPress={() => {
                    onEdit({
                      placeName: editName.trim() || undefined,
                      placeCategory: editCat as any,
                      description: editDesc.trim() || undefined,
                    });
                    setShowEditModal(false);
                  }}
                >
                  <Ionicons name="checkmark" size={16} color="#F0EBE0" />
                  <Text style={styles.editStopSaveText}>{t.common.save}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}
    </Animated.View>
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
  places,
}: {
  day: DayItinerary | undefined;
  dayIndex: number;
  tripId: string;
  totalDays: number;
  cityTransportMode?: string;
  accommodations?: Accommodation[];
  onGoToPlaces: () => void;
  startDate: string;
  places?: Place[];
}) {
  const t = useTranslation();
  const { removeItineraryStop, updateItineraryStop, moveItineraryStop, reorderItineraryStops, removeItineraryStopAndPlace } = useTripsStore();
  const batchRoute = trpc.directions.batchRoute.useMutation();
  const [updatingRoutes, setUpdatingRoutes] = useState(false);
  const [stopToMove, setStopToMove] = useState<StopLike | null>(null);
  const [showMoveModal, setShowMoveModal] = useState(false);
  // 'position' = move within same day (before/after), 'day' = move to another day
  const [moveMode, setMoveMode] = useState<'position' | 'day'>('position');
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
        <Text style={styles.emptyDayText}>{t.itinerary.noStops}</Text>
        <TouchableOpacity onPress={onGoToPlaces} style={styles.goToPlacesBtn}>
          <Ionicons name="location-outline" size={14} color="#F0EBE0" />
          <Text style={styles.goToPlacesBtnText}>{t.itinerary.addStop}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleDeleteStop = (stop: StopLike) => {
    if (!stop.id) return;
    // Find the placeId to also remove from Places tab
    const placeId = (stop as any).placeId as string | undefined;
    Alert.alert(
      t.itinerary.deleteStop,
      `${t.itinerary.deleteStop} "${stop.placeName || stop.activity || ''}"?`,
      [
        { text: t.common.cancel, style: 'cancel' },
        {
          text: t.common.delete,
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
            <ActivityIndicator size="small" color="#3D5A2E" />
          ) : (
            <Ionicons name="navigate-outline" size={13} color="#3D5A2E" />
          )}
          <Text style={styles.updateRoutesBtnText}>
            {updatingRoutes ? t.common.loading : t.itinerary.title}
          </Text>
        </TouchableOpacity>
      )}
      {/* Day summary header */}
      {rawStops.length > 0 && (
        <View style={styles.daySummaryRow}>
          <View style={styles.daySummaryStat}>
            <Ionicons name="location-outline" size={13} color="rgba(82,183,136,0.7)" />
            <Text style={styles.daySummaryStatText}>{rawStops.length} {rawStops.length !== 1 ? t.itinerary.addStop : t.itinerary.addStop}</Text>
          </View>
          {rawStops.some(s => s.travelTimeToNext) && (
            <View style={styles.daySummaryStat}>
              <Ionicons name="time-outline" size={13} color="rgba(82,183,136,0.7)" />
              <Text style={styles.daySummaryStatText}>
                {rawStops.reduce((acc, s) => {
                  if (!s.travelTimeToNext) return acc;
                  const m = s.travelTimeToNext.match(/(\d+)\s*h/i);
                  const min = s.travelTimeToNext.match(/(\d+)\s*min/i);
                  return acc + (m ? parseInt(m[1]) * 60 : 0) + (min ? parseInt(min[1]) : 0);
                }, 0)} min em trânsito
              </Text>
            </View>
          )}
          {rawStops.some(s => (s as any).estimatedCost) && (
            <View style={styles.daySummaryStat}>
              <Ionicons name="wallet-outline" size={13} color="rgba(196,163,90,0.7)" />
              <Text style={styles.daySummaryStatText}>
                ~{rawStops.reduce((acc, s) => acc + ((s as any).estimatedCost || 0), 0).toFixed(0)}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Hotel stop (virtual, not draggable) */}
      {hotelStop && (
        <StopItem
          stop={hotelStop}
          isLast={rawStops.length === 0}
          prevStop={null}
          cityTransportMode={cityTransportMode}
          animIndex={0}
          linkedPlace={places?.find((p) => (p.category as string) === 'hotel') ?? null}
        />
      )}

      {/* Real stops — simple list (no drag) */}
      {rawStops.map((s, idx) => {
        const i = idx + (hotelStop ? 1 : 0);
        const prevS = i > 0 ? stops[i - 1] : null;
        const linked = s.placeId ? (places?.find((p) => p.id === s.placeId) ?? null) : null;
        return (
          <StopItem
            key={s.id || `stop-${idx}`}
            stop={s}
            isLast={idx === rawStops.length - 1}
            prevStop={prevS}
            cityTransportMode={cityTransportMode}
            onDelete={s.id ? () => handleDeleteStop(s) : undefined}
            onTimeChange={s.id ? (t) => handleTimeChange(s, t) : undefined}
            onMove={s.id ? () => { setStopToMove(s); setMoveMode('position'); setShowMoveModal(true); } : undefined}
            onEdit={s.id ? (updates) => updateItineraryStop(tripId, dayIndex, s.id!, updates) : undefined}
            animIndex={hotelStop ? idx + 1 : idx}
            linkedPlace={linked}
          />
        );
      })}
      {day?.tips ? (
        <View style={styles.dayTip}>
          <Ionicons name="bulb-outline" size={14} color="#C4A35A" />
          <Text style={styles.dayTipText}>{day.tips}</Text>
        </View>
      ) : null}

      {/* Move stop modal — position (before/after) or change day */}
      <Modal visible={showMoveModal} transparent animationType="fade" onRequestClose={() => { setShowMoveModal(false); setStopToMove(null); }}>
        <View style={styles.paceModalOverlay}>
          <View style={styles.paceModalCard}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <Text style={[styles.paceModalTitle, { flex: 1 }]}>Mover parada</Text>
              <TouchableOpacity onPress={() => { setShowMoveModal(false); setStopToMove(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color="rgba(240,235,224,0.9)" />
              </TouchableOpacity>
            </View>
            <Text style={styles.paceModalSubtitle}>
              {stopToMove ? `"${stopToMove.placeName || stopToMove.activity || 'Parada'}"` : ''}
            </Text>

            {/* Mode tabs */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, marginTop: 4 }}>
              <TouchableOpacity
                onPress={() => setMoveMode('position')}
                style={[styles.paceModalBtn, { flex: 1, backgroundColor: moveMode === 'position' ? 'rgba(61,90,46,0.15)' : 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: moveMode === 'position' ? '#3D5A2E' : 'transparent' }]}
              >
                <Ionicons name="swap-vertical-outline" size={14} color={moveMode === 'position' ? '#3D5A2E' : 'rgba(240,235,224,0.9)'} />
                <Text style={{ color: moveMode === 'position' ? '#3D5A2E' : 'rgba(240,235,224,0.9)', fontWeight: '600', fontSize: 13 }}>Posição</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setMoveMode('day')}
                style={[styles.paceModalBtn, { flex: 1, backgroundColor: moveMode === 'day' ? 'rgba(61,90,46,0.15)' : 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: moveMode === 'day' ? '#3D5A2E' : 'transparent' }]}
              >
                <Ionicons name="calendar-outline" size={14} color={moveMode === 'day' ? '#3D5A2E' : 'rgba(240,235,224,0.9)'} />
                <Text style={{ color: moveMode === 'day' ? '#3D5A2E' : 'rgba(240,235,224,0.9)', fontWeight: '600', fontSize: 13 }}>Outro dia</Text>
              </TouchableOpacity>
            </View>

            {moveMode === 'position' ? (
              // Position options: move before/after within the same day
              <View style={{ gap: 8 }}>
                {(() => {
                  const idx = rawStops.findIndex((s) => s.id === stopToMove?.id);
                  const canUp   = idx > 0;
                  const canDown = idx < rawStops.length - 1;
                  return (
                    <>
                      <TouchableOpacity
                        onPress={() => {
                          if (!stopToMove?.id || !canUp) return;
                          const newOrder = [...rawStops] as ItineraryStop[];
                          const [item] = newOrder.splice(idx, 1);
                          newOrder.splice(idx - 1, 0, item);
                          reorderItineraryStops(tripId, dayIndex, newOrder);
                          setTimeout(() => handleUpdateRoutes(), 300);
                          setShowMoveModal(false);
                          setStopToMove(null);
                        }}
                        style={[styles.paceModalOption, { opacity: canUp ? 1 : 0.35 }]}
                        disabled={!canUp}
                      >
                        <Ionicons name="arrow-up-outline" size={18} color="#3D5A2E" />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.paceModalOptionLabel}>Mover para antes</Text>
                          {canUp && rawStops[idx - 1] && (
                            <Text style={styles.paceModalOptionDesc}>Antes de "{rawStops[idx - 1].placeName || rawStops[idx - 1].activity}"</Text>
                          )}
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          if (!stopToMove?.id || !canDown) return;
                          const newOrder = [...rawStops] as ItineraryStop[];
                          const [item] = newOrder.splice(idx, 1);
                          newOrder.splice(idx + 1, 0, item);
                          reorderItineraryStops(tripId, dayIndex, newOrder);
                          setTimeout(() => handleUpdateRoutes(), 300);
                          setShowMoveModal(false);
                          setStopToMove(null);
                        }}
                        style={[styles.paceModalOption, { opacity: canDown ? 1 : 0.35 }]}
                        disabled={!canDown}
                      >
                        <Ionicons name="arrow-down-outline" size={18} color="#3D5A2E" />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.paceModalOptionLabel}>Mover para depois</Text>
                          {canDown && rawStops[idx + 1] && (
                            <Text style={styles.paceModalOptionDesc}>Depois de "{rawStops[idx + 1].placeName || rawStops[idx + 1].activity}"</Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    </>
                  );
                })()}
              </View>
            ) : (
              // Day options: move to another day
              <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false}>
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
                      <Ionicons name="calendar-outline" size={16} color="#3D5A2E" />
                      <Text style={[styles.paceModalOptionLabel, { flex: 1 }]}>{label}</Text>
                      <Ionicons name="chevron-forward" size={16} color="rgba(240,235,224,0.9)" />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
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
  const catColor = CATEGORY_COLORS[cat] || '#3D5A2E';
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
        <Ionicons name="add" size={18} color="#3D5A2E" />
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
  const t = useTranslation();
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

  // ── Weather forecast ────────────────────────────────────────────────────────
  const destLat = trip.destinations?.[0]?.lat;
  const destLng = trip.destinations?.[0]?.lng;
  const weatherQuery = trpc.weather.forecast.useQuery(
    { lat: destLat ?? 0, lon: destLng ?? 0, days: Math.min(trip.totalDays || 1, 5) },
    { enabled: !!(destLat && destLng), staleTime: 1000 * 60 * 30 }
  );

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
        t.itinerary.noPlacesTitle,
        t.itinerary.noPlacesMsg,
        [
          { text: t.common.cancel, style: 'cancel' },
          { text: t.itinerary.goToPlaces, onPress: () => onGoToPlaces() },
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
          <Ionicons name="calendar-outline" size={15} color="#3D5A2E" />
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

        {/* ── Weather strip ── */}
        {weatherQuery.data?.available && weatherQuery.data.days.length > 0 && (() => {
          const currentDay = displayDays[selectedDay];
          const dayDate = currentDay?.date ?? (() => {
            const d = new Date(trip.startDate);
            d.setDate(d.getDate() + selectedDay);
            return d.toISOString().split('T')[0];
          })();
          const weatherDay = weatherQuery.data.days.find((d: any) => d.date === dayDate) ?? weatherQuery.data.days[Math.min(selectedDay, weatherQuery.data.days.length - 1)];
          if (!weatherDay) return null;
          return (
            <View style={styles.weatherStrip}>
              <Image
                source={{ uri: `https://openweathermap.org/img/wn/${weatherDay.icon}@2x.png` }}
                style={styles.weatherIcon}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.weatherDesc} numberOfLines={1}>
                  {weatherDay.description.charAt(0).toUpperCase() + weatherDay.description.slice(1)}
                </Text>
                <Text style={styles.weatherTemp}>
                  {weatherDay.tempMin}° – {weatherDay.tempMax}°C
                  {weatherDay.rainProbability > 0 ? `  💧 ${weatherDay.rainProbability}%` : ''}
                </Text>
              </View>
            </View>
          );
        })()}

        <DayView
          key={`day-${selectedDay}-${(displayDays[selectedDay] as any)?.stops?.length ?? 0}-${displayDays[selectedDay]?.date ?? ''}`}
          day={displayDays[selectedDay]}
          dayIndex={selectedDay}
          tripId={trip.id}
          totalDays={totalDays}
          startDate={trip.startDate}
          cityTransportMode={cityTransportMode || trip.cityTransportMode}
          accommodations={trip.accommodations}
          onGoToPlaces={onGoToPlaces}
          places={trip.places}
        />

        {/* Create/Edit button — at the BOTTOM of the itinerary content */}
        <TouchableOpacity
          onPress={() => {
            if (hasItinerary) {
              Alert.alert(
                t.itinerary.recreateTitle,
                t.itinerary.recreateMsg,
                [
                  { text: t.common.cancel, style: 'cancel' },
                  { text: t.common.confirm, onPress: () => setShowCreateModal(true) },
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
              <ActivityIndicator size="small" color="#F0EBE0" />
              <Text style={styles.createItineraryBtnText}>{t.ai.generatingItinerary}</Text>
            </>
          ) : (
            <>
              <Ionicons name="sparkles" size={15} color="#F0EBE0" />
              <Text style={styles.createItineraryBtnText}>
                {hasItinerary ? t.itinerary.editItinerary : t.itinerary.createItinerary}
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
            <Text style={styles.unscheduledTitle}>{t.itinerary.unscheduled.toUpperCase()}</Text>
            <Text style={styles.unscheduledCount}>{unscheduledPlaces.length}</Text>
          </View>
          <Text style={styles.unscheduledSubtitle}>{t.itinerary.unscheduledHint}</Text>
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
              <Text style={styles.paceModalTitle}>{t.itinerary.createTitle}</Text>
              <TouchableOpacity
                onPress={() => setShowCreateModal(false)}
                style={{ padding: 4, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)' }}
              >
                <Ionicons name="close" size={18} color="rgba(240,235,224,0.9)" />
              </TouchableOpacity>
            </View>
            <Text style={styles.paceModalSubtitle}>{t.itinerary.createSubtitle}</Text>

            {/* Pace selector (shared by all AI modes) */}
            <View style={{ marginBottom: 4 }}>
              <Text style={styles.unscheduledSubtitle}>{t.itinerary.pace}</Text>
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
                    <Text style={[styles.paceMiniChipText, pace === p.id && { color: '#F0EBE0' }]}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Mode options */}
            <TouchableOpacity
              onPress={() => { setShowCreateModal(false); setShowProfileModal(true); }}
              style={styles.createModeOption}
            >
              <View style={[styles.createModeIcon, { backgroundColor: 'rgba(61,90,46,0.12)' }]}>
                <Ionicons name="sparkles" size={20} color="#3D5A2E" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.createModeLabel}>IA do zero</Text>
                <Text style={styles.createModeDesc}>A IA cria tudo com base no seu perfil de viajante</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="rgba(240,235,224,0.9)" />
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
                <Ionicons name="lock-closed-outline" size={16} color="rgba(240,235,224,0.9)" />
              ) : (
                <Ionicons name="chevron-forward" size={16} color="rgba(240,235,224,0.9)" />
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
              <Ionicons name="chevron-forward" size={16} color="rgba(240,235,224,0.9)" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowCreateModal(false)}
              style={[styles.paceModalBtn, { backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 4 }]}
            >
              <Text style={{ color: 'rgba(240,235,224,0.9)', fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Profile questions modal (AI from scratch) ── */}
      <Modal visible={showProfileModal} transparent animationType="slide" onRequestClose={() => setShowProfileModal(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end' }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <View style={[styles.paceModalOverlay, { justifyContent: 'flex-end', padding: 0 }]}>
          <View style={[styles.paceModalCard, { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '90%' }]}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
                      <Ionicons name={s.icon as any} size={13} color={active ? '#F0EBE0' : '#3D5A2E'} />
                      <Text style={[styles.profileChipText, active && { color: '#F0EBE0' }]}>{s.label}</Text>
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
                  <Ionicons name={b.icon as any} size={18} color={profileBudget === b.id ? '#F0EBE0' : '#3D5A2E'} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.paceModalOptionLabel, profileBudget === b.id && { color: '#F0EBE0' }]}>{b.label}</Text>
                    <Text style={[styles.paceModalOptionDesc, profileBudget === b.id && { color: 'rgba(44,36,22,0.5)' }]}>{b.desc}</Text>
                  </View>
                  {profileBudget === b.id && <Ionicons name="checkmark" size={18} color="#F0EBE0" />}
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
                      <Ionicons name={p.icon as any} size={13} color={active ? '#F0EBE0' : '#3D5A2E'} />
                      <Text style={[styles.profileChipText, active && { color: '#F0EBE0' }]}>{p.label}</Text>
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
                    <Ionicons name={p.icon as any} size={14} color={pace === p.id ? '#F0EBE0' : '#3D5A2E'} />
                    <Text style={[styles.paceMiniChipText, pace === p.id && { color: '#F0EBE0' }]}>{p.label}</Text>
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
                    <Text style={[styles.paceMiniChipText, profileWakeUp === t && { color: '#F0EBE0' }]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Interests */}
              <Text style={styles.profileSectionLabel}>Interesses específicos (opcional)</Text>
              <TextInput
                value={profileInterests}
                onChangeText={setProfileInterests}
                placeholder="Ex: vinhos, arquitetura modernista, praias desertas..."
                placeholderTextColor="rgba(240,235,224,0.9)"
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
                  <Text style={{ color: 'rgba(240,235,224,0.9)', fontWeight: '600' }}>Voltar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleGenerateFromScratch}
                  style={[styles.paceModalBtn, { backgroundColor: '#3D5A2E', flex: 1.5 }]}
                  disabled={generating}
                >
                  <Ionicons name="sparkles-outline" size={15} color="#F0EBE0" />
                  <Text style={{ color: '#F0EBE0', fontWeight: '700' }}>Criar Roteiro</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Manual place picker modal ── */}
      <Modal visible={showManualPicker} transparent animationType="slide" onRequestClose={() => setShowManualPicker(false)}>
        <View style={[styles.paceModalOverlay, { justifyContent: 'flex-end', padding: 0 }]}>
          <View style={[styles.paceModalCard, { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '85%' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={styles.paceModalTitle}>Adicionar ao Dia {selectedDay + 1}</Text>
              <TouchableOpacity onPress={() => setShowManualPicker(false)}>
                <Ionicons name="close" size={22} color="rgba(240,235,224,0.9)" />
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
                  const catColor = CATEGORY_COLORS[cat] || '#3D5A2E';
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
                            <Ionicons name="checkmark-circle" size={16} color="#3D5A2E" />
                            <Text style={{ fontSize: 11, color: '#3D5A2E', marginLeft: 3 }}>Agendado</Text>
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
                                  <Text style={[styles.manualDayChipText, isSelected && { color: '#F0EBE0' }]}>
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
                            <Ionicons name="add" size={18} color="#F0EBE0" />
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
              style={[styles.paceModalBtn, { backgroundColor: '#3D5A2E', marginTop: 8 }]}
            >
              <Text style={{ color: '#F0EBE0', fontWeight: '700' }}>Concluído</Text>
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
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: 'rgba(240,235,224,0.9)' },
  regenBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(61,90,46,0.10)', minWidth: 80, justifyContent: 'center' },
  regenBtnText: { fontSize: 12, color: '#3D5A2E', fontWeight: '600' },

  itineraryCard: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: 'rgba(82,183,136,0.1)' },

  // Day selector chips
  dayChip: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', minWidth: 52 },
  dayChipActive: { backgroundColor: '#3D5A2E' },
  dayChipName: { fontSize: 11, color: 'rgba(240,235,224,0.9)', fontWeight: '600', marginBottom: 2 },
  dayChipNameActive: { color: '#F0EBE0' },
  dayChipNum: { fontSize: 20, fontWeight: '800', color: '#F0EBE0', lineHeight: 24 },
  dayChipNumActive: { color: '#F0EBE0' },
  dayChipMonth: { fontSize: 10, color: 'rgba(240,235,224,0.9)', marginTop: 1 },
  dayChipMonthActive: { color: 'rgba(44,36,22,0.5)' },

  // Stop item — Google Maps-style
  stopAnimatedBg: { backgroundColor: '#EDE8DC' }, // opaque so swipe-delete bg doesn't show through
  stopRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6, paddingHorizontal: 4 },
  // Legacy (kept for fallback references)
  timeCol: { width: 44, alignItems: 'flex-end', paddingRight: 10, paddingTop: 6 },
  stopTime: { fontSize: 12, color: 'rgba(240,235,224,0.9)', fontWeight: '500' },
  iconCol: { width: 36, alignItems: 'center' },
  stopIconBg: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  vertLine: { flex: 1, width: 1, backgroundColor: 'rgba(61,90,46,0.15)', marginTop: 4, minHeight: 16 },
  stopContent: { flex: 1, paddingLeft: 10, paddingBottom: 8 },
  // Google Maps-style columns
  gmIconCol: { width: 32, alignItems: 'center', paddingTop: 2 },
  gmIconCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  gmVertLine: { width: 1.5, flex: 1, backgroundColor: 'rgba(82,183,136,0.25)', marginTop: 3, minHeight: 20 },
  gmContent: { flex: 1, paddingLeft: 10, paddingBottom: 10, paddingTop: 3 },
  gmRightCol: { alignItems: 'flex-end', paddingLeft: 6, paddingTop: 3, gap: 6, minWidth: 52 },
  gmTimeBtn: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(82,183,136,0.1)', borderWidth: 1, borderColor: 'rgba(61,90,46,0.15)' },
  gmTimeText: { fontSize: 12, color: '#3D5A2E', fontWeight: '600', letterSpacing: 0.3 },
  gmMoveBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  // Transit connector (Google Maps style)
  gmTransitRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 4, paddingVertical: 2, paddingBottom: 4 },
  gmTransitIconWrap: { width: 32, alignItems: 'center' },
  gmTransitIconBg: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(61,90,46,0.12)' },
  gmTransitText: { fontSize: 11, color: 'rgba(240,235,224,0.9)', paddingLeft: 10, flex: 1 },
  stopName: { fontSize: 15, fontWeight: '700', color: '#F0EBE0', lineHeight: 20 },
  stopDesc: { fontSize: 13, color: 'rgba(240,235,224,0.9)', marginTop: 2, lineHeight: 18 },
  stopExpanded: { marginTop: 8, gap: 6 },
  stopDetail: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  stopDetailText: { fontSize: 12, color: 'rgba(240,235,224,0.9)', flex: 1, lineHeight: 16 },
  stopActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  stopActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(61,90,46,0.10)' },
  stopActionText: { fontSize: 12, color: '#3D5A2E', fontWeight: '600' },

  // Travel between stops
  travelRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  travelIconBg: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  travelText: { fontSize: 11, color: 'rgba(240,235,224,0.9)', paddingLeft: 10 },

  // Day tip
  dayTip: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12, padding: 10, backgroundColor: 'rgba(196,163,90,0.1)', borderRadius: 10, borderLeftWidth: 2, borderLeftColor: '#C4A35A' },
  dayTipText: { flex: 1, fontSize: 12, color: 'rgba(240,235,224,0.9)', lineHeight: 18 },

  // Empty day
  emptyDay: { paddingVertical: 20, alignItems: 'center', gap: 12 },
  emptyDayText: { fontSize: 14, color: 'rgba(240,235,224,0.9)', textAlign: 'center' },
  goToPlacesBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#3D5A2E', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  goToPlacesBtnText: { fontSize: 13, fontWeight: '700', color: '#F0EBE0' },

  // Generating
  generatingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, justifyContent: 'center' },
  loadingText: { fontSize: 12, color: 'rgba(240,235,224,0.9)', textAlign: 'center' },

  // Pace modal
  paceModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  paceModalCard: { backgroundColor: '#EDE8DC', borderRadius: 20, padding: 20, gap: 10 },
  paceModalTitle: { fontSize: 18, fontWeight: '700', color: '#F0EBE0', fontStyle: 'italic', marginBottom: 2 },
  paceModalSubtitle: { fontSize: 13, color: 'rgba(240,235,224,0.9)', lineHeight: 18, marginBottom: 4 },
  paceModalOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  paceModalOptionActive: { backgroundColor: '#3D5A2E' },
  paceModalOptionLabel: { fontSize: 15, fontWeight: '700', color: '#F0EBE0' },
  paceModalOptionDesc: { fontSize: 12, color: 'rgba(240,235,224,0.9)', marginTop: 1 },
  paceModalBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12, borderRadius: 12 },

  // Time edit
  timeBtn: { paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(61,90,46,0.15)' },
  timeModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 32 },
  timeModalSheet: { backgroundColor: '#EDE8DC', borderRadius: 20, padding: 20, gap: 12 },
  timeModalTitle: { fontSize: 17, fontWeight: '700', color: '#F0EBE0', textAlign: 'center' },
  timeModalInput: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 14, fontSize: 28, fontWeight: '700', color: '#F0EBE0', textAlign: 'center', borderWidth: 1, borderColor: 'rgba(61,90,46,0.25)', letterSpacing: 4 },
  timeModalHint: { fontSize: 12, color: 'rgba(240,235,224,0.9)', textAlign: 'center' },
  timeModalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  timeModalCancel: { flex: 1, paddingVertical: 13, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center' },
  timeModalCancelText: { color: 'rgba(240,235,224,0.9)', fontSize: 15, fontWeight: '500' },
  timeModalConfirm: { flex: 2, paddingVertical: 13, borderRadius: 14, backgroundColor: '#3D5A2E', alignItems: 'center' },
  timeModalConfirmText: { color: '#F0EBE0', fontSize: 15, fontWeight: '700' },

  // Update routes button
  updateRoutesBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: 'rgba(82,183,136,0.1)', marginBottom: 10, borderWidth: 1, borderColor: 'rgba(61,90,46,0.15)' },
  updateRoutesBtnText: { fontSize: 11, color: '#3D5A2E', fontWeight: '600' },

  // Create mode options
  createModeOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: 8 },
  createModeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  createModeLabel: { fontSize: 15, fontWeight: '700', color: '#F0EBE0', marginBottom: 2 },
  createModeDesc: { fontSize: 12, color: 'rgba(240,235,224,0.9)', lineHeight: 16 },

  // Pace mini chips (for create modal)
  paceMiniChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center' },
  paceMiniChipActive: { backgroundColor: '#3D5A2E' },
  paceMiniChipText: { fontSize: 12, fontWeight: '600', color: '#3D5A2E' },

  // Profile questions
  profileSectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: 'rgba(240,235,224,0.9)', marginTop: 12, marginBottom: 8 },
  profileChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  profileChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.06)' },
  profileChipActive: { backgroundColor: '#3D5A2E' },
  profileChipText: { fontSize: 13, fontWeight: '600', color: '#3D5A2E' },
  profileTextInput: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 12, fontSize: 14, color: '#F0EBE0', borderWidth: 1, borderColor: 'rgba(61,90,46,0.15)', lineHeight: 20, minHeight: 64 },

  // Manual picker
  manualDayChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(61,90,46,0.15)' },
  manualDayChipActive: { backgroundColor: '#3D5A2E', borderColor: '#3D5A2E' },
  manualDayChipText: { fontSize: 12, fontWeight: '600', color: 'rgba(240,235,224,0.9)' },
  manualPickerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(240,235,224,0.9)' },
  manualPickerScheduled: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(82,183,136,0.1)' },

  // Drag handle
  dragHandle: { width: 20, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, flexWrap: 'wrap', flexDirection: 'row', gap: 3, marginRight: 2 },
  dragDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(240,235,224,0.9)' },

  // Swipe-to-delete
  swipeDeleteAction: { backgroundColor: '#E74C3C', alignItems: 'center', justifyContent: 'center', width: 80, borderRadius: 12, gap: 4 },
  swipeDeleteText: { fontSize: 11, fontWeight: '700', color: '#fff' },

  // Create itinerary button (below day selector)
  createItineraryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#3D5A2E', borderRadius: 14, paddingVertical: 11, paddingHorizontal: 16, marginBottom: 16 },
  createItineraryBtnText: { fontSize: 14, fontWeight: '700', color: '#F0EBE0' },

  // Unscheduled places panel
  unscheduledPanel: { marginTop: 12, backgroundColor: 'rgba(196,163,90,0.06)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(196,163,90,0.15)' },
  unscheduledHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  unscheduledTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: '#C4A35A', flex: 1 },
  unscheduledCount: { fontSize: 11, fontWeight: '700', color: '#C4A35A', backgroundColor: 'rgba(196,163,90,0.2)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  unscheduledSubtitle: { fontSize: 12, color: 'rgba(240,235,224,0.9)', marginBottom: 10, lineHeight: 16 },
  unscheduledRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  unscheduledIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  unscheduledName: { fontSize: 14, fontWeight: '600', color: '#F0EBE0' },
  unscheduledCat: { fontSize: 11, color: 'rgba(240,235,224,0.9)', marginTop: 1 },
  unscheduledAddBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(61,90,46,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(61,90,46,0.25)' },

  // Edit stop modal
  editStopOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  editStopSheet: { backgroundColor: '#EDE8DC', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  editStopHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  editStopTitle: { fontSize: 18, fontWeight: '700', color: '#F0EBE0' },
  editStopLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: 'rgba(240,235,224,0.9)', marginBottom: 6, marginTop: 4 },
  editStopInput: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, padding: 12, fontSize: 14, color: '#F0EBE0', borderWidth: 1, borderColor: 'rgba(61,90,46,0.15)', marginBottom: 12 },
  editCatChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  editCatChipText: { fontSize: 12, fontWeight: '600' },
  editStopActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  editStopCancel: { flex: 1, paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center' },
  editStopCancelText: { fontSize: 14, fontWeight: '600', color: 'rgba(240,235,224,0.9)' },
  editStopSave: { flex: 2, flexDirection: 'row', gap: 6, paddingVertical: 12, borderRadius: 14, backgroundColor: '#3D5A2E', alignItems: 'center', justifyContent: 'center' },
  editStopSaveText: { fontSize: 14, fontWeight: '700', color: '#F0EBE0' },

  // Day summary header
  daySummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 4, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(82,183,136,0.1)' },
  daySummaryStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  daySummaryStatText: { fontSize: 12, color: 'rgba(240,235,224,0.9)', fontWeight: '500' },

  // Weather strip
  weatherStrip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(82,183,136,0.08)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(61,90,46,0.12)' },
  weatherIcon: { width: 40, height: 40 },
  weatherDesc: { fontSize: 13, color: 'rgba(240,235,224,0.9)', fontWeight: '500', lineHeight: 17 },
  weatherTemp: { fontSize: 12, color: 'rgba(240,235,224,0.9)', marginTop: 2 },

  // Stop photo & attachments
  stopPhoto: { width: '100%', height: 130, borderRadius: 12, marginBottom: 10, marginTop: 4 },
  stopAttachList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  stopAttachChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(196,163,90,0.1)', borderWidth: 1, borderColor: 'rgba(196,163,90,0.25)' },
  stopAttachChipText: { fontSize: 11, fontWeight: '600', color: 'rgba(196,163,90,0.85)', maxWidth: 120 },
});
