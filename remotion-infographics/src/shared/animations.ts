/**
 * Reusable animation helpers wrapping Remotion's spring() and interpolate().
 * These helpers follow the cinematic 3-beat pattern: Entrance → Build → Emphasis.
 */

import { spring, interpolate, type SpringConfig } from 'remotion';

/**
 * Standard spring config presets.
 */
export const SPRING_PRESETS = {
  /** Smooth entrance, no bounce */
  smooth: { damping: 200 } satisfies SpringConfig,
  /** Subtle bounce for emphasis */
  bouncy: { damping: 12, stiffness: 200 } satisfies SpringConfig,
  /** Snappy, fast response */
  snappy: { damping: 20, stiffness: 300 } satisfies SpringConfig,
  /** Gentle, slow entrance */
  gentle: { damping: 200, stiffness: 80 } satisfies SpringConfig,
} as const;

/**
 * Fade-in with optional delay.
 */
export function fadeIn(
  frame: number,
  fps: number,
  delay: number = 0,
  config: SpringConfig = SPRING_PRESETS.smooth,
): number {
  return spring({ frame: Math.max(0, frame - delay), fps, config });
}

/**
 * Scale entrance from a smaller size.
 */
export function scaleEntrance(
  frame: number,
  fps: number,
  delay: number = 0,
  fromScale: number = 0.8,
  config: SpringConfig = SPRING_PRESETS.smooth,
): number {
  const progress = spring({ frame: Math.max(0, frame - delay), fps, config });
  return interpolate(progress, [0, 1], [fromScale, 1], { extrapolateRight: 'clamp' });
}

/**
 * Slide-up entrance.
 */
export function slideUp(
  frame: number,
  fps: number,
  delay: number = 0,
  distance: number = 30,
  config: SpringConfig = SPRING_PRESETS.smooth,
): number {
  const progress = spring({ frame: Math.max(0, frame - delay), fps, config });
  return interpolate(progress, [0, 1], [distance, 0], { extrapolateRight: 'clamp' });
}

/**
 * Staggered delay calculator for list items.
 */
export function staggerDelay(index: number, baseDelay: number = 0, staggerFrames: number = 12): number {
  return baseDelay + index * staggerFrames;
}

/**
 * Exit animation — fade out toward the end of the composition.
 */
export function fadeOut(
  frame: number,
  durationInFrames: number,
  exitDuration: number = 15,
): number {
  if (frame < durationInFrames - exitDuration) return 1;
  return interpolate(
    frame,
    [durationInFrames - exitDuration, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
}
