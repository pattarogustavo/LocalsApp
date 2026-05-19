import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Dimensions,
  RefreshControl,
  ImageBackground,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useTripsStore } from '@/store/trips';
import { TripCard, TripCardStacked } from '@/components/trip-card';
import { CreateTripSheet } from '@/components/create-trip-sheet';
import { isTripUpcoming, isTripPast, isTripOngoing } from '@/utils/trip-helpers';
import type { Trip, CuratedGuide } from '@/types/voyage';

const { width } = Dimensions.get('window');

// Curated guides data (static)
const CURATED_GUIDES: CuratedGuide[] = [
  {
    id: 'paris-1day',
    title: '1-Day Paris Trip',
    destination: 'Paris, França',
    days: 1,
    spots: 9,
    imageUrl: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600',
  },
  {
    id: 'rome-1day',
    title: '1-Day Rome Trip',
    destination: 'Roma, Itália',
    days: 1,
    spots: 7,
    imageUrl: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600',
  },
  {
    id: 'london-3day',
    title: '3-Day London Trip',
    destination: 'Londres, Reino Unido',
    days: 3,
    spots: 19,
    imageUrl: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600',
  },
  {
    id: 'tokyo-4day',
    title: '4-Day Tokyo Trip',
    destination: 'Tóquio, Japão',
    days: 4,
    spots: 14,
    imageUrl: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600',
  },
];

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { trips, loadTrips } = useTripsStore();
  const [showCreate, setShowCreate] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadTrips();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTrips();
    setRefreshing(false);
  }, []);

  const upcomingTrips = trips.filter((t) => isTripUpcoming(t) || isTripOngoing(t))
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  const pastTrips = trips.filter((t) => isTripPast(t))
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

  const handleTripPress = (trip: Trip) => {
    router.push(`/trip/${trip.id}`);
  };

  const handleTripCreated = (trip: Trip) => {
    router.push(`/trip/${trip.id}`);
  };

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1C3D2E" />
        }
      >
        {/* Header */}
        <View
          className="flex-row items-center justify-between px-6"
          style={{ paddingTop: insets.top + 12, paddingBottom: 16 }}
        >
          <View>
            <Text style={{ fontSize: 32, fontFamily: 'serif', fontStyle: 'italic', color: '#1C3D2E', fontWeight: '400' }}>
              Voyage
            </Text>
            <Text className="text-muted text-xs tracking-widest font-semibold uppercase" style={{ marginTop: -2 }}>
              Curated Routes
            </Text>
          </View>
          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={() => setShowCreate(true)}
              className="w-10 h-10 rounded-full bg-primary items-center justify-center"
            >
              <Ionicons name="add" size={20} color="#F5F0E8" />
            </TouchableOpacity>
            <TouchableOpacity className="w-10 h-10 rounded-full bg-primary items-center justify-center">
              <Ionicons name="search" size={18} color="#F5F0E8" />
            </TouchableOpacity>
            <TouchableOpacity className="w-10 h-10 rounded-full bg-primary items-center justify-center">
              <Ionicons name="ellipsis-horizontal" size={18} color="#F5F0E8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Por Vir section */}
        {upcomingTrips.length > 0 ? (
          <View className="mb-6">
            <Text className="text-muted text-xs tracking-widest font-semibold uppercase px-6 mb-3">
              Por Vir
            </Text>
            <TripCardStacked trips={upcomingTrips} onPressTrip={handleTripPress} />
          </View>
        ) : (
          /* Empty state - Create first trip CTA */
          <View className="mx-6 mb-6 rounded-3xl overflow-hidden" style={{ height: 200 }}>
            <ImageBackground
              source={{ uri: 'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=800' }}
              style={{ flex: 1 }}
              imageStyle={{ borderRadius: 24 }}
            >
              <LinearGradient
                colors={['rgba(28,61,46,0.6)', 'rgba(28,61,46,0.9)']}
                style={{ flex: 1, borderRadius: 24, justifyContent: 'flex-end', padding: 20 }}
              >
                <Text style={{ color: '#F5F0E8', fontSize: 20, fontFamily: 'serif', fontStyle: 'italic', fontWeight: '600', marginBottom: 4 }}>
                  Crie seu primeiro roteiro
                </Text>
                <View className="flex-row items-center justify-between">
                  <Text style={{ color: 'rgba(245,240,232,0.8)', fontSize: 14 }}>
                    Viagens curadas e planejadas.
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowCreate(true)}
                    className="bg-background rounded-full px-5 py-2"
                  >
                    <Text className="text-foreground font-semibold text-sm">Criar</Text>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </ImageBackground>
          </View>
        )}

        {/* Já Aconteceram section */}
        {pastTrips.length > 0 && (
          <View className="mb-6">
            <Text className="text-muted text-xs tracking-widest font-semibold uppercase px-6 mb-3">
              Já Aconteceram
            </Text>
            <TripCardStacked trips={pastTrips} onPressTrip={handleTripPress} />
          </View>
        )}

        {/* Guias Curados */}
        <View>
          <Text
            style={{ fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', color: '#1C3D2E', paddingHorizontal: 24, marginBottom: 12 }}
          >
            Guias Curados
          </Text>
          <FlatList
            data={CURATED_GUIDES}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                activeOpacity={0.9}
                style={{ width: 140, height: 180, borderRadius: 16, overflow: 'hidden' }}
              >
                <ImageBackground
                  source={{ uri: item.imageUrl }}
                  style={{ flex: 1 }}
                  imageStyle={{ borderRadius: 16 }}
                >
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.75)']}
                    style={{ flex: 1, borderRadius: 16, justifyContent: 'flex-end', padding: 12 }}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', marginBottom: 2 }} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>
                      {item.spots} Spots
                    </Text>
                  </LinearGradient>
                </ImageBackground>
              </TouchableOpacity>
            )}
          />
        </View>
      </ScrollView>

      {/* Create Trip Sheet */}
      <CreateTripSheet
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleTripCreated}
      />
    </View>
  );
}
