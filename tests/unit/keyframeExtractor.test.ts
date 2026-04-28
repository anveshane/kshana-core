/**
 * Tests for the video keyframe extractor.
 *
 * Used by the fidelity audit to sample N keyframes from a shot_video so
 * the VLM judge can score each frame, then aggregate cross-frame
 * properties (motion, drift, identity consistency).
 *
 * These tests use a real (tiny, 1.8KB) fixture MP4 at
 * `tests/fixtures/keyframe-source.mp4` — 10 frames of solid red — to
 * exercise the actual ffmpeg shell-out. Faster than mocking ffmpeg, and
 * we know it works end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractKeyframes } from '../../src/core/timeline/keyframeExtractor.js';

const FIXTURE = join(__dirname, '..', 'fixtures', 'keyframe-source.mp4');
let outDir: string;

beforeEach(() => {
  outDir = join(tmpdir(), `keyframe-extract-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(outDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
});

describe('extractKeyframes — happy path', () => {
  it('extracts the requested count of frames from a 10-frame fixture', async () => {
    const frames = await extractKeyframes(FIXTURE, 4, outDir);
    expect(frames).toHaveLength(4);
    for (const f of frames) {
      expect(existsSync(f), `frame should exist: ${f}`).toBe(true);
      expect(statSync(f).size).toBeGreaterThan(0);
    }
  });

  it('returns frame paths in temporal order (first frame index < last frame index)', async () => {
    const frames = await extractKeyframes(FIXTURE, 4, outDir);
    // Frame names should sort correctly and reflect temporal order.
    const sorted = [...frames].sort();
    expect(frames).toEqual(sorted);
  });

  it('writes PNG files, not other formats', async () => {
    const [first] = await extractKeyframes(FIXTURE, 2, outDir);
    expect(first!.endsWith('.png')).toBe(true);
  });

  it('extracts 2 keyframes when count=2 (first and last)', async () => {
    const frames = await extractKeyframes(FIXTURE, 2, outDir);
    expect(frames).toHaveLength(2);
  });

  it('extracts a single frame when count=1 (the first frame)', async () => {
    const frames = await extractKeyframes(FIXTURE, 1, outDir);
    expect(frames).toHaveLength(1);
  });
});

describe('extractKeyframes — edge cases', () => {
  it('handles count > total frames by returning what exists (no crash)', async () => {
    // Fixture has 10 frames; ask for 20.
    const frames = await extractKeyframes(FIXTURE, 20, outDir);
    // Should return up to as many frames as the video has.
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeLessThanOrEqual(10);
    for (const f of frames) {
      expect(existsSync(f)).toBe(true);
    }
  });

  it('throws a clear error when the video file does not exist', async () => {
    await expect(
      extractKeyframes('/nonexistent/video.mp4', 4, outDir),
    ).rejects.toThrow(/not found|does not exist|no such/i);
  });

  it('throws when count is zero or negative (callers must specify a positive number)', async () => {
    await expect(extractKeyframes(FIXTURE, 0, outDir)).rejects.toThrow(/positive|count/i);
    await expect(extractKeyframes(FIXTURE, -1, outDir)).rejects.toThrow(/positive|count/i);
  });

  it('creates the output directory if it does not exist', async () => {
    const nestedOut = join(outDir, 'nested', 'subdir');
    expect(existsSync(nestedOut)).toBe(false);
    const frames = await extractKeyframes(FIXTURE, 2, nestedOut);
    expect(frames).toHaveLength(2);
    expect(existsSync(nestedOut)).toBe(true);
  });
});
