import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ImageBackground,
  Dimensions,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { Trip } from '@/types/voyage';
import { getTripBadge, getTripName, formatDate } from '@/utils/trip-helpers';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width } = Dimensions.get('window');

// Credit-card proportions: 85.6mm × 53.98mm → ratio ~1.586
export const CARD_WIDTH = width - 32;
export const CARD_HEIGHT = Math.round(CARD_WIDTH / 1.586); // ~200px on 375px screen

// How much of each card sticks out above the one in front of it
const PEEK_HEIGHT = 64;

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

// ─── Standalone TripCard (used outside of stacked context) ───────────────────

interface TripCardProps {
  trip: Trip;
  onPress: () => void;
  style?: object;
}

export function TripCard({ trip, onPress, style }: TripCardProps) {
  const badge = getTripBadge(trip);
  const name = getTripName(trip);
  const imageUrl = getImageForTrip(trip);
  const dateRange = `${formatDate(trip.startDate, 'short')} – ${formatDate(trip.endDate, 'short')}`;
  const destNames = trip.destinations.map((d) => d.name).join(' · ');

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.93} style={[styles.card, style]}>
      <ImageBackground source={{ uri: imageUrl }} style={styles.image} imageStyle={styles.imageStyle}>
        <LinearGradient
          colors={['rgba(0,0,0,0.55)', 'transparent', 'rgba(0,0,0,0.6)']}
          style={styles.gradient}
        >
          <View style={styles.topRow}>
            <View style={styles.infoBadge}>
              <Ionicons name="calendar-outline" size={11} color="rgba(255,255,255,0.9)" />
              <Text style={styles.infoText}>{dateRange}</Text>
            </View>
            <View style={[styles.infoBadge, { flexShrink: 1, maxWidth: '55%' }]}>
              <Ionicons name="location-outline" size={11} color="rgba(255,255,255,0.9)" />
              <Text style={styles.infoText} numberOfLines={1}>{destNames}</Text>
            </View>
          </View>
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

// ─── Apple Wallet Stacked Cards ───────────────────────────────────────────────

interface TripCardStackedProps {
  trips: Trip[];
  onPressTrip: (trip: Trip) => void;
}

/**
 * True Apple Wallet stack:
 * - All cards are absolutely positioned on top of each other.
 * - Only PEEK_HEIGHT of each card is visible (the top strip).
 * - The last (bottom) card is fully visible.
 * - Tapping a peek strip brings that card to the active position (bottom).
 * - The container height = (n-1) * PEEK_HEIGHT + CARD_HEIGHT.
 */
export function TripCardStacked({ trips, onPressTrip }: TripCardStackedProps) {
  // activeIndex = which card is "on top" / fully expanded
  // We start with the last card expanded (index = trips.length - 1)
  const [activeIndex, setActiveIndex] = useState(trips.length - 1);

  if (trips.length === 0) return null;
  if (trips.length === 1) {
    return (
      <View style={{ paddingHorizontal: 16 }}>
        <TripCard trip={trips[0]} onPress={() => onPressTrip(trips[0])} />
      </View>
    );
  }

  const handlePeekPress = (index: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveIndex(index);
  };

  // Build display order: cards are rendered back-to-front (index 0 at back).
  // Each card i gets a top offset = i * PEEK_HEIGHT.
  // The active card gets top = activeIndex * PEEK_HEIGHT (same formula).
  // Cards after activeIndex are hidden behind the active card.
  //
  // Visual order (zIndex): card 0 has lowest zIndex, last card highest.
  // But we want the active card on top → give it the highest zIndex.

  const n = trips.length;
  // Total container height: all peeks + one full card
  const containerHeight = (n - 1) * PEEK_HEIGHT + CARD_HEIGHT;

  return (
    <View style={{ paddingHorizontal: 16 }}>
      <View style={{ height: containerHeight, position: 'relative' }}>
        {trips.map((trip, idx) => {
          const imageUrl = getImageForTrip(trip);
          const name = getTripName(trip);
          const badge = getTripBadge(trip);
          const dateRange = `${formatDate(trip.startDate, 'short')} – ${formatDate(trip.endDate, 'short')}`;
          const destNames = trip.destinations.map((d) => d.name).join(' · ');

          // Cards before activeIndex: stacked at their natural position
          // Active card: sits at activeIndex * PEEK_HEIGHT
          // Cards after activeIndex: hidden behind active card (same top as active)
          let topOffset: number;
          if (idx <= activeIndex) {
            topOffset = idx * PEEK_HEIGHT;
          } else {
            // Push cards after active behind the active card (not visible)
            topOffset = activeIndex * PEEK_HEIGHT;
          }

          // zIndex: active card is on top, others below in order
          const zIndex = idx === activeIndex ? n + 10 : idx;

          const isActive = idx === activeIndex;

          return (
            <TouchableOpacity
              key={trip.id}
              activeOpacity={isActive ? 0.93 : 0.85}
              onPress={() => {
                if (isActive) {
                  onPressTrip(trip);
                } else {
                  handlePeekPress(idx);
                }
              }}
              style={[
                styles.card,
                {
                  position: 'absolute',
                  top: topOffset,
                  left: 0,
                  right: 0,
                  zIndex,
                  // Only show full card height for active; others are clipped by cards on top
                  height: CARD_HEIGHT,
                },
              ]}
            >
              <ImageBackground
                source={{ uri: imageUrl }}
                style={styles.image}
                imageStyle={styles.imageStyle}
              >
                <LinearGradient
                  colors={['rgba(0,0,0,0.60)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.65)']}
                  style={styles.gradient}
                >
                  {/* Top peek area: name left, badge right */}
                  <View style={styles.topRow}>
                    <Text style={styles.tripName} numberOfLines={1}>{name}</Text>
                    <View style={styles.badgePill}>
                      <Text style={styles.badgeText}>{badge}</Text>
                    </View>
                  </View>

                  {/* Second line: date + destination (always in peek area) */}
                  <View style={styles.peekSecondLine}>
                    <View style={styles.peekInfoItem}>
                      <Ionicons name="calendar-outline" size={10} color="rgba(255,255,255,0.75)" />
                      <Text style={styles.peekInfoText}>{dateRange}</Text>
                    </View>
                    <View style={styles.peekInfoItem}>
                      <Ionicons name="location-outline" size={10} color="rgba(255,255,255,0.75)" />
                      <Text style={styles.peekInfoText} numberOfLines={1}>{destNames}</Text>
                    </View>
                  </View>
                </LinearGradient>
              </ImageBackground>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 8,
  },
  image: {
    flex: 1,
  },
  imageStyle: {
    borderRadius: 20,
  },
  gradient: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    justifyContent: 'flex-start',
    gap: 6,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  tripName: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'serif',
    fontStyle: 'italic',
    fontWeight: '700',
    flex: 1,
    lineHeight: 20,
  },
  badgePill: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    flexShrink: 0,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  peekSecondLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  peekInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  peekInfoText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
  },
  // Legacy standalone card styles (used by TripCard export)
  infoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  infoText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 'auto' as any,
  },
});
