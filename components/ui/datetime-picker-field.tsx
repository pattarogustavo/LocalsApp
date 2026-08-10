import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '@/hooks/use-translation';
import { useColors } from '@/hooks/use-colors';
import { type ThemeColorPalette } from '@/constants/theme';

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

interface DateTimePickerFieldProps {
  label?: string;
  value: Date | null;
  onChange: (date: Date) => void;
  minimumDate?: Date;
  hint?: string;
}

const LOCALE_MAP: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT',
};

function formatDisplay(date: Date | null, locale: string): string {
  if (!date) return '';
  return date.toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DateTimePickerField({
  label,
  value,
  onChange,
  minimumDate,
  hint,
}: DateTimePickerFieldProps) {
  const t = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const lang = t.common.today === 'Hoje' ? 'pt' : t.common.today === 'Today' ? 'en' : t.common.today === 'Hoy' ? 'es' : 'pt';
  const locale = LOCALE_MAP[lang] || 'pt-BR';

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(value || new Date());

  const hasValue = value !== null;
  const placeholder = t.common.selectDateTime;

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <View style={styles.field}>
          <Ionicons name="calendar-outline" size={16} color={colors.muted} />
          <Text style={[styles.fieldText, !hasValue && styles.placeholder]}>
            {hasValue ? formatDisplay(value, locale) : placeholder}
          </Text>
        </View>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    );
  }

  // iOS: two-step — date first, then time
  if (Platform.OS === 'ios') {
    return (
      <View style={styles.container}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <TouchableOpacity style={styles.field} onPress={() => { setTempDate(value || new Date()); setShowDatePicker(true); }}>
          <Ionicons name="calendar-outline" size={16} color={colors.muted} />
          <Text style={[styles.fieldText, !hasValue && styles.placeholder]}>
            {hasValue ? formatDisplay(value, locale) : placeholder}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.muted} />
        </TouchableOpacity>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}

        {/* Step 1: Date */}
        <Modal visible={showDatePicker} transparent animationType="slide">
          <View style={styles.sheetOverlay}>
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>{t.common.selectDate}</Text>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                minimumDate={minimumDate}
                onChange={(_, d) => { if (d) setTempDate(d); }}
                textColor={colors.foreground}
                style={{ width: '100%' }}
              />
              <View style={styles.sheetBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowDatePicker(false)}>
                  <Text style={styles.cancelText}>{t.common.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmBtn}
                  activeOpacity={0.7}
                  onPress={() => { setShowDatePicker(false); setShowTimePicker(true); }}
                >
                  <Text style={styles.confirmText}>{t.common.next || 'Próximo →'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Step 2: Time */}
        <Modal visible={showTimePicker} transparent animationType="slide">
          <View style={styles.sheetOverlay}>
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>{t.common.selectTime || 'Horário'}</Text>
              <DateTimePicker
                value={tempDate}
                mode="time"
                display="spinner"
                onChange={(_, d) => { if (d) setTempDate(d); }}
                textColor={colors.foreground}
                style={{ width: '100%' }}
              />
              <View style={styles.sheetBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowTimePicker(false); setShowDatePicker(true); }}>
                  <Text style={styles.cancelText}>{t.common.back}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmBtn}
                  activeOpacity={0.7}
                  onPress={() => { setShowTimePicker(false); onChange(tempDate); }}
                >
                  <Text style={styles.confirmText}>{t.common.confirm}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // Android: use datetime mode directly
  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity style={styles.field} onPress={() => { setTempDate(value || new Date()); setShowDatePicker(true); }}>
        <Ionicons name="calendar-outline" size={16} color={colors.muted} />
        <Text style={[styles.fieldText, !hasValue && styles.placeholder]}>
          {hasValue ? formatDisplay(value, locale) : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={14} color={colors.muted} />
      </TouchableOpacity>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {showDatePicker && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="calendar"
          minimumDate={minimumDate}
          onChange={(_, d) => {
            setShowDatePicker(false);
            if (d) { setTempDate(d); setShowTimePicker(true); }
          }}
        />
      )}
      {showTimePicker && (
        <DateTimePicker
          value={tempDate}
          mode="time"
          display="clock"
          onChange={(_, d) => {
            setShowTimePicker(false);
            if (d) onChange(d);
          }}
        />
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColorPalette) => StyleSheet.create({
  container: { marginBottom: 14 },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: colors.muted, marginBottom: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: withAlpha(colors.foreground, 0.07),
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: withAlpha(colors.foreground, 0.08),
  },
  fieldText: { flex: 1, fontSize: 15, color: colors.foreground },
  placeholder: { color: colors.muted },
  hint: { fontSize: 11, color: colors.muted, marginTop: 4 },
  sheetOverlay: { flex: 1, backgroundColor: colors.overlayModal, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, alignItems: 'stretch', width: '100%' },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: colors.foreground, textAlign: 'center', marginBottom: 8 },
  sheetBtns: { flexDirection: 'row', gap: 12, marginTop: 16, width: '100%' },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: withAlpha(colors.foreground, 0.07), alignItems: 'center' },
  cancelText: { fontSize: 15, color: colors.muted, fontWeight: '600' },
  confirmBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  confirmText: { fontSize: 15, color: colors.textOnPrimary, fontWeight: '700' },
});
