/**
 * File tools for the workflow - read_file, write_file, read_project, update_project.
 * These tools allow agents to read/write project files and manage project state.
 */

import { createTool } from '../../../core/tools/index.js';
import type { ToolDefinition } from '../../../core/llm/index.js';
import { getWorkflowLogger } from './WorkflowLogger.js';
import {
  loadProject,
  saveProject,
  readProjectFile,
  writeProjectFile,
  getProjectSummary,
  getStateTransitionPrompt,
  projectExists,
  createProject,
  saveCharacter,
  saveSetting,
  addAsset,
  addScene,
  addNewScene,
  updatePhaseStatus,
  updatePlannerStage,
  transitionToNextPhase,
  updateCharacter,
  updateSetting,
  updateCharacterApproval,
  updateSettingApproval,
  updateSceneApproval,
  updateScene,
} from './ProjectManager.js';
import type { ProjectFile, CharacterData, SettingData, SceneRef, AssetInfo, PhaseStatus, ItemApprovalStatus } from './types.js';
import { PlannerStage, createDefaultCharacterData, createDefaultSettingData, createDefaultSceneRef } from './types.js';

/**
 * Read file tool - reads content from a project file.
 */
export const readFileTool: ToolDefinition = createTool(
  'read_file',
  `Read content from a project file within the .kshana directory.

Use this to read:
- Plan files: plans/plot.md, plans/story.md, plans/scenes.md, plans/images.md, plans/video.md
- Character files: characters/[name].md
- Setting files: settings/[name].md
- Original input: original_input.md
- Asset manifest: assets/manifest.json

Returns the file content as a string, or an error if file doesn't exist.`,
  {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Relative path within .kshana directory (e.g., "plans/plot.md")',
      },
    },
    required: ['file_path'],
  },
  async (args) => {
    const filePath = args['file_path'] as string;

    // Security: prevent path traversal
    if (filePath.includes('..') || filePath.startsWith('/')) {
      return {
        status: 'error',
        error: 'Invalid file path. Use relative paths within .kshana directory.',
      };
    }

    const content = readProjectFile(filePath);

    if (content === null) {
      return {
        status: 'error',
        error: `File not found: ${filePath}`,
      };
    }

    return {
      status: 'success',
      file_path: filePath,
      content: content,
      length: content.length,
    };
  }
);

/**
 * Write file tool - writes content to a project file.
 */
export const writeFileTool: ToolDefinition = createTool(
  'write_file',
  `Write content to a project file within the .kshana directory.

Use this to write:
- Plan files: plans/plot.md, plans/story.md, plans/scenes.md, etc.
- Any other text files within the project

For structured data (characters, settings, assets, scenes), prefer using update_project instead.`,
  {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Relative path within .kshana directory (e.g., "plans/plot.md")',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
    },
    required: ['file_path', 'content'],
  },
  async (args) => {
    const filePath = args['file_path'] as string;
    const content = args['content'] as string;

    // Security: prevent path traversal
    if (filePath.includes('..') || filePath.startsWith('/')) {
      return {
        status: 'error',
        error: 'Invalid file path. Use relative paths within .kshana directory.',
      };
    }

    try {
      writeProjectFile(filePath, content);
      return {
        status: 'success',
        message: `File written successfully: ${filePath}`,
        file_path: filePath,
        bytes_written: content.length,
      };
    } catch (error) {
      return {
        status: 'error',
        error: `Failed to write file: ${String(error)}`,
      };
    }
  }
);

/**
 * Read project tool - reads the project.json index file.
 */
export const readProjectTool: ToolDefinition = createTool(
  'read_project',
  `Read the project.json index file to check phase statuses, planner stages, and project metadata.

Returns:
- Project ID and title
- Original user input
- Current phase and planner stage
- Phase statuses (pending, in_progress, completed)
- List of characters, settings, scenes, and assets
- State transition instructions (what to do next)

Use this at the start of each turn to understand the project state and what action to take.`,
  {
    type: 'object',
    properties: {
      include_summary: {
        type: 'boolean',
        description: 'If true, include a human-readable summary (default: true)',
      },
      include_transition_prompt: {
        type: 'boolean',
        description: 'If true, include instructions for what to do next (default: true)',
      },
    },
    required: [],
  },
  async (args) => {
    const includeSummary = args['include_summary'] !== false;
    const includeTransitionPrompt = args['include_transition_prompt'] !== false;

    if (!projectExists()) {
      return {
        status: 'no_project',
        message: 'No project found. Use update_project with action "create" to create one.',
      };
    }

    const project = loadProject();

    if (!project) {
      return {
        status: 'error',
        error: 'Failed to load project file.',
      };
    }

    const result: Record<string, unknown> = {
      status: 'success',
      project: project,
    };

    if (includeSummary) {
      result['summary'] = getProjectSummary();
    }

    if (includeTransitionPrompt) {
      result['next_action'] = getStateTransitionPrompt();
    }

    return result;
  }
);

/**
 * Update project tool - updates the project.json file.
 */
export const updateProjectTool: ToolDefinition = createTool(
  'update_project',
  `Update the project.json file with new data.

Note: project.json is an INDEX file. Content should be in .md files:
- Characters: Write full content to characters/[name].md, then use add_character to register
- Settings: Write full content to settings/[name].md, then use add_setting to register
- Scenes: Write full content to plans/scenes.md, then use add_scene to register scene references

Actions:
- "create": Create a new project with the given original_input
- "set_title": Set the project title
- "update_phase": Update a phase status. Data: { phase: string, status: 'pending'|'in_progress'|'completed' }
- "update_planner_stage": Update planner stage. Data: { phase: string, stage: 'planning'|'verify'|'refining'|'complete' }
- "transition_phase": Automatically transition to next phase if current is complete
- "add_character": Register a character. Data: { name, description?, visual_description?, approval_status? }
- "update_character": Update an existing character. Data: { name, updates: { ... } }
- "update_character_approval": Update character approval. Data: { name, status, contentArtifactId?, referenceImageId? }
- "add_setting": Register a setting. Data: { name, description?, visual_description?, approval_status? }
- "update_setting": Update an existing setting. Data: { name, updates: { ... } }
- "update_setting_approval": Update setting approval. Data: { name, status, contentArtifactId?, referenceImageId? }
- "add_scene": Register a scene reference. Data: { scene_number, title?, description? }
- "update_scene": Update scene reference. Data: { scene_number, updates: { ... } }
- "update_scene_approval": Update scene approval. Data: { scene_number, approval_type: 'content'|'image'|'video', status, artifactId? }
- "add_asset": Register a generated asset. Data: { id, type, path, metadata? }
- "set_final_video": Set the final video info. Data: { artifactId, path, duration }`,
  {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'create',
          'set_title',
          'update_phase',
          'update_planner_stage',
          'transition_phase',
          'add_character',
          'update_character',
          'update_character_approval',
          'add_setting',
          'update_setting',
          'update_setting_approval',
          'add_scene',
          'update_scene',
          'update_scene_approval',
          'add_asset',
          'set_final_video',
        ],
        description: 'The action to perform',
      },
      data: {
        type: 'object',
        description: 'Data for the action (structure depends on action type)',
      },
    },
    required: ['action', 'data'],
  },
  async (args) => {
    const action = args['action'] as string;
    const data = args['data'] as Record<string, unknown>;

    try {
      switch (action) {
        case 'create': {
          const originalInput = data['original_input'] as string;
          if (!originalInput) {
            return { status: 'error', error: 'original_input is required for create action' };
          }
          const project = createProject(originalInput);
          return {
            status: 'success',
            message: 'Project created',
            project_id: project.id,
            current_phase: project.currentPhase,
          };
        }

        case 'set_title': {
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          project.title = data['title'] as string;
          saveProject(project);
          return { status: 'success', message: 'Title updated' };
        }

        case 'update_phase': {
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          // Accept both 'phase' and 'phase_name' for compatibility
          const phase = (data['phase'] || data['phase_name']) as keyof ProjectFile['phases'];
          const status = data['status'] as PhaseStatus;
          if (!phase || !status) {
            return { status: 'error', error: 'phase (or phase_name) and status are required' };
          }
          updatePhaseStatus(project, phase, status);
          return { status: 'success', message: `Phase ${phase} updated to ${status}`, current_phase: project.currentPhase };
        }

        case 'update_planner_stage': {
          const logger = getWorkflowLogger();
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          // Accept both 'phase' and 'phase_name' for compatibility
          const phase = (data['phase'] || data['phase_name']) as keyof ProjectFile['phases'];
          const stage = data['stage'] as PlannerStage;
          if (!phase || !stage) {
            return { status: 'error', error: 'phase (or phase_name) and stage are required' };
          }
          const validStages = ['planning', 'verify', 'refining', 'complete'];
          if (!validStages.includes(stage)) {
            return { status: 'error', error: `Invalid stage. Must be one of: ${validStages.join(', ')}` };
          }
          updatePlannerStage(project, phase, stage);
          // When stage is 'complete', the phase is also marked as completed automatically
          const phaseCompleted = stage === 'complete';
          logger.logPlannerStage(phase, stage, phaseCompleted);
          return {
            status: 'success',
            message: phaseCompleted
              ? `Planner stage for ${phase} updated to ${stage}. Phase ${phase} is now completed. Use transition_phase to move to the next phase.`
              : `Planner stage for ${phase} updated to ${stage}`,
            current_phase: project.currentPhase,
            phase_status: project.phases[phase]?.status,
            phase_completed: phaseCompleted,
          };
        }

        case 'transition_phase': {
          const logger = getWorkflowLogger();
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const beforePhase = project.currentPhase;
          const beforeStatus = project.phases[beforePhase as keyof typeof project.phases]?.status;

          const result = transitionToNextPhase(project);
          logger.logPhaseTransition(
            beforePhase,
            result.project.currentPhase,
            result.reason,
            result.transitioned
          );
          return {
            status: 'success',
            transitioned: result.transitioned,
            reason: result.reason,
            current_phase: result.project.currentPhase,
            debug: {
              before_phase: beforePhase,
              before_status: beforeStatus,
              after_phase: result.project.currentPhase,
            },
          };
        }

        case 'add_character': {
          const name = data['name'] as string;
          if (!name) {
            return { status: 'error', error: 'name is required for add_character' };
          }
          // Create character with defaults and provided data
          const character: CharacterData = {
            ...createDefaultCharacterData(name),
            description: (data['description'] as string) || '',
            visualDescription: (data['visual_description'] as string) || '',
            approvalStatus: (data['approval_status'] as ItemApprovalStatus) || 'pending',
            referenceImageId: data['reference_image_id'] as string | undefined,
            referenceImagePath: data['reference_image_path'] as string | undefined,
          };
          saveCharacter(character);
          return { status: 'success', message: `Character "${character.name}" added` };
        }

        case 'update_character': {
          const name = data['name'] as string;
          const updates = data['updates'] as Partial<CharacterData>;
          if (!name) {
            return { status: 'error', error: 'name is required for update_character' };
          }
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const success = updateCharacter(project, name, updates);
          if (!success) {
            return { status: 'error', error: `Character "${name}" not found` };
          }
          return { status: 'success', message: `Character "${name}" updated` };
        }

        case 'update_character_approval': {
          const name = data['name'] as string;
          const approvalStatus = data['status'] as ItemApprovalStatus;
          if (!name || !approvalStatus) {
            return { status: 'error', error: 'name and status are required for update_character_approval' };
          }
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const success = updateCharacterApproval(project, name, approvalStatus, {
            contentArtifactId: data['contentArtifactId'] as string | undefined,
            referenceImageId: data['referenceImageId'] as string | undefined,
            referenceImagePath: data['referenceImagePath'] as string | undefined,
          });
          if (!success) {
            return { status: 'error', error: `Character "${name}" not found` };
          }
          return { status: 'success', message: `Character "${name}" approval updated to ${approvalStatus}` };
        }

        case 'add_setting': {
          const name = data['name'] as string;
          if (!name) {
            return { status: 'error', error: 'name is required for add_setting' };
          }
          // Create setting with defaults and provided data
          const setting: SettingData = {
            ...createDefaultSettingData(name),
            description: (data['description'] as string) || '',
            visualDescription: (data['visual_description'] as string) || '',
            approvalStatus: (data['approval_status'] as ItemApprovalStatus) || 'pending',
            referenceImageId: data['reference_image_id'] as string | undefined,
            referenceImagePath: data['reference_image_path'] as string | undefined,
          };
          saveSetting(setting);
          return { status: 'success', message: `Setting "${setting.name}" added` };
        }

        case 'update_setting': {
          const name = data['name'] as string;
          const updates = data['updates'] as Partial<SettingData>;
          if (!name) {
            return { status: 'error', error: 'name is required for update_setting' };
          }
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const success = updateSetting(project, name, updates);
          if (!success) {
            return { status: 'error', error: `Setting "${name}" not found` };
          }
          return { status: 'success', message: `Setting "${name}" updated` };
        }

        case 'update_setting_approval': {
          const name = data['name'] as string;
          const approvalStatus = data['status'] as ItemApprovalStatus;
          if (!name || !approvalStatus) {
            return { status: 'error', error: 'name and status are required for update_setting_approval' };
          }
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const success = updateSettingApproval(project, name, approvalStatus, {
            contentArtifactId: data['contentArtifactId'] as string | undefined,
            referenceImageId: data['referenceImageId'] as string | undefined,
            referenceImagePath: data['referenceImagePath'] as string | undefined,
          });
          if (!success) {
            return { status: 'error', error: `Setting "${name}" not found` };
          }
          return { status: 'success', message: `Setting "${name}" approval updated to ${approvalStatus}` };
        }

        case 'add_scene': {
          const sceneNumber = data['scene_number'] as number;
          if (sceneNumber === undefined) {
            return { status: 'error', error: 'scene_number is required for add_scene' };
          }
          // Create scene with defaults and provided data
          const sceneRef: SceneRef = {
            ...createDefaultSceneRef(sceneNumber),
            file: data['file'] as string | undefined,
            title: data['title'] as string | undefined,
            description: data['description'] as string | undefined,
          };
          addNewScene(sceneRef);
          return { status: 'success', message: `Scene ${sceneRef.sceneNumber} reference added` };
        }

        case 'update_scene_approval': {
          const sceneNumber = data['scene_number'] as number;
          const approvalType = data['approval_type'] as 'content' | 'image' | 'video';
          const approvalStatus = data['status'] as ItemApprovalStatus;
          if (sceneNumber === undefined || !approvalType || !approvalStatus) {
            return { status: 'error', error: 'scene_number, approval_type, and status are required for update_scene_approval' };
          }
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const success = updateSceneApproval(project, sceneNumber, approvalType, approvalStatus, {
            artifactId: data['artifactId'] as string | undefined,
            prompt: data['prompt'] as string | undefined,
          });
          if (!success) {
            return { status: 'error', error: `Scene ${sceneNumber} not found` };
          }
          return { status: 'success', message: `Scene ${sceneNumber} ${approvalType} approval updated to ${approvalStatus}` };
        }

        case 'add_asset': {
          const asset: AssetInfo = {
            id: data['id'] as string,
            type: data['type'] as AssetInfo['type'],
            path: data['path'] as string,
            createdAt: Date.now(),
            metadata: data['metadata'] as Record<string, unknown> | undefined,
          };
          if (!asset.id || !asset.type || !asset.path) {
            return { status: 'error', error: 'id, type, and path are required for add_asset' };
          }
          addAsset(asset);
          return { status: 'success', message: `Asset "${asset.id}" added` };
        }

        case 'update_scene': {
          const sceneNumber = data['scene_number'] as number;
          const updates = data['updates'] as Partial<SceneRef>;
          if (sceneNumber === undefined) {
            return { status: 'error', error: 'scene_number is required for update_scene' };
          }
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const success = updateScene(project, sceneNumber, updates);
          if (!success) {
            return { status: 'error', error: `Scene ${sceneNumber} not found` };
          }
          return { status: 'success', message: `Scene ${sceneNumber} updated` };
        }

        case 'set_final_video': {
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const artifactId = data['artifactId'] as string;
          const path = data['path'] as string;
          const duration = data['duration'] as number;
          if (!artifactId || !path) {
            return { status: 'error', error: 'artifactId and path are required for set_final_video' };
          }
          project.finalVideo = {
            artifactId,
            path,
            duration: duration || 0,
            createdAt: Date.now(),
          };
          saveProject(project);
          return { status: 'success', message: 'Final video set', path };
        }

        default:
          return { status: 'error', error: `Unknown action: ${action}` };
      }
    } catch (error) {
      return { status: 'error', error: String(error) };
    }
  }
);

/**
 * Get all workflow file tools.
 */
export function getWorkflowFileTools(): ToolDefinition[] {
  return [readFileTool, writeFileTool, readProjectTool, updateProjectTool];
}
