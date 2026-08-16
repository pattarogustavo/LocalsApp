import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/use-colors';

// Gap between the two lines, as a fraction of font size — kept in sync with
// the same ratio baked into the static splash PNGs (assets/images/
// splash-icon*.png) so the wordmark's proportions match everywhere it's used.
const LINE_GAP_RATIO = 0.12;

/**
 * "The Locals" wordmark — "The" stacked above "Locals" (bold, same size),
 * centered. Replaces the old CompassLogo mark everywhere.
 */
export function Wordmark({ size, color }: { size: number; color?: string }) {
  const colors = useColors();
  const textColor = color ?? colors.primary;

  return (
    <View style={styles.container}>
      <Text style={[styles.line, { fontSize: size, color: textColor, fontFamily: 'Lora-Regular' }]}>
        The
      </Text>
      <Text
        style={[
          styles.line,
          { fontSize: size, color: textColor, fontFamily: 'Lora-Bold', marginTop: size * LINE_GAP_RATIO },
        ]}
      >
        Locals
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {
    textAlign: 'center',
  },
});
