import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Linking, ActivityIndicator, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTripsStore } from '@/store/trips';
import { PaywallModal } from '@/components/paywall-modal';
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

// ─── Day Selector ─────────────────────────────────────────────────────────────

function DaySelector({
  days, selectedIndex, onSelect, startDate,
}: {
  days: DayItinerary[]; selectedIndex: number; onSelect: (i: number) => void; startDate: string;
}) {
  return (
    <ScrollView
      horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 2, paddingBottom: 4 }}
      style={{ marginBottom: 16 }}
    >
      {days.map((day, i) => {
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

function StopItem({ stop, isLast }: { stop: StopLike; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
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
      <TouchableOpacity onPress={() => setExpanded(!expanded)} style={styles.stopRow} activeOpacity={0.75}>
        {/* Time */}
        <View style={styles.timeCol}>
          <Text style={styles.stopTime}>{stop.time}</Text>
        </View>
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
        <View style={styles.travelRow}>
          <View style={styles.timeCol} />
          <View style={styles.iconCol}>
            <View style={styles.travelIconBg}>
              <Ionicons name="walk-outline" size={11} color="rgba(245,240,232,0.4)" />
            </View>
          </View>
          <Text style={styles.travelText}>{stop.travelTimeToNext}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Day View ─────────────────────────────────────────────────────────────────

function DayView({ day }: { day: DayItinerary }) {
  // Support both new stops[] format and legacy morning/afternoon/evening
  const stops: StopLike[] = (day as any).stops && (day as any).stops.length > 0
    ? (day as any).stops
    : [
        day.morning   ? { id: 'm', time: day.morning.time   || '09:00', placeName: day.morning.activity,   placeCategory: 'attraction', description: day.morning.tip   } : null,
        day.afternoon ? { id: 'a', time: day.afternoon.time || '14:00', placeName: day.afternoon.activity, placeCategory: 'restaurant', description: day.afternoon.tip } : null,
        day.evening   ? { id: 'e', time: day.evening.time   || '19:00', placeName: day.evening.activity,   placeCategory: 'other',      description: day.evening.tip   } : null,
      ].filter(Boolean) as StopLike[];

  if (stops.length === 0) {
    return (
      <View style={styles.emptyDay}>
        <Text style={styles.emptyDayText}>Nenhuma atividade para este dia</Text>
      </View>
    );
  }

  return (
    <View>
      {stops.map((s, i) => (
        <StopItem key={s.id || i} stop={s} isLast={i === stops.length - 1} />
      ))}
      {day.tips ? (
        <View style={styles.dayTip}>
          <Ionicons name="bulb-outline" size={14} color="#C4A35A" />
          <Text style={styles.dayTipText}>{day.tips}</Text>
        </View>
      ) : null}
      {day.estimatedCost != null ? (
        <View style={styles.dayCost}>
          <Ionicons name="wallet-outline" size={13} color="rgba(245,240,232,0.4)" />
          <Text style={styles.dayCostText}>Estimativa: ~{day.estimatedCost}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ItineraryBlock({ trip }: { trip: Trip }) {
  const { setItinerary, updateUserPlan, userPlan } = useTripsStore();
  const [selectedDay, setSelectedDay] = useState(0);
  const [pace, setPace] = useState<TravelPace>('moderado');
  const [showPaywall, setShowPaywall] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showPaceModal, setShowPaceModal] = useState(false);

  const generateItinerary = trpc.ai.generateItinerary.useMutation();

  const hasItinerary = trip.itinerary && trip.itinerary.length > 0;
  const canUseAI = userPlan.tier !== 'free' || userPlan.aiCreditsUsed < userPlan.aiCreditsLimit;

  const handleGenerate = async () => {
    if (!canUseAI) { setShowPaywall(true); return; }
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
        })),
        totalDays: trip.totalDays,
        startDate: trip.startDate,
        preferences: {
          pace,
          includeBreakfast: true,
          includeLunch: true,
          includeDinner: true,
        },
      });
      if (result?.days && result.days.length > 0) {
        await setItinerary(trip.id, result.days);
        if (userPlan.tier === 'free') {
          await updateUserPlan({ ...userPlan, aiCreditsUsed: userPlan.aiCreditsUsed + 1 });
        }
        setSelectedDay(0);
      }
    } catch (e) {
      console.error('Itinerary generation error:', e);
    } finally {
      setGenerating(false);
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
        {hasItinerary && (
          <TouchableOpacity onPress={() => setShowPaceModal(true)} style={styles.regenBtn}>
            <Ionicons name="sparkles-outline" size={14} color="#52B788" />
            <Text style={styles.regenBtnText}>Regerar</Text>
          </TouchableOpacity>
        )}
      </View>

      {hasItinerary ? (
        <View style={styles.itineraryCard}>
          <DaySelector
            days={trip.itinerary}
            selectedIndex={selectedDay}
            onSelect={setSelectedDay}
            startDate={trip.startDate}
          />
          {trip.itinerary[selectedDay] && <DayView day={trip.itinerary[selectedDay]} />}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Ionicons name="map-outline" size={32} color="rgba(82,183,136,0.4)" />
          <Text style={styles.emptyTitle}>Roteiro ainda não criado</Text>
          <Text style={styles.emptySubtitle}>
            {trip.places.length > 0
              ? `${trip.places.length} lugares selecionados. Escolha o ritmo e gere o roteiro.`
              : 'Adicione lugares na aba Lugares e gere seu roteiro personalizado com IA.'}
          </Text>
          <View style={styles.paceRow}>
            {PACE_OPTIONS.map((p) => (
              <TouchableOpacity
                key={p.id} onPress={() => setPace(p.id)}
                style={[styles.paceChip, pace === p.id && styles.paceChipActive]}
              >
                <Ionicons name={p.icon as any} size={14} color={pace === p.id ? '#0F1F16' : '#52B788'} />
                <Text style={[styles.paceChipText, pace === p.id && { color: '#0F1F16' }]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            onPress={handleGenerate} disabled={generating}
            style={[styles.generateBtn, generating && { opacity: 0.6 }]}
          >
            {generating ? (
              <ActivityIndicator size="small" color="#0F1F16" />
            ) : (
              <>
                <Ionicons name="sparkles-outline" size={16} color="#0F1F16" />
                <Text style={styles.generateBtnText}>
                  {userPlan.tier === 'free' ? 'Criar Roteiro com IA (PRO)' : 'Criar Roteiro com IA'}
                </Text>
              </>
            )}
          </TouchableOpacity>
          {generating && (
            <Text style={styles.loadingText}>A IA está criando seu roteiro personalizado...</Text>
          )}
        </View>
      )}

      {/* Pace modal for regeneration */}
      <Modal visible={showPaceModal} transparent animationType="fade" onRequestClose={() => setShowPaceModal(false)}>
        <View style={styles.paceModalOverlay}>
          <View style={styles.paceModalCard}>
            <Text style={styles.paceModalTitle}>Ritmo da Viagem</Text>
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
                onPress={() => { setShowPaceModal(false); handleGenerate(); }}
                style={[styles.paceModalBtn, { backgroundColor: '#52B788', flex: 1.5 }]}
              >
                <Ionicons name="sparkles-outline" size={15} color="#0F1F16" />
                <Text style={{ color: '#0F1F16', fontWeight: '700' }}>Regerar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} feature="Gerar Roteiro com IA" />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: 'rgba(245,240,232,0.7)' },
  regenBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(82,183,136,0.12)' },
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

  // Day tip / cost
  dayTip: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12, padding: 10, backgroundColor: 'rgba(196,163,90,0.1)', borderRadius: 10, borderLeftWidth: 2, borderLeftColor: '#C4A35A' },
  dayTipText: { flex: 1, fontSize: 12, color: 'rgba(245,240,232,0.6)', lineHeight: 18 },
  dayCost: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  dayCostText: { fontSize: 12, color: 'rgba(245,240,232,0.4)' },

  // Empty day
  emptyDay: { padding: 16, alignItems: 'center' },
  emptyDayText: { fontSize: 13, color: 'rgba(245,240,232,0.4)' },

  // Empty state
  emptyCard: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 20, padding: 20, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: 'rgba(82,183,136,0.1)' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#F5F0E8', textAlign: 'center' },
  emptySubtitle: { fontSize: 13, color: 'rgba(245,240,232,0.5)', textAlign: 'center', lineHeight: 18, marginBottom: 4 },
  paceRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  paceChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: 'rgba(82,183,136,0.1)', borderWidth: 1, borderColor: 'rgba(82,183,136,0.2)' },
  paceChipActive: { backgroundColor: '#52B788', borderColor: '#52B788' },
  paceChipText: { fontSize: 12, fontWeight: '600', color: '#52B788' },
  generateBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#52B788', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 13, marginTop: 4, width: '100%', justifyContent: 'center' },
  generateBtnText: { fontSize: 15, fontWeight: '700', color: '#0F1F16' },
  loadingText: { fontSize: 12, color: 'rgba(245,240,232,0.4)', textAlign: 'center' },

  // Pace modal
  paceModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  paceModalCard: { backgroundColor: '#1A2E22', borderRadius: 20, padding: 20, gap: 10 },
  paceModalTitle: { fontSize: 18, fontWeight: '700', color: '#F5F0E8', fontStyle: 'italic', marginBottom: 4 },
  paceModalOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  paceModalOptionActive: { backgroundColor: '#52B788' },
  paceModalOptionLabel: { fontSize: 15, fontWeight: '700', color: '#F5F0E8' },
  paceModalOptionDesc: { fontSize: 12, color: 'rgba(245,240,232,0.5)', marginTop: 1 },
  paceModalBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12, borderRadius: 12 },
});
