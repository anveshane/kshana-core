/**
 * Enhancement tools for the video editing workflow.
 * Handles enhancement suggestions, approval workflow, and user hints.
 */

import * as path from 'path';
import { createTool } from '../../../core/tools/index.js';
import type { ToolDefinition } from '../../../core/llm/index.js';
import {
  loadProject,
  saveProject,
  addEnhancement,
  updateEnhancementApproval,
  getPendingEnhancements,
  getApprovedEnhancements,
  areAllEnhancementsApproved,
  getProjectDir,
  updatePhaseStatus,
  writeProjectFile,
} from '../workflow/ProjectManager.js';
import type {
  EnhancementSuggestion,
  EnhancementType,
  CompositionMode,
  ItemApprovalStatus,
  ScriptSegment,
} from '../workflow/types.js';

/**
 * suggest_enhancement tool - AI suggests an enhancement for a specific time range.
 */
export const suggestEnhancementTool: ToolDefinition = createTool(
  'suggest_enhancement',
  `Suggest an enhancement for a specific time range in the video.

Creates an AI-generated enhancement suggestion that will be presented to the user for approval.

Enhancement types:
- ai_image: AI-generated still image for B-roll or overlay
- ai_video_clip: Short AI-generated video clip (5-10 seconds)
- motion_graphic: Animated text, lower thirds, infographics
- audio_music: Background music
- audio_sfx: Sound effects

Composition modes:
- pip_overlay: Picture-in-picture (small overlay on video)
- broll_cut: Full replacement (B-roll cut)
- split_screen: Side-by-side or grid layout
- lower_third: Text overlay at bottom of screen
- full_overlay: Full screen overlay with transparency`,
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
      start_ms: {
        type: 'number',
        description: 'Alternative: start time in milliseconds',
      },
      end_ms: {
        type: 'number',
        description: 'Alternative: end time in milliseconds',
      },
      type: {
        type: 'string',
        enum: ['ai_image', 'ai_video_clip', 'motion_graphic', 'audio_music', 'audio_sfx'],
        description: 'Type of enhancement',
      },
      composition_mode: {
        type: 'string',
        enum: ['pip_overlay', 'broll_cut', 'split_screen', 'lower_third', 'full_overlay'],
        description: 'How the enhancement should be composed on the video',
      },
      description: {
        type: 'string',
        description: 'Human-readable description of what this enhancement shows/does',
      },
      prompt: {
        type: 'string',
        description: 'Detailed prompt for AI generation',
      },
      confidence: {
        type: 'number',
        description: 'Confidence score (0-1) for this suggestion (default: 0.7)',
      },
      segment_id: {
        type: 'string',
        description: 'Optional: associated script segment ID',
      },
    },
    required: ['type', 'composition_mode', 'description'],
  },
  async (args) => {
    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    // Parse time range
    let startMs: number;
    let endMs: number;

    if (args.start_ms !== undefined && args.end_ms !== undefined) {
      startMs = args.start_ms as number;
      endMs = args.end_ms as number;
    } else if (args.start_time && args.end_time) {
      startMs = parseTimeToMs(args.start_time as string);
      endMs = parseTimeToMs(args.end_time as string);
    } else {
      return { success: false, error: 'Time range required: provide start_time/end_time or start_ms/end_ms' };
    }

    if (startMs >= endMs) {
      return { success: false, error: 'End time must be after start time' };
    }

    // Validate against video duration
    if (project.source.metadata) {
      if (endMs > project.source.metadata.durationMs) {
        return {
          success: false,
          error: `End time exceeds video duration (${formatMsToTime(project.source.metadata.durationMs)})`,
        };
      }
    }

    const enhancementType = args.type as EnhancementType;
    const compositionMode = args.composition_mode as CompositionMode;
    const description = args.description as string;
    const prompt = args.prompt as string | undefined;
    const confidence = (args.confidence as number) || 0.7;
    const segmentId = args.segment_id as string | undefined;

    // Create enhancement suggestion
    const enhancement: EnhancementSuggestion = {
      id: `enh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: enhancementType,
      compositionMode,
      timeRange: { startMs, endMs },
      source: 'ai_suggested',
      confidence,
      description,
      prompt,
      scriptSegmentId: segmentId,
      approvalStatus: 'pending',
      regenerationCount: 0,
    };

    // Add to project
    addEnhancement(project, enhancement);

    // Update enhancements file
    updateEnhancementsFile(project.enhancements);

    return {
      success: true,
      enhancementId: enhancement.id,
      type: enhancementType,
      compositionMode,
      timeRange: {
        start: formatMsToTime(startMs),
        end: formatMsToTime(endMs),
      },
      description,
      status: 'pending',
      totalPending: getPendingEnhancements(project).length,
    };
  }
);

/**
 * approve_enhancement tool - Mark an enhancement as approved.
 */
export const approveEnhancementTool: ToolDefinition = createTool(
  'approve_enhancement',
  `Approve an enhancement suggestion.

Once approved, the enhancement will be included in asset generation and timeline composition.`,
  {
    type: 'object',
    properties: {
      enhancement_id: {
        type: 'string',
        description: 'ID of the enhancement to approve',
      },
      modified_prompt: {
        type: 'string',
        description: 'Optional: modified prompt if user requested changes',
      },
    },
    required: ['enhancement_id'],
  },
  async (args) => {
    const enhancementId = args.enhancement_id as string;
    const modifiedPrompt = args.modified_prompt as string | undefined;

    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    // Find the enhancement
    const enhancement = project.enhancements.find(e => e.id === enhancementId);
    if (!enhancement) {
      return { success: false, error: `Enhancement not found: ${enhancementId}` };
    }

    // Update prompt if modified
    if (modifiedPrompt) {
      enhancement.prompt = modifiedPrompt;
    }

    // Update approval status
    const updated = updateEnhancementApproval(project, enhancementId, 'approved');
    if (!updated) {
      return { success: false, error: 'Failed to update enhancement approval' };
    }

    // Update enhancements file
    updateEnhancementsFile(project.enhancements);

    const pending = getPendingEnhancements(project);
    const approved = getApprovedEnhancements(project);

    return {
      success: true,
      enhancementId,
      status: 'approved',
      approvedCount: approved.length,
      pendingCount: pending.length,
      allApproved: pending.length === 0,
    };
  }
);

/**
 * reject_enhancement tool - Reject an enhancement with feedback.
 */
export const rejectEnhancementTool: ToolDefinition = createTool(
  'reject_enhancement',
  `Reject an enhancement suggestion with feedback.

Rejected enhancements will not be included in the final video.
Provide feedback to explain why it was rejected.`,
  {
    type: 'object',
    properties: {
      enhancement_id: {
        type: 'string',
        description: 'ID of the enhancement to reject',
      },
      feedback: {
        type: 'string',
        description: 'Reason for rejection',
      },
    },
    required: ['enhancement_id', 'feedback'],
  },
  async (args) => {
    const enhancementId = args.enhancement_id as string;
    const feedback = args.feedback as string;

    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    // Update approval status
    const updated = updateEnhancementApproval(project, enhancementId, 'rejected', feedback);
    if (!updated) {
      return { success: false, error: `Enhancement not found: ${enhancementId}` };
    }

    // Update enhancements file
    updateEnhancementsFile(project.enhancements);

    const pending = getPendingEnhancements(project);

    return {
      success: true,
      enhancementId,
      status: 'rejected',
      feedback,
      pendingCount: pending.length,
    };
  }
);

/**
 * regenerate_enhancement tool - Request regeneration of an enhancement with new parameters.
 */
export const regenerateEnhancementTool: ToolDefinition = createTool(
  'regenerate_enhancement',
  `Request regeneration of an enhancement with modified parameters.

Use this when the user wants to modify an existing suggestion rather than rejecting it entirely.`,
  {
    type: 'object',
    properties: {
      enhancement_id: {
        type: 'string',
        description: 'ID of the enhancement to regenerate',
      },
      new_prompt: {
        type: 'string',
        description: 'New generation prompt',
      },
      new_type: {
        type: 'string',
        enum: ['ai_image', 'ai_video_clip', 'motion_graphic', 'audio_music', 'audio_sfx'],
        description: 'Optional: change the enhancement type',
      },
      new_composition: {
        type: 'string',
        enum: ['pip_overlay', 'broll_cut', 'split_screen', 'lower_third', 'full_overlay'],
        description: 'Optional: change the composition mode',
      },
      feedback: {
        type: 'string',
        description: 'User feedback for the change',
      },
    },
    required: ['enhancement_id'],
  },
  async (args) => {
    const enhancementId = args.enhancement_id as string;
    const newPrompt = args.new_prompt as string | undefined;
    const newType = args.new_type as EnhancementType | undefined;
    const newComposition = args.new_composition as CompositionMode | undefined;
    const feedback = args.feedback as string | undefined;

    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    // Find the enhancement
    const enhancementIndex = project.enhancements.findIndex(e => e.id === enhancementId);
    if (enhancementIndex < 0) {
      return { success: false, error: `Enhancement not found: ${enhancementId}` };
    }

    const enhancement = project.enhancements[enhancementIndex];
    if (!enhancement) {
      return { success: false, error: `Enhancement not found: ${enhancementId}` };
    }

    // Update enhancement properties
    if (newPrompt) enhancement.prompt = newPrompt;
    if (newType) enhancement.type = newType;
    if (newComposition) enhancement.compositionMode = newComposition;
    if (feedback) enhancement.feedback = feedback;

    enhancement.approvalStatus = 'regenerating';
    enhancement.regenerationCount++;

    saveProject(project);

    // Update enhancements file
    updateEnhancementsFile(project.enhancements);

    return {
      success: true,
      enhancementId,
      status: 'regenerating',
      regenerationCount: enhancement.regenerationCount,
      type: enhancement.type,
      compositionMode: enhancement.compositionMode,
      prompt: enhancement.prompt,
    };
  }
);

/**
 * list_enhancements tool - List all enhancement suggestions with their status.
 */
export const listEnhancementsTool: ToolDefinition = createTool(
  'list_enhancements',
  `List all enhancement suggestions with their approval status.

Useful for:
- Getting an overview of all planned enhancements
- Finding pending enhancements that need approval
- Reviewing approved/rejected enhancements`,
  {
    type: 'object',
    properties: {
      status_filter: {
        type: 'string',
        enum: ['all', 'pending', 'approved', 'rejected', 'regenerating'],
        description: 'Filter by approval status (default: all)',
      },
      type_filter: {
        type: 'string',
        enum: ['ai_image', 'ai_video_clip', 'motion_graphic', 'audio_music', 'audio_sfx'],
        description: 'Filter by enhancement type',
      },
    },
    required: [],
  },
  async (args) => {
    const statusFilter = args.status_filter as ItemApprovalStatus | 'all' | undefined;
    const typeFilter = args.type_filter as EnhancementType | undefined;

    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    let enhancements = [...project.enhancements];

    // Apply status filter
    if (statusFilter && statusFilter !== 'all') {
      enhancements = enhancements.filter(e => e.approvalStatus === statusFilter);
    }

    // Apply type filter
    if (typeFilter) {
      enhancements = enhancements.filter(e => e.type === typeFilter);
    }

    // Sort by time
    enhancements.sort((a, b) => a.timeRange.startMs - b.timeRange.startMs);

    // Count by status
    const statusCounts: Record<string, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      regenerating: 0,
      in_review: 0,
    };
    for (const e of project.enhancements) {
      statusCounts[e.approvalStatus]++;
    }

    return {
      success: true,
      total: project.enhancements.length,
      filtered: enhancements.length,
      statusCounts,
      enhancements: enhancements.map(e => ({
        id: e.id,
        type: e.type,
        compositionMode: e.compositionMode,
        timeRange: {
          start: formatMsToTime(e.timeRange.startMs),
          end: formatMsToTime(e.timeRange.endMs),
        },
        description: e.description,
        status: e.approvalStatus,
        source: e.source,
        confidence: e.confidence,
      })),
    };
  }
);

/**
 * get_next_pending_enhancement tool - Get the next pending enhancement for review.
 */
export const getNextPendingEnhancementTool: ToolDefinition = createTool(
  'get_next_pending_enhancement',
  `Get the next pending enhancement that needs user approval.

Returns full details about the enhancement for presentation to the user.`,
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

    const pending = getPendingEnhancements(project);

    if (pending.length === 0) {
      return {
        success: true,
        hasMorePending: false,
        message: 'All enhancements have been reviewed.',
        approvedCount: getApprovedEnhancements(project).length,
        totalCount: project.enhancements.length,
      };
    }

    // Sort by time and get first
    pending.sort((a, b) => a.timeRange.startMs - b.timeRange.startMs);
    const next = pending[0];

    if (!next) {
      return {
        success: true,
        hasMorePending: false,
        message: 'All enhancements have been reviewed.',
      };
    }

    // Get associated script segment text if available
    let segmentText: string | undefined;
    if (next.scriptSegmentId && project.script.segments) {
      const segment = project.script.segments.find(s => s.id === next.scriptSegmentId);
      segmentText = segment?.text;
    }

    return {
      success: true,
      hasMorePending: true,
      pendingCount: pending.length,
      enhancement: {
        id: next.id,
        type: next.type,
        compositionMode: next.compositionMode,
        timeRange: {
          start: formatMsToTime(next.timeRange.startMs),
          end: formatMsToTime(next.timeRange.endMs),
          durationSec: Math.round((next.timeRange.endMs - next.timeRange.startMs) / 1000),
        },
        description: next.description,
        prompt: next.prompt,
        source: next.source,
        confidence: next.confidence,
        userHint: next.userHint,
        segmentText,
      },
    };
  }
);

/**
 * complete_enhancement_plan tool - Mark enhancement planning phase as complete.
 */
export const completeEnhancementPlanTool: ToolDefinition = createTool(
  'complete_enhancement_plan',
  `Mark the enhancement planning phase as complete.

Validates that all enhancements have been reviewed (approved or rejected).
Transitions the project to the ASSET_GENERATION phase.`,
  {
    type: 'object',
    properties: {
      force: {
        type: 'boolean',
        description: 'Force completion even if some enhancements are pending (default: false)',
      },
    },
    required: [],
  },
  async (args) => {
    const force = args.force as boolean | undefined;

    const project = loadProject();
    if (!project) {
      return { success: false, error: 'No project found.' };
    }

    const pending = getPendingEnhancements(project);
    const approved = getApprovedEnhancements(project);

    // Check if there are pending enhancements
    if (pending.length > 0 && !force) {
      return {
        success: false,
        error: `${pending.length} enhancement(s) still pending review. Use force=true to skip them.`,
        pendingCount: pending.length,
        approvedCount: approved.length,
      };
    }

    // Check if there are any approved enhancements
    if (approved.length === 0) {
      return {
        success: false,
        error: 'No approved enhancements. Approve at least one enhancement or add user hints.',
      };
    }

    // Generate enhancement plan document
    generateEnhancementPlanDocument(project.enhancements);

    // Mark phase as complete
    updatePhaseStatus(project, 'enhancement_plan', 'completed');

    return {
      success: true,
      message: 'Enhancement planning phase completed. Ready for asset generation.',
      nextPhase: 'asset_generation',
      approvedEnhancements: approved.length,
      rejectedEnhancements: project.enhancements.filter(e => e.approvalStatus === 'rejected').length,
      skippedEnhancements: pending.length,
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
    const [minutes, seconds] = parts;
    return ((minutes ?? 0) * 60 + (seconds ?? 0)) * 1000;
  } else if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return ((hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)) * 1000;
  }

  throw new Error(`Invalid time format: ${timeStr}. Use MM:SS or HH:MM:SS`);
}

/**
 * Format milliseconds to time string.
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
 * Update the enhancements JSON file.
 */
function updateEnhancementsFile(enhancements: EnhancementSuggestion[]): void {
  writeProjectFile(
    path.join('enhancements', 'suggestions.json'),
    JSON.stringify(enhancements, null, 2)
  );
}

/**
 * Generate the enhancement plan markdown document.
 */
function generateEnhancementPlanDocument(enhancements: EnhancementSuggestion[]): void {
  const approved = enhancements.filter(e => e.approvalStatus === 'approved');
  const rejected = enhancements.filter(e => e.approvalStatus === 'rejected');

  let md = `# Enhancement Plan\n\n`;
  md += `**Total Enhancements:** ${enhancements.length}\n`;
  md += `**Approved:** ${approved.length}\n`;
  md += `**Rejected:** ${rejected.length}\n\n`;

  // Group approved by type
  const byType: Record<string, EnhancementSuggestion[]> = {};
  for (const e of approved) {
    if (!byType[e.type]) byType[e.type] = [];
    byType[e.type].push(e);
  }

  md += `## Approved Enhancements\n\n`;

  if (approved.length === 0) {
    md += `_No approved enhancements_\n\n`;
  } else {
    // Sort by time
    approved.sort((a, b) => a.timeRange.startMs - b.timeRange.startMs);

    for (const e of approved) {
      md += `### ${formatMsToTime(e.timeRange.startMs)} - ${e.type}\n`;
      md += `- **Composition:** ${e.compositionMode}\n`;
      md += `- **Duration:** ${Math.round((e.timeRange.endMs - e.timeRange.startMs) / 1000)}s\n`;
      md += `- **Description:** ${e.description}\n`;
      if (e.prompt) {
        md += `- **Generation Prompt:** ${e.prompt}\n`;
      }
      md += `\n`;
    }
  }

  if (rejected.length > 0) {
    md += `## Rejected Enhancements\n\n`;
    for (const e of rejected) {
      md += `- **${formatMsToTime(e.timeRange.startMs)}**: ${e.description}\n`;
      if (e.feedback) {
        md += `  - Reason: ${e.feedback}\n`;
      }
    }
  }

  writeProjectFile('plans/enhancement-plan.md', md);
}

// ============================================================================
// Export all enhancement tools
// ============================================================================

export const enhancementTools: ToolDefinition[] = [
  suggestEnhancementTool,
  approveEnhancementTool,
  rejectEnhancementTool,
  regenerateEnhancementTool,
  listEnhancementsTool,
  getNextPendingEnhancementTool,
  completeEnhancementPlanTool,
];
