import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/use-colors';
import { trpc } from '@/lib/trpc';
import { useTripsStore } from '@/store/trips';
import { PaywallModal } from '@/components/paywall-modal';
import type { Trip, DayItinerary, TravelPace } from '@/types/voyage';

interface ItineraryBlockProps {
  trip: Trip;
}

const PACE_OPTIONS: { id: TravelPace; label: string }[] = [
  { id: 'relaxado', label: 'Relaxado' },
  { id: 'moderado', label: 'Moderado' },
  { id: 'intenso', label: 'Intenso' },
];

export function ItineraryBlock({ trip }: ItineraryBlockProps) {
  const colors = useColors();
  const { setItinerary, userPlan, updateUserPlan } = useTripsStore();
  const [showPaywall, setShowPaywall] = useState(false);
  const [selectedPace, setSelectedPace] = useState<TravelPace>('moderado');
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const generateMutation = trpc.ai.generateItinerary.useMutation({
    onSuccess: async (data) => {
      if (data.days && data.days.length > 0) {
        await setItinerary(trip.id, data.days);
        // Consume an AI credit
        if (userPlan.tier === 'free') {
          updateUserPlan({ aiCreditsUsed: userPlan.aiCreditsUsed + 1 });
        }
      }
    },
  });

  const handleGenerate = () => {
    const canUseAI = userPlan.tier !== 'free' || userPlan.aiCreditsUsed < userPlan.aiCreditsLimit;
    if (!canUseAI) {
      setShowPaywall(true);
      return;
    }

    generateMutation.mutate({
      tripId: trip.id,
      startDate: trip.startDate,
      totalDays: trip.totalDays,
      destinations: trip.destinations.map((d) => ({
        name: d.name,
        country: d.country,
        days: d.days,
      })),
      selectedPlaces: trip.places.map((p) => ({
        name: p.name,
        category: p.category,
        destinationName: trip.destinations.find((d) => d.id === p.destinationId)?.name || '',
        hours: p.hours,
        address: p.address,
      })),
      preferences: {
        pace: selectedPace,
        includeBreakfast: true,
        includeLunch: true,
        includeDinner: true,
      },
    });
  };

  const hasItinerary = trip.itinerary && trip.itinerary.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: '#1A3A2A' }]}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Ionicons name="map-outline" size={16} color="#A8D5B5" />
          <Text style={styles.title}>ROTEIRO DIA A DIA</Text>
        </View>
        {hasItinerary && (
          <Pressable
            onPress={handleGenerate}
            style={({ pressed }) => [styles.regenerateBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="refresh-outline" size={14} color="#A8D5B5" />
            <Text style={styles.regenerateBtnText}>Refazer</Text>
          </Pressable>
        )}
      </View>

      {!hasItinerary ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            {trip.places.length > 0
              ? `${trip.places.length} lugares selecionados. Gere o roteiro dia a dia com IA.`
              : 'Adicione lugares na aba "Lugares" ou gere um roteiro completo com IA.'}
          </Text>

          {/* Pace selector */}
          <View style={styles.paceRow}>
            {PACE_OPTIONS.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setSelectedPace(p.id)}
                style={({ pressed }) => [
                  styles.paceChip,
                  {
                    backgroundColor: selectedPace === p.id ? '#2D5A3D' : 'rgba(255,255,255,0.1)',
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text style={[styles.paceChipText, { color: selectedPace === p.id ? '#fff' : '#A8D5B5' }]}>
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={handleGenerate}
            disabled={generateMutation.isPending}
            style={({ pressed }) => [styles.generateBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            {generateMutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="sparkles" size={16} color="#fff" />
                <Text style={styles.generateBtnText}>
                  {userPlan.tier === 'free' ? '✦ Gerar com IA (PRO)' : '✦ Gerar Roteiro com IA'}
                </Text>
              </>
            )}
          </Pressable>

          {generateMutation.isPending && (
            <Text style={styles.loadingText}>A IA está criando seu roteiro personalizado...</Text>
          )}
        </View>
      ) : (
        <ScrollView
          horizontal={false}
          showsVerticalScrollIndicator={false}
          style={styles.daysList}
        >
          {trip.itinerary.map((day, idx) => {
            const isExpanded = expandedDay === day.date;
            const dateObj = new Date(day.date);
            const dayNum = idx + 1;
            const weekDay = dateObj.toLocaleDateString('pt-BR', { weekday: 'short' });
            const dayMonth = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

            return (
              <Pressable
                key={day.date}
                onPress={() => setExpandedDay(isExpanded ? null : day.date)}
                style={({ pressed }) => [styles.dayCard, { opacity: pressed ? 0.9 : 1 }]}
              >
                <View style={styles.dayCardHeader}>
                  <View style={styles.dayBadge}>
                    <Text style={styles.dayBadgeNum}>Dia {dayNum}</Text>
                    <Text style={styles.dayBadgeDate}>{weekDay}, {dayMonth}</Text>
                  </View>
                  <View style={styles.dayCardRight}>
                    {day.title && (
                      <Text style={styles.dayTitle} numberOfLines={isExpanded ? undefined : 1}>
                        {day.title}
                      </Text>
                    )}
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={14}
                      color="#A8D5B5"
                    />
                  </View>
                </View>

                {isExpanded && (
                  <View style={styles.dayDetails}>
                    {day.morning && (
                      <DayActivity icon="sunny-outline" label="Manhã" activity={day.morning} />
                    )}
                    {day.afternoon && (
                      <DayActivity icon="partly-sunny-outline" label="Tarde" activity={day.afternoon} />
                    )}
                    {day.evening && (
                      <DayActivity icon="moon-outline" label="Noite" activity={day.evening} />
                    )}
                    {day.meals && (
                      <View style={styles.mealsRow}>
                        <Ionicons name="restaurant-outline" size={13} color="#A8D5B5" />
                        <Text style={styles.mealsText}>
                          {[day.meals.breakfast, day.meals.lunch, day.meals.dinner]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                    )}
                    {day.tips && (
                      <View style={styles.tipRow}>
                        <Ionicons name="bulb-outline" size={13} color="#F0C040" />
                        <Text style={styles.tipText}>{day.tips}</Text>
                      </View>
                    )}
                    {day.estimatedCost !== undefined && (
                      <Text style={styles.costText}>
                        Custo estimado: ~USD {day.estimatedCost}
                      </Text>
                    )}
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <PaywallModal
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
        feature="Gerar Roteiro com IA"
      />
    </View>
  );
}

function DayActivity({
  icon,
  label,
  activity,
}: {
  icon: any;
  label: string;
  activity: { time: string; activity: string; place?: string; tip?: string };
}) {
  return (
    <View style={styles.activityRow}>
      <View style={styles.activityIcon}>
        <Ionicons name={icon} size={13} color="#A8D5B5" />
      </View>
      <View style={styles.activityContent}>
        <Text style={styles.activityLabel}>{label} · {activity.time}</Text>
        <Text style={styles.activityText}>{activity.activity}</Text>
        {activity.place && (
          <Text style={styles.activityPlace}>📍 {activity.place}</Text>
        )}
        {activity.tip && (
          <Text style={styles.activityTip}>💡 {activity.tip}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: '#A8D5B5',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  regenerateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  regenerateBtnText: {
    color: '#A8D5B5',
    fontSize: 12,
  },
  emptyState: {
    gap: 12,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 20,
  },
  paceRow: {
    flexDirection: 'row',
    gap: 8,
  },
  paceChip: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  paceChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2D5A3D',
    borderRadius: 12,
    paddingVertical: 14,
  },
  generateBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  loadingText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    textAlign: 'center',
  },
  daysList: {
    maxHeight: 400,
  },
  dayCard: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  dayCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dayBadge: {
    backgroundColor: '#2D5A3D',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 64,
    alignItems: 'center',
  },
  dayBadgeNum: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  dayBadgeDate: {
    color: '#A8D5B5',
    fontSize: 10,
    marginTop: 1,
  },
  dayCardRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dayTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  dayDetails: {
    marginTop: 12,
    gap: 8,
  },
  activityRow: {
    flexDirection: 'row',
    gap: 10,
  },
  activityIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  activityContent: {
    flex: 1,
    gap: 2,
  },
  activityLabel: {
    color: '#A8D5B5',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  activityText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
  },
  activityPlace: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
  activityTip: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontStyle: 'italic',
  },
  mealsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    padding: 8,
  },
  mealsText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    flex: 1,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(240,192,64,0.1)',
    borderRadius: 8,
    padding: 8,
  },
  tipText: {
    color: '#F0C040',
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
  costText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    textAlign: 'right',
  },
});
