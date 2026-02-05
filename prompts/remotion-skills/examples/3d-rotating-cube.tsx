import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { ThreeCanvas } from '@remotion/three';

export const RotatingCubeExample: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const intro = spring({ frame, fps, config: { damping: 200 } });
  const rotation = interpolate(frame, [0, 240], [0, Math.PI * 2]);

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <div
        style={{
          position: 'absolute',
          top: 40,
          left: 40,
          right: 40,
          padding: '26px 36px',
          borderRadius: '22px',
          background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(99, 102, 241, 0.2) 100%)',
          border: '1px solid rgba(255,255,255,0.2)',
          backdropFilter: 'blur(10px)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.35)',
          color: '#e2e8f0',
          fontSize: '40px',
          fontWeight: 700,
          letterSpacing: '1px',
          opacity: intro,
          transform: `translateY(${interpolate(intro, [0, 1], [20, 0])}px)`,
        }}
      >
        3D Rotating Cube
      </div>

      <ThreeCanvas width={width} height={height}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[4, 6, 6]} intensity={1.0} />
        <pointLight position={[-6, -2, 6]} intensity={0.4} color="#38bdf8" />
        <group rotation={[rotation * 0.35, rotation, rotation * 0.2]} position={[0, 0, 0]}>
          <mesh scale={[2.3, 2.3, 2.3]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#60a5fa" metalness={0.5} roughness={0.2} />
          </mesh>
        </group>
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
