import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Dimensions,
  RefreshControl,
  ImageBackground,
  Modal,
  TextInput,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useTripsStore } from '@/store/trips';
import { TripCard, TripCardStacked } from '@/components/trip-card';
import { CreateTripSheet } from '@/components/create-trip-sheet';
import { isTripUpcoming, isTripPast, isTripOngoing } from '@/utils/trip-helpers';
import type { Trip } from '@/types/voyage';
import { TrialBanner } from '@/components/trial-banner';
import { useAuthStore } from '@/store/auth';
import { useSubscription } from '@/hooks/use-subscription';
import { useTranslation } from '@/hooks/use-translation';
import { trpc } from '@/lib/trpc';

const { width } = Dimensions.get('window');

// Curated guides data (static)
const CURATED_GUIDES_BASE = [
  { id: 'paris-1day' as const, days: 1, spots: 9, imageUrl: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600' },
  { id: 'rome-1day' as const, days: 1, spots: 7, imageUrl: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600' },
  { id: 'london-3day' as const, days: 3, spots: 19, imageUrl: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600' },
  { id: 'tokyo-4day' as const, days: 4, spots: 14, imageUrl: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600' },
];

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { trips, loadTrips } = useTripsStore();
  const [showCreate, setShowCreate] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { user } = useAuthStore();
  const { isExpired } = useSubscription();
  const t = useTranslation();

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return trips.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      t.destinations.some((d: { name: string }) => d.name.toLowerCase().includes(q))
    );
  }, [trips, searchQuery]);

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

  // Shared trips (trips other users invited me to)
  const sharedTripsQuery = trpc.sharing.listSharedWithMe.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F0E8' }}>
      {/* Status bar background - extends bg color behind iPhone status bar */}
      <View style={{ height: insets.top, backgroundColor: '#F5F0E8' }} />
      <TrialBanner />
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
          style={{ paddingTop: 12, paddingBottom: 16 }}
        >
          <View>
            <Text style={{ fontSize: 32, fontFamily: 'serif', fontStyle: 'italic', color: '#1C3D2E', fontWeight: '400' }}>
              LocalsApp
            </Text>
            <Text className="text-muted text-xs tracking-widest font-semibold uppercase" style={{ marginTop: -2 }}>
            {t.home.curatedRoutes}
          </Text>
          </View>
          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={() => setShowCreate(true)}
              className="w-10 h-10 rounded-full bg-primary items-center justify-center"
            >
              <Ionicons name="add" size={20} color="#F5F0E8" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setShowSearch(true); setSearchQuery(''); }}
              className="w-10 h-10 rounded-full bg-primary items-center justify-center"
            >
              <Ionicons name="search" size={18} color="#F5F0E8" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/profile' as any)}
              className="w-10 h-10 rounded-full bg-primary items-center justify-center"
            >
              <Ionicons name="person-outline" size={18} color="#F5F0E8" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Por Vir section */}
        {upcomingTrips.length > 0 ? (
          <View className="mb-6">
            <Text className="text-muted text-xs tracking-widest font-semibold uppercase px-6 mb-3">
              {t.home.upcoming}
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
                  {t.home.noTrips}
                </Text>
                <View className="flex-row items-center justify-between">
                  <Text style={{ color: 'rgba(245,240,232,0.8)', fontSize: 14 }}>
                    {t.home.noTripsSubtitle}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowCreate(true)}
                    className="bg-background rounded-full px-5 py-2"
                  >
                    <Text className="text-foreground font-semibold text-sm">{t.common.add}</Text>
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
              {t.home.past}
            </Text>
            <TripCardStacked trips={pastTrips} onPressTrip={handleTripPress} />
          </View>
        )}

        {/* Viagens Compartilhadas comigo */}
        {sharedTripsQuery.data && sharedTripsQuery.data.length > 0 && (
          <View className="mb-6">
            <Text className="text-muted text-xs tracking-widest font-semibold uppercase px-6 mb-3">
              {t.sharing.sharedWithMe}
            </Text>
            {sharedTripsQuery.data.map((s) => {
              let tripData: Trip | null = null;
              try { tripData = JSON.parse(s.tripData); } catch {}
              if (!tripData) return null;
              return (
                <TouchableOpacity
                  key={s.shareId}
                  onPress={() => router.push(`/trip/${tripData!.id}`)}
                  style={{
                    marginHorizontal: 16,
                    marginBottom: 10,
                    borderRadius: 16,
                    overflow: 'hidden',
                    backgroundColor: '#fff',
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 14,
                    gap: 12,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.06,
                    shadowRadius: 4,
                    elevation: 2,
                  }}
                >
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#1C3D2E18', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="airplane-outline" size={22} color="#1C3D2E" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#1C3D2E' }} numberOfLines={1}>
                      {tripData.destinations?.[0]?.name ?? t.sharing.tripFallback}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#687076', marginTop: 2 }}>
                      {s.shareRole === 'editor' ? `✏️ ${t.sharing.roleEditor}` : `👁 ${t.sharing.roleViewer}`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#9BA1A6" />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Guias Curados */}
        <View>
          <Text
            style={{ fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', color: '#1C3D2E', paddingHorizontal: 24, marginBottom: 12 }}
          >
            {t.home.curatedGuides}
          </Text>
          <FlatList
            data={CURATED_GUIDES_BASE}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const guideI18n = (t.home.guides as Record<string, { title: string; destination: string }>)[item.id];
              const guideTitle = guideI18n?.title ?? item.id;
              return (
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
                        {guideTitle}
                      </Text>
                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>
                        {item.spots} {t.home.spotsLabel}
                      </Text>
                    </LinearGradient>
                  </ImageBackground>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </ScrollView>

      {/* Create Trip Sheet */}
      <CreateTripSheet
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleTripCreated}
      />

      {/* Search Modal */}
      <Modal
        visible={showSearch}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSearch(false)}
      >
        <View style={searchStyles.container}>
          <View style={searchStyles.header}>
            <View style={searchStyles.inputRow}>
              <Ionicons name="search" size={18} color="rgba(28,61,46,0.5)" />
              <TextInput
                style={searchStyles.input}
                placeholder={t.home.searchPlaceholder}
                placeholderTextColor="rgba(28,61,46,0.4)"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color="rgba(28,61,46,0.4)" />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity onPress={() => setShowSearch(false)} style={searchStyles.cancelBtn}>
              <Text style={searchStyles.cancelText}>{t.common.cancel}</Text>
            </TouchableOpacity>
          </View>

          {searchQuery.trim().length === 0 ? (
            <View style={searchStyles.emptyState}>
              <Ionicons name="search-outline" size={40} color="rgba(28,61,46,0.2)" />
              <Text style={searchStyles.emptyText}>{t.home.searchPlaceholder}</Text>
            </View>
          ) : searchResults.length === 0 ? (
            <View style={searchStyles.emptyState}>
              <Ionicons name="alert-circle-outline" size={40} color="rgba(28,61,46,0.2)" />
              <Text style={searchStyles.emptyText}>{t.common.noResults}</Text>
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 16, gap: 12 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={searchStyles.resultCard}
                  onPress={() => { setShowSearch(false); router.push(`/trip/${item.id}`); }}
                >
                  <View style={searchStyles.resultLeft}>
                    <Text style={searchStyles.resultName} numberOfLines={1}>{item.name}</Text>
                    <Text style={searchStyles.resultDest} numberOfLines={1}>
                      {item.destinations.map((d) => d.name).join(' · ')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="rgba(28,61,46,0.4)" />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const searchStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F0E8',
    paddingTop: Platform.OS === 'android' ? 16 : 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(28,61,46,0.15)',
  },
  inputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(28,61,46,0.08)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#1C3D2E',
  },
  cancelBtn: {
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 15,
    color: '#1C3D2E',
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingBottom: 80,
  },
  emptyText: {
    fontSize: 15,
    color: 'rgba(28,61,46,0.4)',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  resultLeft: { flex: 1 },
  resultName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C3D2E',
    marginBottom: 3,
  },
  resultDest: {
    fontSize: 13,
    color: 'rgba(28,61,46,0.5)',
  },
});
