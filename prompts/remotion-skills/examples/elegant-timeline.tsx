import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Sequence,
} from 'remotion';

/**
 * Elegant Timeline Example
 * Demonstrates a polished historical timeline with:
 * - Beat 1: Title and vertical line draw
 * - Beat 2: Staggered event nodes with glass cards
 * - Beat 3: Key event emphasis with glow
 *
 * Shows how to build timelines/lists with cinematic quality.
 */

interface InfographicProps {
  prompt: string;
  infographicType: string;
  data?: Record<string, unknown>;
}

export const ElegantTimeline: React.FC<InfographicProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const title = 'Key Milestones';
  const events = [
    { year: '1776', label: 'Declaration of Independence', highlight: false },
    { year: '1787', label: 'Constitution Ratified', highlight: true },
    { year: '1791', label: 'Bill of Rights Adopted', highlight: false },
    { year: '1803', label: 'Louisiana Purchase', highlight: false },
  ];

  // Beat 1: Title entrance
  const titleEntrance = spring({ frame, fps, config: { damping: 200 } });
  const titleY = interpolate(titleEntrance, [0, 1], [30, 0]);

  // Timeline line draw
  const lineProgress = interpolate(frame, [10, 60], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: 'transparent',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '50px 80px',
      }}
    >
      {/* Title */}
      <Sequence from={0} layout="none">
        <div
          style={{
            opacity: titleEntrance,
            transform: `translateY(${titleY}px)`,
            marginBottom: '40px',
          }}
        >
          <h1
            style={{
              fontSize: '60px',
              fontWeight: 800,
              color: '#fef3c7',
              margin: 0,
              letterSpacing: '-0.02em',
              filter: 'drop-shadow(0 0 15px rgba(251,191,36,0.3))',
            }}
          >
            {title}
          </h1>
          <div
            style={{
              width: 80,
              height: 4,
              borderRadius: 2,
              background: 'linear-gradient(90deg, #f59e0b, #d97706)',
              marginTop: '16px',
              opacity: titleEntrance,
              transform: `scaleX(${titleEntrance})`,
              transformOrigin: 'left',
            }}
          />
        </div>
      </Sequence>

      {/* Timeline container */}
      <div style={{ position: 'relative', paddingLeft: '60px', flex: 1 }}>
        {/* Vertical line */}
        <div
          style={{
            position: 'absolute',
            left: '24px',
            top: 0,
            bottom: 0,
            width: '3px',
            background: 'linear-gradient(180deg, #f59e0b, #92400e)',
            borderRadius: '2px',
            transformOrigin: 'top',
            transform: `scaleY(${lineProgress})`,
            boxShadow: '0 0 12px rgba(245,158,11,0.3)',
          }}
        />

        {/* Event nodes */}
        {events.map((event, i) => {
          const delay = 20 + i * 18;
          const nodeEntrance = spring({
            frame: frame - delay,
            fps,
            config: { damping: 18, stiffness: 90 },
          });
          const nodeX = interpolate(nodeEntrance, [0, 1], [40, 0], {
            extrapolateRight: 'clamp',
          });

          // Emphasis glow for highlighted events
          const isHighlight = event.highlight;
          const glowPhase = Math.max(0, frame - delay - 40);
          const glowPulse = isHighlight && glowPhase > 0
            ? 0.5 + Math.sin(glowPhase * 0.08) * 0.3
            : 0;

          return (
            <Sequence key={i} from={0} layout="none">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: i < events.length - 1 ? '50px' : 0,
                  opacity: nodeEntrance,
                  transform: `translateX(${nodeX}px)`,
                }}
              >
                {/* Node dot */}
                <div
                  style={{
                    position: 'absolute',
                    left: '14px',
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: isHighlight
                      ? 'linear-gradient(135deg, #f59e0b, #fbbf24)'
                      : 'linear-gradient(135deg, #78350f, #a16207)',
                    border: '3px solid rgba(254,243,199,0.4)',
                    boxShadow: isHighlight
                      ? `0 0 ${12 + glowPulse * 20}px rgba(245,158,11,${0.5 + glowPulse})`
                      : '0 4px 12px rgba(0,0,0,0.4)',
                    transform: `scale(${nodeEntrance})`,
                    zIndex: 2,
                  }}
                />

                {/* Event card */}
                <div
                  style={{
                    marginLeft: '30px',
                    padding: '24px 36px',
                    borderRadius: '20px',
                    background: isHighlight
                      ? 'linear-gradient(135deg, rgba(120,53,15,0.7) 0%, rgba(161,98,7,0.5) 100%)'
                      : 'linear-gradient(135deg, rgba(30,41,59,0.7) 0%, rgba(51,65,85,0.5) 100%)',
                    backdropFilter: 'blur(12px)',
                    border: isHighlight
                      ? '1px solid rgba(251,191,36,0.4)'
                      : '1px solid rgba(255,255,255,0.1)',
                    boxShadow: isHighlight
                      ? `0 20px 40px rgba(120,53,15,0.4), 0 0 30px rgba(245,158,11,${glowPulse * 0.3})`
                      : '0 15px 30px rgba(0,0,0,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '28px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '40px',
                      fontWeight: 800,
                      color: isHighlight ? '#fbbf24' : '#94a3b8',
                      fontVariantNumeric: 'tabular-nums',
                      minWidth: '100px',
                      filter: isHighlight
                        ? `drop-shadow(0 0 8px rgba(251,191,36,${0.4 + glowPulse}))`
                        : 'none',
                    }}
                  >
                    {event.year}
                  </div>
                  <div
                    style={{
                      width: '2px',
                      height: '36px',
                      background: isHighlight
                        ? 'rgba(251,191,36,0.4)'
                        : 'rgba(148,163,184,0.2)',
                      borderRadius: '1px',
                    }}
                  />
                  <div
                    style={{
                      fontSize: '28px',
                      fontWeight: 600,
                      color: isHighlight ? '#fef3c7' : 'rgba(226,232,240,0.85)',
                      lineHeight: 1.3,
                    }}
                  >
                    {event.label}
                  </div>
                </div>
              </div>
            </Sequence>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
