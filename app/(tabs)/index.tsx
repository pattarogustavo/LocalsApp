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
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTripsStore } from '@/store/trips';
import { TripCard, TripCardStacked, getImageForTrip } from '@/components/trip-card';
import { CreateTripSheet } from '@/components/create-trip-sheet';
import { isTripUpcoming, isTripPast, isTripOngoing, getTripName } from '@/utils/trip-helpers';
import type { Trip } from '@/types/voyage';
import { useAuthStore } from '@/store/auth';
import { useSubscription } from '@/hooks/use-subscription';
import { useTranslation } from '@/hooks/use-translation';
import { trpc } from '@/lib/trpc';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { Wordmark } from '@/components/ui/wordmark-logo';

const { width } = Dimensions.get('window');

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { trips, loadTrips } = useTripsStore();
  const [showCreate, setShowCreate] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pastExpanded, setPastExpanded] = useState(false);
  const { user } = useAuthStore();
  const { isExpired } = useSubscription();
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return trips.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      t.destinations.some((d: { name: string }) => d.name.toLowerCase().includes(q))
    );
  }, [trips, searchQuery]);

  const favoriteTrips = useMemo(() => trips.filter((t) => t.isFavorite), [trips]);

  useEffect(() => {
    loadTrips();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTrips();
    setRefreshing(false);
  }, []);

  // Shared trips (trips other users invited me to) — merged into the normal
  // upcoming/past flow so they render with the same TripCardStacked visuals.
  const sharedTripsQuery = trpc.sharing.listSharedWithMe.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });

  const { sharedTrips, sharedShareIdByTripId } = useMemo(() => {
    const list: Trip[] = [];
    const map: Record<string, number> = {};
    for (const s of sharedTripsQuery.data ?? []) {
      let tripData: Trip | null = null;
      try { tripData = JSON.parse(s.tripData); } catch {}
      if (!tripData) continue;
      list.push(tripData);
      map[tripData.id] = s.shareId;
    }
    return { sharedTrips: list, sharedShareIdByTripId: map };
  }, [sharedTripsQuery.data]);

  const sharedTripIds = useMemo(() => new Set(sharedTrips.map((t) => t.id)), [sharedTrips]);

  const allTrips = useMemo(() => [...trips, ...sharedTrips], [trips, sharedTrips]);

  const upcomingTrips = allTrips.filter((t) => isTripUpcoming(t) || isTripOngoing(t))
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  const pastTrips = allTrips.filter((t) => isTripPast(t))
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

  const handleTripPress = (trip: Trip) => {
    router.push(`/trip/${trip.id}`);
  };

  const handleTripCreated = (trip: Trip) => {
    router.push(`/trip/${trip.id}`);
  };

  // Pending invites addressed to me (inbox)
  const [showInbox, setShowInbox] = useState(false);
  const pendingInvitesQuery = trpc.sharing.listPendingForMe.useQuery(undefined, {
    enabled: !!user,
    staleTime: 30_000,
  });
  const acceptMutation = trpc.sharing.accept.useMutation();
  const declineMutation = trpc.sharing.decline.useMutation();
  const hideForMeMutation = trpc.sharing.hideForMe.useMutation();
  const pendingCount = pendingInvitesQuery.data?.length ?? 0;

  const handleHideSharedTrip = (shareId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      t.trip.deleteTrip,
      t.trip.deleteTripConfirm,
      [
        { text: t.common.cancel, style: 'cancel' },
        {
          text: t.common.delete,
          style: 'destructive',
          onPress: async () => {
            try {
              await hideForMeMutation.mutateAsync({ shareId });
              sharedTripsQuery.refetch();
            } catch {
              // Offline or unauthenticated — ignore
            }
          },
        },
      ]
    );
  };

  const handleHideSharedTripByTripId = (trip: Trip) => {
    const shareId = sharedShareIdByTripId[trip.id];
    if (shareId != null) handleHideSharedTrip(shareId);
  };

  const handleAcceptInvite = async (token: string) => {
    try {
      await acceptMutation.mutateAsync({ token });
      await Promise.all([pendingInvitesQuery.refetch(), sharedTripsQuery.refetch()]);
    } catch {
      // Offline or already handled — ignore
    }
  };

  const handleDeclineInvite = async (shareId: number) => {
    try {
      await declineMutation.mutateAsync({ shareId });
      pendingInvitesQuery.refetch();
    } catch {
      // Offline or already handled — ignore
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Status bar background - extends bg color behind iPhone status bar */}
      <View style={{ height: insets.top, backgroundColor: colors.background }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.foreground} />
        }
      >
        {/* Header */}
        <View
          className="flex-row items-center justify-between px-6"
          style={{ paddingTop: 12, paddingBottom: 16 }}
        >
          <View>
            <Wordmark size={16} color={colors.foreground} />
          </View>
          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={() => setShowCreate(true)}
              className="w-10 h-10 rounded-full bg-primary items-center justify-center"
            >
              <Ionicons name="add" size={20} color={colors.textOnPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setShowSearch(true); setSearchQuery(''); }}
              className="w-10 h-10 rounded-full bg-primary items-center justify-center"
            >
              <Ionicons name="search" size={18} color={colors.textOnPrimary} />
            </TouchableOpacity>
            {!!user && (
              <TouchableOpacity
                onPress={() => setShowInbox(true)}
                className="w-10 h-10 rounded-full bg-primary items-center justify-center"
                style={{ position: 'relative' }}
              >
                <Ionicons name="mail-outline" size={18} color={colors.textOnPrimary} />
                {pendingCount > 0 && (
                  <View
                    style={{
                      position: 'absolute',
                      top: -2,
                      right: -2,
                      minWidth: 16,
                      height: 16,
                      borderRadius: 8,
                      backgroundColor: colors.error,
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingHorizontal: 3,
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => router.push('/profile' as any)}
              className="w-10 h-10 rounded-full bg-primary items-center justify-center"
            >
              <Ionicons name="person-outline" size={18} color={colors.textOnPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Por Vir section */}
        {upcomingTrips.length > 0 ? (
          <View className="mb-6">
            <Text className="text-muted text-[14px] tracking-widest font-semibold uppercase px-6 mb-3">
              {t.home.upcoming}
            </Text>
            <TripCardStacked
              trips={upcomingTrips}
              onPressTrip={handleTripPress}
              sharedTripIds={sharedTripIds}
              onHideShared={handleHideSharedTripByTripId}
            />
          </View>
        ) : (
          /* Empty state - Create first trip CTA */
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setShowCreate(true)}
            style={{
              marginHorizontal: 24,
              marginBottom: 24,
              height: 200,
              borderRadius: 24,
              backgroundColor: colors.emptyStateBackground,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 24,
              gap: 12,
            }}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="add" size={26} color={colors.textOnPrimary} />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 20, fontFamily: 'serif', fontStyle: 'italic', fontWeight: '600', textAlign: 'center' }}>
              {t.home.noTrips}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 14, textAlign: 'center' }}>
              {t.home.noTripsSubtitle}
            </Text>
          </TouchableOpacity>
        )}

        {/* Já Aconteceram section — collapsed by default */}
        {pastTrips.length > 0 && (
          <View className="mb-6">
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                setPastExpanded((v) => !v);
              }}
              className="flex-row items-center justify-between px-6 mb-3"
              activeOpacity={0.7}
            >
              <Text className="text-muted text-[14px] tracking-widest font-semibold uppercase">
                {t.home.past} ({pastTrips.length})
              </Text>
              <Ionicons name={pastExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
            </TouchableOpacity>
            {pastExpanded && (
              <TripCardStacked
                trips={pastTrips}
                onPressTrip={handleTripPress}
                sharedTripIds={sharedTripIds}
                onHideShared={handleHideSharedTripByTripId}
              />
            )}
          </View>
        )}

        {/* Guias Favoritos — trips marked as favorite by the user */}
        {favoriteTrips.length > 0 && (
          <View>
            <Text
              style={{ fontSize: 22, fontFamily: 'serif', fontStyle: 'italic', color: colors.foreground, paddingHorizontal: 24, marginBottom: 12 }}
            >
              {t.home.favoriteGuides}
            </Text>
            <FlatList
              data={favoriteTrips}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => handleTripPress(item)}
                  style={{ width: 140, height: 180, borderRadius: 16, overflow: 'hidden' }}
                >
                  <ImageBackground
                    source={{ uri: getImageForTrip(item) }}
                    style={{ flex: 1 }}
                    imageStyle={{ borderRadius: 16 }}
                  >
                    <LinearGradient
                      colors={['transparent', 'rgba(0,0,0,0.75)']}
                      style={{ flex: 1, borderRadius: 16, justifyContent: 'flex-end', padding: 12 }}
                    >
                      <Text style={{ color: colors.textOnPrimary, fontSize: 13, fontWeight: '600' }} numberOfLines={2}>
                        {getTripName(item)}
                      </Text>
                    </LinearGradient>
                  </ImageBackground>
                </TouchableOpacity>
              )}
            />
          </View>
        )}
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
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.inputRow}>
              <Ionicons name="search" size={18} color={colors.muted} />
              <TextInput
                style={styles.input}
                placeholder={t.home.searchPlaceholder}
                placeholderTextColor={colors.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={colors.muted} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity onPress={() => setShowSearch(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>{t.common.cancel}</Text>
            </TouchableOpacity>
          </View>

          {searchQuery.trim().length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="search-outline" size={40} color={colors.muted} />
              <Text style={styles.emptyText}>{t.home.searchPlaceholder}</Text>
            </View>
          ) : searchResults.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="alert-circle-outline" size={40} color={colors.muted} />
              <Text style={styles.emptyText}>{t.common.noResults}</Text>
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 16, gap: 12 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.resultCard}
                  onPress={() => { setShowSearch(false); router.push(`/trip/${item.id}`); }}
                >
                  <View style={styles.resultLeft}>
                    <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.resultDest} numberOfLines={1}>
                      {item.destinations.map((d) => d.name).join(' · ')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>

      {/* Invites Inbox Modal */}
      <Modal
        visible={showInbox}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowInbox(false)}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: colors.foreground, flex: 1 }]}>
              {t.sharing.inboxTitle}
            </Text>
            <TouchableOpacity onPress={() => setShowInbox(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>{t.common.cancel}</Text>
            </TouchableOpacity>
          </View>

          {pendingInvitesQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
          ) : !pendingInvitesQuery.data || pendingInvitesQuery.data.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="mail-open-outline" size={40} color={colors.muted} />
              <Text style={styles.emptyText}>{t.sharing.inboxEmpty}</Text>
            </View>
          ) : (
            <FlatList
              data={pendingInvitesQuery.data}
              keyExtractor={(item) => String(item.shareId)}
              contentContainerStyle={{ padding: 16, gap: 12 }}
              renderItem={({ item }) => {
                let tripData: Trip | null = null;
                try { tripData = JSON.parse(item.tripData); } catch {}
                return (
                  <View style={styles.inviteCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: withAlpha(colors.foreground, 0.094), alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="airplane-outline" size={22} color={colors.foreground} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.resultName} numberOfLines={1}>
                          {tripData?.destinations?.[0]?.name ?? tripData?.name ?? t.sharing.tripFallback}
                        </Text>
                        <Text style={styles.resultDest} numberOfLines={1}>
                          {item.ownerName ? `${t.sharing.invitedByPrefix} ${item.ownerName}` : ''}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                      <TouchableOpacity
                        onPress={() => handleDeclineInvite(item.shareId)}
                        style={[styles.inviteActionBtn, { borderColor: colors.border }]}
                      >
                        <Text style={{ color: colors.foreground, fontWeight: '600' }}>{t.sharing.declineBtn}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleAcceptInvite(item.token)}
                        style={[styles.inviteActionBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                      >
                        <Text style={{ color: colors.textOnPrimary, fontWeight: '600' }}>{t.sharing.acceptBtn}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    borderBottomColor: colors.border,
  },
  inputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: withAlpha(colors.foreground, 0.5),
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.foreground,
  },
  cancelBtn: {
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 15,
    color: colors.foreground,
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
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
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
    color: colors.foreground,
    marginBottom: 3,
  },
  resultDest: {
    fontSize: 13,
    color: colors.muted,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  inviteCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  inviteActionBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
