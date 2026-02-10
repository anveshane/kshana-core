# About Remotion

Remotion is a framework that can create videos programmatically.
It is based on React.js. All output should be valid React code and be written in TypeScript.

## Project Structure

A Remotion Project consists of an entry file, a Root file and any number of React component files.

The Root file defines `<Composition>` components:
```tsx
import {Composition} from 'remotion';
import {MyComp} from './MyComp';
export const Root: React.FC = () => {
  return (
    <Composition
      id="MyComp"
      component={MyComp}
      durationInFrames={120}
      width={1920}
      height={1080}
      fps={30}
      defaultProps={{}}
    />
  );
};
```

A `<Composition>` defines a video that can be rendered. It has a React `component`, an `id`, `durationInFrames`, `width`, `height` and `fps`.

## Core Hooks

Inside a component, use `useCurrentFrame()` to get the current frame number (starts at 0):
```tsx
import {useCurrentFrame} from 'remotion';
export const MyComp: React.FC = () => {
  const frame = useCurrentFrame();
  return <div>Frame {frame}</div>;
};
```

Use `useVideoConfig()` for composition metadata:
```tsx
import {useVideoConfig} from 'remotion';
const {fps, durationInFrames, height, width} = useVideoConfig();
```

## Layout — AbsoluteFill

Use `AbsoluteFill` from `remotion` to layer elements on top of each other:
```tsx
import {AbsoluteFill} from 'remotion';
<AbsoluteFill>
  <AbsoluteFill><div>Back layer</div></AbsoluteFill>
  <AbsoluteFill><div>Front layer</div></AbsoluteFill>
</AbsoluteFill>
```

## Sequencing

### Sequence

Wrap elements in `Sequence` to delay their appearance. Child `useCurrentFrame()` resets to 0 at sequence start:
```tsx
import {Sequence} from 'remotion';
<Sequence from={10} durationInFrames={20}>
  <div>Appears at frame 10, child frame starts at 0</div>
</Sequence>
```

### Series

Display multiple elements one after another:
```tsx
import {Series} from 'remotion';
<Series>
  <Series.Sequence durationInFrames={20}>
    <div>First (frames 0-19)</div>
  </Series.Sequence>
  <Series.Sequence durationInFrames={30}>
    <div>Second (frames 20-49)</div>
  </Series.Sequence>
  <Series.Sequence durationInFrames={30} offset={-8}>
    <div>Third (overlaps by 8 frames)</div>
  </Series.Sequence>
</Series>
```

### TransitionSeries

Display elements with transitions between them:
```tsx
import {springTiming, TransitionSeries} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {wipe} from '@remotion/transitions/wipe';
<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={60}>
    <Fill color="blue" />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition
    timing={springTiming({config: {damping: 200}})}
    presentation={fade()}
  />
  <TransitionSeries.Sequence durationInFrames={60}>
    <Fill color="black" />
  </TransitionSeries.Sequence>
</TransitionSeries>
```

## Animation

### interpolate()

Maps a value from an input range to an output range:
```tsx
import {interpolate} from 'remotion';
const opacity = interpolate(frame, [0, 30], [0, 1], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});
```
Always add `extrapolateLeft: 'clamp'` and `extrapolateRight: 'clamp'` by default.

### spring()

Physics-based animation with configurable damping:
```tsx
import {spring} from 'remotion';
const scale = spring({
  fps,
  frame,
  config: {damping: 200},
});
```

### Determinism

Remotion requires deterministic code. Never use `Math.random()`. Use `random()` from `remotion` with a static seed:
```tsx
import {random} from 'remotion';
const value = random('my-seed'); // returns 0-1
```

## Media Components

```tsx
import {Video, Audio} from '@remotion/media';
import {Img} from 'remotion';
import {Gif} from '@remotion/gif';

<Video src="video.mp4" volume={0.5} />
<Audio src="audio.mp3" volume={1} />
<Img src="image.png" style={{width: '100%'}} />
<Gif src="animation.gif" style={{width: '100%'}} />
```

Assets from the `public/` folder use `staticFile()`:
```tsx
import {staticFile} from 'remotion';
<Audio src={staticFile('audio.mp3')} />
```
