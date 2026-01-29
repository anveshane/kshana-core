import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Infographic1 } from './components/Infographic1';
import { Infographic2 } from './components/Infographic2';

const fps = 24;

const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Infographic1"
        // @ts-ignore - Remotion Composition expects Record<string, unknown> but components use InfographicProps
        component={Infographic1}
        durationInFrames={5 * fps}
        fps={fps}
        width={1920}
        height={1080}
        defaultProps={{
          prompt: '',
          infographicType: 'statistic',
        }}
      />
      <Composition
        id="Infographic2"
        // @ts-ignore - Remotion Composition expects Record<string, unknown> but components use InfographicProps
        component={Infographic2}
        durationInFrames={5 * fps}
        fps={fps}
        width={1920}
        height={1080}
        defaultProps={{
          prompt: '',
          infographicType: 'statistic',
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
