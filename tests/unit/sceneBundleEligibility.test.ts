/**
 * TDD tests for `checkSceneBundleEligibility`.
 *
 * Scene-bundle rendering has two hard structural constraints from the
 * underlying LTX 2.3 + kijai-PromptRelay stack:
 *
 *   1. **Shot count ≤ 20.** kijai LTXVAddGuideMulti caps `num_guides`
 *      at 20 (`for num_guides in range(1, 21)` in
 *      ComfyUI-KJNodes/ltxv_nodes.py).
 *
 *   2. **Total pixel frames ≤ 1000.** LTXVEmptyLatentAudio's
 *      `frames_number` input declares `max: 1000` — anything larger
 *      gets rejected by ComfyUI's prompt validator with
 *      `value_bigger_than_max` BEFORE the workflow runs.
 *
 * Both are *structural* — retrying won't help. The eligibility check
 * lets us bail before the upload/submit round-trip and let the
 * per-shot flow run once instead of 12× re-attempting.
 */

import { describe, it, expect } from 'vitest';
import { checkSceneBundleEligibility } from '../../src/core/planner/sceneBundleEligibility.js';

describe('checkSceneBundleEligibility', () => {
  it('accepts a scene under both caps', () => {
    const r = checkSceneBundleEligibility({ shotCount: 4, totalFrames: 481 });
    expect(r.eligible).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('rejects when shot count exceeds 20', () => {
    const r = checkSceneBundleEligibility({ shotCount: 21, totalFrames: 800 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/20|cap|max/i);
    expect(r.reason).toMatch(/shot/i);
  });

  it('accepts exactly 20 shots', () => {
    const r = checkSceneBundleEligibility({ shotCount: 20, totalFrames: 800 });
    expect(r.eligible).toBe(true);
  });

  it('rejects when total frames exceeds 1000 (the LTXVEmptyLatentAudio cap)', () => {
    const r = checkSceneBundleEligibility({ shotCount: 12, totalFrames: 1537 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/1000|frame|audio/i);
  });

  it('accepts exactly 1000 frames', () => {
    const r = checkSceneBundleEligibility({ shotCount: 8, totalFrames: 1000 });
    expect(r.eligible).toBe(true);
  });

  it('reports the first violated constraint when both fail', () => {
    const r = checkSceneBundleEligibility({ shotCount: 25, totalFrames: 5000 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBeDefined();
  });

  it('rejects zero shots (degenerate)', () => {
    const r = checkSceneBundleEligibility({ shotCount: 0, totalFrames: 0 });
    expect(r.eligible).toBe(false);
  });

  it('classifies failures as permanent (i.e. retrying with the same inputs cannot help)', () => {
    // The caller uses `permanent` to decide whether to cache the failure.
    // Both shot-cap and frame-cap are deterministic on the inputs.
    const tooManyShots = checkSceneBundleEligibility({ shotCount: 25, totalFrames: 800 });
    const tooManyFrames = checkSceneBundleEligibility({ shotCount: 12, totalFrames: 1537 });
    expect(tooManyShots.permanent).toBe(true);
    expect(tooManyFrames.permanent).toBe(true);
  });
});
