/**
 * TDD tests for `collapseBundleSegments` in FFmpegAssembler.
 *
 * When a scene is rendered as a single prompt-relay bundle mp4, all
 * N timeline segments for that scene resolve to the same filePath.
 * The assembler must concat the bundle ONCE, not N times — slicing
 * and re-concatenating defeats the smooth cross-shot transitions
 * that the relay generates.
 *
 * Behavior: walk segments in order; collapse runs of consecutive
 * segments with identical filePath into a single segment whose
 * duration is the sum and whose endTime is the last segment's endTime.
 * Transitions: keep the FIRST segment's transition (cross-scene
 * transition lives on the first segment of the next scene anyway).
 */

import { describe, it, expect } from 'vitest';
import { collapseBundleSegments } from '../../src/core/timeline/FFmpegAssembler.js';
import type { ResolvedSegment } from '../../src/core/timeline/FFmpegAssembler.js';

function seg(overrides: Partial<ResolvedSegment>): ResolvedSegment {
  return {
    segmentId: 'segment_1_shot_1',
    label: 'shot 1',
    startTime: 0,
    endTime: 5,
    duration: 5,
    filePath: '/tmp/scene_1_shot_1.mp4',
    mediaType: 'video',
    ...overrides,
  };
}

describe('collapseBundleSegments', () => {
  it('passes through a single segment unchanged', () => {
    const input = [seg({ filePath: '/a.mp4' })];
    expect(collapseBundleSegments(input)).toEqual(input);
  });

  it('passes through N distinct files unchanged', () => {
    const input = [
      seg({ segmentId: 'shot_1', filePath: '/a.mp4' }),
      seg({ segmentId: 'shot_2', filePath: '/b.mp4' }),
      seg({ segmentId: 'shot_3', filePath: '/c.mp4' }),
    ];
    expect(collapseBundleSegments(input)).toHaveLength(3);
  });

  it('collapses 9 consecutive segments pointing at the same bundle into 1', () => {
    const bundle = '/proj/scene_1_promptrelay.mp4';
    const input = Array.from({ length: 9 }, (_, i) =>
      seg({
        segmentId: `segment_1_shot_${i + 1}`,
        startTime: i * 4,
        endTime: (i + 1) * 4,
        duration: 4,
        filePath: bundle,
      }),
    );
    const out = collapseBundleSegments(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.filePath).toBe(bundle);
    expect(out[0]!.duration).toBe(36);          // 9 × 4
    expect(out[0]!.startTime).toBe(0);
    expect(out[0]!.endTime).toBe(36);
    // First segment's id wins so cross-scene transition logic still works
    expect(out[0]!.segmentId).toBe('segment_1_shot_1');
  });

  it('handles a mix: per-shot scene then bundle scene then per-shot scene', () => {
    const sceneABundle = '/proj/scene_2_promptrelay.mp4';
    const input = [
      // Scene 1: per-shot, 2 distinct files
      seg({ segmentId: 'segment_1_shot_1', filePath: '/p/s1_1.mp4', startTime: 0, endTime: 5, duration: 5 }),
      seg({ segmentId: 'segment_1_shot_2', filePath: '/p/s1_2.mp4', startTime: 5, endTime: 9, duration: 4 }),
      // Scene 2: bundle, 3 segments same file
      seg({ segmentId: 'segment_2_shot_1', filePath: sceneABundle, startTime: 9, endTime: 12, duration: 3 }),
      seg({ segmentId: 'segment_2_shot_2', filePath: sceneABundle, startTime: 12, endTime: 15, duration: 3 }),
      seg({ segmentId: 'segment_2_shot_3', filePath: sceneABundle, startTime: 15, endTime: 18, duration: 3 }),
      // Scene 3: per-shot, 1 file
      seg({ segmentId: 'segment_3_shot_1', filePath: '/p/s3_1.mp4', startTime: 18, endTime: 22, duration: 4 }),
    ];
    const out = collapseBundleSegments(input);
    expect(out).toHaveLength(4);
    expect(out[0]!.filePath).toBe('/p/s1_1.mp4');
    expect(out[1]!.filePath).toBe('/p/s1_2.mp4');
    expect(out[2]!.filePath).toBe(sceneABundle);
    expect(out[2]!.duration).toBe(9);
    expect(out[2]!.startTime).toBe(9);
    expect(out[2]!.endTime).toBe(18);
    expect(out[3]!.filePath).toBe('/p/s3_1.mp4');
  });

  it('does NOT collapse non-consecutive identical files (defensive)', () => {
    // Pathological but correct: if the same file appears non-adjacent
    // we don't merge — only run-length collapse on adjacency.
    const same = '/p/x.mp4';
    const input = [
      seg({ filePath: same }),
      seg({ filePath: '/p/other.mp4' }),
      seg({ filePath: same }),
    ];
    expect(collapseBundleSegments(input)).toHaveLength(3);
  });

  it('preserves the FIRST segment\'s transition on collapse', () => {
    const bundle = '/p/b.mp4';
    const input = [
      seg({ filePath: bundle, transition: 'fade', transitionDuration: 0.5 }),
      seg({ filePath: bundle, transition: 'cut' }),
    ];
    const out = collapseBundleSegments(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.transition).toBe('fade');
    expect(out[0]!.transitionDuration).toBe(0.5);
  });

  it('handles empty input', () => {
    expect(collapseBundleSegments([])).toEqual([]);
  });
});
