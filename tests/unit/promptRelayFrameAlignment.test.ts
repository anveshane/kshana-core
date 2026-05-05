/**
 * TDD tests for LTX-aligned segment-frame computation.
 *
 * LTX 2.3 latent space requires (total_pixel_frames - 1) % 8 === 0,
 * which we satisfy by:
 *   - rounding each shot's `duration * fps` to the nearest multiple
 *     of 8 (floor at 8 frames per segment)
 *   - adding +1 to segment 1
 *
 * Used by:
 *   - scripts/probe-ltx-promptrelay.ts (probe driver)
 *   - the executor's scene-bundle renderer (slice 5c)
 */

import { describe, it, expect } from 'vitest';
import { alignDurationsToLTX } from '../../src/services/providers/promptRelayFrameAlignment.js';

describe('alignDurationsToLTX', () => {
  it('matches the noir scene 1 hand-computed plan (4,5,4,5,4,4,3,3,3 @ 24fps)', () => {
    const out = alignDurationsToLTX([4, 5, 4, 5, 4, 4, 3, 3, 3], 24);
    expect(out).toEqual([97, 120, 96, 120, 96, 96, 72, 72, 72]);
    // (sum - 1) % 8 === 0 — LTX alignment invariant
    expect((out.reduce((a, b) => a + b, 0) - 1) % 8).toBe(0);
  });

  it('matches the woman_medieval 4-shot fixed-default plan when each is 5s', () => {
    // 5s × 24fps = 120, → 121 + 120×3 = 481
    const out = alignDurationsToLTX([5, 5, 5, 5], 24);
    expect(out).toEqual([121, 120, 120, 120]);
  });

  it('rounds to nearest multiple of 8', () => {
    // 2s × 24fps = 48 (exact multiple of 8)
    // 2.1s × 24fps = 50.4 → 48 (closer to 48 than 56)
    // 2.5s × 24fps = 60 → 64 (Math.round(7.5)=8 in JS rounds-half-up)
    const out = alignDurationsToLTX([2, 2.1, 2.5], 24);
    expect(out[0]).toBe(48 + 1);  // first gets +1
    expect(out[1]).toBe(48);
    expect(out[2]).toBe(64);
  });

  it('floors each segment at 8 frames so a near-zero duration still survives', () => {
    // 0.1s × 24fps = 2.4 → would round to 0; clamp to 8
    const out = alignDurationsToLTX([0.1, 0.1], 24);
    expect(out[0]).toBe(9);    // 8 + 1
    expect(out[1]).toBe(8);
  });

  it('always satisfies (total - 1) % 8 === 0', () => {
    // Property check across a few mixes
    const cases = [
      [3, 3, 3],
      [4, 5, 4, 5],
      [10, 1, 7, 2, 6],
      [0.5, 0.5, 0.5],
    ];
    for (const c of cases) {
      const aligned = alignDurationsToLTX(c, 24);
      expect((aligned.reduce((a, b) => a + b, 0) - 1) % 8).toBe(0);
    }
  });

  it('handles different fps values', () => {
    // 30fps: 4s = 120 frames (already a multiple of 8)
    // → 121, 120
    const out = alignDurationsToLTX([4, 4], 30);
    expect(out).toEqual([121, 120]);
  });

  it('throws on empty input', () => {
    expect(() => alignDurationsToLTX([], 24)).toThrow();
  });
});
