import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  Platform,
  KeyboardAvoidingView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTripsStore } from '@/store/trips';
import { generateId } from '@/utils/trip-helpers';
import { PlacesAutocompleteInput } from '@/components/ui/places-autocomplete-input';
import { AIPreferencesModal } from '@/components/ai-preferences-modal';
import { PaywallModal } from '@/components/paywall-modal';
import { trpc } from '@/lib/trpc';
import { getApiBaseUrl } from '@/constants/api';
import type { Trip, Destination } from '@/types/voyage';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { DatePickerField } from '@/components/ui/date-picker-field';
import { useTranslation } from '@/hooks/use-translation';

interface CreateTripSheetProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: (trip: Trip) => void;
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatDateDisplay(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function CreateTripSheet({ visible, onClose, onCreated }: CreateTripSheetProps) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const t = useTranslation();
  const addTrip = useTripsStore((s) => s.addTrip);
  const userPlan = useTripsStore((s) => s.userPlan);

  const [startDate, setStartDate] = useState<Date | null>(null);
  const [totalDays, setTotalDays] = useState(3);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  // For date picker
  const today = new Date();
  const [pickerDate, setPickerDate] = useState(today);

  const distributedDays = destinations.reduce((sum, d) => sum + d.days, 0);
  const canCreate = startDate !== null && destinations.length > 0;

  // tRPC query for place details (to get lat/lng/imageUrl after selection)
  const detailsQuery = trpc.places.details.useQuery(
    { placeId: '' },
    { enabled: false }
  );

  const handleSelectDestination = async (prediction: {
    placeId: string;
    name: string;
    fullDescription: string;
    country: string;
  }) => {
    // Check if already added
    if (destinations.find((d) => d.placeId === prediction.placeId)) return;

    const remainingDays = Math.max(1, totalDays - distributedDays);
    const tempId = generateId();
    const newDest: Destination = {
      id: tempId,
      name: prediction.name,
      country: prediction.country,
      days: remainingDays,
      placeId: prediction.placeId,
    };
    setDestinations((prev) => [...prev, newDest]);

    // Fetch details in background for lat/lng/imageUrl
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/trpc/places.details?input=${encodeURIComponent(JSON.stringify({ json: { placeId: prediction.placeId } }))}`
      );
      const json = await res.json();
      const details = json?.result?.data?.json;
      if (details?.imageUrl || details?.lat) {
        setDestinations((prev) =>
          prev.map((d) =>
            d.id === tempId
              ? { ...d, lat: details.lat, lng: details.lng, imageUrl: details.imageUrl, country: details.country || d.country }
              : d
          )
        );
      }
    } catch {
      // Non-critical — hero image will use Unsplash fallback
    }
  };

  const handleUpdateDestDays = (id: string, delta: number) => {
    setDestinations((prev) =>
      prev.map((d) => (d.id === id ? { ...d, days: Math.max(1, d.days + delta) } : d))
    );
  };

  const handleRemoveDest = (id: string) => {
    setDestinations((prev) => prev.filter((d) => d.id !== id));
  };

  const handleAIPress = () => {
    const canUseAI = userPlan.tier !== 'free' || userPlan.aiCreditsUsed < userPlan.aiCreditsLimit;
    if (!canUseAI) {
      setShowPaywall(true);
    } else {
      setShowAIModal(true);
    }
  };

  const handleAIDestinationsSelected = (aiDestinations: Destination[]) => {
    // Distribute days proportionally
    const total = aiDestinations.reduce((sum, d) => sum + d.days, 0);
    const scaleFactor = totalDays / Math.max(total, 1);
    const scaled = aiDestinations.map((d, i) => ({
      ...d,
      id: generateId(),
      days: i === aiDestinations.length - 1
        ? totalDays - aiDestinations.slice(0, -1).reduce((s, dd) => s + Math.round(dd.days * scaleFactor), 0)
        : Math.max(1, Math.round(d.days * scaleFactor)),
    }));
    setDestinations(scaled);
  };

  const handleCreate = async () => {
    if (!startDate || destinations.length === 0) return;
    setIsCreating(true);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + totalDays - 1);

    const firstName = destinations[0].name;
    const tripName =
      destinations.length === 1
        ? `${totalDays} ${totalDays === 1 ? 'Dia' : 'Dias'} em ${firstName}`
        : destinations.map((d) => d.name).join(' + ');

    const trip: Trip = {
      id: generateId(),
      name: tripName,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totalDays,
      destinations,
      transport: [],
      places: [],
      documents: [],
      expenses: [],
      travelers: [],
      accommodations: [],
      itinerary: [],
      currency: 'BRL',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await addTrip(trip);
    setIsCreating(false);
    onCreated?.(trip);
    handleClose();
  };

  const handleClose = () => {
    setStartDate(null);
    setTotalDays(3);
    setDestinations([]);
    setPickerDate(today);
    onClose();
  };

  const handleDateConfirm = () => {
    setStartDate(pickerDate);
    setShowDatePicker(false);
  };

  const adjustPickerDate = (delta: number) => {
    const d = new Date(pickerDate);
    d.setDate(d.getDate() + delta);
    if (d >= today) setPickerDate(d);
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }]}>
              {/* Handle */}
              <View style={styles.handleContainer}>
                <View style={[styles.handle, { backgroundColor: colors.border }]} />
              </View>

              <ScrollView
                style={styles.scroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 8 }}
              >
                {/* Header */}
                <View style={styles.header}>
                  <Text style={[styles.title, { color: colors.foreground }]}>{t.createTrip.title}</Text>
                  <TouchableOpacity
                    onPress={handleClose}
                    style={[styles.closeBtn, { backgroundColor: colors.surface }]}
                  >
                    <Ionicons name="close" size={16} color={colors.foreground} />
                  </TouchableOpacity>
                </View>

                {/* Start Date + Days */}
                <Text style={[styles.sectionLabel, { color: colors.muted }]}>{t.createTrip.startDate.toUpperCase()}</Text>
                <View style={styles.dateRow}>
                  <View style={{ flex: 1 }}>
                    <DatePickerField
                      value={startDate}
                      onChange={(d) => setStartDate(d)}
                      minimumDate={new Date()}
                      compact
                    />
                  </View>

                  <View style={[styles.daysStepper, { backgroundColor: colors.surface }]}>
                    <TouchableOpacity
                      onPress={() => setTotalDays(Math.max(1, totalDays - 1))}
                      style={[styles.stepperBtn, { backgroundColor: colors.background }]}
                    >
                      <Ionicons name="remove" size={14} color={colors.foreground} />
                    </TouchableOpacity>
                    <View style={styles.stepperCenter}>
                      <Text style={[styles.stepperNum, { color: colors.foreground }]}>{totalDays}</Text>
                      <Text style={[styles.stepperLabel, { color: colors.muted }]}>{t.common.days.toUpperCase()}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setTotalDays(totalDays + 1)}
                      style={[styles.stepperBtn, { backgroundColor: colors.background }]}
                    >
                      <Ionicons name="add" size={14} color={colors.foreground} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Destinations */}
                <Text style={[styles.sectionLabel, { color: colors.muted }]}>{t.createTrip.destination.toUpperCase()}</Text>

                {destinations.length > 0 && (
                  <View style={[styles.destList, { backgroundColor: colors.surface }]}>
                    {destinations.map((dest, idx) => (
                      <View key={dest.id}>
                        <View style={styles.destRow}>
                          <View style={styles.destDot} />
                          <View style={styles.destInfo}>
                            <Text style={[styles.destName, { color: colors.foreground }]}>{dest.name}</Text>
                            {dest.country ? (
                              <Text style={[styles.destCountry, { color: colors.muted }]}>{dest.country}</Text>
                            ) : null}
                          </View>
                          <View style={styles.destDaysRow}>
                            <TouchableOpacity
                              onPress={() => handleUpdateDestDays(dest.id, -1)}
                              style={[styles.miniBtn, { backgroundColor: colors.background }]}
                            >
                              <Ionicons name="remove" size={12} color={colors.foreground} />
                            </TouchableOpacity>
                            <Text style={[styles.destDaysNum, { color: colors.foreground }]}>{dest.days}</Text>
                            <Text style={[styles.destDaysLabel, { color: colors.muted }]}>{t.common.days}</Text>
                            <TouchableOpacity
                              onPress={() => handleUpdateDestDays(dest.id, 1)}
                              style={[styles.miniBtn, { backgroundColor: colors.background }]}
                            >
                              <Ionicons name="add" size={12} color={colors.foreground} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => handleRemoveDest(dest.id)}
                              style={[styles.miniBtn, { backgroundColor: colors.background, marginLeft: 4 }]}
                            >
                              <Ionicons name="close" size={12} color={colors.error} />
                            </TouchableOpacity>
                          </View>
                        </View>
                        {idx < destinations.length - 1 && (
                          <View style={[styles.divider, { backgroundColor: colors.border }]} />
                        )}
                      </View>
                    ))}
                    {/* Days distributed */}
                    <View style={[styles.daysDistRow, { borderTopColor: colors.border }]}>
                      <Text style={[styles.daysDistLabel, { color: colors.muted }]}>{t.common.days} distribuídos</Text>
                      <Text
                        style={[
                          styles.daysDistValue,
                          { color: distributedDays > totalDays ? colors.error : colors.success },
                        ]}
                      >
                        {distributedDays}/{totalDays}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Autocomplete input */}
                <View style={styles.autocompleteWrapper}>
                  <PlacesAutocompleteInput
                    onSelect={handleSelectDestination}
                    placeholder={t.createTrip.destinationPlaceholder}
                    searchTypes="cities"
                  />
                </View>

                {/* Create button */}
                <TouchableOpacity
                  onPress={canCreate ? handleCreate : undefined}
                  disabled={!canCreate || isCreating}
                  style={[
                    styles.createBtn,
                    { backgroundColor: canCreate ? colors.primary : colors.surface },
                  ]}
                >
                  <Text style={[styles.createBtnText, { color: canCreate ? colors.textOnPrimary : colors.muted }]}>
                    {!startDate
                      ? t.createTrip.startDate
                      : destinations.length === 0
                      ? t.createTrip.destinationPlaceholder
                      : isCreating
                      ? t.createTrip.generating
                      : t.createTrip.createBtn}
                  </Text>
                </TouchableOpacity>

                <View style={{ height: 8 }} />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>

        {/* Date picker is now inline via DatePickerField */}
      </Modal>

      {/* AI Preferences Modal */}
      <AIPreferencesModal
        visible={showAIModal}
        onClose={() => setShowAIModal(false)}
        totalDays={totalDays}
        startDate={startDate ? startDate.toISOString() : new Date().toISOString()}
        onDestinationsSelected={handleAIDestinationsSelected}
      />

      {/* Paywall Modal */}
      <PaywallModal
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
        feature="Criar com IA"
      />
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlayModal,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontStyle: 'italic',
    fontFamily: 'serif',
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  dateRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  dateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
  },
  dateBtnText: {
    fontSize: 15,
    fontWeight: '500',
  },
  daysStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 52,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperCenter: {
    alignItems: 'center',
    minWidth: 36,
  },
  stepperNum: {
    fontSize: 18,
    fontWeight: '700',
  },
  stepperLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  destList: {
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
  },
  destRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  destDot: {
    width: 4,
    height: 20,
    borderRadius: 2,
    backgroundColor: colors.primary,
    marginRight: 12,
  },
  destInfo: {
    flex: 1,
  },
  destName: {
    fontSize: 15,
    fontWeight: '600',
  },
  destCountry: {
    fontSize: 12,
    marginTop: 1,
  },
  destDaysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destDaysNum: {
    fontSize: 14,
    fontWeight: '700',
    minWidth: 16,
    textAlign: 'center',
  },
  destDaysLabel: {
    fontSize: 11,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 14,
  },
  daysDistRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  daysDistLabel: {
    fontSize: 12,
  },
  daysDistValue: {
    fontSize: 12,
    fontWeight: '700',
  },
  autocompleteWrapper: {
    marginBottom: 16,
    zIndex: 200,
  },
  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
    marginBottom: 12,
  },
  aiBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  aiBadge: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 4,
  },
  aiBadgeText: {
    color: colors.textOnPrimary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  createBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  datePickerOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.overlayModal,
  },
  datePickerCard: {
    borderRadius: 24,
    padding: 24,
    width: 300,
  },
  datePickerTitle: {
    fontSize: 20,
    fontStyle: 'italic',
    fontFamily: 'serif',
    fontWeight: '600',
    marginBottom: 20,
  },
  datePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  datePickerArrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  datePickerCenter: {
    alignItems: 'center',
  },
  datePickerDay: {
    fontSize: 36,
    fontWeight: '700',
  },
  datePickerMonth: {
    fontSize: 14,
    marginTop: 2,
  },
  datePickerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  datePickerCancelBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  datePickerCancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
  datePickerConfirmBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  datePickerConfirmText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
});
