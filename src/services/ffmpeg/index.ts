/**
 * FFmpeg service exports.
 */

import { FFmpegService } from './FFmpegService.js';

export { FFmpegService } from './FFmpegService.js';
export type {
  ThumbnailOptions,
  PIPOptions,
  SplitScreenOptions,
  LowerThirdOptions,
  ProgressCallback,
} from './FFmpegService.js';

// Singleton instance for convenience
export const ffmpegService = new FFmpegService();
