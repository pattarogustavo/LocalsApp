import React, { useRef } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

interface ScalePressableProps extends Omit<PressableProps, 'children'> {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  children?: React.ReactNode;
}

/**
 * Primary-action button wrapper: scales down slightly on press for a more
 * tactile feel. Reserved for the app's most important CTAs (create trip,
 * create itinerary, save, confirm) — not a drop-in TouchableOpacity replacement.
 */
export function ScalePressable({ style, scaleTo = 0.97, onPressIn, onPressOut, children, ...props }: ScalePressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      onPressIn={(e) => {
        Animated.spring(scale, { toValue: scaleTo, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
        onPressOut?.(e);
      }}
      {...props}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
