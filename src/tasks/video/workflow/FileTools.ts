/**
 * File tools for the workflow - read_file, write_file, read_project, update_project.
 * These tools allow agents to read/write project files and manage project state.
 */

import { createTool } from '../../../core/tools/index.js';
import type { ToolDefinition } from '../../../core/llm/index.js';
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
  updatePhaseStatus,
  updatePlannerStage,
  transitionToNextPhase,
} from './ProjectManager.js';
import type { ProjectFile, CharacterData, SettingData, SceneData, AssetInfo, PhaseStatus } from './types.js';
import { PlannerStage } from './types.js';

/**
 * Read file tool - reads content from a project file.
 */
export const readFileTool: ToolDefinition = createTool(
  'read_file',
  `Read content from a project file within the .kshana directory.

Use this to read:
- Plan files: plans/plot.md, plans/story.md, plans/scenes.md, plans/images.md, plans/video.md
- Character files: characters/[name].json
- Setting files: settings/[name].json
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

Actions:
- "create": Create a new project with the given original_input
- "set_title": Set the project title
- "update_phase": Update a phase status (pending, in_progress, completed)
- "update_planner_stage": Update planner stage (planning, verify, refining, complete)
- "transition_phase": Automatically transition to next phase if current is complete
- "add_character": Add a character to the project
- "add_setting": Add a setting to the project
- "add_scene": Add a scene to the project
- "add_asset": Register a generated asset
- "update_scene": Update an existing scene`,
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
          'add_setting',
          'add_scene',
          'add_asset',
          'update_scene',
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
          const phase = data['phase'] as keyof ProjectFile['phases'];
          const status = data['status'] as PhaseStatus;
          if (!phase || !status) {
            return { status: 'error', error: 'phase and status are required' };
          }
          updatePhaseStatus(project, phase, status);
          return { status: 'success', message: `Phase ${phase} updated to ${status}` };
        }

        case 'update_planner_stage': {
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const phase = data['phase'] as keyof ProjectFile['phases'];
          const stage = data['stage'] as PlannerStage;
          if (!phase || !stage) {
            return { status: 'error', error: 'phase and stage are required' };
          }
          const validStages = ['planning', 'verify', 'refining', 'complete'];
          if (!validStages.includes(stage)) {
            return { status: 'error', error: `Invalid stage. Must be one of: ${validStages.join(', ')}` };
          }
          updatePlannerStage(project, phase, stage);
          return { status: 'success', message: `Planner stage for ${phase} updated to ${stage}` };
        }

        case 'transition_phase': {
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const result = transitionToNextPhase(project);
          return {
            status: 'success',
            transitioned: result.transitioned,
            reason: result.reason,
            current_phase: result.project.currentPhase,
          };
        }

        case 'add_character': {
          const character: CharacterData = {
            name: data['name'] as string,
            description: data['description'] as string,
            visualDescription: data['visual_description'] as string,
            referenceImageId: data['reference_image_id'] as string | undefined,
            referenceImagePath: data['reference_image_path'] as string | undefined,
          };
          if (!character.name) {
            return { status: 'error', error: 'name is required for add_character' };
          }
          saveCharacter(character);
          return { status: 'success', message: `Character "${character.name}" added` };
        }

        case 'add_setting': {
          const setting: SettingData = {
            name: data['name'] as string,
            description: data['description'] as string,
            visualDescription: data['visual_description'] as string,
            referenceImageId: data['reference_image_id'] as string | undefined,
            referenceImagePath: data['reference_image_path'] as string | undefined,
          };
          if (!setting.name) {
            return { status: 'error', error: 'name is required for add_setting' };
          }
          saveSetting(setting);
          return { status: 'success', message: `Setting "${setting.name}" added` };
        }

        case 'add_scene': {
          const scene: SceneData = {
            sceneNumber: data['scene_number'] as number,
            description: data['description'] as string,
            characters: data['characters'] as string[],
            setting: data['setting'] as string,
            action: data['action'] as string,
            imagePrompt: data['image_prompt'] as string | undefined,
            imageArtifactId: data['image_artifact_id'] as string | undefined,
            videoArtifactId: data['video_artifact_id'] as string | undefined,
            duration: data['duration'] as number | undefined,
          };
          if (scene.sceneNumber === undefined) {
            return { status: 'error', error: 'scene_number is required for add_scene' };
          }
          addScene(scene);
          return { status: 'success', message: `Scene ${scene.sceneNumber} added` };
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
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const sceneNumber = data['scene_number'] as number;
          const sceneIndex = project.scenes.findIndex((s) => s.sceneNumber === sceneNumber);
          if (sceneIndex === -1) {
            return { status: 'error', error: `Scene ${sceneNumber} not found` };
          }
          // Update only provided fields
          const updates = data['updates'] as Record<string, unknown>;
          const scene = project.scenes[sceneIndex];
          if (scene) {
            for (const [key, value] of Object.entries(updates)) {
              (scene as unknown as Record<string, unknown>)[key] = value;
            }
          }
          saveProject(project);
          return { status: 'success', message: `Scene ${sceneNumber} updated` };
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
