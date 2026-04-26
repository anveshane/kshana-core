import { describe, it, expect } from 'vitest';
import {
  buildAudioFilter,
  buildVideoFilter,
  computeXfadeOffset,
  xfadeTransitionDuration,
} from '../../src/core/timeline/FFmpegAssembler.js';

describe('FFmpegAssembler audio padding (AV-sync regression)', () => {
  // LTX 2.3 outputs we observed on woman_medieval_village_betrothed:
  //   video=3.041667s, audio=3.029s  (12 ms short)
  //   video=8.041667s, audio=8.021s  (20 ms short)
  // Across 17 clips that compounded to a noticeable lead in voice vs
  // lip movement in the final assembly. Fix pads each clip's audio with
  // apad then trims to the video duration so every [v_i][a_i] pair has
  // identical length entering the concat filter.

  it('pads + trims audio to the video duration when audio is present', () => {
    const f = buildAudioFilter(2, /*hasAudio=*/ true, 3.041667, /*silence=*/ -1);
    expect(f).toBe('[2:a]asetpts=PTS-STARTPTS,apad,atrim=duration=3.041667[a2]');
  });

  it('uses each segment’s OWN video duration (not a shared/timeline duration)', () => {
    // Different clips → different durations. Verify we’re per-clip, not
    // accidentally pulling a single value.
    const a = buildAudioFilter(0, true, 3.041667, -1);
    const b = buildAudioFilter(1, true, 8.041667, -1);
    const c = buildAudioFilter(2, true, 6.041667, -1);
    expect(a).toContain('atrim=duration=3.041667');
    expect(b).toContain('atrim=duration=8.041667');
    expect(c).toContain('atrim=duration=6.041667');
  });

  it('slices silence to the video duration for clips without audio', () => {
    // silence source is at input index 17 (after 17 video inputs)
    const f = buildAudioFilter(5, /*hasAudio=*/ false, 4.5, /*silence=*/ 17);
    expect(f).toBe('[17:a]atrim=duration=4.5,asetpts=PTS-STARTPTS[a5]');
  });

  it('emits a [v_i] label that matches the [a_i] label position for concat pairing', () => {
    // The concat filter expects interleaved [v0][a0][v1][a1]... — labels
    // must agree on index. Sanity-check a few indices.
    for (const i of [0, 7, 16]) {
      const v = buildVideoFilter(i, 1280, 720);
      const a = buildAudioFilter(i, true, 5.0, -1);
      expect(v).toContain(`[v${i}]`);
      expect(a).toContain(`[a${i}]`);
    }
  });

  it('video filter scales and pads to the requested resolution with PTS reset', () => {
    const v = buildVideoFilter(3, 1920, 1080);
    expect(v).toBe(
      '[3:v]scale=1920:1080:force_original_aspect_ratio=decrease,' +
        'pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setpts=PTS-STARTPTS[v3]',
    );
  });
});

describe('computeXfadeOffset (timeline-vs-actual duration regression)', () => {
  // The first run produced final_video.mp4 with video=44.7s, audio=82.9s
  // because xfade offsets used segments[i].duration (planned, e.g. 2.14 s)
  // while LTX 2.3 actually emitted ~3.04 s clips. xfade then truncated
  // each clip to its planned length, dropping nearly half the video.

  it('uses ACTUAL clip duration for the running offset, not the planned timeline duration', () => {
    // Step 0: clip 0 actual = 3.04 s. Step 1: 0.5 s fade.
    const step1 = computeXfadeOffset(3.04, 3.04, 0.5);
    // offset = 3.04 - 0.5 = 2.54 s into the running output, fade begins
    expect(step1.offset).toBeCloseTo(2.54, 6);
    // accumulator advances by 3.04 - 0.5 = 2.54
    expect(step1.nextAccumulatedDuration).toBeCloseTo(5.58, 6);
  });

  it('clamps offset to 0 if accumulator < transition duration (first clip shorter than fade)', () => {
    // Edge case: first clip is 0.3 s, fade is 0.5 s. Offset would be
    // negative — must clamp to 0 so xfade doesn't error.
    const step = computeXfadeOffset(0.3, 1.0, 0.5);
    expect(step.offset).toBe(0);
    expect(step.nextAccumulatedDuration).toBeCloseTo(0.8, 6); // 0.3 + 1.0 - 0.5
  });

  it('cuts of total duration matches sum of actual clips minus transitions', () => {
    // Replay woman_medieval_village_betrothed: 3 clips at 3.04 s with two
    // 0.5 s fades. Expected total = 3*3.04 - 2*0.5 = 9.12 - 1.0 = 8.12 s.
    let acc = 3.04;
    const s1 = computeXfadeOffset(acc, 3.04, 0.5);
    acc = s1.nextAccumulatedDuration;
    const s2 = computeXfadeOffset(acc, 3.04, 0.5);
    acc = s2.nextAccumulatedDuration;
    expect(acc).toBeCloseTo(8.12, 6);
  });
});

describe('xfadeTransitionDuration (sub-frame xfade regression)', () => {
  // FFmpeg's xfade silently produces broken/truncated output when its
  // `duration` parameter is shorter than 1 frame at the input framerate.
  // The previous code used 0.01s for "cut" — at 24 fps that's < 1 frame
  // and breaks the whole chain (final_video.mp4 came out at 9 s of video
  // against 83 s of audio on woman_medieval_village_betrothed). Two
  // frames at 24 fps (~0.083 s) is the smallest safe value and is
  // visually indistinguishable from a hard cut.

  it('returns ≥1 frame at 24fps for cut transitions', () => {
    const t = xfadeTransitionDuration('cut', undefined);
    expect(t).toBeGreaterThanOrEqual(1 / 24);
    // Also ≥1 frame at 60fps (covers higher-fps inputs too)
    expect(t).toBeGreaterThanOrEqual(1 / 60);
  });

  it('ignores configured duration for cuts (cuts are always the minimum safe duration)', () => {
    // If a planner ever supplies a 0.01s duration thinking it means "fast cut",
    // we must NOT honor that — it triggers the FFmpeg sub-frame bug.
    expect(xfadeTransitionDuration('cut', 0.01)).toBeGreaterThanOrEqual(1 / 24);
    expect(xfadeTransitionDuration('cut', 0)).toBeGreaterThanOrEqual(1 / 24);
  });

  it('uses 0.5s default for fade and dissolve when no override given', () => {
    expect(xfadeTransitionDuration('fade', undefined)).toBe(0.5);
    expect(xfadeTransitionDuration('dissolve', undefined)).toBe(0.5);
    expect(xfadeTransitionDuration('dip_to_black', undefined)).toBe(0.5);
  });

  it('honors configured durations for fade-style transitions', () => {
    expect(xfadeTransitionDuration('fade', 1.2)).toBe(1.2);
    expect(xfadeTransitionDuration('crossfade', 0.3)).toBe(0.3);
  });

  it('caps flash_to_white at 0.3s even when configured longer', () => {
    expect(xfadeTransitionDuration('flash_to_white', 1.0)).toBe(0.3);
    expect(xfadeTransitionDuration('flash_to_white', 0.15)).toBe(0.15);
    expect(xfadeTransitionDuration('flash_to_white', undefined)).toBe(0.2);
  });
});
