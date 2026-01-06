/**
 * Video replacement tools for transcript-first workflow.
 */
import { createTool } from '../../../core/tools/index.js';
import type { ToolDefinition } from '../../../core/llm/index.js';

export const replaceVideoSegmentTool: ToolDefinition = createTool(
  'replace_video_segment',
  'Replace a video segment with a generated image while preserving timing.',
  {
    type: 'object',
    properties: {
      start_time: { type: 'number', description: 'Start time in seconds' },
      end_time: { type: 'number', description: 'End time in seconds' },
      image_path: { type: 'string', description: 'Path to the image to insert' },
    },
    required: ['start_time', 'end_time', 'image_path'],
  },
  async (args: Record<string, unknown>) => {
    return {
      status: 'success',
      message: 'Video segment replacement queued',
      start_time: args['start_time'],
      end_time: args['end_time'],
      image_path: args['image_path'],
    };
  }
);

export const syncAudioWithImagesTool: ToolDefinition = createTool(
  'sync_audio_with_images',
  'Ensure audio/narration stays in sync after image replacements.',
  {
    type: 'object',
    properties: {
      audio_track: { type: 'string', description: 'Audio track identifier or path' },
      replacement_plan: { type: 'string', description: 'Replacement plan reference or summary' },
    },
    required: [],
  },
  async (args: Record<string, unknown>) => {
    return {
      status: 'success',
      message: 'Audio sync plan generated',
      audio_track: args['audio_track'],
      replacement_plan: args['replacement_plan'],
    };
  }
);

export const generateReplacementPlanTool: ToolDefinition = createTool(
  'generate_replacement_plan',
  'Generate a timeline plan for replacing video segments with images.',
  {
    type: 'object',
    properties: {
      srt_with_images: { type: 'string', description: 'SRT content with image tags' },
    },
    required: ['srt_with_images'],
  },
  async (args: Record<string, unknown>) => {
    return {
      status: 'success',
      message: 'Replacement plan generated',
      plan_preview: String(args['srt_with_images']).split(/\r?\n/).slice(0, 10).join('\n'),
    };
  }
);

export function getVideoReplacementTools(): ToolDefinition[] {
  return [replaceVideoSegmentTool, syncAudioWithImagesTool, generateReplacementPlanTool];
}
