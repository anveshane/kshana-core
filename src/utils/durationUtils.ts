/**
 * Shared duration/segment computation logic.
 *
 * Used by both BackwardPlanner (timeline hints) and GenericAgent
 * (content creator duration injection) to ensure consistent segment
 * breakdown calculations.
 *
 *   totalDuration ──► computeSegmentBreakdown() ──► { segCount, segDuration }
 *                         │
 *                    maxClipDuration (default 10s)
 */

export interface SegmentBreakdown {
  /** Number of segments needed */
  segmentCount: number;
  /** Duration per segment in seconds (rounded to 2 decimals) */
  segmentDuration: number;
}

/**
 * Compute how many segments are needed for a given duration,
 * given a maximum clip duration constraint.
 *
 * Returns null if totalDuration is invalid (0, negative, or falsy).
 */
export function computeSegmentBreakdown(
  totalDuration: number,
  maxClipDuration: number = 10,
): SegmentBreakdown | null {
  if (!totalDuration || totalDuration <= 0) return null;

  const segmentCount = Math.ceil(totalDuration / maxClipDuration);
  const segmentDuration = Math.round((totalDuration / segmentCount) * 100) / 100;

  return { segmentCount, segmentDuration };
}
