import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '@/hooks/use-translation';
import Svg, { Circle, Line, Path } from 'react-native-svg';

const SCREEN_WIDTH = Dimensions.get('window').width;
// Logo occupies ~50% of screen width, matching the mockup proportion
const LOGO_SIZE = Math.round(SCREEN_WIDTH * 0.50);

// Compass rose SVG matching the mockup — large, centered, with amber arc at bottom
function CompassLogo({ size }: { size: number }) {
  const c = size / 2;
  const r = size * 0.43;
  const tickLen = size * 0.065;
  const strokeW = size * 0.010;
  const dotR = size * 0.025;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Outer circle */}
      <Circle cx={c} cy={c} r={r} stroke="#2C2416" strokeWidth={strokeW} fill="none" />
      {/* Cardinal tick marks */}
      <Line x1={c} y1={c - r} x2={c} y2={c - r + tickLen} stroke="#2C2416" strokeWidth={strokeW} />
      <Line x1={c} y1={c + r - tickLen} x2={c} y2={c + r} stroke="#2C2416" strokeWidth={strokeW} />
      <Line x1={c - r} y1={c} x2={c - r + tickLen} y2={c} stroke="#2C2416" strokeWidth={strokeW} />
      <Line x1={c + r - tickLen} y1={c} x2={c + r} y2={c} stroke="#2C2416" strokeWidth={strokeW} />
      {/* North point — tall, dark */}
      <Path
        d={`M${c},${c - r * 0.75} L${c - r * 0.13},${c + r * 0.05} L${c},${c - r * 0.08} Z`}
        fill="#2C2416"
      />
      {/* South point — shorter, faded */}
      <Path
        d={`M${c},${c + r * 0.75} L${c + r * 0.13},${c - r * 0.05} L${c},${c + r * 0.08} Z`}
        fill="#2C2416"
        opacity={0.30}
      />
      {/* East point */}
      <Path
        d={`M${c + r * 0.75},${c} L${c - r * 0.05},${c - r * 0.13} L${c + r * 0.08},${c} Z`}
        fill="#2C2416"
        opacity={0.30}
      />
      {/* West point */}
      <Path
        d={`M${c - r * 0.75},${c} L${c + r * 0.05},${c + r * 0.13} L${c - r * 0.08},${c} Z`}
        fill="#2C2416"
        opacity={0.30}
      />
      {/* Center dot */}
      <Circle cx={c} cy={c} r={dotR} fill="#2C2416" />
      {/* Decorative amber arc at bottom */}
      <Path
        d={`M${c - r * 0.30},${c + r * 0.58} Q${c},${c + r * 0.72} ${c + r * 0.30},${c + r * 0.58}`}
        stroke="#B8860B"
        strokeWidth={strokeW * 1.1}
        fill="none"
      />
    </Svg>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const t = useTranslation();

  const features = [
    { icon: 'map-outline' as const, text: t.auth.onboarding.feature1 },
    { icon: 'document-text-outline' as const, text: t.auth.onboarding.feature2 },
    { icon: 'navigate-outline' as const, text: t.auth.onboarding.feature3 },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
      <StatusBar barStyle="dark-content" backgroundColor="#F0EBE0" />

      {/* Large compass logo */}
      <View style={styles.logoSection}>
        <CompassLogo size={LOGO_SIZE} />
      </View>

      {/* Title block */}
      <View style={styles.titleBlock}>
        <Text style={styles.appName}>Locals</Text>
        <View style={styles.appTagRow}>
          <View style={styles.tagLine} />
          <Text style={styles.appTag}>APP</Text>
          <View style={styles.tagLine} />
        </View>
        <Text style={styles.subtitle}>{t.auth.onboarding.subtitle}</Text>
      </View>

      {/* Feature rows */}
      <View style={styles.features}>
        {features.map((f) => (
          <View key={f.text} style={styles.featureRow}>
            <View style={styles.featureIconBg}>
              <Ionicons name={f.icon} size={18} color="#3D5A2E" />
            </View>
            <Text style={styles.featureText}>{f.text}</Text>
          </View>
        ))}
      </View>

      {/* CTA Buttons */}
      <View style={styles.buttons}>
        <TouchableOpacity
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/auth/register' as any)}
        >
          <Text style={styles.primaryBtnText}>{t.auth.onboarding.getStarted}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/auth/login' as any)}
        >
          <Text style={styles.secondaryBtnText}>{t.auth.onboarding.alreadyHaveAccount}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.trialNote}>{t.auth.onboarding.trialInfo}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0EBE0',
    paddingHorizontal: 28,
    justifyContent: 'space-between',
  },
  logoSection: {
    alignItems: 'center',
  },
  titleBlock: {
    alignItems: 'center',
    gap: 6,
  },
  appName: {
    fontSize: 56,
    fontWeight: '700',
    color: '#2C2416',
    fontStyle: 'italic',
    letterSpacing: -1,
    lineHeight: 64,
  },
  appTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  tagLine: {
    width: 36,
    height: 1,
    backgroundColor: '#B8860B',
  },
  appTag: {
    fontSize: 11,
    fontWeight: '600',
    color: '#B8860B',
    letterSpacing: 3,
  },
  subtitle: {
    fontSize: 15,
    color: '#8A7F6E',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
  },
  features: {
    gap: 14,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  featureIconBg: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: '#EDE8DC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    fontSize: 15,
    color: '#2C2416',
    fontWeight: '500',
  },
  buttons: {
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: '#3D5A2E',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#F7F3EC',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    backgroundColor: '#F7F3EC',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#DDD5C5',
  },
  secondaryBtnText: {
    color: '#2C2416',
    fontSize: 16,
    fontWeight: '500',
  },
  trialNote: {
    textAlign: 'center',
    fontSize: 12,
    color: '#8A7F6E',
  },
});
