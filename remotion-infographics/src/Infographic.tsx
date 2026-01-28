import React from 'react';
import { AbsoluteFill } from 'remotion';

export interface InfographicProps {
  prompt: string;
  infographicType: string;
}

export const Infographic: React.FC<InfographicProps> = ({ prompt, infographicType }) => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#0f172a',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 48,
      }}
    >
      <div
        style={{
          fontFamily: 'system-ui, sans-serif',
          color: '#f1f5f9',
          fontSize: 28,
          maxWidth: 900,
          textAlign: 'center',
          lineHeight: 1.4,
        }}
      >
        <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 16, textTransform: 'uppercase' }}>
          {infographicType}
        </div>
        {prompt}
      </div>
    </AbsoluteFill>
  );
};
