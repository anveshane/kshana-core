/**
 * YouTube integration tools.
 */
import { createTool } from '../../core/tools/index.js';
import type { ToolDefinition } from '../../core/llm/index.js';
import { getYouTubeClient, extractVideoId } from './YouTubeClient.js';

/**
 * Fetch YouTube transcript tool.
 * Extracts transcript/captions from a YouTube video.
 */
export const fetchYouTubeTranscriptTool: ToolDefinition = createTool(
  'fetch_youtube_transcript',
  `Extract the transcript (captions/subtitles) from a YouTube video.

**IMPORTANT: ORCHESTRATOR DO NOT USE THIS TOOL DIRECTLY.**
Instead, use \`Task(subagent_type: 'transcript-extractor', ...)\` to handle transcript extraction, processing, and saving.
This tool is intended for use ONLY by the \`transcript-extractor\` sub-agent.

**Input:** YouTube URL or video ID
**Output:** Full transcript text, video metadata, and optionally timestamped segments

**Supported URL formats:**
- https://www.youtube.com/watch?v=VIDEO_ID
- https://youtu.be/VIDEO_ID
- Just the VIDEO_ID (11 characters)

**Note:** Only works for videos that have captions (auto-generated or manual).`,
  {
    type: 'object',
    properties: {
      youtube_url: {
        type: 'string',
        description: 'YouTube URL or video ID to extract transcript from',
      },
      include_timestamps: {
        type: 'boolean',
        description: 'Whether to include timestamps in the output (default: false)',
      },
      language: {
        type: 'string',
        description: 'Preferred language code for transcript (e.g., "en", "es"). Uses default if not specified.',
      },
    },
    required: ['youtube_url'],
  },
  async (args) => {
    const youtubeUrl = args['youtube_url'] as string;
    const includeTimestamps = args['include_timestamps'] as boolean ?? false;
    const language = args['language'] as string | undefined;

    try {
      // Extract video ID for validation
      const videoId = extractVideoId(youtubeUrl);

      // Get YouTube client with optional language preference
      const client = getYouTubeClient(language ? { language } : undefined);

      if (includeTimestamps) {
        // Return transcript with timestamps
        const transcriptWithTimestamps = await client.fetchTranscriptWithTimestamps(youtubeUrl);

        return {
          status: 'success',
          video_id: videoId,
          youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
          format: 'timestamped',
          transcript: transcriptWithTimestamps,
          content: transcriptWithTimestamps, // Add this for UI display
          message: `Successfully extracted timestamped transcript for video ${videoId}`,
        };
      } else {
        // Return full text transcript
        const result = await client.fetchTranscript(youtubeUrl);

        return {
          status: 'success',
          video_id: result.videoId,
          youtube_url: `https://www.youtube.com/watch?v=${result.videoId}`,
          format: 'full_text',
          transcript: result.fullText,
          content: result.fullText, // Add this for UI display
          duration_seconds: result.duration,
          segment_count: result.transcript.length,
          message: `Successfully extracted transcript for video ${result.videoId} (${result.duration} seconds, ${result.transcript.length} segments)`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        status: 'error',
        youtube_url: youtubeUrl,
        error: errorMessage,
        suggestion: errorMessage.includes('No transcript available')
          ? 'This video may not have captions enabled. Try a different video or check if the video has auto-generated captions.'
          : 'Please check the URL is correct and the video is publicly accessible.',
      };
    }
  }
);
