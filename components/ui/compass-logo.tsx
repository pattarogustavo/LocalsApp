import React from 'react';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useColors } from '@/hooks/use-colors';

/**
 * Compass rose mark used across auth/onboarding and the splash screen —
 * outer ring with cardinal tick marks, a north-pointing needle (full
 * opacity) with the other three points faded to 30%, a center dot, and a
 * decorative amber arc underneath.
 */
export function CompassLogo({ size }: { size: number }) {
  const colors = useColors();
  const c = size / 2;
  const r = size * 0.43;
  const tickLen = size * 0.065;
  const strokeW = size * 0.010;
  const dotR = size * 0.025;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Outer circle */}
      <Circle cx={c} cy={c} r={r} stroke={colors.foreground} strokeWidth={strokeW} fill="none" />
      {/* Cardinal tick marks */}
      <Line x1={c} y1={c - r} x2={c} y2={c - r + tickLen} stroke={colors.foreground} strokeWidth={strokeW} />
      <Line x1={c} y1={c + r - tickLen} x2={c} y2={c + r} stroke={colors.foreground} strokeWidth={strokeW} />
      <Line x1={c - r} y1={c} x2={c - r + tickLen} y2={c} stroke={colors.foreground} strokeWidth={strokeW} />
      <Line x1={c + r - tickLen} y1={c} x2={c + r} y2={c} stroke={colors.foreground} strokeWidth={strokeW} />
      {/* North point — tall, dark */}
      <Path
        d={`M${c},${c - r * 0.75} L${c - r * 0.13},${c + r * 0.05} L${c},${c - r * 0.08} Z`}
        fill={colors.foreground}
      />
      {/* South point — shorter, faded */}
      <Path
        d={`M${c},${c + r * 0.75} L${c + r * 0.13},${c - r * 0.05} L${c},${c + r * 0.08} Z`}
        fill={colors.foreground}
        opacity={0.30}
      />
      {/* East point */}
      <Path
        d={`M${c + r * 0.75},${c} L${c - r * 0.05},${c - r * 0.13} L${c + r * 0.08},${c} Z`}
        fill={colors.foreground}
        opacity={0.30}
      />
      {/* West point */}
      <Path
        d={`M${c - r * 0.75},${c} L${c + r * 0.05},${c + r * 0.13} L${c - r * 0.08},${c} Z`}
        fill={colors.foreground}
        opacity={0.30}
      />
      {/* Center dot */}
      <Circle cx={c} cy={c} r={dotR} fill={colors.foreground} />
      {/* Decorative amber arc at bottom */}
      <Path
        d={`M${c - r * 0.30},${c + r * 0.58} Q${c},${c + r * 0.72} ${c + r * 0.30},${c + r * 0.58}`}
        stroke={colors.accent}
        strokeWidth={strokeW * 1.1}
        fill="none"
      />
    </Svg>
  );
}
