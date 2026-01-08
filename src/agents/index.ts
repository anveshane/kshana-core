/**
 * Specialized agents for different workflows.
 */
export {
  YoutubeTranscriptExtractor,
  createTranscriptExtractor,
  type TranscriptExtractionResult,
  type TranscriptExtractorOptions,
} from './YoutubeTranscriptExtractor.js';

export {
  HighlightsExtractor,
  createHighlightsExtractor,
  type Highlight,
  type HighlightVisual,
  type HighlightNarrative,
  type HighlightsExtractionResult,
  type HighlightsExtractorOptions,
} from './HighlightsExtractor.js';

export { VideoAgent, createVideoAgent, type VideoAgentConfig } from './VideoAgent.js';
