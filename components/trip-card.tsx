import React from 'react';
import { View, Text, TouchableOpacity, ImageBackground, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { Trip } from '@/types/voyage';
import { getTripBadge, getTripName, formatDate, getTotalSpots } from '@/utils/trip-helpers';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width * 0.72;
const CARD_HEIGHT = 220;

// Destination cover images (using Unsplash for demo)
const DESTINATION_IMAGES: Record<string, string> = {
  paris: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800',
  rome: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=800',
  london: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800',
  tokyo: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800',
  'new york': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800',
  barcelona: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=800',
  amsterdam: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=800',
  lisbon: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?w=800',
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

export function TripCard({ trip, onPress, style }: TripCardProps) {
  const badge = getTripBadge(trip);
  const name = getTripName(trip);
  const spots = getTotalSpots(trip);
  const imageUrl = getImageForTrip(trip);
  const dateRange = `${formatDate(trip.startDate, 'short')} - ${formatDate(trip.endDate, 'short')}`;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.92}
      style={[{ width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: 20, overflow: 'hidden' }, style]}
    >
      <ImageBackground
        source={{ uri: imageUrl }}
        style={{ flex: 1 }}
        imageStyle={{ borderRadius: 20 }}
      >
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.75)']}
          style={{ flex: 1, borderRadius: 20, justifyContent: 'flex-end', padding: 16 }}
        >
          {/* Badge */}
          <View
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              backgroundColor: 'rgba(255,255,255,0.2)',
              borderRadius: 20,
              paddingHorizontal: 10,
              paddingVertical: 4,
              backdropFilter: 'blur(10px)',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>{badge}</Text>
          </View>

          {/* Bottom info */}
          <Text
            style={{ color: '#fff', fontSize: 20, fontFamily: 'serif', fontStyle: 'italic', fontWeight: '600', marginBottom: 4 }}
            numberOfLines={2}
          >
            {name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="calendar-outline" size={12} color="rgba(255,255,255,0.8)" />
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>{dateRange}</Text>
            </View>
            {spots > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.8)" />
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>{spots} spots</Text>
              </View>
            )}
          </View>
        </LinearGradient>
      </ImageBackground>
    </TouchableOpacity>
  );
}

// Compact stacked card for the "Por Vir" section header
interface TripCardStackedProps {
  trips: Trip[];
  onPressTrip: (trip: Trip) => void;
}

export function TripCardStacked({ trips, onPressTrip }: TripCardStackedProps) {
  if (trips.length === 0) return null;

  const mainTrip = trips[trips.length - 1]; // Show the soonest upcoming
  const imageUrl = getImageForTrip(mainTrip);
  const name = getTripName(mainTrip);
  const badge = getTripBadge(mainTrip);
  const spots = getTotalSpots(mainTrip);
  const dateRange = `${formatDate(mainTrip.startDate, 'short')} - ${formatDate(mainTrip.endDate, 'short')}`;

  return (
    <View style={{ height: 260, marginHorizontal: 16 }}>
      {/* Stack effect - background cards */}
      {trips.length > 2 && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 16,
            right: 16,
            height: 240,
            borderRadius: 20,
            backgroundColor: 'rgba(28,61,46,0.3)',
          }}
        />
      )}
      {trips.length > 1 && (
        <View
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            height: 240,
            borderRadius: 20,
            backgroundColor: 'rgba(28,61,46,0.5)',
          }}
        />
      )}

      {/* Main card */}
      <TouchableOpacity
        onPress={() => onPressTrip(mainTrip)}
        activeOpacity={0.92}
        style={{ position: 'absolute', top: 16, left: 0, right: 0, height: 240, borderRadius: 20, overflow: 'hidden' }}
      >
        <ImageBackground
          source={{ uri: imageUrl }}
          style={{ flex: 1 }}
          imageStyle={{ borderRadius: 20 }}
        >
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.8)']}
            style={{ flex: 1, borderRadius: 20, justifyContent: 'flex-end', padding: 20 }}
          >
            {/* Stack labels */}
            {trips.length > 1 && (
              <View style={{ position: 'absolute', top: 12, left: 16, right: 16 }}>
                {trips.slice(0, -1).reverse().map((t, idx) => (
                  <View
                    key={t.id}
                    style={{
                      backgroundColor: 'rgba(0,0,0,0.4)',
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      marginBottom: 4,
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontFamily: 'serif', fontStyle: 'italic' }}>
                      {getTripName(t)}
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>
                      {getTripBadge(t)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <Text
              style={{ color: '#fff', fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', fontWeight: '600', marginBottom: 6 }}
              numberOfLines={2}
            >
              {name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="calendar-outline" size={13} color="rgba(255,255,255,0.8)" />
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>{dateRange}</Text>
              </View>
              {spots > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.8)" />
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>{spots} spots</Text>
                </View>
              )}
            </View>
          </LinearGradient>
        </ImageBackground>
      </TouchableOpacity>
    </View>
  );
}
