import { describe, it, expect } from 'vitest';
import { computeSegmentBreakdown } from '../../src/utils/durationUtils.js';

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
