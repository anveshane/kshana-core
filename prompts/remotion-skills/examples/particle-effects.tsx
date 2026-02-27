import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';

/**
 * Particle Effects Example
 * Demonstrates floating particles that converge to form a shape/text
 * Useful for: celebration moments, logo reveals, ambient depth
 */

interface Particle {
  id: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  size: number;
  hue: number;
  delay: number;
}

export const ParticleEffectsExample: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Generate particles with deterministic positions (seeded by index)
  const particles = useMemo<Particle[]>(() => {
    const count = 80;
    return Array.from({ length: count }, (_, i) => {
      // Spread start positions around the canvas
      const angle = (i / count) * Math.PI * 2;
      const radius = 400 + (i % 5) * 60;
      const startX = Math.cos(angle) * radius;
      const startY = Math.sin(angle) * radius;

      // Target positions form a circle/badge shape
      const targetAngle = (i / count) * Math.PI * 2;
      const targetRadius = 120 + (i % 3) * 20;
      const targetX = Math.cos(targetAngle) * targetRadius;
      const targetY = Math.sin(targetAngle) * targetRadius;

      return {
        id: i,
        startX,
        startY,
        targetX,
        targetY,
        size: 6 + (i % 4) * 2,
        hue: 200 + (i % 8) * 15,
        delay: i * 0.5,
      };
    });
  }, []);

  // Phase timing
  const scatterPhase = frame < 60; // Frames 0-60: particles scattered
  const convergeStart = 60;
  const holdStart = 120;

  // Title entrance
  const titleOpacity = spring({ frame, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      {/* Title Card */}
      <div
        style={{
          position: 'absolute',
          top: 50,
          left: 60,
          right: 60,
          padding: '26px 40px',
          borderRadius: '22px',
          background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.25) 0%, rgba(99, 102, 241, 0.2) 100%)',
          border: '1px solid rgba(255,255,255,0.2)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          opacity: titleOpacity,
          transform: `translateY(${interpolate(titleOpacity, [0, 1], [20, 0])}px)`,
        }}
      >
        <h1 style={{ fontSize: '44px', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
          Particle Formation
        </h1>
      </div>

      {/* Particle Container */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 0,
          height: 0,
        }}
      >
        {particles.map((p) => {
          // Calculate particle position based on phase
          let x: number, y: number, opacity: number, scale: number;

          if (scatterPhase) {
            // Floating animation during scatter phase
            const floatX = Math.sin(frame * 0.03 + p.id) * 30;
            const floatY = Math.cos(frame * 0.025 + p.id * 0.7) * 25;
            x = p.startX + floatX;
            y = p.startY + floatY;
            opacity = spring({ frame: frame - p.delay, fps, config: { damping: 200 } });
            scale = 0.8 + Math.sin(frame * 0.05 + p.id) * 0.2;
          } else {
            // Converge to target position
            const convergeProgress = spring({
              frame: frame - convergeStart - p.delay * 0.3,
              fps,
              config: { damping: 18, stiffness: 100 },
            });
            x = interpolate(convergeProgress, [0, 1], [p.startX, p.targetX]);
            y = interpolate(convergeProgress, [0, 1], [p.startY, p.targetY]);

            // Slight float after convergence
            if (frame > holdStart) {
              const holdFloat = (frame - holdStart) * 0.02;
              x += Math.sin(holdFloat + p.id) * 5;
              y += Math.cos(holdFloat + p.id * 0.7) * 4;
            }

            opacity = 1;
            scale = interpolate(convergeProgress, [0, 0.8, 1], [0.8, 1.2, 1]);
          }

          // Glow intensity increases after convergence
          const glowIntensity = frame > holdStart
            ? interpolate(frame, [holdStart, holdStart + 20], [0, 1], { extrapolateRight: 'clamp' })
            : 0;

          return (
            <div
              key={p.id}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: p.size,
                height: p.size,
                borderRadius: '50%',
                background: `hsl(${p.hue}, 80%, 60%)`,
                opacity,
                transform: `translate(-50%, -50%) scale(${scale})`,
                boxShadow: glowIntensity > 0
                  ? `0 0 ${10 * glowIntensity}px hsl(${p.hue}, 80%, 60%)`
                  : 'none',
                filter: `blur(${1 - opacity}px)`,
              }}
            />
          );
        })}

        {/* Center badge (appears after convergence) */}
        {frame > holdStart && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              padding: '30px 50px',
              borderRadius: '20px',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.4) 0%, rgba(168, 85, 247, 0.3) 100%)',
              border: '2px solid rgba(255,255,255,0.3)',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 20px 40px rgba(99, 102, 241, 0.4)',
              opacity: spring({ frame: frame - holdStart, fps, config: { damping: 200 } }),
            }}
          >
            <span style={{ fontSize: '48px', fontWeight: 700, color: '#fff' }}>
              10,000+
            </span>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
