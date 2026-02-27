import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { fade } from '@remotion/transitions/fade';

/**
 * Transition Series Demo
 * Shows multiple scenes with smooth transitions between them
 * Useful for: multi-step processes, feature lists, storytelling
 */

interface SceneProps {
  title: string;
  description: string;
  icon: string;
  gradient: string;
  accentColor: string;
}

const Scene: React.FC<SceneProps> = ({ title, description, icon, gradient, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({ frame, fps, config: { damping: 200 } });
  const iconScale = spring({ frame: frame - 10, fps, config: { damping: 15, stiffness: 80 } });
  const textY = interpolate(entrance, [0, 1], [40, 0]);

  return (
    <AbsoluteFill style={{ background: 'transparent', padding: 80 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 40,
        }}
      >
        {/* Icon Circle */}
        <div
          style={{
            width: 160,
            height: 160,
            borderRadius: '50%',
            background: gradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 20px 50px ${accentColor}66, 0 10px 30px rgba(0,0,0,0.3)`,
            transform: `scale(${iconScale})`,
            border: '3px solid rgba(255,255,255,0.2)',
          }}
        >
          <span style={{ fontSize: '72px' }}>{icon}</span>
        </div>

        {/* Text Content */}
        <div
          style={{
            textAlign: 'center',
            opacity: entrance,
            transform: `translateY(${textY}px)`,
          }}
        >
          <h2
            style={{
              fontSize: '56px',
              fontWeight: 700,
              color: '#f1f5f9',
              margin: 0,
              marginBottom: 20,
              filter: `drop-shadow(0 0 20px ${accentColor}80)`,
            }}
          >
            {title}
          </h2>
          <p
            style={{
              fontSize: '28px',
              color: 'rgba(241, 245, 249, 0.8)',
              maxWidth: 600,
              lineHeight: 1.5,
            }}
          >
            {description}
          </p>
        </div>

        {/* Decorative Card */}
        <div
          style={{
            position: 'absolute',
            bottom: 60,
            left: 60,
            right: 60,
            height: 8,
            borderRadius: 4,
            background: `linear-gradient(90deg, transparent 0%, ${accentColor} 50%, transparent 100%)`,
            opacity: entrance * 0.6,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

export const TransitionSeriesDemo: React.FC = () => {
  const scenes: SceneProps[] = [
    {
      title: 'Design',
      description: 'Create stunning visuals with modern tools and techniques',
      icon: '🎨',
      gradient: 'linear-gradient(135deg, #f472b6 0%, #c026d3 100%)',
      accentColor: '#c026d3',
    },
    {
      title: 'Develop',
      description: 'Build robust applications with cutting-edge technology',
      icon: '⚡',
      gradient: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
      accentColor: '#3b82f6',
    },
    {
      title: 'Deploy',
      description: 'Ship to production with confidence and speed',
      icon: '🚀',
      gradient: 'linear-gradient(135deg, #34d399 0%, #10b981 100%)',
      accentColor: '#10b981',
    },
  ];

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <TransitionSeries>
        {scenes.map((scene, i) => (
          <React.Fragment key={i}>
            <TransitionSeries.Sequence durationInFrames={80}>
              <Scene {...scene} />
            </TransitionSeries.Sequence>
            {i < scenes.length - 1 && (
              <TransitionSeries.Transition
                presentation={i % 2 === 0 ? slide({ direction: 'from-right' }) : fade()}
                timing={linearTiming({ durationInFrames: 20 })}
              />
            )}
          </React.Fragment>
        ))}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
