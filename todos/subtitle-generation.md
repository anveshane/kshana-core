# Subtitle / Caption Generation

## Problem

Videos with narration have no subtitles. The narration text exists in the artifact pipeline (screenplay, scene breakdowns) and timing exists in the timeline, but there's no conversion to standard subtitle formats (SRT/VTT) and no burn-in capability.

## Feature

A `SubtitleGenerator` that produces SRT and VTT subtitle files from timeline segments and narration text, with optional hard-burn into the video during FFmpeg assembly.

## Output Formats

### SRT (SubRip)
```
1
00:00:01,000 --> 00:00:04,500
Welcome to this explanation
of how neural networks learn.

2
00:00:05,000 --> 00:00:08,200
First, let's understand
what a neuron does.
```

### VTT (WebVTT)
```
WEBVTT

00:00:01.000 --> 00:00:04.500
Welcome to this explanation
of how neural networks learn.

00:00:05.000 --> 00:00:08.200
First, let's understand
what a neuron does.
```

## Implementation Approach

### New File: `src/core/timeline/SubtitleGenerator.ts`

```typescript
interface SubtitleConfig {
  format: 'srt' | 'vtt';
  maxWordsPerCue: number;      // default: 12
  maxCharsPerLine: number;     // default: 42
  minCueDurationMs: number;    // default: 1000
  maxCueDurationMs: number;    // default: 7000
}

interface SubtitleCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}
```

### Source Data

Subtitles are built from two sources:
1. **Timeline segments** — provide start/end timestamps for each shot/scene
2. **Narration text** — from screenplay artifacts or scene content

The generator splits narration text into cues that fit within segment boundaries, respecting `maxWordsPerCue` and `maxCharsPerLine` constraints.

### Cue Building Algorithm

1. For each timeline segment that has narration text:
   - Split text into words
   - Group words into cues respecting `maxWordsPerCue` and `maxCharsPerLine`
   - Distribute cue timing evenly across the segment duration
   - Ensure each cue meets `minCueDurationMs`
2. Format cues into SRT or VTT with proper timestamp formatting
   - SRT: `HH:MM:SS,mmm`
   - VTT: `HH:MM:SS.mmm`

### FFmpeg Burn-In

Optional hard-burn subtitles into the video using FFmpeg's `subtitles` filter:

```
ffmpeg -i video.mp4 -vf "subtitles=subs.srt:force_style='FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2'" output.mp4
```

Styling parameters (font, size, color, outline, position) should be configurable and ideally driven by the style playbook if one is active.

### Integration Points

1. **Assembly pipeline** — Generate subtitle file before final encode; optionally burn in
2. **Project output** — Save `.srt` and `.vtt` alongside the final video
3. **Web UI timeline view** — Display subtitle cues as an overlay layer
4. **Assembly config** — Add `subtitles` options: `{ enabled: boolean, burnIn: boolean, format: 'srt' | 'vtt', style?: SubtitleStyle }`
