import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from '@/hooks/use-translation';
import { trpc } from '@/lib/trpc';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { sheetScreenOptions } from '@/utils/sheet-presentation';
import type { Trip } from '@/types/voyage';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

/** Pending trip-share invites addressed to the current user — [0.6, 1.0] sheet. */
export default function InvitesInboxScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const t = useTranslation();
  const user = useAuthStore((s) => s.user);
  const utils = trpc.useUtils();

  const pendingInvitesQuery = trpc.sharing.listPendingForMe.useQuery(undefined, {
    enabled: !!user,
    staleTime: 30_000,
  });
  const acceptMutation = trpc.sharing.accept.useMutation();
  const declineMutation = trpc.sharing.decline.useMutation();

  const handleAcceptInvite = async (token: string) => {
    try {
      await acceptMutation.mutateAsync({ token });
      await Promise.all([
        pendingInvitesQuery.refetch(),
        utils.sharing.listSharedWithMe.invalidate(),
      ]);
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
    <>
      <Stack.Screen options={sheetScreenOptions(colors, [0.6, 1.0])} />
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: colors.foreground, flex: 1 }]}>
            {t.sharing.inboxTitle}
          </Text>
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
            keyboardShouldPersistTaps="handled"
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
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: Platform.OS === 'android' ? 16 : 0 },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 80 },
  emptyText: { fontSize: 15, color: colors.muted, textAlign: 'center', paddingHorizontal: 32 },
  resultName: { fontSize: 16, fontWeight: '600', color: colors.foreground, marginBottom: 3 },
  resultDest: { fontSize: 13, color: colors.muted },
  inviteCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  inviteActionBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
});
