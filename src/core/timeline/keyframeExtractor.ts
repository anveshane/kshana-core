/**
 * Video keyframe extractor.
 *
 * Shells out to ffmpeg to pull N evenly-spaced frames from a video file.
 * Used by the fidelity audit (`scripts/audit-fidelity.ts`) to feed the
 * VLM judge: each shot_video gets sampled into a few PNG keyframes that
 * the judge scores individually, and the audit aggregates motion-related
 * properties across them.
 *
 * Why "evenly spaced" rather than ffmpeg's keyframe-detection: motion
 * directives describe an arc (start state → action → end state); we want
 * frames that capture the arc, not whatever the encoder happened to mark
 * as I-frames. Index 0 is the first frame; the last index is N-1.
 */

import { existsSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';

/**
 * Run ffprobe to count the frames in a video. Returns the total frame
 * count, or throws if ffprobe fails or the file is missing.
 */
async function countFrames(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-count_frames',
      '-show_entries', 'stream=nb_read_frames',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]);
    let out = '';
    let err = '';
    proc.stdout.on('data', d => { out += String(d); });
    proc.stderr.on('data', d => { err += String(d); });
    proc.on('error', e => reject(new Error(`ffprobe spawn failed: ${e.message}`)));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe exit ${code}: ${err.trim()}`));
      const n = parseInt(out.trim(), 10);
      if (isNaN(n) || n <= 0) return reject(new Error(`ffprobe returned invalid frame count: ${out.trim()}`));
      resolve(n);
    });
  });
}

/**
 * Extract a single frame at the given zero-based index from the video.
 * Writes to `outPath`. Throws on ffmpeg failure.
 */
async function extractFrameAtIndex(videoPath: string, frameIndex: number, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', videoPath,
      '-vf', `select='eq(n,${frameIndex})'`,
      '-vsync', '0',
      '-frames:v', '1',
      outPath,
    ]);
    let err = '';
    proc.stderr.on('data', d => { err += String(d); });
    proc.on('error', e => reject(new Error(`ffmpeg spawn failed: ${e.message}`)));
    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg exit ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
      }
      if (!existsSync(outPath)) {
        return reject(new Error(`ffmpeg succeeded but wrote no file at ${outPath}`));
      }
      resolve();
    });
  });
}

/**
 * Compute N evenly-spaced frame indices over a [0, total-1] range.
 * - For N=1: returns [0].
 * - For N=2: returns [0, total-1] (first and last).
 * - For N>2: spreads across the full range, inclusive of endpoints.
 *
 * If N >= total, returns all integers [0, total-1] — useful for very
 * short clips where you'd rather sample every frame than overshoot.
 */
function computeFrameIndices(total: number, count: number): number[] {
  if (count <= 0) return [];
  if (count >= total) return Array.from({ length: total }, (_, i) => i);
  if (count === 1) return [0];
  if (count === 2) return [0, total - 1];
  const indices: number[] = [];
  // Even spacing including endpoints: i = round((k / (count-1)) * (total-1))
  const seen = new Set<number>();
  for (let k = 0; k < count; k++) {
    const idx = Math.round((k / (count - 1)) * (total - 1));
    if (!seen.has(idx)) {
      indices.push(idx);
      seen.add(idx);
    }
  }
  return indices;
}

/**
 * Extract `count` evenly-spaced keyframes from the video at `videoPath`,
 * write them to `outDir` as `frame-NN.png`, and return their absolute
 * paths in temporal order.
 *
 * - Throws if `videoPath` doesn't exist.
 * - Throws if `count` is zero or negative.
 * - When `count` exceeds the video's frame count, returns whatever
 *   exists (no padding, no crash).
 * - Creates `outDir` recursively if it doesn't exist.
 */
export async function extractKeyframes(
  videoPath: string,
  count: number,
  outDir: string,
): Promise<string[]> {
  if (count <= 0) {
    throw new Error(`extractKeyframes: count must be positive, got ${count}`);
  }
  if (!existsSync(videoPath)) {
    throw new Error(`extractKeyframes: video file does not exist: ${videoPath}`);
  }

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const total = await countFrames(videoPath);
  const indices = computeFrameIndices(total, count);

  const paths: string[] = [];
  for (let i = 0; i < indices.length; i++) {
    const out = join(outDir, `frame-${String(i).padStart(2, '0')}.png`);
    await extractFrameAtIndex(videoPath, indices[i]!, out);
    paths.push(out);
  }
  return paths;
}
