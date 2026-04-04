# Audio Mixing — Multi-Track Mixing, Ducking, and Normalization

## Problem

The timeline type system has audio layer types (`audio`, `narration_video`) but there is no audio post-processing. When a video has narration over background music, the music plays at full volume over the speech. There's no mixing, no ducking, and no loudness normalization.

## Feature

An `AudioMixer` that uses FFmpeg filters to produce professional-grade audio: multi-track mixing with per-track volume/timing, sidechain compression ducking (automatically lower music when narration plays), and broadcast-standard loudness normalization.

## Core Operations

### 1. Multi-Track Mix
Layer multiple audio tracks (narration, music, SFX) with individual volume levels, start offsets, and fade in/out.

```
narration.wav  [vol=1.0, start=0s]
music.mp3      [vol=0.3, start=0s, fade_in=2s, fade_out=3s]
sfx_whoosh.wav [vol=0.5, start=5.2s]
→ mixed_output.wav
```

### 2. Sidechain Compression Ducking
Automatically lower music volume when narration is playing, then bring it back up during pauses. Uses FFmpeg's `sidechaincompress` filter with the narration track as the sidechain key.

**Parameters:**
- Duck amount: -12dB to -18dB (how much to lower music)
- Attack: 10-50ms (how fast music ducks)
- Release: 200-500ms (how fast music returns)
- Threshold: speech detection sensitivity

**FFmpeg filter chain:**
```
[narration][music]sidechaincompress=threshold=0.02:ratio=9:attack=10:release=200
```

### 3. Loudness Normalization
Normalize final mix to broadcast standard using FFmpeg's `loudnorm` filter.

**Target:** -16 LUFS (YouTube/podcast standard), LRA=11, true peak=-1.5dB

```
ffmpeg -i mixed.wav -af loudnorm=I=-16:LRA=11:TP=-1.5 normalized.wav
```

## Implementation Approach

### New File: `src/core/timeline/AudioMixer.ts`

```typescript
interface AudioTrack {
  path: string;
  role: 'narration' | 'music' | 'sfx';
  volume: number;        // 0.0 - 1.0
  startOffsetMs: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}

interface MixConfig {
  tracks: AudioTrack[];
  duckingEnabled: boolean;
  duckAmountDb: number;     // default: -12
  normalizeLufs: number;    // default: -16
  outputPath: string;
}
```

### Integration Points

1. **`FFmpegAssembler`** — After video concat, call `AudioMixer.mix()` to produce the final audio, then mux audio + video
2. **Timeline segments** — Each segment's audio layers map to `AudioTrack` entries with timing from segment offsets
3. **Assembly config** — Add `audioMix` options to `AssemblyConfig` (ducking on/off, normalization target)

### FFmpeg Implementation Notes

- All operations use FFmpeg filter graphs (no external audio libraries needed)
- Sidechain ducking: narration track feeds `sidechaincompress` as sidechain input
- Volume: `volume` filter with dB-to-linear conversion (`10^(dB/20)`)
- Fades: `afade=t=in:d=2` and `afade=t=out:st=58:d=3`
- The `amix` filter combines multiple inputs with per-input volume
- For complex mixes, build a filter_complex string programmatically
