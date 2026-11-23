import React from 'react';
import { View, Text, ScrollView, SafeAreaView } from 'react-native';

/**
 * Temporary diagnostic boundary — catches a render-phase crash and shows
 * the actual JS error/stack on screen instead of letting it take down the
 * whole native process with no information. Remove once the real crash
 * (app closes instantly on launch, no JS detail in the native crash log)
 * is found and fixed for good.
 */
export class CrashDebugBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[CrashDebugBoundary] caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#1a1a14', paddingTop: 60 }}>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 12 }}>
              Crash capturado
            </Text>
            <Text style={{ color: '#fff', fontSize: 13, marginBottom: 12 }} selectable>
              {this.state.error.name}: {this.state.error.message}
            </Text>
            <Text style={{ color: '#aaa', fontSize: 11 }} selectable>
              {this.state.error.stack}
            </Text>
          </ScrollView>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}
