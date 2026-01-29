import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Sequence } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Montserrat';

interface InfographicProps {
  prompt: string;
  infographicType: string;
}

const { fontFamily } = loadFont();

const tasks = [
  { text: 'Organize your desk', icon: (
    <svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
      <rect x='2' y='7' width='20' height='15' rx='2' ry='2'></rect>
      <line x1='12' y1='7' x2='12' y2='22'></line>
      <path d='M16 2H8c-1.1 0-2 .9-2 2v3h12V4c0-1.1-.9-2-2-2z'></path>
    </svg>
  )},
  { text: 'Water your plants', icon: (
    <svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
      <path d='M10 21v-3m0-13V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2m-4 0a4 4 0 0 1 4 4v5c0 1.66-1.34 3-3 3h-2c-1.66 0-3-1.34-3-3V9a4 4 0 0 1 4-4z'></path>
      <path d='M12 21a2 2 0 0 1-2-2h4a2 2 0 0 1-2 2z'></path>
      <path d='M18 10a2 2 0 0 1-2-2h4a2 2 0 0 1-2 2z'></path>
    </svg>
  )},
  { text: 'Clip your nails', icon: (
    <svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
      <path d='M17 21h-2a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2z'></path>
      <path d='M7 21H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2z'></path>
      <path d='M12 2v3'></path>
      <path d='M12 19v3'></path>
    </svg>
  )}
];

export const Infographic1: React.FC<InfographicProps> = ({ prompt, infographicType }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const entranceProgress = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 30,
  });

  const fadeIn = interpolate(entranceProgress, [0, 1], [0, 1]);
  const slideUp = interpolate(entranceProgress, [0, 1], [30, 0]);

  const titleScale = interpolate(entranceProgress, [0, 1], [0.8, 1], { extrapolateRight: 'clamp' });
  const titleOpacity = interpolate(entranceProgress, [0, 1], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        fontFamily,
        backgroundColor: '#e0f2fe',
        backgroundImage: 'linear-gradient(135deg, #e0f2fe 0%, #ffffff 100%)',
        justifyContent: 'center',
        alignItems: 'center',
        opacity: fadeIn,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '40px',
          borderRadius: '20px',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)',
          transform: `translateY(${slideUp * 0.5}px)`,
          opacity: fadeIn,
          maxWidth: '80%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '30px' }}>
          <div
            style={{
              fontSize: '1.8em',
              fontWeight: 'bold',
              color: '#333',
              marginRight: '15px',
              transform: `scale(${titleScale})`,
              opacity: titleOpacity,
            }}
          >
            Quick 2-Minute Tasks
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: '#007bff',
              color: 'white',
              fontSize: '1.2em',
              fontWeight: 'bold',
              transform: `scale(${titleScale})`,
              opacity: titleOpacity,
            }}
          >
            <span style={{ fontSize: '0.8em', lineHeight: 1 }}>2</span>
            <span style={{ fontSize: '0.5em', lineHeight: 1, marginLeft: '2px' }}>MIN</span>
          </div>
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, width: '100%' }}>
          {tasks.map((task, index) => {
            const itemDelay = 15 + index * 10; // Staggered delay
            const itemSpring = spring({
              frame: frame - itemDelay,
              fps,
              config: { damping: 200, stiffness: 100 },
              durationInFrames: 30,
            });
            const itemTranslateY = interpolate(itemSpring, [0, 1], [40, 0]);
            const itemOpacity = interpolate(itemSpring, [0, 1], [0, 1]);

            return (
              <Sequence key={index} from={itemDelay} durationInFrames={durationInFrames - itemDelay} layout='none'>
                <li
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '20px',
                    fontSize: '1.2em',
                    color: '#555',
                    transform: `translateY(${itemTranslateY}px)`,
                    opacity: itemOpacity,
                  }}
                >
                  <div style={{ marginRight: '15px', color: '#007bff' }}>{task.icon}</div>
                  <div>{task.text}</div>
                </li>
              </Sequence>
            );
          })}
        </ul>
      </div>
    </AbsoluteFill>
  );
};
