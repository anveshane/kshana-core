/**
 * Convert per-shot durations (in seconds) into LTX-2.3-aligned
 * per-segment frame counts.
 *
 * LTX latent space requires `(total_pixel_frames - 1) % 8 === 0`.
 * We achieve that by:
 *
 *   - rounding each shot's `duration * fps` to the nearest multiple
 *     of 8, with a floor of 8 so a sub-second shot still gets a
 *     usable segment
 *   - adding +1 to the first segment
 *
 * After this transform, sum(out) ≡ 1 (mod 8).
 *
 * Used by both the probe driver and the executor's scene-bundle
 * renderer to derive `segment_lengths` and `total_frames` for the
 * PromptRelayEncode + EmptyLTXVLatentVideo nodes.
 */

export function alignDurationsToLTX(durationsSec: number[], fps: number): number[] {
  if (durationsSec.length === 0) {
    throw new Error('alignDurationsToLTX: durations array must not be empty');
  }
  const rounded = durationsSec.map(d => {
    const raw = d * fps;
    const r = Math.round(raw / 8) * 8;
    return Math.max(8, r);
  });
  rounded[0] = rounded[0]! + 1;
  return rounded;
}
