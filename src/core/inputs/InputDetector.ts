/**
 * InputDetector - Detects input source type and media type from user-provided strings.
 *
 * Handles:
 * - Local file paths: /path/to/file.mp4
 * - Remote URLs: https://example.com/video.mp4
 * - YouTube URLs: https://youtube.com/watch?v=xyz, https://youtu.be/xyz
 * - Inline text: Any text that doesn't match the above patterns
 */

import * as fs from 'fs';
import * as path from 'path';
import type { InputSourceType, InputMediaType } from '../../tasks/video/workflow/types.js';

/**
 * Result of input detection.
 */
export interface DetectionResult {
  /** Type of source (local_path, remote_url, youtube, inline) */
  sourceType: InputSourceType;
  /** Detected media type (null if can't determine) */
  mediaType: InputMediaType | null;
  /** Confidence level (0-1) */
  confidence: number;
  /** Additional metadata from detection */
  metadata: {
    /** YouTube video ID if detected */
    youtubeId?: string;
    /** Filename if detected */
    filename?: string;
    /** File extension if detected */
    extension?: string;
    /** Domain if URL */
    domain?: string;
    /** Whether the local file exists */
    fileExists?: boolean;
  };
}

/**
 * Media type detection mappings.
 */
const EXTENSION_TO_MEDIA_TYPE: Record<string, InputMediaType> = {
  // Text
  txt: 'text',
  md: 'text',
  markdown: 'text',
  rtf: 'text',
  doc: 'text',
  docx: 'text',
  // Audio
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
  flac: 'audio',
  wma: 'audio',
  aiff: 'audio',
  // Image
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  tiff: 'image',
  svg: 'image',
  heic: 'image',
  // Video
  mp4: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',
  webm: 'video',
  wmv: 'video',
  flv: 'video',
  m4v: 'video',
  '3gp': 'video',
};

const MIME_TO_MEDIA_TYPE: Record<string, InputMediaType> = {
  // Text
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/rtf': 'text',
  'application/msword': 'text',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'text',
  // Audio
  'audio/mpeg': 'audio',
  'audio/mp3': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/x-m4a': 'audio',
  'audio/aac': 'audio',
  'audio/ogg': 'audio',
  'audio/flac': 'audio',
  // Image
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/bmp': 'image',
  'image/tiff': 'image',
  'image/svg+xml': 'image',
  // Video
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/x-msvideo': 'video',
  'video/x-matroska': 'video',
  'video/webm': 'video',
  'video/x-ms-wmv': 'video',
  'video/x-flv': 'video',
};

/**
 * YouTube URL patterns.
 */
const YOUTUBE_PATTERNS = [
  // Standard watch URL: youtube.com/watch?v=VIDEO_ID
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?(?:[^&]*&)*v=([a-zA-Z0-9_-]{11})/,
  // Short URL: youtu.be/VIDEO_ID
  /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
  // Embed URL: youtube.com/embed/VIDEO_ID
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  // Shorts URL: youtube.com/shorts/VIDEO_ID
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  // Live URL: youtube.com/live/VIDEO_ID
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
];

/**
 * InputDetector class for detecting input types.
 */
export class InputDetector {
  /**
   * Main detection method - determines source type and media type from user input.
   */
  detect(userInput: string): DetectionResult {
    const trimmed = userInput.trim();

    // Check YouTube first (most specific URL pattern)
    const youtubeResult = this.isYouTubeUrl(trimmed);
    if (youtubeResult.isYouTube && youtubeResult.videoId) {
      return {
        sourceType: 'youtube',
        mediaType: 'video', // YouTube is always video
        confidence: 1.0,
        metadata: {
          youtubeId: youtubeResult.videoId,
          domain: 'youtube.com',
        },
      };
    }

    // Check if it's a URL
    if (this.isUrl(trimmed)) {
      const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
      const pathname = url.pathname;
      const filename = path.basename(pathname);
      const extension = path.extname(filename).toLowerCase().slice(1);
      const mediaType = this.detectMediaTypeFromExtension(extension);

      return {
        sourceType: 'remote_url',
        mediaType,
        confidence: mediaType ? 0.9 : 0.5,
        metadata: {
          filename: filename || undefined,
          extension: extension || undefined,
          domain: url.hostname,
        },
      };
    }

    // Check if it's a local path
    if (this.isLocalPath(trimmed)) {
      const resolvedPath = path.resolve(trimmed);
      const filename = path.basename(resolvedPath);
      const extension = path.extname(filename).toLowerCase().slice(1);
      const mediaType = this.detectMediaTypeFromExtension(extension);
      const fileExists = fs.existsSync(resolvedPath);

      return {
        sourceType: 'local_path',
        mediaType,
        confidence: fileExists ? (mediaType ? 1.0 : 0.7) : 0.5,
        metadata: {
          filename,
          extension: extension || undefined,
          fileExists,
        },
      };
    }

    // Default to inline text
    return {
      sourceType: 'inline',
      mediaType: 'text',
      confidence: 0.8,
      metadata: {},
    };
  }

  /**
   * Check if input looks like a local file path.
   */
  isLocalPath(input: string): boolean {
    // Absolute paths
    if (input.startsWith('/') || input.startsWith('~')) {
      return true;
    }

    // Windows absolute paths
    if (/^[a-zA-Z]:[/\\]/.test(input)) {
      return true;
    }

    // Relative paths starting with ./ or ../
    if (input.startsWith('./') || input.startsWith('../')) {
      return true;
    }

    // Check if it looks like a file with extension and no URL characteristics
    const hasExtension = /\.[a-zA-Z0-9]{1,10}$/.test(input);
    const hasNoUrlChars = !input.includes('://') && !input.includes('www.');

    if (hasExtension && hasNoUrlChars) {
      // Could be a relative path to a file
      // Check if it exists to increase confidence
      try {
        const resolved = path.resolve(input);
        if (fs.existsSync(resolved)) {
          return true;
        }
      } catch {
        // Ignore errors
      }
      // Still might be intended as a local path
      return true;
    }

    return false;
  }

  /**
   * Check if input is a URL.
   */
  isUrl(input: string): boolean {
    // Explicit protocol
    if (input.startsWith('http://') || input.startsWith('https://')) {
      try {
        new URL(input);
        return true;
      } catch {
        return false;
      }
    }

    // Check for www. prefix
    if (input.startsWith('www.')) {
      try {
        new URL(`https://${input}`);
        return true;
      } catch {
        return false;
      }
    }

    // Check for domain-like pattern (domain.tld/path)
    const domainPattern = /^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+[/\w.-]*$/;
    if (domainPattern.test(input)) {
      try {
        new URL(`https://${input}`);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Check if input is a YouTube URL and extract video ID.
   */
  isYouTubeUrl(input: string): { isYouTube: boolean; videoId?: string } {
    for (const pattern of YOUTUBE_PATTERNS) {
      const match = input.match(pattern);
      if (match && match[1]) {
        return {
          isYouTube: true,
          videoId: match[1],
        };
      }
    }

    return { isYouTube: false };
  }

  /**
   * Detect media type from file extension.
   */
  detectMediaTypeFromExtension(ext: string): InputMediaType | null {
    const normalized = ext.toLowerCase().replace(/^\./, '');
    return EXTENSION_TO_MEDIA_TYPE[normalized] || null;
  }

  /**
   * Detect media type from MIME type.
   */
  detectMediaTypeFromMime(mime: string): InputMediaType | null {
    const normalized = mime.toLowerCase();
    return MIME_TO_MEDIA_TYPE[normalized] || null;
  }

  /**
   * Get all supported extensions for a media type.
   */
  getSupportedExtensions(mediaType: InputMediaType): string[] {
    return Object.entries(EXTENSION_TO_MEDIA_TYPE)
      .filter(([_, type]) => type === mediaType)
      .map(([ext, _]) => ext);
  }

  /**
   * Validate that a local path exists and is accessible.
   */
  validateLocalPath(inputPath: string): {
    exists: boolean;
    isFile: boolean;
    isDirectory: boolean;
    size?: number;
  } {
    try {
      const resolved = path.resolve(inputPath);
      const stats = fs.statSync(resolved);
      return {
        exists: true,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.isFile() ? stats.size : undefined,
      };
    } catch {
      return {
        exists: false,
        isFile: false,
        isDirectory: false,
      };
    }
  }
}

/**
 * Singleton instance for convenience.
 */
export const inputDetector = new InputDetector();
