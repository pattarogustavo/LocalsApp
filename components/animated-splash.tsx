import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/use-colors';
import { useAuthStore } from '@/store/auth';
import { CompassLogo } from '@/components/ui/compass-logo';
import {
  SPLASH_IMAGE_WIDTH,
  SPLASH_IMAGE_SOURCE_WIDTH,
  SPLASH_IMAGE_SOURCE_HEIGHT,
  SPLASH_COMPASS_CENTER_Y_FRACTION,
  SPLASH_COMPASS_SIZE_FRACTION,
  SPLASH_TEXT_GAP_FRACTION,
  SPLASH_TEXT_FONT_SIZE_FRACTION,
} from '@/constants/splash';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Same math the native splash uses to place the image (resizeMode:
// "contain", centered on screen) — see constants/splash.ts.
const IMAGE_DISPLAY_HEIGHT = SPLASH_IMAGE_WIDTH * (SPLASH_IMAGE_SOURCE_HEIGHT / SPLASH_IMAGE_SOURCE_WIDTH);
const IMAGE_TOP = SCREEN_H / 2 - IMAGE_DISPLAY_HEIGHT / 2;

const COMPASS_SIZE = SPLASH_COMPASS_SIZE_FRACTION * SPLASH_IMAGE_WIDTH;
const COMPASS_CENTER_X = SCREEN_W / 2;
const COMPASS_CENTER_Y = IMAGE_TOP + SPLASH_COMPASS_CENTER_Y_FRACTION * IMAGE_DISPLAY_HEIGHT;

const TEXT_TOP = COMPASS_CENTER_Y + COMPASS_SIZE / 2 + SPLASH_TEXT_GAP_FRACTION * COMPASS_SIZE;
const TEXT_FONT_SIZE = SPLASH_TEXT_FONT_SIZE_FRACTION * COMPASS_SIZE;

// Radius needed for a circle centered on the compass to cover the whole
// screen: half the screen diagonal is the theoretical max distance from a
// point near the center to a corner, plus a safety margin since the compass
// isn't exactly at the screen's geometric center.
const SCREEN_DIAGONAL = Math.sqrt(SCREEN_W * SCREEN_W + SCREEN_H * SCREEN_H);
const CIRCLE_RADIUS = (SCREEN_DIAGONAL / 2) * 1.25;

const ANIMATION_DURATION = 700;

interface AnimatedSplashProps {
  /** Called once the reveal animation has finished. */
  onFinished: () => void;
}

/**
 * Full-screen overlay shown as soon as JS boots, rendering the exact same
 * compass + "TheLocals" lockup as the static native splash image so the
 * handoff between them is invisible. A circle in `colors.background` then
 * grows from the compass's center, erasing the logo until the screen is a
 * flat background color — indistinguishable from the first frame of the
 * real screen underneath, so swapping to it produces no visible cut.
 */
export function AnimatedSplash({ onFinished }: AnimatedSplashProps) {
  const colors = useColors();
  const scale = useSharedValue(0.0001);
  const [animationDone, setAnimationDone] = useState(false);
  const authInitialized = useAuthStore((s) => s.initialized);

  useEffect(() => {
    scale.value = withTiming(
      1,
      { duration: ANIMATION_DURATION, easing: Easing.inOut(Easing.ease) },
      (finished) => {
        if (finished) runOnJS(setAnimationDone)(true);
      },
    );
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
      <View
        style={{
          position: 'absolute',
          left: COMPASS_CENTER_X - COMPASS_SIZE / 2,
          top: COMPASS_CENTER_Y - COMPASS_SIZE / 2,
          width: COMPASS_SIZE,
          height: COMPASS_SIZE,
        }}
      >
        <CompassLogo size={COMPASS_SIZE} />
      </View>
      <Text
        style={[
          styles.wordmark,
          { top: TEXT_TOP, fontSize: TEXT_FONT_SIZE, color: colors.foreground },
        ]}
      >
        TheLocals
      </Text>
      <Animated.View
        style={[
          styles.circle,
          {
            left: COMPASS_CENTER_X - CIRCLE_RADIUS,
            top: COMPASS_CENTER_Y - CIRCLE_RADIUS,
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
  wordmark: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: 'serif',
    fontStyle: 'italic',
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  circle: {
    position: 'absolute',
  },
});
