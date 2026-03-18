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

// =============================================================================
// Narrative-Driven Duration Budget
// =============================================================================

export interface DurationBudget {
  totalDuration: number;
  maxClipDuration: number;
  /** Physics minimum: ceil(totalDuration / maxClipDuration) */
  minTotalShots: number;
  /** Narrative-driven range, not a fixed count */
  suggestedSceneRange: { min: number; max: number };
  /** Average target shot duration */
  avgShotDuration: number;
  /** Human-readable guidance for the agent */
  guidance: string;
}

/**
 * Compute a narrative-driven duration budget that provides soft guidance
 * instead of rigid segment counts.
 *
 * Scene ranges by duration tier:
 * - ≤30s  → 2-3 scenes
 * - 31-60s → 3-5 scenes
 * - 61-120s → 5-8 scenes
 * - 121-180s → 8-12 scenes
 *
 * Returns null if totalDuration is invalid (0, negative, or falsy).
 */
export function computeDurationBudget(
  totalDuration: number,
  maxClipDuration: number = 10,
): DurationBudget | null {
  if (!totalDuration || totalDuration <= 0) return null;

  const minTotalShots = Math.ceil(totalDuration / maxClipDuration);
  const avgShotDuration = Math.round((totalDuration / minTotalShots) * 100) / 100;

  let suggestedSceneRange: { min: number; max: number };
  if (totalDuration <= 30) {
    suggestedSceneRange = { min: 2, max: 3 };
  } else if (totalDuration <= 60) {
    suggestedSceneRange = { min: 3, max: 5 };
  } else if (totalDuration <= 120) {
    suggestedSceneRange = { min: 5, max: 8 };
  } else {
    suggestedSceneRange = { min: 8, max: 12 };
  }

  const guidance =
    `Target duration: ${totalDuration}s. ` +
    `You need at least ${minTotalShots} total clips across all scenes. ` +
    `Aim for ${suggestedSceneRange.min}-${suggestedSceneRange.max} scenes — let the story determine the exact count. ` +
    `Each scene can have 1-3 shots depending on complexity. ` +
    `IMPORTANT: Every shot MUST be at least 4 seconds (video model minimum for reliable output). ` +
    `Prefer 5-8 second shots for best quality. ` +
    `After planning scenes AND their shot breakdowns, create the timeline skeleton.`;

  return {
    totalDuration,
    maxClipDuration,
    minTotalShots,
    suggestedSceneRange,
    avgShotDuration,
    guidance,
  };
}
