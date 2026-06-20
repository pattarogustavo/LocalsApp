/**
 * DatePickerField
 *
 * A pressable field that opens a native date picker (iOS spinner / Android calendar).
 * On web it falls back to a plain text input.
 *
 * Usage:
 *   <DatePickerField
 *     label="DATA DO VOO"
 *     value={date}          // Date | null
 *     onChange={setDate}    // (d: Date) => void
 *     minimumDate={new Date()}
 *   />
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { useTranslation } from '@/hooks/use-translation';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface DatePickerFieldProps {
  label?: string;
  value: Date | null;
  onChange: (date: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  hint?: string;
  /** Compact mode: no label, smaller height — for inline use */
  compact?: boolean;
}

const LOCALE_MAP: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT',
};

function formatDisplay(date: Date | null, locale: string): string {
  if (!date) return '';
  return date.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function DatePickerField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  hint,
  compact = false,
}: DatePickerFieldProps) {
  const t = useTranslation();
  const lang = t.common.today === 'Hoje' ? 'pt' : t.common.today === 'Today' ? 'en' : t.common.today === 'Hoy' ? 'es' : 'pt';
  const locale = LOCALE_MAP[lang] || 'pt-BR';
  const [showPicker, setShowPicker] = useState(false);
  // Temporary date while the iOS spinner is open (confirm on "Done")
  const [tempDate, setTempDate] = useState<Date>(value ?? new Date());

  // ── Web fallback ──────────────────────────────────────────────────────────
  if (Platform.OS === 'web') {
    const webValue = value
      ? value.toISOString().split('T')[0]
      : '';
    return (
      <View style={compact ? undefined : { marginBottom: 14 }}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <TextInput
          value={webValue}
          onChangeText={(v) => {
            const d = new Date(v);
            if (!isNaN(d.getTime())) onChange(d);
          }}
          placeholder="AAAA-MM-DD"
          placeholderTextColor="rgba(245,240,232,0.25)"
          style={[styles.field, compact && styles.fieldCompact]}
        />
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    );
  }

  // ── iOS ───────────────────────────────────────────────────────────────────
  if (Platform.OS === 'ios') {
    return (
      <View style={compact ? undefined : { marginBottom: 14 }}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <TouchableOpacity
          style={[styles.field, compact && styles.fieldCompact]}
          onPress={() => { setTempDate(value ?? new Date()); setShowPicker(true); }}
          activeOpacity={0.75}
        >
          <Ionicons name="calendar-outline" size={15} color="rgba(82,183,136,0.7)" />
          <Text style={[styles.fieldText, !value && styles.placeholder]}>
            {value ? formatDisplay(value, locale) : t.common.selectDate || 'Selecionar data'}
          </Text>
        </TouchableOpacity>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}

        {/* iOS: modal sheet with spinner + Done button */}
        <Modal visible={showPicker} transparent animationType="slide">
          <Pressable style={styles.iosOverlay} onPress={() => setShowPicker(false)} />
          <View style={styles.iosSheet}>
            <View style={styles.iosSheetHeader}>
              <TouchableOpacity onPress={() => setShowPicker(false)}>
                <Text style={styles.iosCancelText}>{t.common.cancel}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  onChange(tempDate);
                  setShowPicker(false);
                }}
              >
                <Text style={styles.iosDoneText}>{t.common.confirm}</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={tempDate}
              mode="date"
              display="spinner"
              onChange={(_, d) => { if (d) setTempDate(d); }}
              minimumDate={minimumDate}
              maximumDate={maximumDate}
              locale={locale}
              style={styles.iosPicker}
              textColor="#F5F0E8"
            />
          </View>
        </Modal>
      </View>
    );
  }

  // ── Android ───────────────────────────────────────────────────────────────
  return (
    <View style={compact ? undefined : { marginBottom: 14 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        style={[styles.field, compact && styles.fieldCompact]}
        onPress={() => setShowPicker(true)}
        activeOpacity={0.75}
      >
        <Ionicons name="calendar-outline" size={15} color="rgba(82,183,136,0.7)" />
        <Text style={[styles.fieldText, !value && styles.placeholder]}>
          {value ? formatDisplay(value, locale) : t.common.selectDate || 'Selecionar data'}
        </Text>
      </TouchableOpacity>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {showPicker && (
        <DateTimePicker
          value={value ?? new Date()}
          mode="date"
          display="calendar"
          onChange={(_, d) => {
            setShowPicker(false);
            if (d) onChange(d);
          }}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: 'rgba(245,240,232,0.4)',
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  fieldCompact: {
    paddingVertical: 10,
    borderRadius: 10,
  },
  fieldText: {
    fontSize: 15,
    color: '#F5F0E8',
    flex: 1,
  },
  placeholder: {
    color: 'rgba(245,240,232,0.65)',
    fontSize: 14,
  },
  hint: {
    fontSize: 11,
    color: 'rgba(245,240,232,0.35)',
    marginTop: 4,
  },

  // iOS modal
  iosOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  iosSheet: {
    backgroundColor: '#1A2E22',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    alignItems: 'stretch',
  },
  iosSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  iosCancelText: {
    fontSize: 15,
    color: 'rgba(245,240,232,0.5)',
  },
  iosDoneText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#52B788',
  },
  iosPicker: {
    height: 200,
    width: '100%',
    alignSelf: 'center',
  },
});
