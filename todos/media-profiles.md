# Media Profiles — Platform-Specific Render Configurations

## Problem

Resolution, codec, and duration settings are currently specified per-assembly call with no platform awareness. There's no way to say "render for TikTok" and have the right constraints (vertical 9:16, max 60s, 1080x1920) propagate through image generation, video generation, and final assembly automatically.

## Feature

A `MediaProfile` system that defines platform-specific render configurations and propagates constraints through the entire pipeline — from asset generation to final encode.

## Built-in Profiles

| Profile | Resolution | Aspect | FPS | Max Duration | Codec |
|---|---|---|---|---|---|
| `youtube_landscape` | 1920x1080 | 16:9 | 30 | — | H.264, CRF 18 |
| `youtube_4k` | 3840x2160 | 16:9 | 30 | — | H.264, CRF 18 |
| `youtube_shorts` | 1080x1920 | 9:16 | 30 | 60s | H.264 |
| `instagram_reels` | 1080x1920 | 9:16 | 30 | 90s, 250MB max | H.264 |
| `tiktok` | 1080x1920 | 9:16 | 30 | 180s | H.264 |
| `linkedin` | 1920x1080 | 16:9 | 30 | 600s | H.264 |
| `cinematic` | 2560x1080 | 21:9 | 24 | — | H.264, CRF 15 |

## Implementation Approach

### Type Definition

```typescript
interface MediaProfile {
  id: string;
  displayName: string;
  resolution: { width: number; height: number };
  aspectRatio: string;
  frameRate: number;
  codec: string;
  audioCodec: string;
  audioBitrate: string;
  videoBitrate?: string;
  crf?: number;
  maxDurationSeconds?: number;
  maxFileSizeMB?: number;
}
```

### Integration Points

1. **`src/core/templates/MediaProfiles.ts`** — New file with profile definitions and a `getProfile(id)` lookup
2. **`StyleConfig` in `src/core/templates/types.ts`** — Add optional `mediaProfile` field (already has `aspectRatio` and `resolution`)
3. **`FFmpegAssembler`** — Read profile from assembly config to set output resolution, codec, CRF, audio settings
4. **Image/video generation tools** — Use profile's resolution as default width/height when generating assets
5. **Web UI** — Profile selector dropdown when creating a project or starting a render

### Constraint Propagation

When a profile is selected:
- Image generation uses the profile's resolution for width/height defaults
- Video generation respects the aspect ratio and resolution
- The backward planner can validate that total timeline duration doesn't exceed `maxDurationSeconds`
- FFmpegAssembler uses profile's codec, CRF, and audio settings for final encode
- A warning fires if the assembled output would exceed `maxFileSizeMB`
