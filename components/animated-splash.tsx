import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/use-colors';
import { useAuthStore } from '@/store/auth';
import { Wordmark } from '@/components/ui/wordmark-logo';
import {
  SPLASH_IMAGE_WIDTH,
  SPLASH_WORDMARK_FONT_SIZE_FRACTION,
} from '@/constants/splash';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const WORDMARK_FONT_SIZE = SPLASH_WORDMARK_FONT_SIZE_FRACTION * SPLASH_IMAGE_WIDTH;

// Radius needed for a circle centered on screen to cover the whole screen:
// half the screen diagonal is the max distance from the center to a corner,
// plus a small safety margin.
const SCREEN_DIAGONAL = Math.sqrt(SCREEN_W * SCREEN_W + SCREEN_H * SCREEN_H);
const CIRCLE_RADIUS = (SCREEN_DIAGONAL / 2) * 1.1;

// Logo sits still for PAUSE_DURATION, then the reveal circle grows over
// REVEAL_DURATION — ~1.4s total before onFinished can fire.
const PAUSE_DURATION = 700;
const REVEAL_DURATION = 700;

interface AnimatedSplashProps {
  /** Called once the reveal animation has finished. */
  onFinished: () => void;
}

/**
 * Full-screen overlay shown as soon as JS boots, rendering the exact same
 * centered "The Locals" wordmark as the static native splash image (see
 * constants/splash.ts for why no extra position math is needed) so the
 * handoff between them is invisible. After a short pause, a circle in
 * `colors.background` grows from the screen's center, erasing the logo
 * until the screen is a flat background color — indistinguishable from the
 * first frame of the real screen underneath, so swapping to it produces no
 * visible cut.
 */
export function AnimatedSplash({ onFinished }: AnimatedSplashProps) {
  const colors = useColors();
  const scale = useSharedValue(0.0001);
  const [animationDone, setAnimationDone] = useState(false);
  const authInitialized = useAuthStore((s) => s.initialized);

  useEffect(() => {
    const timer = setTimeout(() => {
      scale.value = withTiming(
        1,
        { duration: REVEAL_DURATION, easing: Easing.inOut(Easing.ease) },
        (finished) => {
          if (finished) runOnJS(setAnimationDone)(true);
        },
      );
    }, PAUSE_DURATION);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Wait for both: the reveal animation to finish, and auth state to be
    // known (so the screen underneath — routed by AuthGuard — is already
    // the correct one by the time we uncover it).
    if (animationDone && authInitialized) {
      onFinished();
    }
  }, [animationDone, authInitialized, onFinished]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, zIndex: 999 }]}
    >
      <View style={styles.center} pointerEvents="none">
        {/* colors.foreground (not the Wordmark's default colors.primary) to
            match the static splash PNGs, which use the scheme's foreground
            color for contrast — primary is constant across schemes and
            unreadable on the dark background. */}
        <Wordmark size={WORDMARK_FONT_SIZE} color={colors.foreground} />
      </View>
      <Animated.View
        style={[
          styles.circle,
          {
            left: SCREEN_W / 2 - CIRCLE_RADIUS,
            top: SCREEN_H / 2 - CIRCLE_RADIUS,
            width: CIRCLE_RADIUS * 2,
            height: CIRCLE_RADIUS * 2,
            borderRadius: CIRCLE_RADIUS,
            backgroundColor: colors.background,
          },
          circleStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    position: 'absolute',
  },
});
