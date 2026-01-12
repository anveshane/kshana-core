/**
 * Script tools for the video editing workflow.
 * Handles script parsing, format detection, and alignment with video.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createTool } from '../../../core/tools/index.js';
import type { ToolDefinition } from '../../../core/llm/index.js';
import { ScriptParser } from '../../../services/script-parser/ScriptParser.js';
import { ffmpegService } from '../../../services/ffmpeg/index.js';
import { transcriptionService } from '../../../services/transcription/index.js';
import {
  loadProject,
  setScript,
  setScriptSegments,
  getProjectDir,
  updatePhaseStatus,
  addEnhancement,
} from '../workflow/ProjectManager.js';
import type {
  ScriptFormat,
  ScriptSegment,
  EnhancementSuggestion,
  TimeRange,
  EnhancementType,
  CompositionMode,
} from '../workflow/types.js';

// Initialize script parser
const scriptParser = new ScriptParser();

/**
 * detect_script_format tool - Auto-detect the format of a script.
 */
export const detectScriptFormatTool: ToolDefinition = createTool(
  'detect_script_format',
  `Detect the format of a script from its content.

Supports the following formats:
- srt: SubRip subtitle format (00:00:00,000 --> 00:00:00,000)
- vtt: WebVTT subtitle format (00:00:00.000 --> 00:00:00.000)
- screenplay: Standard screenplay format with INT./EXT. scene headings
- timestamped_text: Text with timestamps like [00:00] or (00:00)
- plain_text: Regular text without timestamps

Returns the detected format and confidence score.`,
  {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The script content to analyze',
      },
      file_path: {
        type: 'string',
        description: 'Alternative: path to a script file to read',
      },
    },
    required: [],
  },
  async (args) => {
    let content = args.content as string | undefined;
    const filePath = args.file_path as string | undefined;

    // Read from file if path provided
    if (!content && filePath) {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `Script file not found: ${filePath}` };
      }
      content = fs.readFileSync(filePath, 'utf-8');
    }

    if (!content) {
      return { success: false, error: 'Either content or file_path is required' };
    }

    try {
      const result = scriptParser.detectFormat(content);

      return {
        success: true,
        format: result.format,
        confidence: result.confidence,
        indicators: result.indicators,
        recommendation: result.confidence >= 0.8
          ? `High confidence: Detected as ${result.format}`
          : result.confidence >= 0.5
            ? `Medium confidence: Likely ${result.format}, please verify`
            : `Low confidence: Best guess is ${result.format}, consider manual format selection`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to detect format: ${errorMessage}` };
    }
  }
);

/**
 * parse_script tool - Parse script and extract segments.
 */
export const parseScriptTool: ToolDefinition = createTool(
  'parse_script',
  `Parse a script and extract segments with timing information.

This tool:
1. Auto-detects the script format (or uses specified format)
2. Extracts segments (dialogue, narration, action, etc.)
3. Preserves timing information if available
4. Stores parsed segments in the project

Use detect_script_format first if you want to preview the format before parsing.`,
  {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The script content to parse',
      },
      file_path: {
        type: 'string',
        description: 'Alternative: path to a script file to read',
      },
      format: {
        type: 'string',
        enum: ['srt', 'vtt', 'screenplay', 'timestamped_text', 'plain_text', 'auto_detect'],
        description: 'Script format (default: auto_detect)',
      },
    },
    required: [],
  },
  async (args) => {
    let content = args.content as string | undefined;
    const filePath = args.file_path as string | undefined;
    const format = (args.format as ScriptFormat) || 'auto_detect';

    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    // Read from file if path provided
    if (!content && filePath) {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `Script file not found: ${filePath}` };
      }
      content = fs.readFileSync(filePath, 'utf-8');
    }

    if (!content) {
      return { success: false, error: 'Either content or file_path is required' };
    }

    try {
      // Parse the script
      const segments = scriptParser.parse(content, {
        format: format === 'auto_detect' ? undefined : format,
        extractKeywords: true,
      });

      // Detect the actual format used
      const detectedFormat = format === 'auto_detect'
        ? scriptParser.detectFormat(content).format
        : format;

      // Save to project
      setScript(project, content, detectedFormat, filePath);
      setScriptSegments(project, segments);

      // Count segment types
      const typeCounts: Record<string, number> = {};
      for (const seg of segments) {
        typeCounts[seg.type] = (typeCounts[seg.type] || 0) + 1;
      }

      // Count segments with timing
      const timedSegments = segments.filter(s => s.timeRange).length;

      return {
        success: true,
        format: detectedFormat,
        segmentCount: segments.length,
        timedSegments,
        segmentTypes: typeCounts,
        preview: segments.slice(0, 3).map(s => ({
          index: s.index,
          type: s.type,
          text: s.text.substring(0, 100) + (s.text.length > 100 ? '...' : ''),
          timeRange: s.timeRange,
        })),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to parse script: ${errorMessage}` };
    }
  }
);

/**
 * transcribe_video tool - Extract and transcribe audio from video.
 */
export const transcribeVideoTool: ToolDefinition = createTool(
  'transcribe_video',
  `Extract audio from the source video and transcribe it to text with timestamps.

This tool:
1. Extracts audio from the source video (16kHz mono for optimal speech recognition)
2. Uses Google Gemini AI to transcribe the audio
3. Returns segments with timestamps that can be used as the script

Requirements:
- GOOGLE_API_KEY environment variable must be set
- Video must be imported first (run import_video)
- FFmpeg must be available on the system

This is an alternative to providing a script file - useful when you want to generate
the script from the video's actual audio track.`,
  {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Language hint (e.g., "en", "es", "fr"). Auto-detects if not specified.',
      },
      max_segment_seconds: {
        type: 'number',
        description: 'Maximum segment duration in seconds (default: 30)',
      },
      time_range_start: {
        type: 'string',
        description: 'Optional: Start time to transcribe from (MM:SS or HH:MM:SS)',
      },
      time_range_end: {
        type: 'string',
        description: 'Optional: End time to transcribe to (MM:SS or HH:MM:SS)',
      },
    },
    required: [],
  },
  async (args) => {
    const language = args.language as string | undefined;
    const maxSegmentSeconds = (args.max_segment_seconds as number) ?? 30;
    const timeRangeStart = args.time_range_start as string | undefined;
    const timeRangeEnd = args.time_range_end as string | undefined;

    // Check if transcription service is configured
    if (!transcriptionService.isConfigured()) {
      return {
        success: false,
        error: 'GOOGLE_API_KEY environment variable not set. Required for audio transcription.',
      };
    }

    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found. Use import_video first.' };
    }

    if (!project.source.path) {
      return { success: false, error: 'No source video. Use import_video first.' };
    }

    const videoPath = project.source.path;
    if (!fs.existsSync(videoPath)) {
      return { success: false, error: `Source video not found: ${videoPath}` };
    }

    try {
      // Create temp directory for audio extraction
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-'));
      const audioPath = path.join(tempDir, 'audio.wav');

      // Build time range options if specified
      let timeRange: TimeRange | undefined;
      if (timeRangeStart && timeRangeEnd) {
        timeRange = {
          startMs: parseTimeToMs(timeRangeStart),
          endMs: parseTimeToMs(timeRangeEnd),
        };
      }

      // Extract audio from video
      await ffmpegService.extractAudio(videoPath, audioPath, {
        format: 'wav',
        sampleRate: 16000, // Optimal for speech recognition
        channels: 1, // Mono
        timeRange,
      });

      // Verify audio was extracted
      if (!fs.existsSync(audioPath)) {
        return { success: false, error: 'Failed to extract audio from video' };
      }

      // Get audio duration for reference
      const audioDurationMs = await ffmpegService.getAudioDuration(audioPath);

      // Transcribe the audio
      const transcriptionResult = await transcriptionService.transcribe(audioPath, {
        language,
        includeTimestamps: true,
        maxSegmentDurationMs: maxSegmentSeconds * 1000,
      });

      // Clean up temp files
      try {
        fs.unlinkSync(audioPath);
        fs.rmdirSync(tempDir);
      } catch {
        // Ignore cleanup errors
      }

      if (!transcriptionResult.success) {
        return {
          success: false,
          error: transcriptionResult.error ?? 'Transcription failed',
        };
      }

      // Adjust timestamps if time range was specified
      let segments = transcriptionResult.segments ?? [];
      if (timeRange && segments.length > 0) {
        // Offset timestamps by the start time
        segments = segments.map(seg => ({
          ...seg,
          timeRange: seg.timeRange
            ? {
                startMs: seg.timeRange.startMs + timeRange.startMs,
                endMs: seg.timeRange.endMs + timeRange.startMs,
              }
            : undefined,
        }));
      }

      // Store the transcription as the script
      const transcriptionText = transcriptionResult.text ?? segments.map(s => s.text).join(' ');
      setScript(project, transcriptionText, 'plain_text');
      setScriptSegments(project, segments);

      // Count segments with timing
      const timedSegments = segments.filter(s => s.timeRange).length;

      return {
        success: true,
        message: 'Video transcribed successfully',
        segmentCount: segments.length,
        timedSegments,
        durationMs: transcriptionResult.durationMs ?? audioDurationMs,
        language: transcriptionResult.language ?? 'auto-detected',
        preview: segments.slice(0, 3).map(s => ({
          index: s.index,
          text: s.text.substring(0, 100) + (s.text.length > 100 ? '...' : ''),
          timeRange: s.timeRange
            ? {
                start: formatMsToTime(s.timeRange.startMs),
                end: formatMsToTime(s.timeRange.endMs),
              }
            : undefined,
        })),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Transcription failed: ${errorMessage}` };
    }
  }
);

/**
 * align_script_to_video tool - Align parsed script segments to video timecodes.
 */
export const alignScriptToVideoTool: ToolDefinition = createTool(
  'align_script_to_video',
  `Align parsed script segments to video timecodes.

This tool:
1. Uses existing timestamps from the script if available
2. For untimed segments, distributes them evenly across the video duration
3. Updates segment timeRanges in the project

Run parse_script first to extract segments.`,
  {
    type: 'object',
    properties: {
      strategy: {
        type: 'string',
        enum: ['preserve', 'distribute', 'proportional'],
        description: `Alignment strategy:
- preserve: Keep existing timestamps, only fill gaps (default)
- distribute: Distribute all segments evenly
- proportional: Distribute based on text length`,
      },
    },
    required: [],
  },
  async (args) => {
    const strategy = (args.strategy as string) || 'preserve';

    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    if (!project.script.segments || project.script.segments.length === 0) {
      return { success: false, error: 'No script segments found. Run parse_script first.' };
    }

    if (!project.source.metadata) {
      return { success: false, error: 'No video metadata. Run extract_metadata first.' };
    }

    const videoDurationMs = project.source.metadata.durationMs;

    try {
      let segments = [...project.script.segments];

      switch (strategy) {
        case 'preserve': {
          // Use the scriptParser's alignment
          const result = scriptParser.alignToVideo(segments, videoDurationMs);
          segments = result.alignedSegments;
          break;
        }

        case 'distribute': {
          // Distribute segments evenly across video duration
          const segmentDuration = videoDurationMs / segments.length;
          segments = segments.map((seg, i) => ({
            ...seg,
            timeRange: {
              startMs: Math.round(i * segmentDuration),
              endMs: Math.round((i + 1) * segmentDuration),
            },
          }));
          break;
        }

        case 'proportional': {
          // Distribute based on text length
          const totalLength = segments.reduce((sum, s) => sum + s.text.length, 0);
          let currentTime = 0;
          segments = segments.map((seg) => {
            const proportion = seg.text.length / totalLength;
            const duration = videoDurationMs * proportion;
            const startMs = Math.round(currentTime);
            currentTime += duration;
            return {
              ...seg,
              timeRange: {
                startMs,
                endMs: Math.round(currentTime),
              },
            };
          });
          break;
        }
      }

      // Save aligned segments
      setScriptSegments(project, segments);

      // Count aligned segments
      const alignedCount = segments.filter(s => s.timeRange).length;

      return {
        success: true,
        strategy,
        totalSegments: segments.length,
        alignedSegments: alignedCount,
        videoDurationMs,
        preview: segments.slice(0, 3).map(s => ({
          index: s.index,
          text: s.text.substring(0, 50) + '...',
          timeRange: s.timeRange,
        })),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to align script: ${errorMessage}` };
    }
  }
);

/**
 * add_user_hint tool - Add a user enhancement hint at a specific timecode.
 */
export const addUserHintTool: ToolDefinition = createTool(
  'add_user_hint',
  `Add a user enhancement hint at a specific timecode.

User hints are suggestions from the user about where and what enhancements should be added.
These are combined with AI suggestions during the enhancement planning phase.

Hints can specify:
- Time range where enhancement should appear
- Type of enhancement (image, video clip, motion graphic, music, sfx)
- Description of what should be shown/played`,
  {
    type: 'object',
    properties: {
      start_time: {
        type: 'string',
        description: 'Start time (MM:SS or HH:MM:SS format)',
      },
      end_time: {
        type: 'string',
        description: 'End time (MM:SS or HH:MM:SS format)',
      },
      enhancement_type: {
        type: 'string',
        enum: ['ai_image', 'ai_video_clip', 'motion_graphic', 'audio_music', 'audio_sfx'],
        description: 'Type of enhancement',
      },
      composition_mode: {
        type: 'string',
        enum: ['pip_overlay', 'broll_cut', 'split_screen', 'lower_third', 'full_overlay'],
        description: 'How the enhancement should be composed (default: broll_cut)',
      },
      description: {
        type: 'string',
        description: 'Description of what the enhancement should show/play',
      },
      prompt: {
        type: 'string',
        description: 'Optional: specific prompt for AI generation',
      },
    },
    required: ['start_time', 'end_time', 'enhancement_type', 'description'],
  },
  async (args) => {
    const startTime = args.start_time as string;
    const endTime = args.end_time as string;
    const enhancementType = args.enhancement_type as EnhancementType;
    const compositionMode = (args.composition_mode as CompositionMode) || 'broll_cut';
    const description = args.description as string;
    const prompt = args.prompt as string | undefined;

    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    try {
      // Parse time strings to milliseconds
      const startMs = parseTimeToMs(startTime);
      const endMs = parseTimeToMs(endTime);

      if (startMs >= endMs) {
        return { success: false, error: 'End time must be after start time' };
      }

      // Validate against video duration if available
      if (project.source.metadata) {
        const videoDuration = project.source.metadata.durationMs;
        if (endMs > videoDuration) {
          return {
            success: false,
            error: `End time (${endTime}) exceeds video duration (${formatMsToTime(videoDuration)})`,
          };
        }
      }

      // Find associated script segment
      const scriptSegmentId = findScriptSegmentAtTime(project.script.segments, startMs);

      // Create enhancement suggestion
      const enhancement: EnhancementSuggestion = {
        id: `hint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: enhancementType,
        compositionMode,
        timeRange: { startMs, endMs },
        source: 'user_hint',
        confidence: 1.0,
        description,
        prompt,
        userHint: description,
        scriptSegmentId,
        approvalStatus: 'pending',
        regenerationCount: 0,
      };

      // Add to project
      addEnhancement(project, enhancement);

      return {
        success: true,
        enhancementId: enhancement.id,
        timeRange: {
          start: formatMsToTime(startMs),
          end: formatMsToTime(endMs),
        },
        type: enhancementType,
        compositionMode,
        description,
        scriptSegmentId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to add hint: ${errorMessage}` };
    }
  }
);

/**
 * complete_script_parse tool - Mark the script parsing phase as complete.
 */
export const completeScriptParseTool: ToolDefinition = createTool(
  'complete_script_parse',
  `Mark the script parsing phase as complete.

This transitions the project to the ANALYSIS phase.
Ensure script has been parsed and optionally aligned before calling this.`,
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

    // Validate script parsing is complete
    if (!project.script.segments || project.script.segments.length === 0) {
      return { success: false, error: 'No script segments found. Use parse_script first.' };
    }

    // Mark phase as complete
    updatePhaseStatus(project, 'script_parse', 'completed');

    return {
      success: true,
      message: 'Script parsing phase completed. Ready for content analysis.',
      nextPhase: 'analysis',
      segmentCount: project.script.segments.length,
    };
  }
);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse time string (MM:SS or HH:MM:SS) to milliseconds.
 */
function parseTimeToMs(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);

  if (parts.length === 2) {
    // MM:SS
    const [minutes, seconds] = parts;
    return ((minutes ?? 0) * 60 + (seconds ?? 0)) * 1000;
  } else if (parts.length === 3) {
    // HH:MM:SS
    const [hours, minutes, seconds] = parts;
    return ((hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)) * 1000;
  }

  throw new Error(`Invalid time format: ${timeStr}. Use MM:SS or HH:MM:SS`);
}

/**
 * Format milliseconds to time string (MM:SS or HH:MM:SS).
 */
function formatMsToTime(ms: number): string {
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
 * Find the script segment that contains a given timestamp.
 */
function findScriptSegmentAtTime(segments: ScriptSegment[], timeMs: number): string | undefined {
  for (const segment of segments) {
    if (segment.timeRange) {
      if (timeMs >= segment.timeRange.startMs && timeMs <= segment.timeRange.endMs) {
        return segment.id;
      }
    }
  }
  return undefined;
}

// ============================================================================
// Export all script tools
// ============================================================================

export const scriptTools: ToolDefinition[] = [
  detectScriptFormatTool,
  parseScriptTool,
  transcribeVideoTool,
  alignScriptToVideoTool,
  addUserHintTool,
  completeScriptParseTool,
];
