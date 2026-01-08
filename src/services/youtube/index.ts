/**
 * YouTube service exports.
 */

export {
  YouTubeClient,
  getYouTubeClient,
  extractVideoId,
  type TranscriptSegment,
  type TranscriptResult,
  type YouTubeClientOptions,
} from './YouTubeClient.js';

export { fetchYouTubeTranscriptTool } from './tools.js';