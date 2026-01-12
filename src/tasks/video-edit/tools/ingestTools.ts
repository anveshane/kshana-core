/**
 * Ingest tools for the video editing workflow.
 * Handles video/audio import, metadata extraction, and thumbnail generation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Innertube } from 'youtubei.js';
import { createTool } from '../../../core/tools/index.js';
import type { ToolDefinition } from '../../../core/llm/index.js';
import { FFmpegService } from '../../../services/ffmpeg/FFmpegService.js';
import {
  loadProject,
  createProject,
  setSourceVideo,
  updateSourceMetadata,
  addAsset,
  getProjectDir,
  updatePhaseStatus,
} from '../workflow/ProjectManager.js';
import type {
  InputSourceType,
  CloudProvider,
  AssetInfo,
} from '../workflow/types.js';

// ============================================================================
// Media Type Detection
// ============================================================================

/** Audio file extensions */
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.aiff']);

/** Video file extensions */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v']);

/**
 * Detect media type from file extension.
 */
function getMediaType(filePath: string): 'video' | 'audio' | 'unknown' {
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return 'unknown';
}

/**
 * Check if a file is an audio file.
 */
function isAudioFile(filePath: string): boolean {
  return getMediaType(filePath) === 'audio';
}

/**
 * Check if a URL is a YouTube URL.
 */
function isYouTubeUrl(url: string): boolean {
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/)|youtu\.be\/)[\w-]+/;
  return youtubeRegex.test(url);
}

/**
 * Extract video ID from YouTube URL.
 */
function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Download video from YouTube using youtubei.js (npm package).
 * No system dependencies required - works on any server.
 */
async function downloadYouTubeVideo(
  url: string,
  outputDir: string
): Promise<{ success: boolean; filePath?: string; title?: string; error?: string }> {
  try {
    // Extract video ID
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      return { success: false, error: 'Invalid YouTube URL - could not extract video ID' };
    }

    // Initialize Innertube client
    const innertube = await Innertube.create();

    // Get video info
    const info = await innertube.getBasicInfo(videoId);
    const title = info.basic_info.title || 'video';

    // Download the video (best quality with audio+video)
    const stream = await innertube.download(videoId, {
      type: 'video+audio',
      quality: 'best',
    });

    const outputPath = path.join(outputDir, 'video.mp4');
    const writeStream = fs.createWriteStream(outputPath);

    // Convert ReadableStream to Node.js writable
    const reader = stream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writeStream.write(Buffer.from(value));
    }

    writeStream.end();

    // Wait for write to complete
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    return {
      success: true,
      filePath: outputPath,
      title,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to download YouTube video: ${errorMessage}`,
    };
  }
}

// Initialize FFmpeg service
const ffmpegService = new FFmpegService();

/**
 * import_video tool - Import video or audio from local file, URL, or cloud storage.
 */
export const importVideoTool: ToolDefinition = createTool(
  'import_video',
  `Import a source video or audio file for editing.

Supports three input types:
- local_file: Path to a local video or audio file
- url: HTTP/HTTPS URL to a media file (including YouTube)
- cloud_storage: Cloud storage reference (Google Drive, Dropbox, S3)

Supported formats:
- Video: mp4, mov, avi, mkv, webm, wmv, flv, m4v
- Audio: mp3, wav, m4a, aac, flac, ogg, wma, aiff

YouTube support:
- Accepts youtube.com and youtu.be URLs
- Downloads best quality video+audio in MP4 format

Audio-only files are fully supported for creating video content from podcasts, music, or voiceovers.

Returns the import status and file path.`,
  {
    type: 'object',
    properties: {
      source_type: {
        type: 'string',
        enum: ['local_file', 'url', 'cloud_storage'],
        description: 'Type of media source',
      },
      path: {
        type: 'string',
        description: 'Local file path, URL, or cloud storage path',
      },
      cloud_provider: {
        type: 'string',
        enum: ['google_drive', 'dropbox', 's3'],
        description: 'Cloud provider (required for cloud_storage type)',
      },
    },
    required: ['source_type', 'path'],
  },
  async (args) => {
    const sourceType = args['source_type'] as InputSourceType;
    const sourcePath = args['path'] as string;
    const cloudProvider = args['cloud_provider'] as CloudProvider | undefined;

    // Auto-create project if it doesn't exist
    let project = loadProject();
    if (!project) {
      project = createProject('Video Editing Project');
    }

    const projectDir = getProjectDir();
    const sourceDir = path.join(projectDir, 'source', 'original');

    // Ensure source directory exists
    if (!fs.existsSync(sourceDir)) {
      fs.mkdirSync(sourceDir, { recursive: true });
    }

    let finalMediaPath: string;
    let mediaType: 'video' | 'audio' | 'unknown' = 'unknown';

    try {
      switch (sourceType) {
        case 'local_file': {
          // Verify the file exists
          if (!fs.existsSync(sourcePath)) {
            return { success: false, error: `Media file not found: ${sourcePath}` };
          }

          // Detect media type
          mediaType = getMediaType(sourcePath);
          if (mediaType === 'unknown') {
            return {
              success: false,
              error: `Unsupported file format: ${path.extname(sourcePath)}. Supported: video (mp4, mov, etc.) or audio (mp3, wav, etc.)`
            };
          }

          // Copy to project directory with appropriate name
          const ext = path.extname(sourcePath);
          const baseName = mediaType === 'audio' ? 'audio' : 'video';
          const destPath = path.join(sourceDir, `${baseName}${ext}`);
          fs.copyFileSync(sourcePath, destPath);
          finalMediaPath = destPath;
          break;
        }

        case 'url': {
          // Check if this is a YouTube URL
          if (isYouTubeUrl(sourcePath)) {
            // Download using youtubei.js (npm package - no system deps needed)
            const ytResult = await downloadYouTubeVideo(sourcePath, sourceDir);
            if (!ytResult.success) {
              return {
                success: false,
                error: ytResult.error || 'Failed to download YouTube video',
              };
            }

            finalMediaPath = ytResult.filePath!;
            mediaType = 'video'; // YouTube always returns video
            break;
          }

          // Regular URL - download directly
          const response = await fetch(sourcePath);
          if (!response.ok) {
            return { success: false, error: `Failed to download media: ${response.statusText}` };
          }

          // Determine extension from URL or content-type
          const contentType = response.headers.get('content-type') || '';
          let ext = '.mp4';
          let baseName = 'video';

          // Check for audio content types
          if (contentType.includes('audio/') ||
              sourcePath.match(/\.(mp3|wav|m4a|aac|flac|ogg)$/i)) {
            if (contentType.includes('mpeg') || sourcePath.endsWith('.mp3')) ext = '.mp3';
            else if (contentType.includes('wav') || sourcePath.endsWith('.wav')) ext = '.wav';
            else if (contentType.includes('m4a') || sourcePath.endsWith('.m4a')) ext = '.m4a';
            else if (contentType.includes('aac') || sourcePath.endsWith('.aac')) ext = '.aac';
            else if (contentType.includes('flac') || sourcePath.endsWith('.flac')) ext = '.flac';
            else if (contentType.includes('ogg') || sourcePath.endsWith('.ogg')) ext = '.ogg';
            else ext = '.mp3'; // Default audio extension
            baseName = 'audio';
            mediaType = 'audio';
          } else {
            // Video content types
            if (contentType.includes('quicktime') || sourcePath.endsWith('.mov')) {
              ext = '.mov';
            } else if (contentType.includes('webm') || sourcePath.endsWith('.webm')) {
              ext = '.webm';
            }
            mediaType = 'video';
          }

          const destPath = path.join(sourceDir, `${baseName}${ext}`);
          const buffer = await response.arrayBuffer();
          fs.writeFileSync(destPath, Buffer.from(buffer));
          finalMediaPath = destPath;
          break;
        }

        case 'cloud_storage': {
          if (!cloudProvider) {
            return { success: false, error: 'cloud_provider is required for cloud_storage type' };
          }

          // Cloud storage support is a placeholder
          // In production, this would integrate with respective cloud APIs
          return {
            success: false,
            error: `Cloud storage (${cloudProvider}) integration not yet implemented. Please use local_file or url for now.`,
          };
        }

        default:
          return { success: false, error: `Unknown source type: ${sourceType}` };
      }

      // Update project with source media
      setSourceVideo(project, sourceType, finalMediaPath, cloudProvider);

      // Add source media as an asset
      const asset: AssetInfo = {
        id: `asset_source_${Date.now()}`,
        type: 'source_video', // Keep as source_video for compatibility
        path: path.relative(projectDir, finalMediaPath),
        createdAt: Date.now(),
        metadata: { mediaType }, // Store actual media type in metadata
      };
      addAsset(project, asset);

      return {
        success: true,
        mediaPath: finalMediaPath,
        mediaType,
        sourceType,
        message: `${mediaType === 'audio' ? 'Audio' : 'Video'} imported successfully from ${sourceType}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to import media: ${errorMessage}` };
    }
  }
);

/**
 * extract_metadata tool - Extract media metadata using FFmpeg.
 */
export const extractMetadataTool: ToolDefinition = createTool(
  'extract_metadata',
  `Extract metadata from the source video or audio file.

Extracts:
- Duration
- Resolution (width x height) - for video only
- Frame rate (FPS) - for video only
- Codec information
- Bitrate
- Audio track information

This tool should be called after import_video.`,
  {
    type: 'object',
    properties: {},
    required: [],
  },
  async () => {
    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    if (!project.source.path) {
      return { success: false, error: 'No source media found. Import a file first using import_video.' };
    }

    try {
      // Detect if source is audio-only
      const sourceIsAudio = isAudioFile(project.source.path);

      // Extract metadata using FFmpeg service
      const metadata = await ffmpegService.extractMetadata(project.source.path);

      // Update project with metadata
      updateSourceMetadata(project, metadata);

      // Save metadata to file for reference
      const projectDir = getProjectDir();
      const metadataPath = path.join(projectDir, 'source', 'original', 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

      // Build response based on media type
      if (sourceIsAudio) {
        return {
          success: true,
          mediaType: 'audio',
          metadata: {
            duration: metadata.durationMs,
            durationFormatted: formatDuration(metadata.durationMs),
            codec: metadata.codec || 'unknown',
            bitrate: metadata.bitrate,
            format: metadata.format,
            fileSize: formatFileSize(metadata.fileSize),
            audioTracks: metadata.audioTracks.length,
            sampleRate: metadata.audioTracks[0]?.sampleRate,
            channels: metadata.audioTracks[0]?.channels,
          },
          note: 'Audio-only file detected. Thumbnail generation will be skipped.',
        };
      }

      return {
        success: true,
        mediaType: 'video',
        metadata: {
          duration: metadata.durationMs,
          durationFormatted: formatDuration(metadata.durationMs),
          resolution: `${metadata.width}x${metadata.height}`,
          fps: metadata.fps,
          codec: metadata.codec,
          bitrate: metadata.bitrate,
          format: metadata.format,
          fileSize: formatFileSize(metadata.fileSize),
          audioTracks: metadata.audioTracks.length,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to extract metadata: ${errorMessage}` };
    }
  }
);

/**
 * generate_thumbnails tool - Generate thumbnail strip for timeline preview.
 */
export const generateThumbnailsTool: ToolDefinition = createTool(
  'generate_thumbnails',
  `Generate thumbnails from the source video for timeline preview.

Creates a series of thumbnail images at regular intervals.
Default interval is one thumbnail every 5 seconds.

These thumbnails are used for the CLI timeline visualization.

Note: This tool is skipped for audio-only files (no video frames to extract).`,
  {
    type: 'object',
    properties: {
      interval_seconds: {
        type: 'number',
        description: 'Interval between thumbnails in seconds (default: 5)',
      },
      width: {
        type: 'number',
        description: 'Thumbnail width in pixels (default: 160)',
      },
      height: {
        type: 'number',
        description: 'Thumbnail height in pixels (default: 90)',
      },
    },
    required: [],
  },
  async (args) => {
    const intervalSeconds = (args['interval_seconds'] as number) || 5;
    const width = (args['width'] as number) || 160;
    const height = (args['height'] as number) || 90;

    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    if (!project.source.path) {
      return { success: false, error: 'No source media found. Import a file first.' };
    }

    if (!project.source.metadata) {
      return { success: false, error: 'Media metadata not extracted. Run extract_metadata first.' };
    }

    // Check if source is audio-only - skip thumbnail generation
    if (isAudioFile(project.source.path)) {
      return {
        success: true,
        skipped: true,
        mediaType: 'audio',
        message: 'Thumbnail generation skipped for audio-only file. No video frames to extract.',
        thumbnailCount: 0,
      };
    }

    const projectDir = getProjectDir();
    const thumbnailDir = path.join(projectDir, 'source', 'thumbnails');

    // Clean existing thumbnails
    if (fs.existsSync(thumbnailDir)) {
      const existingFiles = fs.readdirSync(thumbnailDir);
      for (const file of existingFiles) {
        if (file.startsWith('thumb_')) {
          fs.unlinkSync(path.join(thumbnailDir, file));
        }
      }
    } else {
      fs.mkdirSync(thumbnailDir, { recursive: true });
    }

    try {
      // Generate thumbnails using FFmpeg service
      const thumbnailPaths = await ffmpegService.generateThumbnails(
        project.source.path,
        thumbnailDir,
        {
          intervalSeconds,
          width,
          height,
        }
      );

      // Register thumbnails as assets
      for (const thumbPath of thumbnailPaths) {
        const asset: AssetInfo = {
          id: `asset_thumb_${path.basename(thumbPath, '.jpg')}`,
          type: 'thumbnail',
          path: path.relative(projectDir, thumbPath),
          createdAt: Date.now(),
        };
        addAsset(project, asset);
      }

      return {
        success: true,
        thumbnailCount: thumbnailPaths.length,
        thumbnailDir: path.relative(projectDir, thumbnailDir),
        intervalSeconds,
        resolution: `${width}x${height}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to generate thumbnails: ${errorMessage}` };
    }
  }
);

/**
 * complete_ingest tool - Mark the ingest phase as complete.
 */
export const completeIngestTool: ToolDefinition = createTool(
  'complete_ingest',
  `Mark the ingest phase as complete after video import, metadata extraction, and thumbnail generation.

This transitions the project to the SCRIPT_PARSE phase.`,
  {
    type: 'object',
    properties: {},
    required: [],
  },
  async () => {
    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    // Validate ingest is complete
    if (!project.source.path) {
      return { success: false, error: 'No source video imported. Use import_video first.' };
    }

    if (!project.source.metadata) {
      return { success: false, error: 'Video metadata not extracted. Use extract_metadata first.' };
    }

    // Mark phase as complete
    updatePhaseStatus(project, 'ingest', 'completed');

    return {
      success: true,
      message: 'Ingest phase completed. Ready for script parsing.',
      nextPhase: 'script_parse',
    };
  }
);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format duration in milliseconds to HH:MM:SS.
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format file size in bytes to human-readable format.
 */
function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// ============================================================================
// Export all ingest tools
// ============================================================================

export const ingestTools: ToolDefinition[] = [
  importVideoTool,
  extractMetadataTool,
  generateThumbnailsTool,
  completeIngestTool,
];
