import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');

// ─── Data ────────────────────────────────────────────────────────────────────

const DESTINATION_OPTIONS = [
  { id: 'europe', label: 'Europa', emoji: '🏰' },
  { id: 'americas', label: 'Américas', emoji: '🗽' },
  { id: 'asia', label: 'Ásia', emoji: '🏯' },
  { id: 'africa', label: 'África', emoji: '🌍' },
  { id: 'oceania', label: 'Oceania', emoji: '🦘' },
  { id: 'middleeast', label: 'Oriente Médio', emoji: '🕌' },
];

const TRAVEL_STYLES = [
  { id: 'adventure', label: 'Aventura', emoji: '🧗', desc: 'Trilhas, esportes, natureza' },
  { id: 'culture', label: 'Cultura', emoji: '🎭', desc: 'Museus, história, arte' },
  { id: 'gastronomy', label: 'Gastronomia', emoji: '🍽️', desc: 'Restaurantes, mercados, culinária local' },
  { id: 'relax', label: 'Relaxamento', emoji: '🏖️', desc: 'Praias, spas, resorts' },
  { id: 'urban', label: 'Urbano', emoji: '🏙️', desc: 'Cidades, compras, nightlife' },
  { id: 'nature', label: 'Natureza', emoji: '🌿', desc: 'Parques, florestas, fauna' },
];

const TRIP_PACE = [
  { id: 'slow', label: 'Tranquilo', emoji: '☕', desc: 'Poucos lugares, mais tempo em cada' },
  { id: 'balanced', label: 'Equilibrado', emoji: '⚖️', desc: 'Mix de atividades e descanso' },
  { id: 'intense', label: 'Intenso', emoji: '⚡', desc: 'Aproveitar ao máximo cada dia' },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function PreferencesScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [step, setStep] = useState(0); // 0 = destinations, 1 = style, 2 = pace
  const [selectedDestinations, setSelectedDestinations] = useState<string[]>([]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [selectedPace, setSelectedPace] = useState<string>('');

  const totalSteps = 3;

  const toggleDestination = (id: string) => {
    setSelectedDestinations((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const toggleStyle = (id: string) => {
    setSelectedStyles((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleNext = () => {
    if (step < totalSteps - 1) {
      setStep((s) => s + 1);
    } else {
      handleFinish();
    }
  };

  const handleFinish = async () => {
    // Save preferences to AsyncStorage
    const prefs = {
      destinations: selectedDestinations,
      travelStyles: selectedStyles,
      pace: selectedPace,
    };
    await AsyncStorage.setItem('@voyage_travel_prefs', JSON.stringify(prefs));
    // Navigate to main app
    router.replace('/(tabs)' as any);
  };

  const canProceed = () => {
    if (step === 0) return selectedDestinations.length > 0;
    if (step === 1) return selectedStyles.length > 0;
    if (step === 2) return !!selectedPace;
    return false;
  };

  const stepTitles = [
    'Para onde você gosta de viajar?',
    'Qual é o seu estilo de viagem?',
    'Qual é o seu ritmo preferido?',
  ];

  const stepSubtitles = [
    'Selecione os destinos que mais te atraem',
    'Escolha um ou mais estilos',
    'Como você prefere organizar seu tempo?',
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.progressRow}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressDot,
                i <= step ? styles.progressDotActive : styles.progressDotInactive,
              ]}
            />
          ))}
        </View>
        <TouchableOpacity onPress={handleFinish} style={styles.skipBtn}>
          <Text style={styles.skipText}>Pular</Text>
        </TouchableOpacity>
      </View>

      {/* Title */}
      <View style={styles.titleSection}>
        <Text style={styles.greeting}>
          {user?.name ? `Olá, ${user.name.split(' ')[0]}! 👋` : 'Bem-vindo(a)! 👋'}
        </Text>
        <Text style={styles.title}>{stepTitles[step]}</Text>
        <Text style={styles.subtitle}>{stepSubtitles[step]}</Text>
      </View>

      {/* Options */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.optionsContainer}
        showsVerticalScrollIndicator={false}
      >
        {step === 0 && (
          <View style={styles.grid}>
            {DESTINATION_OPTIONS.map((opt) => {
              const selected = selectedDestinations.includes(opt.id);
              return (
                <TouchableOpacity
                  key={opt.id}
                  onPress={() => toggleDestination(opt.id)}
                  style={[
                    styles.gridCard,
                    selected ? styles.gridCardSelected : styles.gridCardDefault,
                  ]}
                  activeOpacity={0.8}
                >
                  <Text style={styles.gridEmoji}>{opt.emoji}</Text>
                  <Text style={[styles.gridLabel, selected && styles.gridLabelSelected]}>
                    {opt.label}
                  </Text>
                  {selected && (
                    <View style={styles.checkBadge}>
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {step === 1 && (
          <View style={styles.listOptions}>
            {TRAVEL_STYLES.map((opt) => {
              const selected = selectedStyles.includes(opt.id);
              return (
                <TouchableOpacity
                  key={opt.id}
                  onPress={() => toggleStyle(opt.id)}
                  style={[
                    styles.listCard,
                    selected ? styles.listCardSelected : styles.listCardDefault,
                  ]}
                  activeOpacity={0.8}
                >
                  <Text style={styles.listEmoji}>{opt.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.listLabel, selected && styles.listLabelSelected]}>
                      {opt.label}
                    </Text>
                    <Text style={styles.listDesc}>{opt.desc}</Text>
                  </View>
                  {selected && (
                    <Ionicons name="checkmark-circle" size={22} color="#2C2416" />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {step === 2 && (
          <View style={styles.listOptions}>
            {TRIP_PACE.map((opt) => {
              const selected = selectedPace === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  onPress={() => setSelectedPace(opt.id)}
                  style={[
                    styles.listCard,
                    selected ? styles.listCardSelected : styles.listCardDefault,
                  ]}
                  activeOpacity={0.8}
                >
                  <Text style={styles.listEmoji}>{opt.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.listLabel, selected && styles.listLabelSelected]}>
                      {opt.label}
                    </Text>
                    <Text style={styles.listDesc}>{opt.desc}</Text>
                  </View>
                  {selected && (
                    <Ionicons name="checkmark-circle" size={22} color="#2C2416" />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Bottom button */}
      <View style={[styles.bottomSection, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          onPress={handleNext}
          disabled={!canProceed()}
          style={[styles.nextBtn, !canProceed() && styles.nextBtnDisabled]}
          activeOpacity={0.85}
        >
          <Text style={styles.nextBtnText}>
            {step === totalSteps - 1 ? 'Começar a Explorar 🚀' : 'Continuar'}
          </Text>
          {step < totalSteps - 1 && (
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const CARD_WIDTH = (width - 48 - 12) / 2;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0EBE0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  progressDot: {
    height: 6,
    borderRadius: 3,
  },
  progressDotActive: {
    width: 24,
    backgroundColor: '#4CAF7D',
  },
  progressDotInactive: {
    width: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  skipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  skipText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
  titleSection: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
  },
  greeting: {
    color: '#4CAF7D',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  title: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 32,
    marginBottom: 8,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 15,
    lineHeight: 20,
  },
  optionsContainer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  // Grid (destinations)
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridCard: {
    width: CARD_WIDTH,
    height: 100,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    position: 'relative',
  },
  gridCardDefault: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  gridCardSelected: {
    backgroundColor: 'rgba(76,175,125,0.18)',
    borderWidth: 1.5,
    borderColor: '#4CAF7D',
  },
  gridEmoji: { fontSize: 28 },
  gridLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '600',
  },
  gridLabelSelected: { color: '#4CAF7D' },
  checkBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#4CAF7D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // List (styles + pace)
  listOptions: { gap: 10 },
  listCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 16,
  },
  listCardDefault: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  listCardSelected: {
    backgroundColor: 'rgba(76,175,125,0.15)',
    borderWidth: 1.5,
    borderColor: '#4CAF7D',
  },
  listEmoji: { fontSize: 26 },
  listLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  listLabelSelected: { color: '#4CAF7D' },
  listDesc: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    lineHeight: 16,
  },
  // Bottom
  bottomSection: {
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: '#F0EBE0',
  },
  nextBtn: {
    backgroundColor: '#4CAF7D',
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nextBtnDisabled: {
    opacity: 0.35,
  },
  nextBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
