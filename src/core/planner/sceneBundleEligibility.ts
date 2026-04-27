/**
 * Decide whether a scene can be rendered as a single prompt-relay
 * bundle, before we waste an upload/submit round-trip.
 *
 * Two structural caps:
 *
 *   - `MAX_SHOTS_PER_BUNDLE = 20` — kijai LTXVAddGuideMulti
 *     (ComfyUI-KJNodes/ltxv_nodes.py): `for num_guides in range(1, 21)`.
 *
 *   - `MAX_TOTAL_FRAMES = 1000` — LTXVEmptyLatentAudio's
 *     `frames_number` input declares `max: 1000`. Submitting a
 *     workflow with `frames_number > 1000` is rejected by ComfyUI's
 *     prompt validator with `value_bigger_than_max` BEFORE execution.
 *     Observed live on a 12-shot 64s scene that totaled 1537 frames.
 *
 * Failures from these caps are `permanent: true` — retrying with the
 * same inputs cannot succeed. The caller uses that to cache the
 * failure (vs the transient "shot_image not ready yet" case).
 */

export const MAX_SHOTS_PER_BUNDLE = 20;
export const MAX_TOTAL_FRAMES = 1000;

export interface SceneBundleEligibilityInput {
  shotCount: number;
  totalFrames: number;
}

export interface SceneBundleEligibilityResult {
  eligible: boolean;
  reason?: string;
  /** True when the failure is structural (retry can't help). */
  permanent: boolean;
}

export function checkSceneBundleEligibility(
  input: SceneBundleEligibilityInput,
): SceneBundleEligibilityResult {
  if (input.shotCount <= 0) {
    return { eligible: false, reason: 'no shots in scene', permanent: true };
  }
  if (input.shotCount > MAX_SHOTS_PER_BUNDLE) {
    return {
      eligible: false,
      reason: `${input.shotCount} shots exceeds prompt-relay shot cap (max ${MAX_SHOTS_PER_BUNDLE} per bundle, kijai LTXVAddGuideMulti)`,
      permanent: true,
    };
  }
  if (input.totalFrames > MAX_TOTAL_FRAMES) {
    return {
      eligible: false,
      reason: `${input.totalFrames} total frames exceeds prompt-relay audio-latent cap (max ${MAX_TOTAL_FRAMES}, LTXVEmptyLatentAudio.frames_number)`,
      permanent: true,
    };
  }
  return { eligible: true, permanent: false };
}
