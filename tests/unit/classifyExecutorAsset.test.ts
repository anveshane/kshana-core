/**
 * Tests for `classifyExecutorAsset`.
 *
 * Background: ExecutorAgent emits `tool_result` events whose `result`
 * payload may carry a `file_path`. The pi-agent tool needs to surface
 * generated images/videos as standalone chat events. The classifier
 * inspects a file path and returns 'image' | 'video' | null based on
 * extension. Folded out so the in-process runner doesn't need
 * scripts/parseAssetLines's stdout-line scanner.
 */
import { describe, it, expect } from 'vitest';
import { classifyExecutorAsset } from '../../src/server/runners/classifyExecutorAsset.js';

describe('classifyExecutorAsset', () => {
  it('classifies common image extensions as image', () => {
    expect(classifyExecutorAsset('assets/images/s1shot1_first_frame_klein_abc.png')).toBe('image');
    expect(classifyExecutorAsset('foo.jpg')).toBe('image');
    expect(classifyExecutorAsset('foo.JPEG')).toBe('image');
    expect(classifyExecutorAsset('foo.webp')).toBe('image');
    expect(classifyExecutorAsset('foo.gif')).toBe('image');
  });

  it('classifies common video extensions as video', () => {
    expect(classifyExecutorAsset('assets/videos/scenes/scene_1.mp4')).toBe('video');
    expect(classifyExecutorAsset('foo.MP4')).toBe('video');
    expect(classifyExecutorAsset('foo.webm')).toBe('video');
    expect(classifyExecutorAsset('foo.mov')).toBe('video');
  });

  it('returns null for non-asset extensions', () => {
    expect(classifyExecutorAsset('prompts/scene_summaries.json')).toBeNull();
    expect(classifyExecutorAsset('logs/executor.log')).toBeNull();
    expect(classifyExecutorAsset('story.md')).toBeNull();
  });

  it('returns null for empty / undefined / null', () => {
    expect(classifyExecutorAsset('')).toBeNull();
    expect(classifyExecutorAsset(undefined)).toBeNull();
    expect(classifyExecutorAsset(null)).toBeNull();
  });

  it('handles absolute paths and trailing whitespace', () => {
    expect(classifyExecutorAsset('/Users/foo/bar.png')).toBe('image');
    expect(classifyExecutorAsset('  bar.mp4  ')).toBe('video');
  });

  it('returns null when extension lacks a leading dot or is just a name', () => {
    expect(classifyExecutorAsset('mp4')).toBeNull();
    expect(classifyExecutorAsset('photo')).toBeNull();
    expect(classifyExecutorAsset('directory/')).toBeNull();
  });

  it('uses only the LAST dot-segment so paths with dots in their dir names work', () => {
    expect(classifyExecutorAsset('my.project/assets/images/foo.png')).toBe('image');
    expect(classifyExecutorAsset('v1.0/scenes/foo.webm')).toBe('video');
  });
});
