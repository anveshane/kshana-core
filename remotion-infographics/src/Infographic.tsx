import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

// Cast to satisfy JSX when @types/react 18 and 19 are mixed (Remotion uses React 18 types)
const Fill = AbsoluteFill as React.ComponentType<
  React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }
>;

export interface InfographicProps {
  prompt: string;
  infographicType: string;
  data?: Record<string, unknown>;
}

/**
 * Base/fallback Infographic component.
 * Generated components override this per placement.
 */
export const Infographic: React.FC<InfographicProps> = ({ prompt, infographicType }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = spring({ frame, fps, config: { damping: 200 } });
  const scale = spring({ frame, fps, config: { damping: 200 } });
  const translateY = interpolate(
    spring({ frame, fps, config: { damping: 200 } }),
    [0, 1],
    [20, 0],
    { extrapolateRight: 'clamp' }
  );

  return (
    <Fill
      style={{
        background: 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 48,
      }}
    >
      <div
        style={{
          fontFamily: 'system-ui, sans-serif',
          color: '#f1f5f9',
          fontSize: 28,
          maxWidth: 900,
          textAlign: 'center',
          lineHeight: 1.4,
          opacity,
          transform: `scale(${scale}) translateY(${translateY}px)`,
        }}
      >
        <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 16, textTransform: 'uppercase' }}>
          {infographicType}
        </div>
        {prompt}
      </div>
    </Fill>
  );
};
