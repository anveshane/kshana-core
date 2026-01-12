/**
 * Shared tools available to all sub-agents.
 * These tools provide access to project state for reading and updating.
 */

import type { ToolDefinition } from '../../../core/llm/index.js';
import { createTool } from '../../../core/tools/ToolRegistry.js';
import {
  loadProject,
  saveProject,
  createProject,
  updatePhaseStatus,
  updatePlannerStage,
  transitionToNextPhase,
  addEnhancement,
  updateEnhancementApproval,
  addAsset,
  addTimelineTrack,
  addComposedSegment,
  updateSegmentApproval,
  getProjectSummary,
  setSourceVideo,
  updateSourceMetadata,
  setScript,
  setScriptSegments,
} from '../workflow/ProjectManager.js';
import type {
  PhaseStatus,
  EnhancementSuggestion,
  AssetInfo,
  ComposedSegment,
  VideoMetadata,
  ScriptSegment,
  ScriptFormat,
  InputSourceType,
  CloudProvider,
  TrackType,
  ItemApprovalStatus,
} from '../workflow/types.js';
import { PlannerStage, EditWorkflowPhase } from '../workflow/types.js';

/**
 * Create the read_project tool for sub-agents.
 * Provides read-only access to project state.
 */
export function createReadProjectTool(): ToolDefinition {
  return createTool(
    'read_project',
    `Read the current video editing project state.

Returns project information including:
- source: Source video path, type, and metadata
- script: Script format, content, and parsed segments
- phases: Current phase and status of all phases
- enhancements: Enhancement suggestions and their approval status
- assets: Generated assets (images, video clips, audio)
- timeline: Timeline composition with tracks and segments

Use section parameter to get only specific parts of the project.`,
    {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['full', 'source', 'script', 'phases', 'enhancements', 'assets', 'timeline', 'summary'],
          description: 'Which section to read. Default: full. Use "summary" for a compact overview.',
        },
      },
      required: [],
    },
    async (args) => {
      const section = (args['section'] as string) || 'full';
      const project = loadProject();

      if (!project) {
        return {
          success: true,
          exists: false,
          message: 'No project found. Use import_video or invoke_ingest_agent to start a new project.',
        };
      }

      switch (section) {
        case 'source':
          return {
            success: true,
            exists: true,
            source: project.source,
          };

        case 'script':
          return {
            success: true,
            exists: true,
            script: {
              format: project.script.format,
              content: project.script.content?.slice(0, 2000) || '', // First 2000 chars of raw content
              hasMoreContent: (project.script.content?.length ?? 0) > 2000,
              segmentCount: project.script.segments.length,
              segments: project.script.segments.slice(0, 20), // First 20 for more context
              hasMoreSegments: project.script.segments.length > 20,
            },
          };

        case 'phases':
          return {
            success: true,
            exists: true,
            currentPhase: project.currentPhase,
            phases: project.phases,
          };

        case 'enhancements':
          return {
            success: true,
            exists: true,
            enhancements: project.enhancements,
            stats: {
              total: project.enhancements.length,
              pending: project.enhancements.filter(e => e.approvalStatus === 'pending').length,
              approved: project.enhancements.filter(e => e.approvalStatus === 'approved').length,
              rejected: project.enhancements.filter(e => e.approvalStatus === 'rejected').length,
            },
          };

        case 'assets':
          return {
            success: true,
            exists: true,
            assets: project.assets,
            stats: {
              total: project.assets.length,
              byType: {
                images: project.assets.filter(a => a.type === 'ai_image').length,
                videoClips: project.assets.filter(a => a.type === 'ai_video_clip').length,
                motionGraphics: project.assets.filter(a => a.type === 'motion_graphic').length,
                audio: project.assets.filter(a => a.type === 'audio_music' || a.type === 'audio_sfx' || a.type === 'audio_user').length,
              },
            },
          };

        case 'timeline':
          return {
            success: true,
            exists: true,
            timeline: {
              durationMs: project.timeline.durationMs,
              frameRate: project.timeline.frameRate,
              resolution: project.timeline.resolution,
              trackCount: project.timeline.tracks.length,
              segmentCount: project.timeline.segments.length,
              tracks: project.timeline.tracks,
            },
          };

        case 'summary':
          return {
            success: true,
            exists: true,
            summary: getProjectSummary(),
          };

        default: // 'full'
          return {
            success: true,
            exists: true,
            project: {
              id: project.id,
              title: project.title,
              version: project.version,
              currentPhase: project.currentPhase,
              source: project.source,
              script: {
                format: project.script.format,
                segmentCount: project.script.segments.length,
              },
              enhancementCount: project.enhancements.length,
              assetCount: project.assets.length,
              timelineInfo: {
                durationMs: project.timeline.durationMs,
                trackCount: project.timeline.tracks.length,
                segmentCount: project.timeline.segments.length,
              },
            },
          };
      }
    }
  );
}

/**
 * Create the update_project tool for sub-agents.
 * Provides controlled write access to project state.
 */
export function createUpdateProjectTool(): ToolDefinition {
  return createTool(
    'update_project',
    `Update the video editing project state.

Supported actions:
- create_project: Create a new project with a title
- phase_status: Update phase status (pending, in_progress, completed, skipped)
- planner_stage: Update planner stage (planning, verify, refining, complete)
- transition_phase: Move to the next workflow phase
- source_video: Set source video path and metadata
- source_metadata: Update video metadata
- script: Set script content and format
- script_segments: Set parsed script segments
- enhancement: Add or update an enhancement suggestion
- enhancement_approval: Update enhancement approval status
- asset: Add a generated asset
- timeline_track: Add a timeline track
- composed_segment: Add a composed segment for preview
- segment_approval: Update segment approval status

Always read_project first to understand current state before updating.`,
    {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'create_project',
            'phase_status',
            'planner_stage',
            'transition_phase',
            'source_video',
            'source_metadata',
            'script',
            'script_segments',
            'enhancement',
            'enhancement_approval',
            'asset',
            'timeline_track',
            'composed_segment',
            'segment_approval',
          ],
          description: 'Type of update to perform',
        },
        data: {
          type: 'object',
          description: 'Data for the update (varies by action type)',
        },
      },
      required: ['action', 'data'],
    },
    async (args) => {
      const action = args['action'] as string;
      const data = args['data'] as Record<string, unknown>;

      // Special case: create_project doesn't require existing project
      if (action === 'create_project') {
        const title = (data['title'] as string) || 'Video Editing Project';
        const project = createProject(title);
        return {
          success: true,
          message: `Project created: ${project.title}`,
          projectId: project.id,
        };
      }

      // All other actions require existing project
      let project = loadProject();
      if (!project) {
        return {
          success: false,
          error: 'No project found. Create a project first with action: create_project',
        };
      }

      try {
        switch (action) {
          case 'phase_status': {
            const phase = data['phase'] as keyof typeof project.phases;
            const status = data['status'] as PhaseStatus;
            if (!phase || !status) {
              return { success: false, error: 'phase and status are required' };
            }
            project = updatePhaseStatus(project, phase, status);
            return { success: true, message: `Phase ${phase} status updated to ${status}` };
          }

          case 'planner_stage': {
            const phase = data['phase'] as keyof typeof project.phases;
            const stage = data['stage'] as PlannerStage;
            if (!phase || !stage) {
              return { success: false, error: 'phase and stage are required' };
            }
            project = updatePlannerStage(project, phase, stage);
            return { success: true, message: `Phase ${phase} planner stage updated to ${stage}` };
          }

          case 'transition_phase': {
            const result = transitionToNextPhase(project);
            return {
              success: result.transitioned,
              message: result.reason,
              newPhase: result.project.currentPhase,
            };
          }

          case 'source_video': {
            const sourceType = data['sourceType'] as InputSourceType;
            const path = data['path'] as string;
            const cloudProvider = data['cloudProvider'] as CloudProvider | undefined;
            if (!sourceType || !path) {
              return { success: false, error: 'sourceType and path are required' };
            }
            project = setSourceVideo(project, sourceType, path, cloudProvider);
            return { success: true, message: `Source video set: ${path}` };
          }

          case 'source_metadata': {
            const metadata = data['metadata'] as VideoMetadata;
            if (!metadata) {
              return { success: false, error: 'metadata is required' };
            }
            project = updateSourceMetadata(project, metadata);
            return { success: true, message: 'Source metadata updated' };
          }

          case 'script': {
            const content = data['content'] as string;
            const format = data['format'] as ScriptFormat;
            const originalPath = data['originalPath'] as string | undefined;
            if (!content || !format) {
              return { success: false, error: 'content and format are required' };
            }
            project = setScript(project, content, format, originalPath);
            return { success: true, message: `Script set with format: ${format}` };
          }

          case 'script_segments': {
            const segments = data['segments'] as ScriptSegment[];
            if (!segments || !Array.isArray(segments)) {
              return { success: false, error: 'segments array is required' };
            }
            project = setScriptSegments(project, segments);
            return { success: true, message: `${segments.length} script segments saved` };
          }

          case 'enhancement': {
            const enhancement = data as unknown as EnhancementSuggestion;
            if (!enhancement.id) {
              return { success: false, error: 'enhancement must have an id' };
            }
            project = addEnhancement(project, enhancement);
            return { success: true, message: `Enhancement added: ${enhancement.id}` };
          }

          case 'enhancement_approval': {
            const enhancementId = data['enhancementId'] as string;
            const status = data['status'] as ItemApprovalStatus;
            const feedback = data['feedback'] as string | undefined;
            if (!enhancementId || !status) {
              return { success: false, error: 'enhancementId and status are required' };
            }
            const updated = updateEnhancementApproval(project, enhancementId, status, feedback);
            if (!updated) {
              return { success: false, error: `Enhancement not found: ${enhancementId}` };
            }
            return { success: true, message: `Enhancement ${enhancementId} status updated to ${status}` };
          }

          case 'asset': {
            const asset = data as unknown as AssetInfo;
            if (!asset.id) {
              return { success: false, error: 'asset must have an id' };
            }
            project = addAsset(project, asset);
            return { success: true, message: `Asset added: ${asset.id}` };
          }

          case 'timeline_track': {
            const type = data['type'] as TrackType;
            const label = data['label'] as string;
            if (!type || !label) {
              return { success: false, error: 'type and label are required' };
            }
            const track = addTimelineTrack(project, type, label);
            return { success: true, message: `Track added: ${track.id}`, trackId: track.id };
          }

          case 'composed_segment': {
            const segment = data as unknown as ComposedSegment;
            if (!segment.id) {
              return { success: false, error: 'segment must have an id' };
            }
            project = addComposedSegment(project, segment);
            return { success: true, message: `Composed segment added: ${segment.id}` };
          }

          case 'segment_approval': {
            const segmentId = data['segmentId'] as string;
            const status = data['status'] as ItemApprovalStatus;
            const feedback = data['feedback'] as string | undefined;
            if (!segmentId || !status) {
              return { success: false, error: 'segmentId and status are required' };
            }
            const updated = updateSegmentApproval(project, segmentId, status, feedback);
            if (!updated) {
              return { success: false, error: `Segment not found: ${segmentId}` };
            }
            return { success: true, message: `Segment ${segmentId} status updated to ${status}` };
          }

          default:
            return { success: false, error: `Unknown action: ${action}` };
        }
      } catch (error) {
        return {
          success: false,
          error: `Update failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  );
}

/**
 * Get all shared tools.
 */
export function getSharedTools(): ToolDefinition[] {
  return [
    createReadProjectTool(),
    createUpdateProjectTool(),
  ];
}
