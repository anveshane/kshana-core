/**
 * FFmpegService - Video processing service using FFmpeg.
 * Handles metadata extraction, thumbnail generation, frame extraction, and video composition.
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import type { VideoMetadata, AudioTrackInfo, TimeRange, Position } from '../../tasks/video-edit/workflow/types.js';

// Import bundled ffmpeg/ffprobe binaries
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const execAsync = promisify(exec);

// Get paths to bundled binaries
const BUNDLED_FFMPEG_PATH = ffmpegStatic ?? 'ffmpeg';
const BUNDLED_FFPROBE_PATH = ffprobeStatic.path ?? 'ffprobe';

/**
 * Configuration for FFmpeg service.
 */
export interface FFmpegConfig {
  /** Path to ffmpeg binary (default: 'ffmpeg') */
  ffmpegPath?: string;
  /** Path to ffprobe binary (default: 'ffprobe') */
  ffprobePath?: string;
  /** Output directory for generated files */
  outputDir?: string;
  /** Default timeout in milliseconds */
  timeout?: number;
}

/**
 * Thumbnail generation options.
 */
export interface ThumbnailOptions {
  /** Interval between thumbnails in seconds */
  intervalSeconds: number;
  /** Thumbnail width (height auto-calculated) */
  width?: number;
  /** Output format (default: jpg) */
  format?: 'jpg' | 'png';
  /** Quality (1-31 for jpg, lower is better) */
  quality?: number;
}

/**
 * PIP (Picture-in-Picture) composition options.
 */
export interface PIPOptions {
  /** Position of PIP overlay (normalized 0-1) */
  position: Position;
  /** Scale of PIP (0-1, relative to main video) */
  scale: number;
  /** Opacity of PIP (0-1) */
  opacity?: number;
  /** Time range for PIP */
  timeRange: TimeRange;
}

/**
 * Split screen composition options.
 */
export interface SplitScreenOptions {
  /** Layout type */
  layout: 'horizontal' | 'vertical' | 'grid';
  /** Gap between videos in pixels */
  gap?: number;
}

/**
 * Render progress callback.
 */
export type ProgressCallback = (percent: number, message: string) => void;

/**
 * FFmpeg service for video processing.
 */
export class FFmpegService {
  private ffmpegPath: string;
  private ffprobePath: string;
  private outputDir: string;
  private timeout: number;

  constructor(config: FFmpegConfig = {}) {
    this.ffmpegPath = config.ffmpegPath ?? BUNDLED_FFMPEG_PATH;
    this.ffprobePath = config.ffprobePath ?? BUNDLED_FFPROBE_PATH;
    this.outputDir = config.outputDir ?? process.cwd();
    this.timeout = config.timeout ?? 300000; // 5 minutes default
  }

  /**
   * Check if FFmpeg is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync(`${this.ffmpegPath} -version`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extract video metadata using ffprobe.
   */
  async extractMetadata(videoPath: string): Promise<VideoMetadata> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    const cmd = [
      this.ffprobePath,
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      `"${videoPath}"`,
    ].join(' ');

    try {
      const { stdout } = await execAsync(cmd, { timeout: this.timeout });
      const data = JSON.parse(stdout);

      // Find video stream
      const videoStream = data.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
      if (!videoStream) {
        throw new Error('No video stream found in file');
      }

      // Find audio streams
      const audioStreams = data.streams?.filter((s: { codec_type: string }) => s.codec_type === 'audio') ?? [];

      // Parse duration (in seconds, convert to ms)
      const durationSec = parseFloat(data.format?.duration ?? videoStream.duration ?? '0');
      const durationMs = Math.round(durationSec * 1000);

      // Parse frame rate
      const fpsStr = videoStream.r_frame_rate ?? videoStream.avg_frame_rate ?? '30/1';
      const [fpsNum, fpsDen] = fpsStr.split('/').map(Number);
      const fps = fpsDen ? Math.round(fpsNum / fpsDen) : fpsNum;

      // Parse bitrate
      const bitrate = Math.round((parseInt(data.format?.bit_rate ?? '0', 10) || 0) / 1000);

      // Parse audio tracks
      const audioTracks: AudioTrackInfo[] = audioStreams.map((stream: {
        index: number;
        codec_name: string;
        channels: number;
        sample_rate: string;
        tags?: { language?: string };
      }, idx: number) => ({
        index: idx,
        codec: stream.codec_name ?? 'unknown',
        channels: stream.channels ?? 2,
        sampleRate: parseInt(stream.sample_rate ?? '48000', 10),
        language: stream.tags?.language,
      }));

      // Get file size
      const stats = fs.statSync(videoPath);

      return {
        durationMs,
        width: videoStream.width ?? 1920,
        height: videoStream.height ?? 1080,
        fps,
        codec: videoStream.codec_name ?? 'unknown',
        bitrate,
        fileSize: stats.size,
        format: data.format?.format_name?.split(',')[0] ?? 'unknown',
        audioTracks,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('JSON')) {
        throw new Error(`Failed to parse ffprobe output: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Generate thumbnail images at regular intervals.
   */
  async generateThumbnails(
    videoPath: string,
    outputDir: string,
    options: ThumbnailOptions
  ): Promise<string[]> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const {
      intervalSeconds,
      width = 320,
      format = 'jpg',
      quality = 5,
    } = options;

    const outputPattern = path.join(outputDir, `thumb_%04d.${format}`);

    const cmd = [
      this.ffmpegPath,
      '-y', // Overwrite output
      '-i', `"${videoPath}"`,
      '-vf', `fps=1/${intervalSeconds},scale=${width}:-1`,
      '-q:v', quality.toString(),
      `"${outputPattern}"`,
    ].join(' ');

    try {
      await execAsync(cmd, { timeout: this.timeout });

      // Find generated thumbnails
      const files = fs.readdirSync(outputDir)
        .filter(f => f.startsWith('thumb_') && f.endsWith(`.${format}`))
        .sort()
        .map(f => path.join(outputDir, f));

      return files;
    } catch (error) {
      throw new Error(`Failed to generate thumbnails: ${error}`);
    }
  }

  /**
   * Extract a single frame at a specific timestamp.
   */
  async extractFrame(
    videoPath: string,
    timestampMs: number,
    outputPath: string
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Convert ms to seconds
    const timestampSec = timestampMs / 1000;

    const cmd = [
      this.ffmpegPath,
      '-y',
      '-ss', timestampSec.toFixed(3),
      '-i', `"${videoPath}"`,
      '-frames:v', '1',
      '-q:v', '2',
      `"${outputPath}"`,
    ].join(' ');

    try {
      await execAsync(cmd, { timeout: 30000 }); // 30 second timeout for single frame
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to extract frame: ${error}`);
    }
  }

  /**
   * Trim a video clip to a specific time range.
   */
  async trimClip(
    videoPath: string,
    timeRange: TimeRange,
    outputPath: string
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const startSec = timeRange.startMs / 1000;
    const durationSec = (timeRange.endMs - timeRange.startMs) / 1000;

    const cmd = [
      this.ffmpegPath,
      '-y',
      '-ss', startSec.toFixed(3),
      '-i', `"${videoPath}"`,
      '-t', durationSec.toFixed(3),
      '-c', 'copy', // Copy without re-encoding for speed
      `"${outputPath}"`,
    ].join(' ');

    try {
      await execAsync(cmd, { timeout: this.timeout });
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to trim clip: ${error}`);
    }
  }

  /**
   * Compose a PIP (Picture-in-Picture) overlay.
   */
  async composePIP(
    baseVideoPath: string,
    overlayVideoPath: string,
    outputPath: string,
    options: PIPOptions
  ): Promise<string> {
    if (!fs.existsSync(baseVideoPath)) {
      throw new Error(`Base video not found: ${baseVideoPath}`);
    }
    if (!fs.existsSync(overlayVideoPath)) {
      throw new Error(`Overlay video not found: ${overlayVideoPath}`);
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const { position, scale, opacity = 1, timeRange } = options;
    const startSec = timeRange.startMs / 1000;
    const endSec = timeRange.endMs / 1000;

    // Calculate overlay position (convert normalized to actual pixels)
    // We'll use overlay filter with expressions
    const overlayX = `W*${position.x}`;
    const overlayY = `H*${position.y}`;

    // Build filter complex
    let filterComplex = `[1:v]scale=iw*${scale}:ih*${scale}[pip];`;
    if (opacity < 1) {
      filterComplex += `[pip]format=rgba,colorchannelmixer=aa=${opacity}[pip_alpha];`;
      filterComplex += `[0:v][pip_alpha]overlay=${overlayX}:${overlayY}:enable='between(t,${startSec},${endSec})'`;
    } else {
      filterComplex += `[0:v][pip]overlay=${overlayX}:${overlayY}:enable='between(t,${startSec},${endSec})'`;
    }

    const cmd = [
      this.ffmpegPath,
      '-y',
      '-i', `"${baseVideoPath}"`,
      '-i', `"${overlayVideoPath}"`,
      '-filter_complex', `"${filterComplex}"`,
      '-c:a', 'copy',
      `"${outputPath}"`,
    ].join(' ');

    try {
      await execAsync(cmd, { timeout: this.timeout });
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to compose PIP: ${error}`);
    }
  }

  /**
   * Compose a B-roll cut (replace segment with different video).
   */
  async composeBRoll(
    baseVideoPath: string,
    brollVideoPath: string,
    outputPath: string,
    timeRange: TimeRange
  ): Promise<string> {
    if (!fs.existsSync(baseVideoPath)) {
      throw new Error(`Base video not found: ${baseVideoPath}`);
    }
    if (!fs.existsSync(brollVideoPath)) {
      throw new Error(`B-roll video not found: ${brollVideoPath}`);
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const startSec = timeRange.startMs / 1000;
    const endSec = timeRange.endMs / 1000;
    const durationSec = endSec - startSec;

    // Create temporary files for the segments
    const tempDir = path.join(outputDir, 'temp_broll');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const beforePath = path.join(tempDir, 'before.mp4');
    const brollTrimmedPath = path.join(tempDir, 'broll_trimmed.mp4');
    const afterPath = path.join(tempDir, 'after.mp4');
    const concatListPath = path.join(tempDir, 'concat.txt');

    try {
      // Extract before segment
      if (startSec > 0) {
        await this.trimClip(baseVideoPath, { startMs: 0, endMs: timeRange.startMs }, beforePath);
      }

      // Trim B-roll to match duration
      await execAsync([
        this.ffmpegPath,
        '-y',
        '-i', `"${brollVideoPath}"`,
        '-t', durationSec.toFixed(3),
        '-c', 'copy',
        `"${brollTrimmedPath}"`,
      ].join(' '), { timeout: this.timeout });

      // Get base video duration for after segment
      const metadata = await this.extractMetadata(baseVideoPath);
      const totalDurationMs = metadata.durationMs;

      // Extract after segment
      if (timeRange.endMs < totalDurationMs) {
        await this.trimClip(baseVideoPath, { startMs: timeRange.endMs, endMs: totalDurationMs }, afterPath);
      }

      // Create concat list
      const concatFiles: string[] = [];
      if (startSec > 0 && fs.existsSync(beforePath)) {
        concatFiles.push(`file '${beforePath}'`);
      }
      concatFiles.push(`file '${brollTrimmedPath}'`);
      if (timeRange.endMs < totalDurationMs && fs.existsSync(afterPath)) {
        concatFiles.push(`file '${afterPath}'`);
      }

      fs.writeFileSync(concatListPath, concatFiles.join('\n'));

      // Concatenate
      await execAsync([
        this.ffmpegPath,
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', `"${concatListPath}"`,
        '-c', 'copy',
        `"${outputPath}"`,
      ].join(' '), { timeout: this.timeout });

      // Cleanup temp files
      fs.rmSync(tempDir, { recursive: true, force: true });

      return outputPath;
    } catch (error) {
      // Cleanup on error
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      throw new Error(`Failed to compose B-roll: ${error}`);
    }
  }

  /**
   * Compose a split-screen layout.
   */
  async composeSplitScreen(
    video1Path: string,
    video2Path: string,
    outputPath: string,
    options: SplitScreenOptions
  ): Promise<string> {
    if (!fs.existsSync(video1Path)) {
      throw new Error(`Video 1 not found: ${video1Path}`);
    }
    if (!fs.existsSync(video2Path)) {
      throw new Error(`Video 2 not found: ${video2Path}`);
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const { layout, gap = 0 } = options;

    let filterComplex: string;
    if (layout === 'horizontal') {
      // Side by side
      filterComplex = `[0:v]scale=iw/2:ih[left];[1:v]scale=iw/2:ih[right];[left][right]hstack=inputs=2`;
    } else if (layout === 'vertical') {
      // Top and bottom
      filterComplex = `[0:v]scale=iw:ih/2[top];[1:v]scale=iw:ih/2[bottom];[top][bottom]vstack=inputs=2`;
    } else {
      // Grid (2x2, uses first two videos)
      filterComplex = `[0:v]scale=iw/2:ih/2[tl];[1:v]scale=iw/2:ih/2[tr];[tl][tr]hstack=inputs=2`;
    }

    const cmd = [
      this.ffmpegPath,
      '-y',
      '-i', `"${video1Path}"`,
      '-i', `"${video2Path}"`,
      '-filter_complex', `"${filterComplex}"`,
      '-c:a', 'aac',
      `"${outputPath}"`,
    ].join(' ');

    try {
      await execAsync(cmd, { timeout: this.timeout });
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to compose split screen: ${error}`);
    }
  }

  /**
   * Add a lower third text overlay.
   */
  async addLowerThird(
    videoPath: string,
    outputPath: string,
    text: string,
    timeRange: TimeRange,
    options: {
      fontSize?: number;
      fontColor?: string;
      backgroundColor?: string;
      position?: 'left' | 'center' | 'right';
    } = {}
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video not found: ${videoPath}`);
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const {
      fontSize = 24,
      fontColor = 'white',
      backgroundColor = 'black@0.5',
      position = 'left',
    } = options;

    const startSec = timeRange.startMs / 1000;
    const endSec = timeRange.endMs / 1000;

    // Calculate x position
    let xPos: string;
    if (position === 'left') {
      xPos = '20';
    } else if (position === 'right') {
      xPos = 'w-tw-20';
    } else {
      xPos = '(w-tw)/2';
    }

    // Escape special characters in text
    const escapedText = text.replace(/'/g, "'\\''").replace(/:/g, '\\:');

    const filterComplex = `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${xPos}:y=h-th-40:enable='between(t,${startSec},${endSec})':box=1:boxcolor=${backgroundColor}:boxborderw=10`;

    const cmd = [
      this.ffmpegPath,
      '-y',
      '-i', `"${videoPath}"`,
      '-vf', `"${filterComplex}"`,
      '-c:a', 'copy',
      `"${outputPath}"`,
    ].join(' ');

    try {
      await execAsync(cmd, { timeout: this.timeout });
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to add lower third: ${error}`);
    }
  }

  /**
   * Render a preview segment with progress callback.
   */
  async renderPreviewSegment(
    videoPath: string,
    outputPath: string,
    timeRange: TimeRange,
    options: {
      width?: number;
      quality?: 'low' | 'medium' | 'high';
    } = {},
    onProgress?: ProgressCallback
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video not found: ${videoPath}`);
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const { width = 720, quality = 'medium' } = options;

    // Quality presets
    const qualityPresets = {
      low: { crf: 28, preset: 'ultrafast' },
      medium: { crf: 23, preset: 'fast' },
      high: { crf: 18, preset: 'medium' },
    };
    const preset = qualityPresets[quality];

    const startSec = timeRange.startMs / 1000;
    const durationSec = (timeRange.endMs - timeRange.startMs) / 1000;

    const args = [
      '-y',
      '-ss', startSec.toFixed(3),
      '-i', videoPath,
      '-t', durationSec.toFixed(3),
      '-vf', `scale=${width}:-2`,
      '-c:v', 'libx264',
      '-crf', preset.crf.toString(),
      '-preset', preset.preset,
      '-c:a', 'aac',
      '-b:a', '128k',
      '-progress', 'pipe:1',
      outputPath,
    ];

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this.ffmpegPath, args);

      let lastProgress = 0;

      ffmpeg.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        const timeMatch = output.match(/out_time_ms=(\d+)/);
        if (timeMatch) {
          const currentMs = parseInt(timeMatch[1], 10) / 1000;
          const targetMs = timeRange.endMs - timeRange.startMs;
          const progress = Math.min(100, Math.round((currentMs / targetMs) * 100));
          if (progress > lastProgress) {
            lastProgress = progress;
            onProgress?.(progress, `Rendering preview: ${progress}%`);
          }
        }
      });

      ffmpeg.stderr.on('data', (data: Buffer) => {
        // FFmpeg outputs progress to stderr, we can parse it if needed
        // For now, just log errors
        const output = data.toString();
        if (output.includes('Error') || output.includes('error')) {
          console.error('[FFmpeg]', output);
        }
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg process error: ${error.message}`));
      });
    });
  }

  /**
   * Render final video with all compositions.
   */
  async renderFinalVideo(
    videoPath: string,
    outputPath: string,
    config: {
      format?: 'mp4' | 'mov' | 'webm';
      codec?: 'h264' | 'h265' | 'prores';
      resolution?: { width: number; height: number };
      fps?: number;
      bitrate?: number;
      audioCodec?: 'aac' | 'mp3' | 'pcm';
      audioSampleRate?: number;
    } = {},
    onProgress?: ProgressCallback
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video not found: ${videoPath}`);
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const {
      codec = 'h264',
      resolution,
      fps,
      bitrate,
      audioCodec = 'aac',
      audioSampleRate = 48000,
    } = config;

    // Build video codec args
    let videoCodecArgs: string[];
    switch (codec) {
      case 'h265':
        videoCodecArgs = ['-c:v', 'libx265', '-crf', '22', '-preset', 'medium'];
        break;
      case 'prores':
        videoCodecArgs = ['-c:v', 'prores_ks', '-profile:v', '3'];
        break;
      default:
        videoCodecArgs = ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium'];
    }

    // Build filter for resolution/fps
    const filters: string[] = [];
    if (resolution) {
      filters.push(`scale=${resolution.width}:${resolution.height}`);
    }
    if (fps) {
      filters.push(`fps=${fps}`);
    }

    const args: string[] = ['-y', '-i', videoPath];

    if (filters.length > 0) {
      args.push('-vf', filters.join(','));
    }

    args.push(...videoCodecArgs);

    if (bitrate) {
      args.push('-b:v', `${bitrate}k`);
    }

    args.push('-c:a', audioCodec === 'pcm' ? 'pcm_s16le' : audioCodec);
    args.push('-ar', audioSampleRate.toString());
    args.push('-progress', 'pipe:1');
    args.push(outputPath);

    // Get total duration for progress
    const metadata = await this.extractMetadata(videoPath);
    const totalDurationMs = metadata.durationMs;

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this.ffmpegPath, args);

      let lastProgress = 0;

      ffmpeg.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        const timeMatch = output.match(/out_time_ms=(\d+)/);
        if (timeMatch) {
          const currentMs = parseInt(timeMatch[1], 10) / 1000;
          const progress = Math.min(100, Math.round((currentMs / totalDurationMs) * 100));
          if (progress > lastProgress) {
            lastProgress = progress;
            onProgress?.(progress, `Rendering: ${progress}%`);
          }
        }
      });

      ffmpeg.stderr.on('data', (data: Buffer) => {
        const output = data.toString();
        if (output.includes('Error') || output.includes('error')) {
          console.error('[FFmpeg]', output);
        }
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg process error: ${error.message}`));
      });
    });
  }

  /**
   * Concatenate multiple video files.
   */
  async concatenateVideos(
    videoPaths: string[],
    outputPath: string
  ): Promise<string> {
    if (videoPaths.length === 0) {
      throw new Error('No videos to concatenate');
    }

    for (const vp of videoPaths) {
      if (!fs.existsSync(vp)) {
        throw new Error(`Video not found: ${vp}`);
      }
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Create temp concat list
    const tempListPath = path.join(outputDir, `concat_${Date.now()}.txt`);
    const concatContent = videoPaths.map(p => `file '${p}'`).join('\n');
    fs.writeFileSync(tempListPath, concatContent);

    try {
      const cmd = [
        this.ffmpegPath,
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', `"${tempListPath}"`,
        '-c', 'copy',
        `"${outputPath}"`,
      ].join(' ');

      await execAsync(cmd, { timeout: this.timeout });

      // Cleanup temp file
      fs.unlinkSync(tempListPath);

      return outputPath;
    } catch (error) {
      // Cleanup on error
      if (fs.existsSync(tempListPath)) {
        fs.unlinkSync(tempListPath);
      }
      throw new Error(`Failed to concatenate videos: ${error}`);
    }
  }

  /**
   * Extract audio from video to a separate file.
   * Useful for transcription services that need audio input.
   */
  async extractAudio(
    videoPath: string,
    outputPath: string,
    options: {
      /** Output format (default: mp3) */
      format?: 'mp3' | 'wav' | 'aac' | 'flac' | 'ogg';
      /** Sample rate in Hz (default: 16000 for speech recognition) */
      sampleRate?: number;
      /** Number of channels (default: 1 for mono, better for speech) */
      channels?: number;
      /** Bitrate for lossy formats (default: 128k) */
      bitrate?: string;
      /** Time range to extract (optional, extracts full audio if not specified) */
      timeRange?: TimeRange;
    } = {}
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const {
      format = 'mp3',
      sampleRate = 16000, // 16kHz is optimal for most speech recognition
      channels = 1, // Mono is better for speech recognition
      bitrate = '128k',
      timeRange,
    } = options;

    // Build FFmpeg command
    const args: string[] = ['-y'];

    // Add time range if specified
    if (timeRange) {
      const startSec = timeRange.startMs / 1000;
      const durationSec = (timeRange.endMs - timeRange.startMs) / 1000;
      args.push('-ss', startSec.toFixed(3));
      args.push('-t', durationSec.toFixed(3));
    }

    args.push('-i', `"${videoPath}"`);
    args.push('-vn'); // No video
    args.push('-ar', sampleRate.toString());
    args.push('-ac', channels.toString());

    // Format-specific settings
    switch (format) {
      case 'wav':
        args.push('-c:a', 'pcm_s16le');
        break;
      case 'flac':
        args.push('-c:a', 'flac');
        break;
      case 'aac':
        args.push('-c:a', 'aac', '-b:a', bitrate);
        break;
      case 'ogg':
        args.push('-c:a', 'libvorbis', '-b:a', bitrate);
        break;
      case 'mp3':
      default:
        args.push('-c:a', 'libmp3lame', '-b:a', bitrate);
        break;
    }

    args.push(`"${outputPath}"`);

    const cmd = `${this.ffmpegPath} ${args.join(' ')}`;

    try {
      await execAsync(cmd, { timeout: this.timeout });
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to extract audio: ${error}`);
    }
  }

  /**
   * Get audio duration in milliseconds.
   */
  async getAudioDuration(audioPath: string): Promise<number> {
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const cmd = [
      this.ffprobePath,
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      `"${audioPath}"`,
    ].join(' ');

    try {
      const { stdout } = await execAsync(cmd, { timeout: 30000 });
      const durationSec = parseFloat(stdout.trim());
      return Math.round(durationSec * 1000);
    } catch (error) {
      throw new Error(`Failed to get audio duration: ${error}`);
    }
  }

  /**
   * Add audio track to video.
   */
  async addAudioTrack(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    options: {
      volume?: number;
      startMs?: number;
      mix?: boolean; // Mix with existing audio or replace
    } = {}
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video not found: ${videoPath}`);
    }
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio not found: ${audioPath}`);
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const { volume = 1, startMs = 0, mix = true } = options;
    const startSec = startMs / 1000;

    let filterComplex: string;
    if (mix) {
      // Mix audio tracks
      filterComplex = `[1:a]adelay=${startMs}|${startMs},volume=${volume}[a1];[0:a][a1]amix=inputs=2:duration=first`;
    } else {
      // Replace audio
      filterComplex = `[1:a]adelay=${startMs}|${startMs},volume=${volume}[a1]`;
    }

    const cmd = [
      this.ffmpegPath,
      '-y',
      '-i', `"${videoPath}"`,
      '-i', `"${audioPath}"`,
      '-filter_complex', `"${filterComplex}"`,
      '-c:v', 'copy',
      '-map', '0:v',
      '-map', mix ? '"[0:a]"' : '"[a1]"',
      `"${outputPath}"`,
    ].join(' ');

    try {
      await execAsync(cmd, { timeout: this.timeout });
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to add audio track: ${error}`);
    }
  }
}

/**
 * Create a default FFmpegService instance.
 */
export function createFFmpegService(config?: FFmpegConfig): FFmpegService {
  return new FFmpegService(config);
}

export default FFmpegService;
