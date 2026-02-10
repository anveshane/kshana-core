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
 * Cinematic Statistic Example
 * Demonstrates a dramatic stat reveal with:
 * - Beat 1: Title card entrance with glass morphism
 * - Beat 2: Animated counter with glow
 * - Beat 3: Supporting stats with stagger + particle emphasis
 *
 * Quality bar: This is the minimum visual quality expected.
 */

interface InfographicProps {
  prompt: string;
  infographicType: string;
  data?: Record<string, unknown>;
}

export const CinematicStatistic: React.FC<InfographicProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const mainValue = 2.4;
  const mainLabel = 'Billion Users';
  const subtitle = 'Global Internet Adoption 2024';
  const supportingStats = [
    { label: 'Mobile', value: '68%', color: '#60a5fa' },
    { label: 'Desktop', value: '27%', color: '#a78bfa' },
    { label: 'Other', value: '5%', color: '#34d399' },
  ];

  // Beat 1: Card entrance
  const cardEntrance = spring({ frame, fps, config: { damping: 200 } });
  const cardScale = spring({ frame, fps, config: { damping: 18, stiffness: 80 } });
  const cardY = interpolate(cardEntrance, [0, 1], [40, 0]);

  // Beat 2: Counter animation
  const counterProgress = interpolate(frame, [25, 85], [0, mainValue], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const counterDisplay = counterProgress.toFixed(1);

  // Beat 3: Glow emphasis
  const glowPhase = Math.max(0, frame - 85);
  const glowIntensity = glowPhase > 0
    ? interpolate(glowPhase, [0, 20, 40], [0, 1, 0.6], { extrapolateRight: 'clamp' })
    : 0;

  // Ambient particles
  const particles = Array.from({ length: 40 }, (_, i) => ({
    x: Math.cos(i * 0.9 + frame * 0.008) * 500 + Math.sin(i * 2.1) * 100,
    y: Math.sin(i * 0.6 + frame * 0.006) * 350 + Math.cos(i * 1.7) * 80,
    size: 3 + (i % 5) * 2,
    opacity: (0.15 + Math.sin(frame * 0.025 + i * 0.7) * 0.1) * cardEntrance,
  }));

  return (
    <AbsoluteFill
      style={{
        background: 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Ambient particles */}
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `calc(50% + ${p.x}px)`,
            top: `calc(50% + ${p.y}px)`,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: `linear-gradient(135deg, #a78bfa80, #60a5fa60)`,
            opacity: p.opacity,
            filter: 'blur(1px)',
          }}
        />
      ))}

      {/* Main card */}
      <div
        style={{
          width: '75%',
          maxWidth: 900,
          padding: '60px 70px',
          borderRadius: '32px',
          background: 'linear-gradient(135deg, rgba(15,23,42,0.85) 0%, rgba(30,41,59,0.75) 100%)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow:
            '0 30px 60px rgba(0,0,0,0.4), 0 15px 30px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
          opacity: cardEntrance,
          transform: `translateY(${cardY}px) scale(${cardScale})`,
          textAlign: 'center',
        }}
      >
        {/* Subtitle */}
        <Sequence from={0} layout="none">
          <div
            style={{
              fontSize: '22px',
              fontWeight: 600,
              color: 'rgba(167,139,250,0.9)',
              textTransform: 'uppercase',
              letterSpacing: '3px',
              marginBottom: '24px',
              opacity: cardEntrance,
            }}
          >
            {subtitle}
          </div>
        </Sequence>

        {/* Main counter */}
        <Sequence from={20} layout="none">
          <div
            style={{
              fontSize: '120px',
              fontWeight: 800,
              color: '#ffffff',
              lineHeight: 1,
              marginBottom: '12px',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.03em',
              filter:
                glowIntensity > 0
                  ? `drop-shadow(0 0 ${25 * glowIntensity}px rgba(167,139,250,0.7)) drop-shadow(0 0 ${50 * glowIntensity}px rgba(167,139,250,0.3))`
                  : 'none',
              opacity: spring({ frame: frame - 20, fps, config: { damping: 200 } }),
            }}
          >
            {counterDisplay}
          </div>
          <div
            style={{
              fontSize: '36px',
              fontWeight: 600,
              color: 'rgba(255,255,255,0.8)',
              marginBottom: '48px',
              opacity: spring({ frame: frame - 30, fps, config: { damping: 200 } }),
            }}
          >
            {mainLabel}
          </div>
        </Sequence>

        {/* Supporting stats row */}
        <Sequence from={60} layout="none">
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '40px',
            }}
          >
            {supportingStats.map((stat, i) => {
              const statEntrance = spring({
                frame: frame - 60 - i * 12,
                fps,
                config: { damping: 18, stiffness: 100 },
              });
              const statY = interpolate(statEntrance, [0, 1], [25, 0], {
                extrapolateRight: 'clamp',
              });
              return (
                <div
                  key={i}
                  style={{
                    padding: '20px 32px',
                    borderRadius: '16px',
                    background: 'rgba(255,255,255,0.06)',
                    border: `1px solid ${stat.color}40`,
                    opacity: statEntrance,
                    transform: `translateY(${statY}px)`,
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      fontSize: '36px',
                      fontWeight: 800,
                      color: stat.color,
                      filter: `drop-shadow(0 0 8px ${stat.color}60)`,
                    }}
                  >
                    {stat.value}
                  </div>
                  <div
                    style={{
                      fontSize: '16px',
                      fontWeight: 500,
                      color: 'rgba(255,255,255,0.6)',
                      marginTop: '6px',
                      textTransform: 'uppercase',
                      letterSpacing: '1.5px',
                    }}
                  >
                    {stat.label}
                  </div>
                </div>
              );
            })}
          </div>
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};
