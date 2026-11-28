import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTripsStore } from '@/store/trips';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';
import { toDateLocale } from '@/utils/date-locale';
import { sheetScreenOptions } from '@/utils/sheet-presentation';
import { useDiscardConfirmation } from '@/hooks/use-discard-confirmation';

export default function EditDatesScreen() {
  const { tripId, currentDate, currentDuration } = useLocalSearchParams<{
    tripId: string; currentDate: string; currentDuration: string;
  }>();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const t = useTranslation();
  const preferredLanguage = useAuthStore((s) => s.preferredLanguage);
  const dateLocale = toDateLocale(preferredLanguage);
  const monthFormatter = useMemo(() => new Intl.DateTimeFormat(dateLocale, { month: 'long' }), [dateLocale]);
  const updateStartDate = useTripsStore((s) => s.updateStartDate);
  const updateTrip = useTripsStore((s) => s.updateTrip);

  const today = new Date();
  const initialDuration = parseInt(currentDuration, 10) || 1;
  const [pickerDate, setPickerDate] = useState(new Date(currentDate));
  const [duration, setDuration] = useState(initialDuration);

  const isDirty = pickerDate.toISOString() !== new Date(currentDate).toISOString() || duration !== initialDuration;
  useDiscardConfirmation(isDirty);

  const adjustDate = (delta: number) => {
    const d = new Date(pickerDate);
    d.setDate(d.getDate() + delta);
    if (d >= today) setPickerDate(d);
  };

  const adjustDuration = (delta: number) => {
    setDuration((prev) => Math.max(1, prev + delta));
  };

  const endDate = new Date(pickerDate);
  endDate.setDate(endDate.getDate() + duration - 1);

  const handleSave = async () => {
    const newDate = pickerDate.toISOString();
    await updateStartDate(tripId, newDate);
    const start = new Date(newDate);
    const end = new Date(start);
    end.setDate(end.getDate() + duration - 1);
    await updateTrip(tripId, { totalDays: duration, endDate: end.toISOString() });
    router.back();
  };

  return (
    <>
      <Stack.Screen options={sheetScreenOptions(colors)} />
      <View style={[styles.editCard, { backgroundColor: colors.background }]}>
        <Text style={[styles.editCardTitle, { color: colors.foreground }]}>{t.tripEdit.datesTitle}</Text>

        <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{t.tripEdit.startDate}</Text>
        <View style={styles.datePickerRow}>
          <TouchableOpacity onPress={() => adjustDate(-1)} style={[styles.arrowBtn, { backgroundColor: colors.surface }]}>
            <Ionicons name="chevron-back" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <View style={styles.dateCenter}>
            <Text style={[styles.dateDayNum, { color: colors.foreground }]}>{pickerDate.getDate()}</Text>
            <Text style={[styles.dateMonthText, { color: colors.muted }]}>
              {monthFormatter.format(pickerDate)} {pickerDate.getFullYear()}
            </Text>
          </View>
          <TouchableOpacity onPress={() => adjustDate(1)} style={[styles.arrowBtn, { backgroundColor: colors.surface }]}>
            <Ionicons name="chevron-forward" size={20} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginTop: 16 }}>{t.tripEdit.duration}</Text>
        <View style={[styles.datePickerRow, { marginBottom: 8 }]}>
          <TouchableOpacity onPress={() => adjustDuration(-1)} style={[styles.arrowBtn, { backgroundColor: colors.surface }]}>
            <Ionicons name="chevron-back" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <View style={styles.dateCenter}>
            <Text style={[styles.dateDayNum, { color: colors.foreground }]}>{duration}</Text>
            <Text style={[styles.dateMonthText, { color: colors.muted }]}>{t.tripEdit.durationUnit}</Text>
          </View>
          <TouchableOpacity onPress={() => adjustDuration(1)} style={[styles.arrowBtn, { backgroundColor: colors.surface }]}>
            <Ionicons name="chevron-forward" size={20} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', marginBottom: 20 }}>
          {t.tripEdit.endDate}: {endDate.getDate()} {monthFormatter.format(endDate)} {endDate.getFullYear()}
        </Text>

        <View style={styles.editCardActions}>
          <TouchableOpacity onPress={() => router.back()} style={[styles.cancelBtn, { backgroundColor: colors.surface }]}>
            <Text style={[styles.cancelBtnText, { color: colors.foreground }]}>{t.common.cancel}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSave} style={[styles.confirmBtn, { backgroundColor: '#2C2416' }]} activeOpacity={0.7}>
            <Text style={styles.confirmBtnText}>{t.common.confirm}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  editCard: { padding: 24 },
  editCardTitle: { fontSize: 18, fontStyle: 'italic', fontFamily: 'serif', fontWeight: '600', marginBottom: 20 },
  datePickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  arrowBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dateCenter: { alignItems: 'center' },
  dateDayNum: { fontSize: 36, fontWeight: '700' },
  dateMonthText: { fontSize: 14, marginTop: 2 },
  editCardActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancelBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, fontWeight: '600' },
  confirmBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
