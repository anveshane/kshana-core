/**
 * Remotion root — registers all infographic compositions.
 *
 * This file is regenerated at runtime by the RemotionRenderer service
 * to register session-specific generated components. The version below
 * is a placeholder that uses the base Infographic fallback component.
 */
import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Infographic } from './Infographic';

const fps = 24;

const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Infographic1"
        // @ts-ignore - Remotion Composition expects Record<string, unknown> but components use InfographicProps
        component={Infographic}
        durationInFrames={5 * fps}
        fps={fps}
        width={1920}
        height={1080}
        defaultProps={{
          prompt: '',
          infographicType: 'statistic',
          data: {},
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
