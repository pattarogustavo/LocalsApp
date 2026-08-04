import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { trpc } from '@/lib/trpc';
import { useTranslation } from '@/hooks/use-translation';
import type { TravelStyle, TravelBudget, TravelPace, TravelPreferences, Destination } from '@/types/voyage';

interface AIPreferencesModalProps {
  visible: boolean;
  onClose: () => void;
  totalDays: number;
  startDate: string;
  onDestinationsSelected: (destinations: Destination[]) => void;
}

const STYLE_OPTIONS: { id: TravelStyle; label: string; emoji: string }[] = [
  { id: 'cultura', label: 'Cultura', emoji: '🏛️' },
  { id: 'gastronomia', label: 'Gastronomia', emoji: '🍽️' },
  { id: 'natureza', label: 'Natureza', emoji: '🌿' },
  { id: 'aventura', label: 'Aventura', emoji: '🧗' },
  { id: 'relaxamento', label: 'Relaxamento', emoji: '🏖️' },
  { id: 'compras', label: 'Compras', emoji: '🛍️' },
  { id: 'historia', label: 'História', emoji: '📜' },
  { id: 'praia', label: 'Praia', emoji: '🌊' },
  { id: 'montanha', label: 'Montanha', emoji: '⛰️' },
  { id: 'cidade', label: 'Cidade', emoji: '🏙️' },
];

const BUDGET_OPTIONS: { id: TravelBudget; label: string; desc: string }[] = [
  { id: 'econômico', label: 'Econômico', desc: 'Hostels, transporte público' },
  { id: 'moderado', label: 'Moderado', desc: 'Hotéis 3★, conforto razoável' },
  { id: 'luxo', label: 'Luxo', desc: 'Hotéis 5★, experiências premium' },
];

const PACE_OPTIONS: { id: TravelPace; label: string; desc: string }[] = [
  { id: 'relaxado', label: 'Relaxado', desc: '2-3 atividades por dia' },
  { id: 'moderado', label: 'Moderado', desc: '4-5 atividades por dia' },
  { id: 'intenso', label: 'Intenso', desc: '6+ atividades por dia' },
];

export function AIPreferencesModal({
  visible,
  onClose,
  totalDays,
  startDate,
  onDestinationsSelected,
}: AIPreferencesModalProps) {
  const colors = useColors();
  const t = useTranslation();
  const ai = t.ai;
  const [step, setStep] = useState<'preferences' | 'results'>('preferences');
  const [selectedStyles, setSelectedStyles] = useState<TravelStyle[]>([]);
  const [budget, setBudget] = useState<TravelBudget>('moderado');
  const [pace, setPace] = useState<TravelPace>('moderado');
  const [originCity, setOriginCity] = useState('');
  const [avoidLongFlights, setAvoidLongFlights] = useState(false);
  const [suggestedOptions, setSuggestedOptions] = useState<any[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  const suggestMutation = trpc.ai.suggestDestinations.useMutation({
    onSuccess: (data) => {
      setSuggestedOptions(data.options || []);
      setStep('results');
    },
  });

  const toggleStyle = (style: TravelStyle) => {
    setSelectedStyles((prev) =>
      prev.includes(style) ? prev.filter((s) => s !== style) : [...prev, style]
    );
  };

  const handleGenerate = () => {
    if (selectedStyles.length === 0) return;
    suggestMutation.mutate({
      totalDays,
      startDate,
      preferences: {
        style: selectedStyles,
        budget,
        pace,
        avoidLongFlights,
        originCity: originCity.trim() || undefined,
      },
    });
  };

  const handleConfirm = () => {
    if (selectedOption === null) return;
    const option = suggestedOptions[selectedOption];
    if (!option?.destinations) return;

    const destinations: Destination[] = option.destinations.map((d: any, i: number) => ({
      id: `dest_${Date.now()}_${i}`,
      name: d.name,
      country: d.country || '',
      days: d.days || 1,
    }));
    onDestinationsSelected(destinations);
    onClose();
  };

  const handleClose = () => {
    setStep('preferences');
    setSelectedStyles([]);
    setBudget('moderado');
    setPace('moderado');
    setOriginCity('');
    setAvoidLongFlights(false);
    setSuggestedOptions([]);
    setSelectedOption(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={[styles.overlay, { backgroundColor: colors.overlayModal }]}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {step === 'preferences' ? (ai.createWithAI || 'Criar com IA ✦') : (ai.suggestedRoutes || 'Roteiros Sugeridos')}
            </Text>
            <Pressable onPress={handleClose} style={[styles.closeBtn, { backgroundColor: colors.surface }]}>
              <Text style={[styles.closeText, { color: colors.muted }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            {step === 'preferences' ? (
              <>
                {/* Travel Styles */}
                <Text style={[styles.sectionLabel, { color: colors.muted }]}>{(ai.travelStyle || 'ESTILO DE VIAGEM').toUpperCase()}</Text>
                <View style={styles.stylesGrid}>
                  {STYLE_OPTIONS.map((s) => {
                    const active = selectedStyles.includes(s.id);
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => toggleStyle(s.id)}
                        style={({ pressed }) => [
                          styles.styleChip,
                          {
                            backgroundColor: active ? '#2D5A3D' : colors.surface,
                            borderColor: active ? '#2D5A3D' : colors.border,
                            opacity: pressed ? 0.8 : 1,
                          },
                        ]}
                      >
                        <Text style={styles.styleEmoji}>{s.emoji}</Text>
                        <Text style={[styles.styleLabel, { color: active ? '#fff' : colors.foreground }]}>
                          {s.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Budget */}
                <Text style={[styles.sectionLabel, { color: colors.muted }]}>{(ai.budget || 'ORÇAMENTO').toUpperCase()}</Text>
                {BUDGET_OPTIONS.map((b) => {
                  const active = budget === b.id;
                  return (
                    <Pressable
                      key={b.id}
                      onPress={() => setBudget(b.id)}
                      style={({ pressed }) => [
                        styles.optionRow,
                        {
                          backgroundColor: active ? '#2D5A3D' : colors.surface,
                          borderColor: active ? '#2D5A3D' : colors.border,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <View>
                        <Text style={[styles.optionLabel, { color: active ? '#fff' : colors.foreground }]}>
                          {b.label}
                        </Text>
                        <Text style={[styles.optionDesc, { color: active ? 'rgba(255,255,255,0.7)' : colors.muted }]}>
                          {b.desc}
                        </Text>
                      </View>
                      {active && <Text style={styles.checkmark}>✓</Text>}
                    </Pressable>
                  );
                })}

                {/* Pace */}
                <Text style={[styles.sectionLabel, { color: colors.muted }]}>{(ai.tripPace || 'RITMO DA VIAGEM').toUpperCase()}</Text>
                {PACE_OPTIONS.map((p) => {
                  const active = pace === p.id;
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => setPace(p.id)}
                      style={({ pressed }) => [
                        styles.optionRow,
                        {
                          backgroundColor: active ? '#2D5A3D' : colors.surface,
                          borderColor: active ? '#2D5A3D' : colors.border,
                          opacity: pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <View>
                        <Text style={[styles.optionLabel, { color: active ? '#fff' : colors.foreground }]}>
                          {p.label}
                        </Text>
                        <Text style={[styles.optionDesc, { color: active ? 'rgba(255,255,255,0.7)' : colors.muted }]}>
                          {p.desc}
                        </Text>
                      </View>
                      {active && <Text style={styles.checkmark}>✓</Text>}
                    </Pressable>
                  );
                })}

                {/* Origin city */}
                <Text style={[styles.sectionLabel, { color: colors.muted }]}>{(ai.originCity || 'CIDADE DE ORIGEM (opcional)').toUpperCase()}</Text>
                <View style={[styles.textInputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.textInput, { color: colors.foreground }]}
                    placeholder="Ex: São Paulo"
                    placeholderTextColor={colors.muted}
                    value={originCity}
                    onChangeText={setOriginCity}
                  />
                </View>

                {/* Avoid long flights */}
                <Pressable
                  onPress={() => setAvoidLongFlights(!avoidLongFlights)}
                  style={({ pressed }) => [
                    styles.toggleRow,
                    { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <Text style={[styles.toggleLabel, { color: colors.foreground }]}>{ai.avoidLongFlights || 'Evitar voos longos (+10h)'}</Text>
                  <View style={[styles.toggle, { backgroundColor: avoidLongFlights ? '#2D5A3D' : colors.border }]}>
                    <View style={[styles.toggleThumb, { left: avoidLongFlights ? 18 : 2 }]} />
                  </View>
                </Pressable>

                {/* Generate button */}
                <Pressable
                  onPress={handleGenerate}
                  disabled={selectedStyles.length === 0 || suggestMutation.isPending}
                  style={({ pressed }) => [
                    styles.generateBtn,
                    {
                      backgroundColor: selectedStyles.length === 0 ? colors.border : '#2D5A3D',
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  {suggestMutation.isPending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.generateBtnText}>✦ {ai.generateSuggestions || 'Gerar Sugestões de Destinos'}</Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <Text style={[styles.resultsSubtitle, { color: colors.muted }]}>
                  {(ai.chooseRoute || 'Escolha um roteiro sugerido pela IA para {n} dias').replace('{n}', String(totalDays))}
                </Text>

                {suggestedOptions.map((option, idx) => (
                  <Pressable
                    key={idx}
                    onPress={() => setSelectedOption(idx)}
                    style={({ pressed }) => [
                      styles.optionCard,
                      {
                        backgroundColor: selectedOption === idx ? '#2D5A3D' : colors.surface,
                        borderColor: selectedOption === idx ? '#2D5A3D' : colors.border,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.optionCardTitle, { color: selectedOption === idx ? '#fff' : colors.foreground }]}>
                      {option.name || `Opção ${idx + 1}`}
                    </Text>
                    {option.highlight && (
                      <Text style={[styles.optionCardHighlight, { color: selectedOption === idx ? 'rgba(255,255,255,0.8)' : colors.muted }]}>
                        {option.highlight}
                      </Text>
                    )}
                    {(option.destinations || []).map((d: any, di: number) => (
                      <View key={di} style={styles.destRow}>
                        <Text style={[styles.destBullet, { color: selectedOption === idx ? '#A8D5B5' : '#2D5A3D' }]}>•</Text>
                        <Text style={[styles.destText, { color: selectedOption === idx ? 'rgba(255,255,255,0.9)' : colors.foreground }]}>
                          {d.name}, {d.country} — {d.days} dia{d.days !== 1 ? 's' : ''}
                        </Text>
                      </View>
                    ))}
                  </Pressable>
                ))}

                <View style={styles.resultActions}>
                  <Pressable
                    onPress={() => setStep('preferences')}
                    style={({ pressed }) => [
                      styles.backBtn,
                      { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Text style={[styles.backBtnText, { color: colors.foreground }]}>← {t.common.back}</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleConfirm}
                    disabled={selectedOption === null}
                    style={({ pressed }) => [
                      styles.confirmBtn,
                      {
                        backgroundColor: selectedOption === null ? colors.border : '#2D5A3D',
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Text style={styles.confirmBtnText}>{ai.useThisRoute || 'Usar este roteiro'}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    maxHeight: '92%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    fontStyle: 'italic',
    fontFamily: 'serif',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 4,
  },
  stylesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  styleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  styleEmoji: {
    fontSize: 16,
  },
  styleLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  optionDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  checkmark: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  textInputRow: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 48,
    justifyContent: 'center',
  },
  textInput: {
    fontSize: 15,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  toggleLabel: {
    fontSize: 15,
  },
  toggle: {
    width: 40,
    height: 24,
    borderRadius: 12,
    position: 'relative',
  },
  toggleThumb: {
    position: 'absolute',
    top: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  generateBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  generateBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  resultsSubtitle: {
    fontSize: 14,
    marginBottom: 4,
  },
  optionCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 16,
    gap: 6,
  },
  optionCardTitle: {
    fontSize: 17,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  optionCardHighlight: {
    fontSize: 13,
    marginBottom: 4,
  },
  destRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  destBullet: {
    fontSize: 16,
    fontWeight: '700',
  },
  destText: {
    fontSize: 14,
  },
  resultActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  backBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  backBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 2,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
