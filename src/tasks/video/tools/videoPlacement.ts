/**
 * Video placement tools for transcript-first workflow.
 */
import { createTool } from '../../../core/tools/index.js';
import type { ToolDefinition } from '../../../core/llm/index.js';
import { loadProject, saveProject } from '../workflow/ProjectManager.js';
import type { VideoPlacement } from '../workflow/types.js';

export const createVideoPlacementTool: ToolDefinition = createTool(
  'create_video_placement',
  'Create a new video placement entry aligned to a transcript index.',
  {
    type: 'object',
    properties: {
      transcript_index: { type: 'number', description: 'Transcript entry index' },
      start_time: { type: 'number', description: 'Start time in seconds' },
      end_time: { type: 'number', description: 'End time in seconds' },
      video_prompt: { type: 'string', description: 'Prompt for the video' },
      video_type: { 
        type: 'string', 
        enum: ['animation', 'stock_footage', 'motion_graphics'],
        description: 'Type of video: animation, stock_footage, or motion_graphics'
      },
    },
    required: ['transcript_index', 'start_time', 'end_time', 'video_prompt', 'video_type'],
  },
  async (args: Record<string, unknown>) => {
    const project = loadProject();
    if (!project) {
      return { status: 'error', error: 'No project found' };
    }

    const startTime = Number(args['start_time']);
    const endTime = Number(args['end_time']);

    const placement: VideoPlacement = {
      transcriptIndex: Number(args['transcript_index']),
      startTime,
      endTime,
      videoPrompt: String(args['video_prompt']),
      videoType: String(args['video_type']) as VideoPlacement['videoType'],
      videoDuration: endTime - startTime,
    };

    if (!project.videoPlacements) {
      project.videoPlacements = [];
    }
    project.videoPlacements.push(placement);
    saveProject(project);

    return { status: 'success', placement };
  }
);

export const updateVideoPlacementTool: ToolDefinition = createTool(
  'update_video_placement',
  'Update an existing video placement entry with generated video data.',
  {
    type: 'object',
    properties: {
      transcript_index: { type: 'number', description: 'Transcript entry index' },
      video_prompt: { type: 'string', description: 'Updated prompt for the video' },
      video_path: { type: 'string', description: 'Path to generated video file' },
      video_artifact_id: { type: 'string', description: 'Artifact ID for generated video' },
    },
    required: ['transcript_index'],
  },
  async (args: Record<string, unknown>) => {
    const project = loadProject();
    if (!project || !project.videoPlacements) {
      return { status: 'error', error: 'No project or placements found' };
    }

    const transcriptIndex = Number(args['transcript_index']);
    const placement = project.videoPlacements.find(p => p.transcriptIndex === transcriptIndex);
    if (!placement) {
      return { status: 'error', error: `No placement found for transcript index ${transcriptIndex}` };
    }

    if (args['video_prompt']) {
      placement.videoPrompt = String(args['video_prompt']);
    }
    if (args['video_path']) {
      placement.videoPath = String(args['video_path']);
    }
    if (args['video_artifact_id']) {
      placement.videoArtifactId = String(args['video_artifact_id']);
    }

    saveProject(project);
    return { status: 'success', placement };
  }
);

export const getVideoPlacementsByTimeTool: ToolDefinition = createTool(
  'get_video_placements_by_time',
  'Get video placements that overlap a specific time range.',
  {
    type: 'object',
    properties: {
      time_seconds: { type: 'number', description: 'Timestamp in seconds' },
      start_time: { type: 'number', description: 'Start time in seconds' },
      end_time: { type: 'number', description: 'End time in seconds' },
    },
    required: [],
  },
  async (args: Record<string, unknown>) => {
    const project = loadProject();
    if (!project || !project.videoPlacements) {
      return { status: 'error', error: 'No project or placements found' };
    }

    const time = args['time_seconds'] as number | undefined;
    const start = args['start_time'] as number | undefined;
    const end = args['end_time'] as number | undefined;

    const placements = project.videoPlacements.filter(p => {
      if (time !== undefined) {
        return time >= p.startTime && time <= p.endTime;
      }
      if (start !== undefined && end !== undefined) {
        return p.startTime <= end && p.endTime >= start;
      }
      return false;
    });

    return { status: 'success', placements };
  }
);

export function getVideoPlacementTools(): ToolDefinition[] {
  return [createVideoPlacementTool, updateVideoPlacementTool, getVideoPlacementsByTimeTool];
}
