import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

interface DateTimePickerFieldProps {
  label?: string;
  value: Date | null;
  onChange: (date: Date) => void;
  minimumDate?: Date;
  hint?: string;
}

function formatDisplay(date: Date | null): string {
  if (!date) return 'Selecionar data e hora';
  return date.toLocaleString('pt-BR', {
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
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(value || new Date());

  const hasValue = value !== null;

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <View style={styles.field}>
          <Ionicons name="calendar-outline" size={16} color="rgba(245,240,232,0.4)" />
          <Text style={[styles.fieldText, !hasValue && styles.placeholder]}>
            {hasValue ? formatDisplay(value) : 'Selecionar data e hora'}
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
          <Ionicons name="calendar-outline" size={16} color="rgba(245,240,232,0.4)" />
          <Text style={[styles.fieldText, !hasValue && styles.placeholder]}>
            {hasValue ? formatDisplay(value) : 'Selecionar data e hora'}
          </Text>
          <Ionicons name="chevron-down" size={14} color="rgba(245,240,232,0.3)" />
        </TouchableOpacity>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}

        {/* Step 1: Date */}
        <Modal visible={showDatePicker} transparent animationType="slide">
          <View style={styles.sheetOverlay}>
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Selecionar Data</Text>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                minimumDate={minimumDate}
                onChange={(_, d) => { if (d) setTempDate(d); }}
                textColor="#F5F0E8"
                style={{ width: '100%' }}
              />
              <View style={styles.sheetBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowDatePicker(false)}>
                  <Text style={styles.cancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={() => { setShowDatePicker(false); setShowTimePicker(true); }}
                >
                  <Text style={styles.confirmText}>Próximo →</Text>
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
              <Text style={styles.sheetTitle}>Horário de Chegada</Text>
              <DateTimePicker
                value={tempDate}
                mode="time"
                display="spinner"
                onChange={(_, d) => { if (d) setTempDate(d); }}
                textColor="#F5F0E8"
                style={{ width: '100%' }}
              />
              <View style={styles.sheetBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowTimePicker(false); setShowDatePicker(true); }}>
                  <Text style={styles.cancelText}>← Voltar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={() => { setShowTimePicker(false); onChange(tempDate); }}
                >
                  <Text style={styles.confirmText}>Confirmar</Text>
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
        <Ionicons name="calendar-outline" size={16} color="rgba(245,240,232,0.4)" />
        <Text style={[styles.fieldText, !hasValue && styles.placeholder]}>
          {hasValue ? formatDisplay(value) : 'Selecionar data e hora'}
        </Text>
        <Ionicons name="chevron-down" size={14} color="rgba(245,240,232,0.3)" />
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

const styles = StyleSheet.create({
  container: { marginBottom: 14 },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: 'rgba(245,240,232,0.4)', marginBottom: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  fieldText: { flex: 1, fontSize: 15, color: '#F5F0E8' },
  placeholder: { color: 'rgba(245,240,232,0.3)' },
  hint: { fontSize: 11, color: 'rgba(245,240,232,0.35)', marginTop: 4 },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1A2E22', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, alignItems: 'stretch', width: '100%' },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: '#F5F0E8', textAlign: 'center', marginBottom: 8 },
  sheetBtns: { flexDirection: 'row', gap: 12, marginTop: 16, width: '100%' },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center' },
  cancelText: { fontSize: 15, color: 'rgba(245,240,232,0.6)', fontWeight: '600' },
  confirmBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#52B788', alignItems: 'center' },
  confirmText: { fontSize: 15, color: '#0F1F16', fontWeight: '700' },
});
