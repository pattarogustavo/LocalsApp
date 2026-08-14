import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ExampleItinerary } from '@/constants/example-itineraries';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

const CATEGORY_ICONS: Record<string, string> = {
  attraction: 'camera-outline',
  restaurant: 'restaurant-outline',
  cafe: 'cafe-outline',
  museum: 'book-outline',
  hidden_gem: 'diamond-outline',
  other: 'location-outline',
};

const CATEGORY_COLORS: Record<string, string> = {
  attraction: '#3D5A2E',
  restaurant: '#E07B5A',
  cafe: '#C4A35A',
  museum: '#7B9FD4',
  hidden_gem: '#B88BF5',
  other: '#A8D5B5',
};

/**
 * Read-only rendering of a single itinerary stop — same visual language as
 * the real itinerary timeline (icon, time, name, description) but with no
 * edit/move/delete affordances, since this only ever shows static sample data.
 */
function ReadOnlyStop({ stop, isLast }: { stop: ExampleItinerary['days'][number]['stops'][number]; isLast: boolean }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const catIcon = CATEGORY_ICONS[stop.placeCategory] || 'location-outline';
  const catColor = CATEGORY_COLORS[stop.placeCategory] || colors.textAccent;

  return (
    <View style={styles.stopRow}>
      <View style={styles.iconCol}>
        <View style={[styles.iconCircle, { backgroundColor: `${catColor}20`, borderColor: `${catColor}50` }]}>
          <Ionicons name={catIcon as any} size={14} color={catColor} />
        </View>
        {!isLast && <View style={styles.vertLine} />}
      </View>
      <View style={styles.content}>
        <View style={styles.nameRow}>
          <Text style={styles.stopName} numberOfLines={1}>{stop.placeName}</Text>
          {!!stop.time && <Text style={styles.stopTime}>{stop.time}</Text>}
        </View>
        {!!stop.description && (
          <Text style={styles.stopDesc} numberOfLines={2}>{stop.description}</Text>
        )}
      </View>
    </View>
  );
}

/**
 * Full read-only preview of an example itinerary: day selector + timeline of
 * stops for the selected day. Used on the welcome-offer screen and from the
 * paywall's "see an example" link — never editable, never fetched from AI.
 */
export function ExampleItineraryPreview({
  itinerary,
  maxStopsPerDay,
}: {
  itinerary: ExampleItinerary;
  /** When set, only render the first N stops of the selected day (used for compact previews). */
  maxStopsPerDay?: number;
}) {
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [selectedDay, setSelectedDay] = useState(0);
  const day = itinerary.days[selectedDay];
  const stops = maxStopsPerDay ? day.stops.slice(0, maxStopsPerDay) : day.stops;

  return (
    <View>
      {itinerary.days.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
          style={{ marginBottom: 12 }}
        >
          {itinerary.days.map((d, i) => {
            const isSelected = i === selectedDay;
            return (
              <TouchableOpacity
                key={d.dayNumber}
                onPress={() => setSelectedDay(i)}
                style={[styles.dayChip, isSelected && styles.dayChipActive]}
              >
                <Text style={[styles.dayChipText, isSelected && styles.dayChipTextActive]}>
                  {t.itinerary.day} {d.dayNumber}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {!!day.title && <Text style={styles.dayTitle}>{day.title}</Text>}

      {stops.map((stop, idx) => (
        <ReadOnlyStop key={stop.id} stop={stop} isLast={idx === stops.length - 1} />
      ))}

      {maxStopsPerDay && day.stops.length > maxStopsPerDay && (
        <Text style={styles.moreHint}>
          +{day.stops.length - maxStopsPerDay}
        </Text>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  dayChip: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: withAlpha(colors.foreground, 0.06),
  },
  dayChipActive: {
    backgroundColor: withAlpha(colors.primary, 0.15),
  },
  dayChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  dayChipTextActive: {
    color: colors.textAccent,
  },
  dayTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.foreground,
    marginBottom: 10,
  },
  stopRow: {
    flexDirection: 'row',
    gap: 10,
  },
  iconCol: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vertLine: {
    width: 1,
    flex: 1,
    minHeight: 18,
    backgroundColor: withAlpha(colors.foreground, 0.12),
    marginVertical: 2,
  },
  content: {
    flex: 1,
    paddingBottom: 14,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  stopName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.foreground,
  },
  stopTime: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '600',
  },
  stopDesc: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    lineHeight: 17,
  },
  moreHint: {
    fontSize: 12,
    color: colors.muted,
    marginLeft: 36,
    marginTop: -6,
  },
});
