import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { ThreeCanvas } from '@remotion/three';

export const ExtrudedBarChart3D: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const data = [2.1, 2.8, 3.4, 4.2];
  const max = Math.max(...data);
  const intro = spring({ frame, fps, config: { damping: 200 } });

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
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(14, 165, 233, 0.18) 100%)',
          border: '1px solid rgba(255,255,255,0.2)',
          backdropFilter: 'blur(10px)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.35)',
          color: '#e2e8f0',
          fontSize: '36px',
          fontWeight: 700,
          letterSpacing: '1px',
          opacity: intro,
          transform: `translateY(${interpolate(intro, [0, 1], [20, 0])}px)`,
        }}
      >
        3D Revenue Growth (in $M)
      </div>

      <ThreeCanvas width={width} height={height}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 6]} intensity={1.0} />
        <pointLight position={[-5, 4, -4]} intensity={0.5} color="#38bdf8" />

        <group rotation={[0, -0.4, 0]} position={[0, -1, 0]}>
          {data.map((value, i) => {
            const heightValue = spring({
              frame: frame - i * 8,
              fps,
              config: { damping: 200 },
            }) * (value / max) * 4;

            return (
              <mesh key={i} position={[(i - 1.5) * 2.2, heightValue / 2, 0]}>
                <boxGeometry args={[1.4, Math.max(0.2, heightValue), 1.4]} />
                <meshStandardMaterial
                  color={`hsl(${200 + i * 20}, 80%, 60%)`}
                  metalness={0.4}
                  roughness={0.35}
                />
              </mesh>
            );
          })}

          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
            <planeGeometry args={[12, 8]} />
            <meshStandardMaterial color="#0f172a" metalness={0.1} roughness={0.8} />
          </mesh>
        </group>
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
