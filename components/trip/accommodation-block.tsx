import React, { useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { useTripsStore } from '@/store/trips';
import type { Trip, AccommodationType } from '@/types/voyage';
import { useTranslation } from '@/hooks/use-translation';
import type { TripPermissions } from '@/hooks/use-trip-permissions';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

const TYPE_OPTIONS: { id: AccommodationType; label: string; icon: string }[] = [
  { id: 'hotel', label: 'Hotel', icon: '🏨' },
  { id: 'house', label: 'Casa / Apartamento', icon: '🏠' },
  { id: 'other', label: 'Outro', icon: '📍' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function nightsBetween(checkIn: string, checkOut: string) {
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)));
}

// ─── Main Block ───────────────────────────────────────────────────────────────

interface AccommodationBlockProps {
  trip: Trip;
  permissions: TripPermissions;
}

export function AccommodationBlock({ trip, permissions }: AccommodationBlockProps) {
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { canEdit } = permissions;
  const removeAccommodation = useTripsStore((s) => s.removeAccommodation);
  const openAddAccommodation = (destinationId: string) =>
    router.push({ pathname: '/trip/[id]/add-accommodation', params: { id: trip.id, tripId: trip.id, destinationId } });

  return (
    <View style={styles.container}>
      <View style={styles.blockHeader}>
        <View style={styles.blockTitleRow}>
          <Ionicons name="bed-outline" size={16} color={colors.textAccent} />
          <Text style={styles.blockTitle}>{t.accommodation.title.toUpperCase()}</Text>
        </View>
      </View>

      {trip.destinations.map((dest) => {
        const destAccommodations = trip.accommodations.filter((a) => a.destinationId === dest.id);
        return (
          <View key={dest.id} style={styles.destSection}>
            <View style={styles.destHeaderRow}>
              <Text style={styles.destName}>{dest.name}</Text>
              <Text style={styles.destDays}>{dest.days} {dest.days !== 1 ? t.common.days : t.common.day}</Text>
            </View>

            {destAccommodations.length === 0 ? (
              <Text style={styles.noAccText}>{t.accommodation.noAccommodation}</Text>
            ) : (
              destAccommodations.map((acc) => {
                const typeInfo = TYPE_OPTIONS.find((t) => t.id === acc.type);
                const nights = nightsBetween(acc.checkIn, acc.checkOut);
                return (
                  <View key={acc.id} style={styles.accCard}>
                    <View style={styles.accCardHeader}>
                      <Text style={styles.accTypeEmoji}>{typeInfo?.icon || '🏨'}</Text>
                      <View style={styles.accInfo}>
                        <Text style={styles.accName}>{acc.name}</Text>
                        <Text style={styles.accDates}>
                          {formatDate(acc.checkIn)} → {formatDate(acc.checkOut)} ·                           {nights} {t.accommodation.nights}
                        </Text>
                        {acc.confirmationCode && (
                          <Text style={styles.accCode}>Reserva: {acc.confirmationCode}</Text>
                        )}
                        {acc.address && (
                          <Text style={styles.accAddress} numberOfLines={1}>{acc.address}</Text>
                        )}
                        {acc.confirmationDocUri && (
                          <TouchableOpacity
                            style={styles.docBadge}
                            activeOpacity={0.7}
                            onPress={() => {
                              Linking.openURL(acc.confirmationDocUri!).catch(() =>
                                Alert.alert(t.common.error, t.documentsExtra.openError)
                              );
                            }}
                          >
                            <Ionicons name="document-attach-outline" size={11} color={colors.textAccent} />
                            <Text style={styles.docBadgeText}>{t.accommodation.confirmationAttached}</Text>
                            <Ionicons name="open-outline" size={10} color={withAlpha(colors.primary, 0.7)} />
                          </TouchableOpacity>
                        )}
                      </View>
                      {canEdit ? (
                        <Pressable
                          onPress={() => removeAccommodation(trip.id, acc.id)}
                          style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.7 : 1 }]}
                        >
                          <Ionicons name="trash-outline" size={14} color={colors.error} />
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}

            {canEdit ? (
              <Pressable
                onPress={() => openAddAccommodation(dest.id)}
                style={({ pressed }) => [styles.addAccBtn, { opacity: pressed ? 0.8 : 1 }]}
              >
                <Ionicons name="add" size={14} color={colors.textAccent} />
                <Text style={styles.addAccBtnText}>{t.accommodation.addAccommodation}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  blockHeader: {
    marginBottom: 12,
  },
  blockTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  blockTitle: {
    color: colors.textAccent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  destSection: {
    marginBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  destHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  destName: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '600',
  },
  destDays: {
    color: colors.textAccent,
    fontSize: 12,
  },
  noAccText: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: 8,
  },
  accCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  accCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  accTypeEmoji: {
    fontSize: 22,
    marginTop: 2,
  },
  accInfo: {
    flex: 1,
    gap: 2,
  },
  accName: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '600',
  },
  accDates: {
    color: colors.textAccent,
    fontSize: 12,
  },
  accCode: {
    color: colors.muted,
    fontSize: 11,
  },
  accAddress: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
  },
  docBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  docBadgeText: {
    color: colors.textAccent,
    fontSize: 11,
  },
  removeBtn: {
    padding: 4,
  },
  addAccBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: withAlpha(colors.primary, 0.3),
    borderStyle: 'dashed',
    alignSelf: 'flex-start',
  },
  addAccBtnText: {
    color: colors.textAccent,
    fontSize: 13,
    fontWeight: '500',
  },
  // Modal
  // Full-screen backdrop scrim behind the bottom sheet — universal UI
  // pattern, intentionally theme-independent.
  overlay: {
    flex: 1,
    backgroundColor: colors.overlayModal,
    justifyContent: 'flex-end',
  },
  addSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    maxHeight: '92%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  addHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  addTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addScroll: {
    paddingHorizontal: 20,
  },
  typeRow: {
    marginBottom: 16,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  typeChipEmoji: {
    fontSize: 16,
  },
  typeChipLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 16,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  nightsBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 44,
  },
  nightsNum: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  nightsLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 9,
    fontWeight: '600',
  },
  saveBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
