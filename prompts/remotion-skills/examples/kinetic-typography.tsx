import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from 'remotion';

/**
 * Kinetic Typography Example
 * Words scale, move, and animate with spring physics
 * Useful for: headlines, key messages, dramatic reveals
 */

export const KineticTypographyExample: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const words = ['Build', 'Ship', 'Scale'];
  const colors = ['#f472b6', '#60a5fa', '#34d399'];

  // Counter animation (0 to 10000)
  const counterProgress = interpolate(
    frame,
    [60, 120],
    [0, 10000],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.quad),
    }
  );
  const counterValue = Math.floor(counterProgress);

  return (
    <AbsoluteFill style={{ background: 'transparent', padding: 60 }}>
      {/* Main Words */}
      <div
        style={{
          position: 'absolute',
          top: '30%',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 60,
        }}
      >
        {words.map((word, i) => {
          // Staggered entrance with bounce
          const delay = i * 15;
          const entrance = spring({
            frame: frame - delay,
            fps,
            config: { damping: 12, stiffness: 100 },
          });

          // Continuous subtle animation
          const float = Math.sin((frame + i * 20) * 0.05) * 8;
          const rotate = Math.sin((frame + i * 30) * 0.03) * 3;

          // Scale pulse on beat
          const pulse = frame > 100 + i * 10
            ? 1 + Math.sin((frame - 100 - i * 10) * 0.1) * 0.05
            : 1;

          return (
            <div
              key={i}
              style={{
                fontSize: '80px',
                fontWeight: 800,
                color: colors[i],
                opacity: entrance,
                transform: `
                  translateY(${interpolate(entrance, [0, 1], [100, 0]) + float}px)
                  scale(${entrance * pulse})
                  rotate(${rotate}deg)
                `,
                filter: `drop-shadow(0 0 30px ${colors[i]}80) drop-shadow(0 0 60px ${colors[i]}40)`,
                textShadow: `0 4px 20px ${colors[i]}60`,
              }}
            >
              {word}
            </div>
          );
        })}
      </div>

      {/* Animated Counter */}
      <div
        style={{
          position: 'absolute',
          bottom: '25%',
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <div
          style={{
            padding: '40px 80px',
            borderRadius: '30px',
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(168, 85, 247, 0.2) 100%)',
            border: '2px solid rgba(255,255,255,0.2)',
            backdropFilter: 'blur(15px)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.4), 0 0 100px rgba(99, 102, 241, 0.2)',
            opacity: spring({ frame: frame - 50, fps, config: { damping: 200 } }),
            transform: `scale(${spring({ frame: frame - 50, fps, config: { damping: 15 } })})`,
          }}
        >
          <div
            style={{
              fontSize: '96px',
              fontWeight: 800,
              color: '#fff',
              fontVariantNumeric: 'tabular-nums',
              filter: 'drop-shadow(0 0 20px rgba(255,255,255,0.5))',
            }}
          >
            {counterValue.toLocaleString()}+
          </div>
        </div>

        <div
          style={{
            fontSize: '32px',
            fontWeight: 600,
            color: 'rgba(255,255,255,0.8)',
            opacity: spring({ frame: frame - 70, fps, config: { damping: 200 } }),
            letterSpacing: '4px',
            textTransform: 'uppercase',
          }}
        >
          Active Users
        </div>
      </div>

      {/* Decorative floating elements */}
      {[...Array(6)].map((_, i) => {
        const angle = (i / 6) * Math.PI * 2 + frame * 0.01;
        const radius = 350 + Math.sin(frame * 0.02 + i) * 50;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * 0.4;
        const size = 12 + (i % 3) * 6;

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `calc(50% + ${x}px)`,
              top: `calc(50% + ${y}px)`,
              width: size,
              height: size,
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${colors[i % 3]}80, ${colors[(i + 1) % 3]}60)`,
              opacity: 0.6,
              filter: 'blur(2px)',
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
