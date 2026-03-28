/**
 * FFmpeg-based Video Assembly
 *
 * Resolves timeline segments to file paths and runs real FFmpeg concat
 * to produce the final assembled video. Handles style-aware validation
 * (anime/cinematic require video-only; documentary allows image→static-clip).
 */

import { existsSync, readFileSync, statSync, mkdirSync } from 'fs';
import { join, extname, basename } from 'path';
import { spawn, execSync } from 'child_process';
import type { Timeline } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedSegment {
  segmentId: string;
  label: string;
  startTime: number;
  endTime: number;
  duration: number;
  filePath: string;
  mediaType: 'video' | 'image';
  /** Transition from the previous segment (default: 'cut') */
  transition?: string;
  /** Transition duration in seconds (default: 0.5) */
  transitionDuration?: number;
}

export interface ResolutionResult {
  resolved: ResolvedSegment[];
  errors: string[];
}

export interface AssemblyConfig {
  width?: number;
  height?: number;
  preset?: string;
  timeoutMs?: number;
}

export interface AssemblyResult {
  success: boolean;
  outputPath: string;
  duration: number;
  fileSize: number;
}

interface ManifestAsset {
  id: string;
  type: string;
  path: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// File-path resolution
// ---------------------------------------------------------------------------

/**
 * Load the asset manifest from a project directory.
 */
function loadManifest(projectDir: string): ManifestAsset[] {
  const manifestPath = join(projectDir, 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) return [];
  try {
    const data = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    return data.assets ?? [];
  } catch {
    return [];
  }
}

/**
 * Detect whether a file is video or image by its extension.
 */
function detectMediaType(filePath: string): 'video' | 'image' | null {
  const ext = extname(filePath).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return null;
}

/**
 * Extract scene/shot numbers from a segment ID.
 * Handles patterns like "segment_1", "segment_5_shot_2", etc.
 */
function parseSegmentId(segmentId: string): { segmentNum?: number; shotNum?: number } {
  // segment_N_shot_M
  const shotMatch = segmentId.match(/segment_(\d+)_shot_(\d+)/);
  if (shotMatch) {
    return { segmentNum: parseInt(shotMatch[1]!, 10), shotNum: parseInt(shotMatch[2]!, 10) };
  }
  // segment_N
  const segMatch = segmentId.match(/segment_(\d+)/);
  if (segMatch) {
    return { segmentNum: parseInt(segMatch[1]!, 10) };
  }
  return {};
}

/**
 * Resolve each timeline segment to an absolute file path.
 *
 * 3-tier fallback:
 *   1. Direct layer.filePath → join with projectDir, verify exists
 *   2. layer.artifactId → look up in assets/manifest.json
 *   3. Neither present → search manifest for videos matching segment metadata
 */
export function resolveSegmentFilePaths(
  timeline: Timeline,
  projectDir: string
): ResolutionResult {
  const manifest = loadManifest(projectDir);
  const resolved: ResolvedSegment[] = [];
  const errors: string[] = [];

  for (const segment of timeline.segments) {
    if (segment.fillStatus !== 'filled') {
      errors.push(`Segment "${segment.id}" (${segment.label}) is not filled (status: ${segment.fillStatus})`);
      continue;
    }

    const visualLayer = segment.layers.find(
      l => l.type === 'visual' || l.type === 'narration_video'
    );

    let absolutePath: string | null = null;
    let mediaType: 'video' | 'image' | null = null;

    // Tier 1: Direct filePath on the layer
    if (visualLayer?.filePath) {
      const candidate = visualLayer.filePath.startsWith('/')
        ? visualLayer.filePath
        : join(projectDir, visualLayer.filePath);
      if (existsSync(candidate)) {
        absolutePath = candidate;
        mediaType = detectMediaType(candidate);
      }
    }

    // Tier 2: artifactId → manifest lookup
    if (!absolutePath && visualLayer?.artifactId) {
      const asset = manifest.find(a => a.id === visualLayer.artifactId);
      if (asset) {
        const candidate = asset.path.startsWith('/')
          ? asset.path
          : join(projectDir, asset.path);
        if (existsSync(candidate)) {
          absolutePath = candidate;
          mediaType = detectMediaType(candidate);
        }
      }
    }

    // Tier 3: Search manifest by segment metadata (scene/shot number)
    if (!absolutePath) {
      const { segmentNum, shotNum } = parseSegmentId(segment.id);
      if (segmentNum !== undefined) {
        // Try to find a scene_video asset matching this segment
        const candidates = manifest.filter(a => {
          if (a.type !== 'scene_video') return false;
          const fileName = basename(a.path).toLowerCase();
          // Match patterns like "scene_5_shot_2", "scene5", "s5_shot2", etc.
          if (shotNum !== undefined) {
            return (
              fileName.includes(`scene_${segmentNum}_shot_${shotNum}`) ||
              fileName.includes(`scene${segmentNum}_shot${shotNum}`) ||
              fileName.includes(`s${segmentNum}_shot_${shotNum}`) ||
              fileName.includes(`s${segmentNum}_shot${shotNum}`)
            );
          }
          return (
            fileName.includes(`scene_${segmentNum}`) ||
            fileName.includes(`scene${segmentNum}`)
          );
        });

        if (candidates.length > 0) {
          // Prefer the most recently created asset
          candidates.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
          const best = candidates[0]!;
          const candidate = best.path.startsWith('/')
            ? best.path
            : join(projectDir, best.path);
          if (existsSync(candidate)) {
            absolutePath = candidate;
            mediaType = detectMediaType(candidate);
          }
        }
      }
    }

    if (!absolutePath) {
      errors.push(
        `Segment "${segment.id}" (${segment.label}): could not resolve to a file. ` +
        `Layer has filePath=${visualLayer?.filePath ?? 'none'}, artifactId=${visualLayer?.artifactId ?? 'none'}`
      );
      continue;
    }

    if (!mediaType) {
      errors.push(
        `Segment "${segment.id}" (${segment.label}): unknown media type for ${absolutePath}`
      );
      continue;
    }

    resolved.push({
      segmentId: segment.id,
      label: segment.label,
      startTime: segment.startTime,
      endTime: segment.endTime,
      duration: segment.duration,
      filePath: absolutePath,
      mediaType,
      transition: segment.transition?.type,
      transitionDuration: segment.transition ? segment.transition.durationMs / 1000 : undefined,
    });
  }

  return { resolved, errors };
}

// ---------------------------------------------------------------------------
// Image → static video clip conversion (documentary style only)
// ---------------------------------------------------------------------------

/**
 * Convert a still image to a static video clip with silent audio.
 * Used for documentary-style projects where image segments are allowed.
 */
export async function convertImageToVideo(
  imagePath: string,
  duration: number,
  outputPath: string
): Promise<void> {
  // Ensure output directory exists
  const outputDir = join(outputPath, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const args = [
    '-y',
    '-loop', '1',
    '-i', imagePath,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-c:v', 'libx264',
    '-t', String(duration),
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-c:a', 'aac',
    '-shortest',
    '-preset', 'fast',
    outputPath,
  ];

  await runFFmpeg(args, 60_000);
}

// ---------------------------------------------------------------------------
// FFmpeg concat assembly
// ---------------------------------------------------------------------------

/**
 * Assemble resolved segments into a single video using FFmpeg concat filter.
 */
export async function assembleVideos(
  segments: ResolvedSegment[],
  outputPath: string,
  config: AssemblyConfig = {}
): Promise<AssemblyResult> {
  const {
    width = 1280,
    height = 720,
    preset = 'fast',
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = config;

  if (segments.length === 0) {
    throw new Error('No segments to assemble');
  }

  // Ensure output directory exists
  const outputDir = join(outputPath, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Probe each input for audio streams
  const hasAudio: boolean[] = segments.map(seg => {
    try {
      const probe = execSync(
        `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${seg.filePath}"`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      return probe.trim().includes('audio');
    } catch {
      return false;
    }
  });

  // Build FFmpeg command args
  const inputArgs: string[] = [];
  const filterParts: string[] = [];
  let silenceInputIdx = -1;

  // Add a silence source if any input lacks audio
  if (hasAudio.some(h => !h)) {
    silenceInputIdx = segments.length;
    inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    inputArgs.push('-i', seg.filePath);
  }

  // Remap input indices: silence source is at silenceInputIdx, video files are at 0..N-1
  // But we pushed silence BEFORE the video files, so we need to adjust.
  // Actually, let's reorder: push video files first, then silence.
  // Rebuild inputArgs in the right order.
  inputArgs.length = 0;
  for (let i = 0; i < segments.length; i++) {
    inputArgs.push('-i', segments[i]!.filePath);
  }
  if (silenceInputIdx >= 0) {
    inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }

  for (let i = 0; i < segments.length; i++) {
    // Scale each input to target resolution and normalize timestamps
    filterParts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setpts=PTS-STARTPTS[v${i}]`
    );
    // Use actual audio if present, otherwise use the silence source
    if (hasAudio[i]) {
      filterParts.push(
        `[${i}:a]asetpts=PTS-STARTPTS[a${i}]`
      );
    } else {
      filterParts.push(
        `[${silenceInputIdx}:a]atrim=duration=${segments[i]!.duration},asetpts=PTS-STARTPTS[a${i}]`
      );
    }
  }

  // Check if any segment has a non-cut transition
  const hasTransitions = segments.some((s, i) => i > 0 && s.transition && s.transition !== 'cut');

  if (hasTransitions) {
    // Build xfade chain for video, acrossfade chain for audio.
    // xfade works pairwise: [v0][v1]xfade=...[vx0]; [vx0][v2]xfade=...[vx1]; ...
    //
    // CRITICAL: offset = time in the ACCUMULATED output where transition begins.
    // After each xfade, accumulated duration = prev_accumulated + next_duration - transition_overlap.
    let prevVideoLabel = 'v0';
    let prevAudioLabel = 'a0';
    let accumulatedDuration = segments[0]!.duration;

    // Map our transition names to FFmpeg xfade transition names
    const xfadeMap: Record<string, string> = {
      crossfade: 'fade',
      fade: 'fadeblack',
      dissolve: 'fade',
      dip_to_black: 'fadeblack',
      flash_to_white: 'fadewhite',
      wipe_left: 'wipeleft',
      wipe_right: 'wiperight',
      wipe_up: 'wipeup',
      wipe_down: 'wipedown',
      circle_open: 'circleopen',
      circle_close: 'circleclose',
      radial: 'radial',
      slide_left: 'slideleft',
      slide_right: 'slideright',
    };

    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i]!;
      const transition = seg.transition ?? 'cut';
      const isFlash = transition === 'flash_to_white';
      const tDur = transition === 'cut' ? 0.01 : isFlash ? Math.min(seg.transitionDuration ?? 0.2, 0.3) : (seg.transitionDuration ?? 0.5);

      // Offset = end of accumulated output minus transition overlap
      const offset = Math.max(0, accumulatedDuration - tDur);

      const outVideoLabel = i < segments.length - 1 ? `vx${i}` : 'outv';
      const outAudioLabel = i < segments.length - 1 ? `ax${i}` : 'outa';

      const ffmpegTransition = transition === 'cut' ? 'fade' : (xfadeMap[transition] ?? 'fade');
      filterParts.push(
        `[${prevVideoLabel}][v${i}]xfade=transition=${ffmpegTransition}:duration=${tDur}:offset=${offset}[${outVideoLabel}]`
      );

      // Audio crossfade
      filterParts.push(
        `[${prevAudioLabel}][a${i}]acrossfade=d=${tDur}:c1=tri:c2=tri[${outAudioLabel}]`
      );

      // Update accumulated duration: previous output + new segment - overlap
      accumulatedDuration = accumulatedDuration + seg.duration - tDur;

      prevVideoLabel = outVideoLabel;
      prevAudioLabel = outAudioLabel;
    }
  } else {
    // No transitions — simple concat (original behavior)
    const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join('');
    filterParts.push(
      `${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`
    );
  }

  const filterComplex = filterParts.join('; ');

  const args = [
    '-y',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', '[outa]',
    '-c:v', 'libx264',
    '-preset', preset,
    '-c:a', 'aac',
    outputPath,
  ];

  await runFFmpeg(args, timeoutMs);

  // Get output file stats
  const stats = statSync(outputPath);
  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);

  return {
    success: true,
    outputPath,
    duration: totalDuration,
    fileSize: stats.size,
  };
}

// ---------------------------------------------------------------------------
// FFmpeg runner
// ---------------------------------------------------------------------------

/**
 * Spawn FFmpeg as a child process, capture stderr, return on completion.
 * Rejects on non-zero exit code or timeout.
 */
export function runFFmpeg(
  args: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    let stdout = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`FFmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stderr); // FFmpeg puts progress info on stderr
      } else {
        reject(new Error(`FFmpeg exited with code ${code}:\n${stderr}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}
