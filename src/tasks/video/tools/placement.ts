/**
 * Image placement tools for transcript-first workflow.
 */
import { createTool } from '../../../core/tools/index.js';
import type { ToolDefinition } from '../../../core/llm/index.js';
import { loadProject, saveProject } from '../workflow/ProjectManager.js';
import type { ImagePlacement } from '../workflow/types.js';
import { validateSinglePlacementAgainstExisting } from '../workflow/PlacementValidator.js';

export const createImagePlacementTool: ToolDefinition = createTool(
  'create_image_placement',
  'Create a new image placement entry aligned to a transcript index.',
  {
    type: 'object',
    properties: {
      transcript_index: { type: 'number', description: 'Transcript entry index' },
      start_time: { type: 'number', description: 'Start time in seconds' },
      end_time: { type: 'number', description: 'End time in seconds' },
      image_prompt: { type: 'string', description: 'Prompt for the image' },
    },
    required: ['transcript_index', 'start_time', 'end_time', 'image_prompt'],
  },
  async (args: Record<string, unknown>) => {
    const project = loadProject();
    if (!project) {
      return { status: 'error', error: 'No project found' };
    }

    const validation = validateSinglePlacementAgainstExisting({
      placementType: 'image',
      placementNumber: Number(args['transcript_index']),
      startTimeSeconds: Number(args['start_time']),
      endTimeSeconds: Number(args['end_time']),
      existing: [
        ...(project.imagePlacements ?? []).map((p) => ({
          placementType: 'image' as const,
          placementNumber: p.transcriptIndex,
          startTimeSeconds: p.startTime,
          endTimeSeconds: p.endTime,
        })),
        ...(project.videoPlacements ?? []).map((p) => ({
          placementType: 'video' as const,
          placementNumber: p.transcriptIndex,
          startTimeSeconds: p.startTime,
          endTimeSeconds: p.endTime,
        })),
        ...(project.infographicPlacements ?? []).map((p) => ({
          placementType: 'infographic' as const,
          placementNumber: p.transcriptIndex,
          startTimeSeconds: p.startTime,
          endTimeSeconds: p.endTime,
        })),
      ],
    });

    if (!validation.accepted) {
      return {
        status: 'error',
        error: 'Placement overlaps existing placements and cannot be adjusted without becoming too short.',
        warnings: validation.warnings,
      };
    }

    const placement: ImagePlacement = {
      transcriptIndex: Number(args['transcript_index']),
      startTime: validation.startTimeSeconds,
      endTime: validation.endTimeSeconds,
      imagePrompt: String(args['image_prompt']),
    };

    if (!project.imagePlacements) {
      project.imagePlacements = [];
    }
    project.imagePlacements.push(placement);
    saveProject(project);

    return { status: 'success', placement, warnings: validation.warnings };
  }
);

export const updateImagePlacementTool: ToolDefinition = createTool(
  'update_image_placement',
  'Update an existing image placement entry with generated image data.',
  {
    type: 'object',
    properties: {
      transcript_index: { type: 'number', description: 'Transcript entry index' },
      image_prompt: { type: 'string', description: 'Updated prompt for the image' },
      image_path: { type: 'string', description: 'Path to generated image file' },
      image_artifact_id: { type: 'string', description: 'Artifact ID for generated image' },
    },
    required: ['transcript_index'],
  },
  async (args: Record<string, unknown>) => {
    const project = loadProject();
    if (!project || !project.imagePlacements) {
      return { status: 'error', error: 'No project or placements found' };
    }

    const transcriptIndex = Number(args['transcript_index']);
    const placement = project.imagePlacements.find(p => p.transcriptIndex === transcriptIndex);
    if (!placement) {
      return { status: 'error', error: `No placement found for transcript index ${transcriptIndex}` };
    }

    if (args['image_prompt']) {
      placement.imagePrompt = String(args['image_prompt']);
    }
    if (args['image_path']) {
      placement.imagePath = String(args['image_path']);
    }
    if (args['image_artifact_id']) {
      placement.imageArtifactId = String(args['image_artifact_id']);
    }

    saveProject(project);
    return { status: 'success', placement };
  }
);

export const getPlacementsByTimeTool: ToolDefinition = createTool(
  'get_placements_by_time',
  'Get image placements that overlap a specific time range.',
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
    if (!project || !project.imagePlacements) {
      return { status: 'error', error: 'No project or placements found' };
    }

    const time = args['time_seconds'] as number | undefined;
    const start = args['start_time'] as number | undefined;
    const end = args['end_time'] as number | undefined;

    const placements = project.imagePlacements.filter(p => {
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

export function getPlacementTools(): ToolDefinition[] {
  return [createImagePlacementTool, updateImagePlacementTool, getPlacementsByTimeTool];
}
