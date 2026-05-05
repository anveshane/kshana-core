/**
 * Split a scene's shots into the minimum number of contiguous chunks
 * such that every chunk fits both prompt-relay caps:
 *
 *   - shots ≤ 20  (kijai LTXVAddGuideMulti num_guides)
 *   - total frames ≤ 1000 (LTXVEmptyLatentAudio frames_number)
 *
 * Each chunk's segment-frame counts are LTX-aligned independently
 * (8M+1 first segment, 8M rest, total ≡ 1 mod 8). The first segment
 * of CHUNK 1 gets +1 — and so does the first segment of CHUNK 2,
 * because each chunk renders as its own latent video. That means the
 * sum across chunks may exceed the original aligned scene total by
 * (chunkCount - 1) frames; this is correct, not a bug.
 *
 * Greedy: walk shots in order; if adding the next shot would break a
 * cap, close the current chunk and start a new one. Re-align frames
 * each time a chunk's shape changes (so the per-shot frame count for
 * shot K depends on whether K is the first shot in its chunk).
 */

import { alignDurationsToLTX } from '../../services/providers/promptRelayFrameAlignment.js';
import { MAX_SHOTS_PER_BUNDLE, MAX_TOTAL_FRAMES } from './sceneBundleEligibility.js';

export interface ChunkerShot {
  shotNumber: number;
  durationSec: number;
}

export interface SceneBundleChunk {
  shots: ChunkerShot[];
  segmentFrames: number[];
  totalFrames: number;
  chunkIndex: number;
  totalChunks: number;
}

function buildChunk(shots: ChunkerShot[], fps: number): { shots: ChunkerShot[]; segmentFrames: number[]; totalFrames: number } {
  const segmentFrames = alignDurationsToLTX(shots.map(s => s.durationSec), fps);
  const totalFrames = segmentFrames.reduce((a, b) => a + b, 0);
  return { shots: [...shots], segmentFrames, totalFrames };
}

export function chunkSceneIntoBundles(shots: ChunkerShot[], fps: number): SceneBundleChunk[] {
  if (shots.length === 0) return [];

  const accumulator: Array<ReturnType<typeof buildChunk>> = [];
  let current: ChunkerShot[] = [];

  for (const shot of shots) {
    const trial = [...current, shot];
    const trialBuilt = buildChunk(trial, fps);
    const wouldBreakCaps =
      trial.length > MAX_SHOTS_PER_BUNDLE ||
      trialBuilt.totalFrames > MAX_TOTAL_FRAMES;

    if (wouldBreakCaps) {
      // Close current chunk and start a new one with this shot.
      // If `current` is empty here, the single shot already exceeds
      // a cap — push it as a one-shot chunk and let the eligibility
      // gate catch it downstream rather than dropping it silently.
      if (current.length > 0) {
        accumulator.push(buildChunk(current, fps));
        current = [shot];
      } else {
        accumulator.push(buildChunk([shot], fps));
        current = [];
      }
    } else {
      current = trial;
    }
  }

  if (current.length > 0) {
    accumulator.push(buildChunk(current, fps));
  }

  return accumulator.map((c, i) => ({
    shots: c.shots,
    segmentFrames: c.segmentFrames,
    totalFrames: c.totalFrames,
    chunkIndex: i,
    totalChunks: accumulator.length,
  }));
}
