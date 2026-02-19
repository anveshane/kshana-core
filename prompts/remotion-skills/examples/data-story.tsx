import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Easing,
  Sequence,
} from 'remotion';

/**
 * Data Story Example — Multi-Beat Bar Chart
 * Demonstrates a narrative data visualization with:
 * - Beat 1: Title + axis entrance
 * - Beat 2: Staggered bar growth with labels
 * - Beat 3: Winner highlight with glow + callout badge
 *
 * Shows how to build charts that tell a story through animation.
 */

interface InfographicProps {
  prompt: string;
  infographicType: string;
  data?: Record<string, unknown>;
}

export const DataStory: React.FC<InfographicProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const title = 'Renewable Energy Growth';
  const subtitle = 'Capacity Added (GW) by Source, 2024';
  const bars = [
    { label: 'Solar', value: 340, color: '#f59e0b' },
    { label: 'Wind', value: 280, color: '#3b82f6' },
    { label: 'Hydro', value: 165, color: '#06b6d4' },
    { label: 'Nuclear', value: 85, color: '#8b5cf6' },
    { label: 'Geo', value: 42, color: '#10b981' },
  ];
  const maxValue = Math.max(...bars.map((b) => b.value));
  const winnerIndex = bars.findIndex((b) => b.value === maxValue);

  // Beat 1: Title
  const titleEntrance = spring({ frame, fps, config: { damping: 200 } });

  // Axis line draw
  const axisProgress = interpolate(frame, [8, 35], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Beat 3: Winner glow
  const glowStart = 30 + bars.length * 12 + 20;
  const glowPhase = Math.max(0, frame - glowStart);
  const glowIntensity = glowPhase > 0
    ? interpolate(glowPhase, [0, 15, 30], [0, 1, 0.7], { extrapolateRight: 'clamp' })
    : 0;

  return (
    <AbsoluteFill
      style={{
        background: 'transparent',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '50px 70px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Title Section */}
      <Sequence from={0} layout="none">
        <div
          style={{
            opacity: titleEntrance,
            transform: `translateY(${interpolate(titleEntrance, [0, 1], [25, 0])}px)`,
            marginBottom: '40px',
          }}
        >
          <h1
            style={{
              fontSize: '52px',
              fontWeight: 800,
              color: '#f1f5f9',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </h1>
          <p
            style={{
              fontSize: '24px',
              fontWeight: 500,
              color: 'rgba(148,163,184,0.8)',
              margin: '10px 0 0',
            }}
          >
            {subtitle}
          </p>
        </div>
      </Sequence>

      {/* Chart area */}
      <div
        style={{
          flex: 1,
          padding: '40px 50px',
          borderRadius: '28px',
          background:
            'linear-gradient(180deg, rgba(15,23,42,0.75) 0%, rgba(30,41,59,0.55) 100%)',
          backdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.35), 0 12px 25px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map((frac, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              bottom: `${frac * 75 + 12}%`,
              left: '50px',
              right: '50px',
              height: '1px',
              background: 'rgba(148,163,184,0.1)',
              opacity: axisProgress,
            }}
          />
        ))}

        {/* Bars */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-around',
            gap: '36px',
            height: '75%',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {bars.map((bar, i) => {
            const barDelay = 30 + i * 12;
            const barGrowth = spring({
              frame: frame - barDelay,
              fps,
              config: { damping: 15, stiffness: 70 },
            });
            const barHeight = (bar.value / maxValue) * 100 * barGrowth;

            const isWinner = i === winnerIndex;
            const barGlow =
              isWinner && glowIntensity > 0
                ? `drop-shadow(0 0 ${18 * glowIntensity}px ${bar.color}90)`
                : 'none';

            // Label entrance (after bar grows)
            const labelEntrance = spring({
              frame: frame - barDelay - 15,
              fps,
              config: { damping: 200 },
            });

            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  flex: 1,
                  gap: '14px',
                }}
              >
                {/* Value label */}
                <div
                  style={{
                    fontSize: '22px',
                    fontWeight: 700,
                    color: isWinner ? bar.color : 'rgba(226,232,240,0.8)',
                    opacity: labelEntrance,
                    filter: isWinner && glowIntensity > 0
                      ? `drop-shadow(0 0 8px ${bar.color}80)`
                      : 'none',
                  }}
                >
                  {bar.value}
                </div>

                {/* Bar */}
                <div
                  style={{
                    width: '100%',
                    maxWidth: '90px',
                    height: `${barHeight}%`,
                    minHeight: barGrowth > 0.01 ? '4px' : '0px',
                    borderRadius: '10px 10px 4px 4px',
                    background: `linear-gradient(180deg, ${bar.color} 0%, ${bar.color}99 100%)`,
                    boxShadow: `0 8px 24px ${bar.color}40`,
                    filter: barGlow,
                    position: 'relative',
                  }}
                >
                  {/* Shine overlay */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: '50%',
                      bottom: 0,
                      borderRadius: '10px 0 0 4px',
                      background:
                        'linear-gradient(90deg, rgba(255,255,255,0.15) 0%, transparent 100%)',
                    }}
                  />
                </div>

                {/* Category label */}
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 600,
                    color: 'rgba(226,232,240,0.7)',
                    opacity: labelEntrance,
                    textAlign: 'center',
                  }}
                >
                  {bar.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom axis line */}
        <div
          style={{
            height: '2px',
            background: 'rgba(148,163,184,0.2)',
            borderRadius: '1px',
            marginTop: '20px',
            transform: `scaleX(${axisProgress})`,
            transformOrigin: 'left',
          }}
        />
      </div>

      {/* Winner badge (Beat 3) */}
      <Sequence from={glowStart} layout="none">
        <div
          style={{
            position: 'absolute',
            top: '50px',
            right: '80px',
            padding: '16px 28px',
            borderRadius: '14px',
            background: `linear-gradient(135deg, ${bars[winnerIndex].color}30, ${bars[winnerIndex].color}15)`,
            border: `2px solid ${bars[winnerIndex].color}60`,
            backdropFilter: 'blur(10px)',
            boxShadow: `0 12px 30px ${bars[winnerIndex].color}25`,
            opacity: spring({
              frame: frame - glowStart,
              fps,
              config: { damping: 200 },
            }),
            transform: `scale(${spring({ frame: frame - glowStart, fps, config: { damping: 14 } })})`,
          }}
        >
          <span
            style={{
              fontSize: '20px',
              fontWeight: 700,
              color: bars[winnerIndex].color,
              filter: `drop-shadow(0 0 6px ${bars[winnerIndex].color}70)`,
            }}
          >
            {bars[winnerIndex].label} leads with {bars[winnerIndex].value} GW
          </span>
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};
