import React from 'react';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useColors } from '@/hooks/use-colors';

/**
 * Compass rose mark used across auth/onboarding and the splash screen —
 * outer ring with cardinal tick marks, a north-pointing needle (full
 * opacity) with the other three points faded to 30%, a center dot, and a
 * decorative amber arc underneath. Points are derived with trigonometry
 * from a shared center/radius so all four kite shapes and tick marks stay
 * perfectly symmetric.
 */
export function CompassLogo({ size }: { size: number }) {
  const colors = useColors();
  const c = size / 2;
  const r = size * 0.31;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const pt = (angleDeg: number, radius: number) => ({
    x: c + radius * Math.sin(toRad(angleDeg)),
    y: c - radius * Math.cos(toRad(angleDeg)),
  });
  const kite = (angleDeg: number, tipR: number, baseR: number, halfAngle: number) => {
    const tip = pt(angleDeg, tipR);
    const b1 = pt(angleDeg - halfAngle, baseR);
    const b2 = pt(angleDeg + halfAngle, baseR);
    return `M${tip.x},${tip.y} L${b1.x},${b1.y} L${b2.x},${b2.y} Z`;
  };
  const tipR = r * 0.92;
  const baseR = r * 0.156;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={c} cy={c} r={r} stroke={colors.foreground} strokeWidth={size * 0.007} fill="none" />
      <Circle cx={c} cy={c} r={r * 0.806} stroke={colors.foreground} strokeWidth={size * 0.003} fill="none" opacity={0.35} />
      {[45, 135, 225, 315].map((angle) => {
        const inner = pt(angle, r * 0.75);
        const outer = pt(angle, tipR);
        return (
          <Line key={angle} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
            stroke={colors.foreground} strokeWidth={size * 0.007} opacity={0.4} />
        );
      })}
      <Path d={kite(0, tipR, baseR, 14)} fill={colors.foreground} />
      <Path d={kite(180, tipR, baseR, 14)} fill={colors.foreground} opacity={0.30} />
      <Path d={kite(90, tipR, baseR, 14)} fill={colors.foreground} opacity={0.30} />
      <Path d={kite(270, tipR, baseR, 14)} fill={colors.foreground} opacity={0.30} />
      <Circle cx={c} cy={c} r={size * 0.022} fill={colors.foreground} />
      <Circle cx={c} cy={c} r={size * 0.022} stroke={colors.background} strokeWidth={size * 0.006} fill="none" />
      <Path
        d={`M${c - r * 0.42},${c + r * 0.71} Q${c},${c + r * 0.9} ${c + r * 0.42},${c + r * 0.71}`}
        stroke={colors.accent}
        strokeWidth={size * 0.008}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}
