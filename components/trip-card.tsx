import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ImageBackground,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { Trip } from '@/types/voyage';
import { getTripBadge, getTripName, formatDate, getTotalSpots } from '@/utils/trip-helpers';

const { width, height } = Dimensions.get('window');

// Card takes ~55% of screen height so ~1/3 of the next card peeks below
export const CARD_WIDTH = width - 32;
export const CARD_HEIGHT = Math.round(height * 0.52);
// Gap between cards — the peek amount is CARD_HEIGHT * ~0.33
const CARD_GAP = 16;

const DESTINATION_IMAGES: Record<string, string> = {
  paris: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800',
  rome: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=800',
  roma: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=800',
  london: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800',
  londres: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800',
  tokyo: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800',
  tóquio: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800',
  'new york': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800',
  'nova york': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800',
  barcelona: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=800',
  amsterdam: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=800',
  lisbon: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=800',
  lisboa: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=800',
  madrid: 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=800',
  berlin: 'https://images.unsplash.com/photo-1560969184-10fe8719e047?w=800',
  berlim: 'https://images.unsplash.com/photo-1560969184-10fe8719e047?w=800',
  santorini: 'https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?w=800',
  bali: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=800',
  dubai: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=800',
  default: 'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=800',
};

function getImageForTrip(trip: Trip): string {
  if (trip.coverImageUrl) return trip.coverImageUrl;
  const destName = trip.destinations[0]?.name?.toLowerCase() || '';
  for (const [key, url] of Object.entries(DESTINATION_IMAGES)) {
    if (destName.includes(key)) return url;
  }
  return DESTINATION_IMAGES.default;
}

interface TripCardProps {
  trip: Trip;
  onPress: () => void;
  style?: object;
}

/**
 * Full-width trip card.
 * - Info at the TOP (date left, destinations right) so it's visible when peeking.
 * - Trip name at the BOTTOM.
 * - Height ~52% of screen so ~1/3 of the next card peeks below.
 */
export function TripCard({ trip, onPress, style }: TripCardProps) {
  const badge = getTripBadge(trip);
  const name = getTripName(trip);
  const imageUrl = getImageForTrip(trip);
  const dateRange = `${formatDate(trip.startDate, 'short')} – ${formatDate(trip.endDate, 'short')}`;
  const destNames = trip.destinations.map((d) => d.name).join(' · ');

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.93}
      style={[styles.card, style]}
    >
      <ImageBackground
        source={{ uri: imageUrl }}
        style={styles.image}
        imageStyle={styles.imageStyle}
      >
        <LinearGradient
          colors={['rgba(0,0,0,0.52)', 'transparent', 'rgba(0,0,0,0.55)']}
          style={styles.gradient}
        >
          {/* ── Top row: date (left) + destinations (right) ── */}
          <View style={styles.topRow}>
            <View style={styles.dateBadge}>
              <Ionicons name="calendar-outline" size={11} color="rgba(255,255,255,0.9)" />
              <Text style={styles.dateText}>{dateRange}</Text>
            </View>
            <View style={styles.destBadge}>
              <Ionicons name="location-outline" size={11} color="rgba(255,255,255,0.9)" />
              <Text style={styles.destText} numberOfLines={1}>{destNames}</Text>
            </View>
          </View>

          {/* ── Bottom: trip name + status badge ── */}
          <View style={styles.bottomRow}>
            <Text style={styles.tripName} numberOfLines={2}>{name}</Text>
            <View style={styles.badgePill}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          </View>
        </LinearGradient>
      </ImageBackground>
    </TouchableOpacity>
  );
}

// ─── Stacked variant ──────────────────────────────────────────────────────────

interface TripCardStackedProps {
  trips: Trip[];
  onPressTrip: (trip: Trip) => void;
}

/**
 * Renders trips as a vertical list where 1/3 of the next card is visible.
 * Cards are spaced with CARD_GAP so the peek is natural.
 */
export function TripCardStacked({ trips, onPressTrip }: TripCardStackedProps) {
  if (trips.length === 0) return null;

  return (
    <View style={styles.listContainer}>
      {trips.map((trip, index) => (
        <TripCard
          key={trip.id}
          trip={trip}
          onPress={() => onPressTrip(trip)}
          style={index < trips.length - 1 ? { marginBottom: CARD_GAP } : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 24,
    overflow: 'hidden',
    alignSelf: 'center',
    // Subtle shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  image: {
    flex: 1,
  },
  imageStyle: {
    borderRadius: 24,
  },
  gradient: {
    flex: 1,
    borderRadius: 24,
    padding: 18,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dateText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  destBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexShrink: 1,
    maxWidth: '60%',
  },
  destText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  tripName: {
    color: '#fff',
    fontSize: 22,
    fontFamily: 'serif',
    fontStyle: 'italic',
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
    lineHeight: 28,
  },
  badgePill: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  listContainer: {
    paddingHorizontal: 16,
  },
});
