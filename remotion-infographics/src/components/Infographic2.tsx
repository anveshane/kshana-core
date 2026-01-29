import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Sequence } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Montserrat';

interface InfographicProps {
  prompt: string;
  infographicType: string;
}

const { fontFamily } = loadFont();

const steps = [
  { text: 'Sit Down', icon: '🪑' },
  { text: 'Open Laptop', icon: '💻' },
  { text: 'Study for 2 Minutes', icon: '⏱️' },
  { text: 'Close Laptop', icon: '💻' },
  { text: 'Do Something Else', icon: '✅' },
];

export const Infographic2: React.FC<InfographicProps> = ({ prompt, infographicType }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const containerEntrance = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 100 },
    durationInFrames: 40,
  });
  const containerScale = interpolate(containerEntrance, [0, 1], [0.8, 1], { extrapolateRight: 'clamp' });
  const containerOpacity = interpolate(containerEntrance, [0, 1], [0, 1], { extrapolateRight: 'clamp' });

  const arrowIcon = (
    <svg width='30' height='30' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
      <line x1='5' y1='12' x2='19' y2='12'></line>
      <polyline points='12 5 19 12 12 19'></polyline>
    </svg>
  );

  return (
    <AbsoluteFill
      style={{
        fontFamily,
        backgroundColor: '#dcfce7',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          transform: `scale(${containerScale})`,
          opacity: containerOpacity,
          padding: '20px',
          borderRadius: '15px',
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          boxShadow: '0 8px 20px rgba(0, 0, 0, 0.08)',
        }}
      >
        {steps.map((step, index) => {
          const itemDelay = index * 15; // Staggered delay for each card
          const itemSpring = spring({
            frame: frame - itemDelay,
            fps,
            config: { damping: 150, stiffness: 120 },
            durationInFrames: 30,
          });
          const itemTranslateX = interpolate(itemSpring, [0, 1], [-50, 0]);
          const itemOpacity = interpolate(itemSpring, [0, 1], [0, 1]);

          const arrowDelay = itemDelay + 15; // Arrow appears after the card it follows
          const arrowSpring = spring({
            frame: frame - arrowDelay,
            fps,
            config: { damping: 150, stiffness: 120 },
            durationInFrames: 20,
          });
          const arrowOpacity = interpolate(arrowSpring, [0, 1], [0, 1]);

          return (
            <React.Fragment key={index}>
              <Sequence from={itemDelay} durationInFrames={durationInFrames - itemDelay} layout='none'>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '25px 35px',
                    margin: '0 10px',
                    backgroundColor: '#ffffff',
                    borderRadius: '15px',
                    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.08)',
                    minWidth: '180px',
                    minHeight: '120px',
                    textAlign: 'center',
                    transform: `translateX(${itemTranslateX}px)`,
                    opacity: itemOpacity,
                    border: index === 2 ? '3px solid #007bff' : 'none', // Highlight "Study for 2 Minutes"
                  }}
                >
                  <span style={{ fontSize: '2.5em', marginBottom: '10px' }}>{step.icon}</span>
                  <div style={{ fontSize: '1.1em', fontWeight: '600', color: '#333' }}>
                    {step.text}
                    {index === 2 && (
                      <div style={{ fontSize: '0.7em', fontWeight: 'bold', color: '#007bff', marginTop: '5px' }}>
                        (2 MIN)
                      </div>
                    )}
                  </div>
                </div>
              </Sequence>
              {index < steps.length - 1 && (
                <Sequence from={arrowDelay} durationInFrames={durationInFrames - arrowDelay} layout='none'>
                  <div style={{ color: '#666', opacity: arrowOpacity, transform: `translateX(${itemTranslateX * 0.5}px)` }}>
                    {arrowIcon}
                  </div>
                </Sequence>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
