import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Infographic } from './Infographic';

const fps = 24;

const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Infographic"
        component={Infographic}
        durationInFrames={5 * fps}
        fps={fps}
        width={1920}
        height={1080}
        defaultProps={{
          prompt: 'Placeholder infographic',
          infographicType: 'statistic',
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
