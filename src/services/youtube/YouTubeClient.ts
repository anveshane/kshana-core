/**
 * YouTubeClient - Service for extracting transcripts from YouTube videos.
 *
 * Uses yt-dlp CLI tool for reliable transcript extraction.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export interface TranscriptSegment {
  text: string;
  startTime: number;  // Start time in seconds
  endTime: number;    // End time in seconds
}

export interface TranscriptResult {
  videoId: string;
  transcript: TranscriptSegment[];
  fullText: string;
  language?: string;
  duration: number; // Total duration in seconds
  title?: string;
}

export interface YouTubeClientOptions {
  language?: string; // Preferred language code (e.g., 'en', 'es')
}

/**
 * Extract video ID from various YouTube URL formats.
 */
export function extractVideoId(urlOrId: string): string {
  // Already a video ID (11 characters, alphanumeric with - and _)
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) {
    return urlOrId;
  }

  // Try to parse as URL
  try {
    const url = new URL(urlOrId);

    // youtube.com/watch?v=VIDEO_ID
    if (url.hostname.includes('youtube.com')) {
      const videoId = url.searchParams.get('v');
      if (videoId) return videoId;

      // youtube.com/embed/VIDEO_ID
      const embedMatch = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embedMatch && embedMatch[1]) return embedMatch[1];

      // youtube.com/v/VIDEO_ID
      const vMatch = url.pathname.match(/\/v\/([a-zA-Z0-9_-]{11})/);
      if (vMatch && vMatch[1]) return vMatch[1];
    }

    // youtu.be/VIDEO_ID
    if (url.hostname === 'youtu.be') {
      const videoId = url.pathname.slice(1);
      if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return videoId;
      }
    }
  } catch {
    // Not a valid URL, might be a video ID with extra characters
  }

  // Last resort: try to find 11-char ID pattern in the string
  const match = urlOrId.match(/[a-zA-Z0-9_-]{11}/);
  if (match) return match[0];

  throw new Error(`Could not extract video ID from: ${urlOrId}`);
}

/**
 * Parse VTT subtitle file content into transcript segments.
 */
function parseVTT(vttContent: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const lines = vttContent.split('\n');

  let i = 0;
  while (i < lines.length) {
    const currentLine = lines[i];
    if (currentLine === undefined) {
      i++;
      continue;
    }
    const line = currentLine.trim();

    // Look for timestamp lines (e.g., "00:00:18.790 --> 00:00:18.800")
    const timestampMatch = line.match(
      /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/
    );

    if (timestampMatch) {
      const startTime =
        parseInt(timestampMatch[1] || '0') * 3600 +
        parseInt(timestampMatch[2] || '0') * 60 +
        parseInt(timestampMatch[3] || '0') +
        parseInt(timestampMatch[4] || '0') / 1000;

      const endTime =
        parseInt(timestampMatch[5] || '0') * 3600 +
        parseInt(timestampMatch[6] || '0') * 60 +
        parseInt(timestampMatch[7] || '0') +
        parseInt(timestampMatch[8] || '0') / 1000;

      // Collect text lines until empty line or next timestamp
      i++;
      const textLines: string[] = [];
      while (i < lines.length) {
        const currentLine = lines[i];
        if (currentLine === undefined || currentLine.trim() === '') break;
        
        const textLine = currentLine.trim();
        // Skip lines that look like timestamps
        if (!textLine.match(/^\d{2}:\d{2}:\d{2}/)) {
          // Remove VTT formatting tags like <00:00:19.039><c>
          const cleanText = textLine
            .replace(/<[^>]+>/g, '')
            .replace(/align:start position:\d+%?/g, '')
            .trim();
          if (cleanText && cleanText !== '[Music]' && cleanText !== '[Applause]') {
            textLines.push(cleanText);
          }
        }
        i++;
      }

      const text = textLines.join(' ').trim();
      if (text) {
        // Avoid duplicate consecutive segments
        const lastSeg = segments[segments.length - 1];
        if (!lastSeg || lastSeg.text !== text) {
          segments.push({ text, startTime, endTime });
        }
      }
    }
    i++;
  }

  return segments;
}

/**
 * YouTube transcript client using yt-dlp CLI.
 */
export class YouTubeClient {
  private options: YouTubeClientOptions;

  constructor(options: YouTubeClientOptions = {}) {
    this.options = options;
  }

  /**
   * Helper to process transcript segments into a result object.
   */
  private processTranscriptResult(
    videoId: string,
    transcript: TranscriptSegment[],
    duration: number,
    title?: string,
    language?: string
  ): TranscriptResult {
    const fullText = transcript
      .map((seg) => seg.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      videoId,
      transcript,
      fullText,
      language,
      duration,
      title,
    };
  }

  /**
   * Fetch transcript for a YouTube video using yt-dlp.
   *
   * @param urlOrId - YouTube URL or video ID
   * @returns Transcript result with segments and full text
   */
  async fetchTranscript(urlOrId: string): Promise<TranscriptResult> {
    const videoId = extractVideoId(urlOrId);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const tempDir = os.tmpdir();
    const outputBase = path.join(tempDir, `yt_transcript_${videoId}_${Date.now()}`);

    try {
      // Check if yt-dlp is available
      try {
        await execAsync('which yt-dlp');
      } catch {
        throw new Error('yt-dlp is not installed. Install it with: brew install yt-dlp');
      }

      // Build yt-dlp metadata command
      const metadataCmd = [
        'yt-dlp',
        '--skip-download',
        '--print "%(title)s"',
        '--print "%(duration)s"',
        `"${videoUrl}"`,
      ].join(' ');

      // Build yt-dlp subtitle command
      const lang = this.options.language || 'en';
      const subCmd = [
        'yt-dlp',
        '--write-subs',
        '--write-auto-sub',
        `--sub-lang ${lang}`,
        '--skip-download',
        '--sub-format vtt',
        `-o "${outputBase}"`,
        `"${videoUrl}"`,
      ].join(' ');

      // Execute metadata command first
      const { stdout: metaStdout } = await execAsync(metadataCmd, { timeout: 30000 });
      const outputLines = metaStdout.trim().split('\n');
      const title = outputLines[0] || undefined;
      const durationStr = outputLines[1];
      const duration = durationStr ? parseFloat(durationStr) : 0;

      // Execute subtitle command
      await execAsync(subCmd, { timeout: 60000 });

      // Find the VTT file
      const vttFile = `${outputBase}.${lang}.vtt`;
      if (!fs.existsSync(vttFile)) {
        // Try to find any .vtt file with this base name in the temp directory
        const baseName = path.basename(outputBase);
        const files = fs.readdirSync(tempDir);
        const vttMatch = files.find(
          (f) => f.startsWith(baseName) && f.endsWith('.vtt')
        );
        if (!vttMatch) {
          throw new Error(
            `No transcript available for video ${videoId}. The video may not have captions enabled or the requested language (${lang}) is not available.`
          );
        }
        // Use the found file
        const actualVttPath = path.join(tempDir, vttMatch);
        const vttContent = fs.readFileSync(actualVttPath, 'utf-8');
        const transcript = parseVTT(vttContent);
        
        // Clean up
        try { fs.unlinkSync(actualVttPath); } catch {}
        
        return this.processTranscriptResult(videoId, transcript, duration, title, lang);
      }

      // Read and parse VTT file
      const vttContent = fs.readFileSync(vttFile, 'utf-8');
      const transcript = parseVTT(vttContent);

      // Clean up temp file
      try {
        fs.unlinkSync(vttFile);
      } catch {
        // Ignore cleanup errors
      }

      if (transcript.length === 0) {
        throw new Error(`No transcript segments found for video ${videoId}.`);
      }

      return this.processTranscriptResult(videoId, transcript, duration, title, lang);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Clean up any temp files on error
      try {
        const files = fs.readdirSync(tempDir);
        files
          .filter((f) => f.startsWith(`yt_transcript_${videoId}`))
          .forEach((f) => fs.unlinkSync(path.join(tempDir, f)));
      } catch {
        // Ignore cleanup errors
      }

      if (message.includes('No transcript') || message.includes('not have captions')) {
        throw error;
      }

      if (message.includes('yt-dlp is not installed')) {
        throw error;
      }

      throw new Error(`Failed to fetch transcript for ${videoId}: ${message}`);
    }
  }

  /**
   * Fetch transcript and format with timestamps.
   *
   * @param urlOrId - YouTube URL or video ID
   * @returns Transcript with timestamps formatted as [MM:SS] text
   */
  async fetchTranscriptWithTimestamps(urlOrId: string): Promise<string> {
    const result = await this.fetchTranscript(urlOrId);

    return result.transcript
      .map((seg) => {
        const totalSeconds = Math.floor(seg.startTime);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const timestamp = `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}]`;
        return `${timestamp} ${seg.text}`;
      })
      .join('\n');
  }

  /**
   * Check if a video has a transcript available.
   *
   * @param urlOrId - YouTube URL or video ID
   * @returns true if transcript is available
   */
  async hasTranscript(urlOrId: string): Promise<boolean> {
    try {
      await this.fetchTranscript(urlOrId);
      return true;
    } catch {
      return false;
    }
  }
}

// Default client instance
let defaultClient: YouTubeClient | null = null;

/**
 * Get or create the default YouTube client.
 */
export function getYouTubeClient(options?: YouTubeClientOptions): YouTubeClient {
  if (!defaultClient || options) {
    defaultClient = new YouTubeClient(options);
  }
  return defaultClient;
}
