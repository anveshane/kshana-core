import { describe, it, expect } from 'vitest';
import { computeSegmentBreakdown, computeDurationBudget } from '../../src/utils/durationUtils.js';

describe('computeSegmentBreakdown', () => {
  // ── Valid durations ────────────────────────────────────────────────────

  it('computes correct breakdown for 60s video (default maxClip=10)', () => {
    const result = computeSegmentBreakdown(60);
    expect(result).not.toBeNull();
    expect(result!.segmentCount).toBe(6);
    expect(result!.segmentDuration).toBe(10);
  });

  it('computes correct breakdown for 30s video', () => {
    const result = computeSegmentBreakdown(30);
    expect(result).not.toBeNull();
    expect(result!.segmentCount).toBe(3);
    expect(result!.segmentDuration).toBe(10);
  });

  it('computes correct breakdown for 45s video (non-even division)', () => {
    const result = computeSegmentBreakdown(45);
    expect(result).not.toBeNull();
    expect(result!.segmentCount).toBe(5); // ceil(45/10) = 5
    expect(result!.segmentDuration).toBe(9); // 45/5 = 9
  });

  it('computes correct breakdown for 180s video', () => {
    const result = computeSegmentBreakdown(180);
    expect(result).not.toBeNull();
    expect(result!.segmentCount).toBe(18);
    expect(result!.segmentDuration).toBe(10);
  });

  it('handles custom maxClipDuration', () => {
    const result = computeSegmentBreakdown(60, 15);
    expect(result).not.toBeNull();
    expect(result!.segmentCount).toBe(4); // ceil(60/15) = 4
    expect(result!.segmentDuration).toBe(15);
  });

  it('rounds segmentDuration to 2 decimal places', () => {
    // 100s / ceil(100/10)=10 segments = 10.00 — even
    // 7s / ceil(7/10)=1 segment = 7.00
    const result = computeSegmentBreakdown(7);
    expect(result).not.toBeNull();
    expect(result!.segmentCount).toBe(1);
    expect(result!.segmentDuration).toBe(7);

    // 13s / ceil(13/10)=2 segments = 6.5
    const result2 = computeSegmentBreakdown(13);
    expect(result2).not.toBeNull();
    expect(result2!.segmentCount).toBe(2);
    expect(result2!.segmentDuration).toBe(6.5);
  });

  // ── Invalid durations (NaN guard) ─────────────────────────────────────

  it('returns null for zero duration', () => {
    expect(computeSegmentBreakdown(0)).toBeNull();
  });

  it('returns null for negative duration', () => {
    expect(computeSegmentBreakdown(-10)).toBeNull();
  });

  it('returns null for NaN duration', () => {
    expect(computeSegmentBreakdown(NaN)).toBeNull();
  });

  it('returns null for undefined-like falsy values', () => {
    // TypeScript prevents undefined, but at runtime it could happen
    expect(computeSegmentBreakdown(0)).toBeNull();
  });
});

// =============================================================================
// computeDurationBudget
// =============================================================================

describe('computeDurationBudget', () => {
  // ── Duration tiers ──────────────────────────────────────────────────────

  it('computes correct budget for 60s video', () => {
    const result = computeDurationBudget(60);
    expect(result).not.toBeNull();
    expect(result!.totalDuration).toBe(60);
    expect(result!.maxClipDuration).toBe(10);
    expect(result!.minTotalShots).toBe(6);
    expect(result!.suggestedSceneRange).toEqual({ min: 3, max: 5 });
    expect(result!.avgShotDuration).toBe(10);
    expect(result!.guidance).toContain('at least 6 total clips');
    expect(result!.guidance).toContain('3-5 scenes');
  });

  it('uses ≤30s tier for short videos', () => {
    const result = computeDurationBudget(20);
    expect(result).not.toBeNull();
    expect(result!.suggestedSceneRange).toEqual({ min: 2, max: 3 });
    expect(result!.minTotalShots).toBe(2); // ceil(20/10)
  });

  it('uses 31-60s tier', () => {
    const result = computeDurationBudget(45);
    expect(result).not.toBeNull();
    expect(result!.suggestedSceneRange).toEqual({ min: 3, max: 5 });
    expect(result!.minTotalShots).toBe(5); // ceil(45/10)
  });

  it('uses 61-120s tier', () => {
    const result = computeDurationBudget(90);
    expect(result).not.toBeNull();
    expect(result!.suggestedSceneRange).toEqual({ min: 5, max: 8 });
    expect(result!.minTotalShots).toBe(9); // ceil(90/10)
  });

  it('uses 121-180s tier', () => {
    const result = computeDurationBudget(150);
    expect(result).not.toBeNull();
    expect(result!.suggestedSceneRange).toEqual({ min: 8, max: 12 });
    expect(result!.minTotalShots).toBe(15); // ceil(150/10)
  });

  // ── Boundary conditions ─────────────────────────────────────────────────

  it('30s falls in ≤30s tier', () => {
    const result = computeDurationBudget(30);
    expect(result!.suggestedSceneRange).toEqual({ min: 2, max: 3 });
  });

  it('31s falls in 31-60s tier', () => {
    const result = computeDurationBudget(31);
    expect(result!.suggestedSceneRange).toEqual({ min: 3, max: 5 });
  });

  it('60s falls in 31-60s tier', () => {
    const result = computeDurationBudget(60);
    expect(result!.suggestedSceneRange).toEqual({ min: 3, max: 5 });
  });

  it('61s falls in 61-120s tier', () => {
    const result = computeDurationBudget(61);
    expect(result!.suggestedSceneRange).toEqual({ min: 5, max: 8 });
  });

  it('120s falls in 61-120s tier', () => {
    const result = computeDurationBudget(120);
    expect(result!.suggestedSceneRange).toEqual({ min: 5, max: 8 });
  });

  it('121s falls in 121-180s tier', () => {
    const result = computeDurationBudget(121);
    expect(result!.suggestedSceneRange).toEqual({ min: 8, max: 12 });
  });

  // ── Custom maxClipDuration ──────────────────────────────────────────────

  it('handles custom maxClipDuration', () => {
    const result = computeDurationBudget(60, 15);
    expect(result).not.toBeNull();
    expect(result!.maxClipDuration).toBe(15);
    expect(result!.minTotalShots).toBe(4); // ceil(60/15)
    expect(result!.avgShotDuration).toBe(15);
  });

  // ── Invalid inputs ──────────────────────────────────────────────────────

  it('returns null for zero duration', () => {
    expect(computeDurationBudget(0)).toBeNull();
  });

  it('returns null for negative duration', () => {
    expect(computeDurationBudget(-10)).toBeNull();
  });

  it('returns null for NaN duration', () => {
    expect(computeDurationBudget(NaN)).toBeNull();
  });
});
