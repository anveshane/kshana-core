import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Sequence } from 'remotion';

/**
 * Multi-Beat Sequence Example
 * Demonstrates three distinct animation phases:
 * Beat 1: Title reveal (frames 0-30)
 * Beat 2: Data build with staggered bars (frames 30-90)
 * Beat 3: Emphasis glow on key stat (frames 90-120)
 */
export const MultiBeatSequenceExample: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const data = [
    { label: 'Q1', value: 45 },
    { label: 'Q2', value: 62 },
    { label: 'Q3', value: 78 },
    { label: 'Q4', value: 95 },
  ];
  const maxValue = Math.max(...data.map(d => d.value));

  // Beat 1: Title entrance
  const titleOpacity = spring({ frame, fps, config: { damping: 200 } });
  const titleY = interpolate(titleOpacity, [0, 1], [30, 0]);

  // Beat 3: Emphasis glow (starts at frame 90)
  const glowIntensity = frame > 90
    ? interpolate(frame, [90, 110, 120], [0, 1, 0.7], { extrapolateRight: 'clamp' })
    : 0;

  return (
    <AbsoluteFill style={{ background: 'transparent', padding: 60 }}>
      {/* Beat 1: Title Card */}
      <Sequence from={0} durationInFrames={120} layout="none">
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 60,
            right: 60,
            padding: '30px 40px',
            borderRadius: '24px',
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(168, 85, 247, 0.2) 100%)',
            border: '1px solid rgba(255,255,255,0.2)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.35)',
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
          }}
        >
          <h1 style={{
            fontSize: '52px',
            fontWeight: 700,
            color: '#f1f5f9',
            margin: 0,
            filter: glowIntensity > 0
              ? `drop-shadow(0 0 ${20 * glowIntensity}px rgba(168, 85, 247, 0.8))`
              : 'none',
          }}>
            Quarterly Growth
          </h1>
          <p style={{ fontSize: '24px', color: 'rgba(241, 245, 249, 0.7)', marginTop: 10 }}>
            Revenue Performance 2024
          </p>
        </div>
      </Sequence>

      {/* Beat 2: Staggered Bar Chart */}
      <Sequence from={30} durationInFrames={90} layout="none">
        <div
          style={{
            position: 'absolute',
            bottom: 120,
            left: 60,
            right: 60,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-around',
            gap: 40,
            padding: '40px',
            borderRadius: '24px',
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.6) 0%, rgba(30, 41, 59, 0.4) 100%)',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          }}
        >
          {data.map((item, i) => {
            // Stagger each bar by 10 frames
            const localFrame = frame - 30 - i * 10;
            const barProgress = spring({
              frame: localFrame,
              fps,
              config: { damping: 15, stiffness: 80 },
            });
            const barHeight = (item.value / maxValue) * 280 * barProgress;

            const isHighest = item.value === maxValue;
            const barGlow = isHighest && glowIntensity > 0
              ? `drop-shadow(0 0 ${15 * glowIntensity}px rgba(34, 197, 94, 0.8))`
              : 'none';

            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 80,
                    height: barHeight,
                    borderRadius: '12px 12px 4px 4px',
                    background: isHighest
                      ? 'linear-gradient(180deg, #22c55e 0%, #16a34a 100%)'
                      : `linear-gradient(180deg, hsl(${220 + i * 15}, 70%, 60%) 0%, hsl(${220 + i * 15}, 70%, 45%) 100%)`,
                    boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
                    filter: barGlow,
                  }}
                />
                <span style={{ fontSize: '20px', fontWeight: 600, color: '#e2e8f0' }}>{item.label}</span>
                <span style={{
                  fontSize: '16px',
                  color: 'rgba(226, 232, 240, 0.7)',
                  opacity: barProgress,
                }}>
                  ${item.value}M
                </span>
              </div>
            );
          })}
        </div>
      </Sequence>

      {/* Beat 3: Key Stat Badge (appears at frame 90) */}
      <Sequence from={90} durationInFrames={30} layout="none">
        <div
          style={{
            position: 'absolute',
            top: 200,
            right: 80,
            padding: '20px 30px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.3) 0%, rgba(22, 163, 74, 0.2) 100%)',
            border: '2px solid rgba(34, 197, 94, 0.5)',
            backdropFilter: 'blur(10px)',
            boxShadow: `0 10px 30px rgba(34, 197, 94, ${0.3 * glowIntensity})`,
            opacity: spring({ frame: frame - 90, fps, config: { damping: 200 } }),
            transform: `scale(${spring({ frame: frame - 90, fps, config: { damping: 15 } })})`,
          }}
        >
          <span style={{ fontSize: '28px', fontWeight: 700, color: '#22c55e' }}>
            +111% YoY
          </span>
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};
