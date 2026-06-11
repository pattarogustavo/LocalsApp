import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ImageBackground,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Background gradient overlay */}
      <View style={styles.background}>
        <View style={styles.gradientOverlay} />
      </View>

      {/* Hero content */}
      <View style={[styles.content, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 }]}>
        {/* Logo / Icon */}
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Ionicons name="airplane" size={40} color="#fff" />
          </View>
        </View>

        {/* Title */}
        <View style={styles.titleBlock}>
          <Text style={styles.appName}>Voyage</Text>
          <Text style={styles.tagline}>Plan your perfect trips,{'\n'}curated just for you.</Text>
        </View>

        {/* Feature highlights */}
        <View style={styles.features}>
          {[
            { icon: 'map-outline', text: 'AI-powered itineraries' },
            { icon: 'document-text-outline', text: 'Organize all your trip docs' },
            { icon: 'airplane-outline', text: 'Track flights & transport' },
          ].map((f) => (
            <View key={f.text} style={styles.featureRow}>
              <View style={styles.featureIconBg}>
                <Ionicons name={f.icon as any} size={16} color="#52B788" />
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
            <Text style={styles.primaryBtnText}>Create account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/auth/login' as any)}
          >
            <Text style={styles.secondaryBtnText}>I already have an account</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.trialNote}>7-day free trial · No credit card required</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F1F16',
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0F1F16',
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,31,22,0.85)',
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
  },
  logoContainer: {
    alignItems: 'center',
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(82,183,136,0.2)',
    borderWidth: 1.5,
    borderColor: 'rgba(82,183,136,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    alignItems: 'center',
    gap: 12,
  },
  appName: {
    fontSize: 48,
    fontWeight: '700',
    color: '#F5F0E8',
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 18,
    color: 'rgba(245,240,232,0.65)',
    textAlign: 'center',
    lineHeight: 26,
  },
  features: {
    gap: 14,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureIconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(82,183,136,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    fontSize: 15,
    color: 'rgba(245,240,232,0.8)',
    fontWeight: '500',
  },
  buttons: {
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: '#52B788',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#0F1F16',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    backgroundColor: 'rgba(245,240,232,0.08)',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(245,240,232,0.15)',
  },
  secondaryBtnText: {
    color: 'rgba(245,240,232,0.85)',
    fontSize: 16,
    fontWeight: '500',
  },
  trialNote: {
    textAlign: 'center',
    fontSize: 12,
    color: 'rgba(245,240,232,0.35)',
  },
});
