/**
 * TDD tests for `chunkSceneIntoBundles`.
 *
 * Splits a scene's shots into the minimum number of contiguous chunks
 * such that every chunk fits both prompt-relay caps (20 shots, 1000
 * frames). Each chunk's frame counts are LTX-aligned independently
 * (8M+1 first segment, 8M rest, total ≡ 1 mod 8).
 *
 * Greedy: walk shots in order; close the current chunk and start a
 * new one when adding the next shot would break a cap.
 */

import { describe, it, expect } from 'vitest';
import { chunkSceneIntoBundles, type ChunkerShot } from '../../src/core/planner/sceneBundleChunker.js';

function shot(n: number, d: number): ChunkerShot {
  return { shotNumber: n, durationSec: d };
}

describe('chunkSceneIntoBundles', () => {
  it('returns a single chunk when the scene is under both caps', () => {
    // 4-shot 20s scene, well under both caps
    const chunks = chunkSceneIntoBundles([shot(1, 5), shot(2, 5), shot(3, 5), shot(4, 5)], 24);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.shots.map(s => s.shotNumber)).toEqual([1, 2, 3, 4]);
    expect(chunks[0]!.segmentFrames).toEqual([121, 120, 120, 120]);
    expect(chunks[0]!.totalFrames).toBe(481);
  });

  it('matches the kareema3 live case (12 shots, 1537 frames → 2 chunks)', () => {
    // shot durations: 4,5,4,5,4,6,8,4,7,5,6,6 (= 64s total at 24fps)
    const shots = [
      shot(1, 4), shot(2, 5), shot(3, 4), shot(4, 5),
      shot(5, 4), shot(6, 6), shot(7, 8), shot(8, 4),
      shot(9, 7), shot(10, 5), shot(11, 6), shot(12, 6),
    ];
    const chunks = chunkSceneIntoBundles(shots, 24);
    expect(chunks).toHaveLength(2);

    // Chunk A: shots 1-8 totaling 961 frames (97+120+96+120+96+144+192+96)
    expect(chunks[0]!.shots.map(s => s.shotNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(chunks[0]!.segmentFrames).toEqual([97, 120, 96, 120, 96, 144, 192, 96]);
    expect(chunks[0]!.totalFrames).toBe(961);

    // Chunk B: shots 9-12, re-aligned (shot 9 is now first, gets +1)
    expect(chunks[1]!.shots.map(s => s.shotNumber)).toEqual([9, 10, 11, 12]);
    expect(chunks[1]!.segmentFrames).toEqual([169, 120, 144, 144]);
    expect(chunks[1]!.totalFrames).toBe(577);
  });

  it('every chunk independently satisfies both caps', () => {
    const shots = Array.from({ length: 50 }, (_, i) => shot(i + 1, 3));
    const chunks = chunkSceneIntoBundles(shots, 24);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.shots.length).toBeLessThanOrEqual(20);
      expect(c.totalFrames).toBeLessThanOrEqual(1000);
    }
  });

  it('every chunk is LTX-aligned: (totalFrames - 1) % 8 === 0', () => {
    const shots = [
      shot(1, 4), shot(2, 5), shot(3, 4), shot(4, 5),
      shot(5, 4), shot(6, 6), shot(7, 8), shot(8, 4),
      shot(9, 7), shot(10, 5), shot(11, 6), shot(12, 6),
    ];
    const chunks = chunkSceneIntoBundles(shots, 24);
    for (const c of chunks) {
      expect((c.totalFrames - 1) % 8).toBe(0);
    }
  });

  it('preserves shot order across chunks (no reordering)', () => {
    const shots = Array.from({ length: 30 }, (_, i) => shot(i + 1, 2));
    const chunks = chunkSceneIntoBundles(shots, 24);
    const flat = chunks.flatMap(c => c.shots.map(s => s.shotNumber));
    expect(flat).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('each chunk gets at least one shot (no empty chunks)', () => {
    const chunks = chunkSceneIntoBundles([shot(1, 4), shot(2, 5)], 24);
    for (const c of chunks) expect(c.shots.length).toBeGreaterThan(0);
  });

  it('handles a single shot that fits cleanly', () => {
    const chunks = chunkSceneIntoBundles([shot(1, 5)], 24);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.shots).toEqual([shot(1, 5)]);
    expect(chunks[0]!.totalFrames).toBe(121);
  });

  it('caps at 20 shots even when frame budget allows more', () => {
    // 25 short shots (1s each = 24f rounded to 24, so chunk would be small)
    const shots = Array.from({ length: 25 }, (_, i) => shot(i + 1, 1));
    const chunks = chunkSceneIntoBundles(shots, 24);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.shots.length).toBeLessThanOrEqual(20);
  });

  it('returns empty array for empty input', () => {
    expect(chunkSceneIntoBundles([], 24)).toEqual([]);
  });

  it('marks each chunk with chunkIndex and total chunk count', () => {
    const shots = [
      shot(1, 4), shot(2, 5), shot(3, 4), shot(4, 5),
      shot(5, 4), shot(6, 6), shot(7, 8), shot(8, 4),
      shot(9, 7), shot(10, 5), shot(11, 6), shot(12, 6),
    ];
    const chunks = chunkSceneIntoBundles(shots, 24);
    expect(chunks[0]!.chunkIndex).toBe(0);
    expect(chunks[0]!.totalChunks).toBe(2);
    expect(chunks[1]!.chunkIndex).toBe(1);
    expect(chunks[1]!.totalChunks).toBe(2);
  });
});
