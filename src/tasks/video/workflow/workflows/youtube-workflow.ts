/**
 * YouTube Workflow Definition
 * 
 * Self-contained workflow for YouTube/documentary video generation.
 * This is the ACTIVE workflow - the only one currently in use.
 * 
 * Phases:
 * 1. TRANSCRIPT_INPUT - Accept and parse SRT transcript
 * 2. CONTENT_PLANNING - Create content plan for visual placements
 * 3. IMAGE_PLACEMENT - Map images to transcript timestamps
 * 4. IMAGE_GENERATION - Generate images for placements
 * 5. VIDEO_PLACEMENT - Map videos to transcript timestamps
 * 6. VIDEO_GENERATION - Generate videos for placements
 * 7. VIDEO_REPLACEMENT - Replace video segments with images
 * 8. VIDEO_COMBINE - Stitch everything together
 * 9. COMPLETED - Workflow complete
 */

import { WorkflowPhase, type PhaseConfig, type AgentType, type ItemProcessMode } from '../types.js';

/**
 * YouTube workflow phases in execution order.
 * These are the ONLY phases that exist in the YouTube workflow.
 */
export const YOUTUBE_PHASES: WorkflowPhase[] = [
  WorkflowPhase.TRANSCRIPT_INPUT,
  WorkflowPhase.CONTENT_PLANNING,
  WorkflowPhase.IMAGE_PLACEMENT,
  WorkflowPhase.IMAGE_GENERATION,
  WorkflowPhase.INFOGRAPHICS_PLACEMENT,
  WorkflowPhase.INFOGRAPHICS_GENERATION,
  WorkflowPhase.VIDEO_PLACEMENT,
  WorkflowPhase.VIDEO_GENERATION,
  // VIDEO_REPLACEMENT and VIDEO_COMBINE skipped for now
  WorkflowPhase.COMPLETED,
];

/**
 * Phase configurations for YouTube workflow.
 * Only includes phases that exist in the YouTube workflow.
 */
export const YOUTUBE_PHASE_CONFIGS: Record<WorkflowPhase, PhaseConfig> = {
  [WorkflowPhase.TRANSCRIPT_INPUT]: {
    phase: WorkflowPhase.TRANSCRIPT_INPUT,
    displayName: 'Transcript Input',
    nextPhase: WorkflowPhase.CONTENT_PLANNING,
    promptFile: 'transcript-input',
    agentType: 'content',
    allowedTools: [
      'think',
      'ask_user',
      'read_file',
      'write_file',
      'read_project',
      'update_project',
      'read_transcript',
      'validate_srt',
      'parse_srt',
      'Task',
    ],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Accept raw SRT text, validate and parse transcript entries',
  },

  [WorkflowPhase.CONTENT_PLANNING]: {
    phase: WorkflowPhase.CONTENT_PLANNING,
    displayName: 'Content Planning',
    nextPhase: WorkflowPhase.IMAGE_PLACEMENT,
    promptFile: 'content-planning',
    agentType: 'planning',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'Task'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Create content plan for visual placements',
  },

  [WorkflowPhase.IMAGE_PLACEMENT]: {
    phase: WorkflowPhase.IMAGE_PLACEMENT,
    displayName: 'Image Placement',
    nextPhase: WorkflowPhase.IMAGE_GENERATION,
    promptFile: 'image-placement',
    agentType: 'content',
    allowedTools: [
      'think',
      'ask_user',
      'read_file',
      'write_file',
      'read_project',
      'update_project',
      'write_placement_plan',
      'create_image_placement',
      'update_image_placement',
      'Task',
    ],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Map placements to transcript timestamps and prepare image prompts',
  },

  [WorkflowPhase.IMAGE_GENERATION]: {
    phase: WorkflowPhase.IMAGE_GENERATION,
    displayName: 'Image Generation',
    nextPhase: WorkflowPhase.INFOGRAPHICS_PLACEMENT,
    promptFile: 'image-generation',
    agentType: 'image',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'dispatch_image_agent', 'generate_image', 'wait_for_job', 'todo_write'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: true,
    description: 'Generate documentary-style images for planned placements',
  },

  [WorkflowPhase.INFOGRAPHICS_PLACEMENT]: {
    phase: WorkflowPhase.INFOGRAPHICS_PLACEMENT,
    displayName: 'Infographics Placement',
    nextPhase: WorkflowPhase.INFOGRAPHICS_GENERATION,
    promptFile: 'infographic-placement',
    agentType: 'content',
    allowedTools: [
      'think',
      'ask_user',
      'read_file',
      'write_file',
      'read_project',
      'update_project',
      'write_infographic_placement_plan',
      'Task',
    ],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Map infographics to transcript timestamps (charts, diagrams, statistics)',
  },

  [WorkflowPhase.INFOGRAPHICS_GENERATION]: {
    phase: WorkflowPhase.INFOGRAPHICS_GENERATION,
    displayName: 'Infographics Generation',
    nextPhase: WorkflowPhase.VIDEO_PLACEMENT,
    promptFile: 'infographic-generation',
    agentType: 'image',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'generate_all_infographics', 'wait_for_job', 'todo_write'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: true,
    description: 'Generate infographics via Remotion (charts, diagrams, data viz)',
  },

  [WorkflowPhase.VIDEO_PLACEMENT]: {
    phase: WorkflowPhase.VIDEO_PLACEMENT,
    displayName: 'Video Placement',
    nextPhase: WorkflowPhase.VIDEO_GENERATION,
    promptFile: 'video-placement',
    agentType: 'video',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'Task', 'todo_write'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Identify moments for video generation (distinct from image placements)',
  },

  [WorkflowPhase.VIDEO_GENERATION]: {
    phase: WorkflowPhase.VIDEO_GENERATION,
    displayName: 'Video Generation',
    nextPhase: WorkflowPhase.COMPLETED, // Skipping VIDEO_REPLACEMENT and VIDEO_COMBINE for now
    promptFile: 'video-generation',
    agentType: 'video',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'generate_all_videos', 'generate_video', 'wait_for_job', 'todo_write'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: true,
    description: 'Generate AI videos for planned placements',
  },

  [WorkflowPhase.VIDEO_REPLACEMENT]: {
    phase: WorkflowPhase.VIDEO_REPLACEMENT,
    displayName: 'Video Replacement',
    nextPhase: WorkflowPhase.VIDEO_COMBINE,
    promptFile: 'video-replacement',
    agentType: 'video',
    allowedTools: [
      'think',
      'ask_user',
      'read_file',
      'write_file',
      'read_project',
      'update_project',
      'generate_replacement_plan',
      'replace_video_segment',
      'sync_audio_with_images',
      'Task',
    ],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: true,
    description: 'Replace video segments with generated images',
  },

  [WorkflowPhase.VIDEO_COMBINE]: {
    phase: WorkflowPhase.VIDEO_COMBINE,
    displayName: 'Video Stitching',
    nextPhase: WorkflowPhase.COMPLETED,
    promptFile: 'video-combine',
    agentType: 'video',
    allowedTools: ['think', 'ask_user', 'read_file', 'read_project', 'update_project', 'stitch_videos', 'wait_for_job'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: true,
    description: 'Stitch all scene videos into final video',
  },

  [WorkflowPhase.COMPLETED]: {
    phase: WorkflowPhase.COMPLETED,
    displayName: 'Completed',
    nextPhase: null,
    promptFile: 'completed',
    agentType: 'planning',
    allowedTools: ['think', 'read_file', 'read_project'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Workflow complete - present final video to user',
  },
} as Record<WorkflowPhase, PhaseConfig>;

/**
 * Get the next phase in the YouTube workflow.
 * Returns null if already at the last phase.
 */
export function getNextYouTubePhase(currentPhase: WorkflowPhase): WorkflowPhase | null {
  const currentIndex = YOUTUBE_PHASES.indexOf(currentPhase);
  
  if (currentIndex >= 0 && currentIndex < YOUTUBE_PHASES.length - 1) {
    const nextIndex = currentIndex + 1;
    const nextPhase = YOUTUBE_PHASES[nextIndex];
    if (nextPhase !== undefined) {
      if (
        currentPhase === WorkflowPhase.IMAGE_GENERATION &&
        nextPhase !== WorkflowPhase.INFOGRAPHICS_PLACEMENT
      ) {
        console.error(
          `[youtube-workflow] Phase invariant violated: expected ${WorkflowPhase.INFOGRAPHICS_PLACEMENT} after ${WorkflowPhase.IMAGE_GENERATION}, got ${nextPhase}.`,
        );
        return WorkflowPhase.INFOGRAPHICS_PLACEMENT;
      }
      return nextPhase;
    }
  }
  
  return null; // Already at last phase or phase not in YouTube workflow
}

/**
 * Check if a phase is part of the YouTube workflow.
 */
export function isYouTubePhase(phase: WorkflowPhase): boolean {
  return YOUTUBE_PHASES.includes(phase);
}

/**
 * Get phase configuration for a YouTube workflow phase.
 * Returns undefined if the phase is not part of the YouTube workflow.
 */
export function getYouTubePhaseConfig(phase: WorkflowPhase): PhaseConfig | undefined {
  if (!isYouTubePhase(phase)) {
    return undefined;
  }
  return YOUTUBE_PHASE_CONFIGS[phase];
}
