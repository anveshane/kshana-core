/**
 * File tools for the workflow - read_file, import_file, read_project, update_project.
 * These tools allow agents to read/write project files and manage project state.
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createTool } from '../../../core/tools/index.js';
import type { ToolDefinition } from '../../../core/llm/index.js';
import {
  regenerateArtifactTool,
  replaceArtifactTool,
  editPromptTool,
  comparePromptsTool,
  restorePromptTool,
  jumpToArtifactTool,
  listArtifactsTool,
  getArtifactStatusTool,
} from '../../../core/tools/builtin/artifactTools.js';
import {
  uploadExternalAssetTool,
  listExternalAssetsTool,
  deleteExternalAssetTool,
} from '../../../core/tools/builtin/assetTools.js';
import { getWorkflowLogger } from './WorkflowLogger.js';
import { getPhaseLogger } from '../../../utils/phaseLogger.js';
import {
  loadProject,
  saveProject,
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
  setProjectInputType,
  updateContentStatus,
  registerFile,
  generateFileSummary,
  getProjectDir,
} from './ProjectManager.js';
import type {
  ProjectFile,
  CharacterData,
  SettingData,
  SceneRef,
  AssetInfo,
  PhaseStatus,
  ItemApprovalStatus,
  InputType,
  ContentTypeName,
} from './types.js';
import {
  PlannerStage,
  createDefaultCharacterData,
  createDefaultSettingData,
  createDefaultSceneRef,
  PHASE_CONFIGS,
  WorkflowPhase,
  INPUT_TYPE_CONFIGS,
} from './types.js';
// read_file is imported from the canonical source — single definition for the entire system
import { readFileTool } from '../../../core/tools/builtin/contentCreatorTools.js';
export { readFileTool };

/**
 * Directories to exclude from project file listing.
 * These are internal/debug directories that agents shouldn't see or access.
 */
const EXCLUDED_DIRECTORIES = ['flows', 'logs', '.git'];

/**
 * Helper function to recursively list files in a directory
 */
function listDirectoryContents(
  dirPath: string,
  basePath: string,
  depth: number = 0,
  maxDepth: number = 3
): Array<{ path: string; type: 'file' | 'directory'; size?: number }> {
  const results: Array<{ path: string; type: 'file' | 'directory'; size?: number }> = [];

  if (depth > maxDepth || !existsSync(dirPath)) {
    return results;
  }

  try {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      // Skip excluded directories
      if (EXCLUDED_DIRECTORIES.includes(entry)) {
        continue;
      }

      const fullPath = join(dirPath, entry);
      const relativePath = fullPath.replace(basePath + '/', '');

      try {
        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
          results.push({ path: relativePath + '/', type: 'directory' });
          // Recurse into subdirectories
          const subResults = listDirectoryContents(fullPath, basePath, depth + 1, maxDepth);
          results.push(...subResults);
        } else if (stats.isFile()) {
          results.push({
            path: relativePath,
            type: 'file',
            size: stats.size,
          });
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return results;
}

/**
 * List project files tool - returns the directory structure of the .kshana project.
 */
export const listProjectFilesTool: ToolDefinition = createTool(
  'list_project_files',
  `List all files in the project directory.

Returns the directory structure with file information:
- plans/ - Plot, story, scenes, and other planning documents
- characters/ - Character description files
- settings/ - Setting description files
- scenes/ - Individual scene files
- assets/ - Generated images and videos
- original_input.md - User's original input
- project.json - Project state and metadata

Use this to discover what content exists, then use read_file to access specific files.
This is the primary way to find available project content.`,
  {
    type: 'object',
    properties: {
      include_sizes: {
        type: 'boolean',
        description: 'Include file sizes in the output (default: false)',
      },
    },
    required: [],
  },
  async args => {
    const includeSizes = args['include_sizes'] === true;
    const projectDir = getProjectDir();

    if (!existsSync(projectDir)) {
      return {
        status: 'no_project',
        content:
          '📁 No project directory found.\n\nCreate a project first using update_project with action "create".',
        message:
          'No project directory found. Create a project first using update_project with action "create".',
        files: [],
      };
    }

    // Get all files recursively
    const allFiles = listDirectoryContents(projectDir, projectDir);

    // Categorize files by type
    const categorized: Record<string, string[]> = {
      plans: [],
      characters: [],
      settings: [],
      scenes: [],
      assets: [],
      other: [],
    };

    const fileList: Array<{ path: string; type: string; size?: number }> = [];

    for (const file of allFiles) {
      if (file.type === 'directory') {
        continue; // Skip directory entries in output
      }

      // Skip internal files that agents shouldn't access directly
      if (file.path === 'project.json') {
        continue; // Use read_project tool instead
      }

      // Determine category
      let category = 'other';
      if (file.path.startsWith('plans/')) {
        category = 'plans';
      } else if (file.path.startsWith('characters/')) {
        category = 'characters';
      } else if (file.path.startsWith('settings/')) {
        category = 'settings';
      } else if (file.path.startsWith('scenes/')) {
        category = 'scenes';
      } else if (file.path.startsWith('assets/')) {
        category = 'assets';
      }

      categorized[category]?.push(file.path);

      const fileEntry: { path: string; type: string; size?: number } = {
        path: file.path,
        type: category,
      };
      if (includeSizes && file.size !== undefined) {
        fileEntry.size = file.size;
      }
      fileList.push(fileEntry);
    }

    // Build summary sections
    const summaryLines: string[] = [];
    summaryLines.push(`📁 Project Files - ${fileList.length} files total`);
    summaryLines.push('');

    if (categorized['plans'] && categorized['plans'].length > 0) {
      summaryLines.push(`**Plans** (${categorized['plans'].length}):`);
      for (const file of categorized['plans']) {
        summaryLines.push(`  - ${file}`);
      }
      summaryLines.push('');
    }
    if (categorized['characters'] && categorized['characters'].length > 0) {
      summaryLines.push(`**Characters** (${categorized['characters'].length}):`);
      for (const file of categorized['characters']) {
        summaryLines.push(`  - ${file}`);
      }
      summaryLines.push('');
    }
    if (categorized['settings'] && categorized['settings'].length > 0) {
      summaryLines.push(`**Settings** (${categorized['settings'].length}):`);
      for (const file of categorized['settings']) {
        summaryLines.push(`  - ${file}`);
      }
      summaryLines.push('');
    }
    if (categorized['scenes'] && categorized['scenes'].length > 0) {
      summaryLines.push(`**Scenes** (${categorized['scenes'].length}):`);
      for (const file of categorized['scenes']) {
        summaryLines.push(`  - ${file}`);
      }
      summaryLines.push('');
    }
    if (categorized['assets'] && categorized['assets'].length > 0) {
      summaryLines.push(`**Assets** (${categorized['assets'].length}):`);
      for (const file of categorized['assets']) {
        summaryLines.push(`  - ${file}`);
      }
      summaryLines.push('');
    }
    if (categorized['other'] && categorized['other'].length > 0) {
      summaryLines.push(`**Other** (${categorized['other'].length}):`);
      for (const file of categorized['other']) {
        summaryLines.push(`  - ${file}`);
      }
      summaryLines.push('');
    }

    // Build content string for UI display
    const content = summaryLines.join('\n');

    return {
      status: 'success',
      content, // This field is displayed in the UI
      project_directory: 'project/',
      total_files: fileList.length,
      files: fileList,
      usage_hint:
        'IMPORTANT: Use the EXACT file paths shown above with read_file(). For example: read_file(path="characters/mr_patel.md"). Do NOT use array indices like 0.md or 1.md - use the actual file names.',
    };
  }
);

/**
 * Import file tool - imports/copies content into a project file.
 */
export const importFileTool: ToolDefinition = createTool(
  'import_file',
  `Import/copy content into the project directory.

Use this ONLY for importing external files or user-referenced content into the project:
- Copying a user-provided file (story, transcript, reference material) into the project
- Saving plan/outline metadata that doesn't need user review

DO NOT use this for creative content (characters, settings, scenes, image prompts,
video prompts). Use generate_content instead — it shows the content to the user for
approval before saving.

Files are automatically registered in project.json with a summary for easy discovery.`,
  {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Relative path within the project directory (e.g., "plans/outline.md")',
      },
      content: {
        type: 'string',
        description: 'Content to import into the project file',
      },
      summary: {
        type: 'string',
        description:
          'Optional brief summary of the content (1-2 sentences). Auto-generated if not provided.',
      },
    },
    required: ['file_path', 'content'],
  },
  async args => {
    const filePath = args['file_path'] as string;
    const content = args['content'] as string;
    const summary = args['summary'] as string | undefined;

    // Security: prevent path traversal
    if (filePath.includes('..') || filePath.startsWith('/')) {
      return {
        status: 'error',
        error: 'Invalid file path. Use relative paths within the project directory.',
      };
    }

    try {
      writeProjectFile(filePath, content);

      // Determine file type from path
      const fileTypeMap: Record<string, string> = {
        'plans/plot.md': 'plot',
        'plans/story.md': 'story',
        'plans/scenes.md': 'scenes_plan',
        'plans/images.md': 'images_plan',
        'plans/video.md': 'video_plan',
        'original_input.md': 'original_input',
      };

      let fileType = fileTypeMap[filePath];
      if (!fileType) {
        // Infer from path
        if (filePath.startsWith('characters/')) fileType = 'character';
        else if (filePath.startsWith('settings/')) fileType = 'setting';
        else if (filePath.startsWith('scenes/')) fileType = 'scene';
        else fileType = 'other';
      }

      // Generate summary if not provided
      const fileSummary = summary || generateFileSummary(content, fileType);

      // Extract name from path for character/setting/scene files
      let name: string | undefined;
      if (fileType === 'character' || fileType === 'setting') {
        const match = filePath.match(/\/([\w-]+)\.md$/);
        name = match?.[1] ? match[1].replace(/-/g, ' ') : undefined;
      } else if (fileType === 'scene') {
        const match = filePath.match(/scene[_-]?(\d+)/i);
        name = match?.[1] ? `Scene ${match[1]}` : undefined;
      }

      // Register file in project.json with summary
      registerFile(filePath, fileType, { name, summary: fileSummary });

      // Track plot/story content in the content registry for persistence
      const project = loadProject();
      if (project) {
        const fileToContentType: Record<string, ContentTypeName> = {
          'plans/plot.md': 'plot',
          'plans/story.md': 'story',
        };
        const contentType = fileToContentType[filePath];
        if (contentType) {
          updateContentStatus(project, contentType, 'available');
        }
      }

      return {
        status: 'success',
        message: `File written and registered: ${filePath}`,
        file_path: filePath,
        bytes_written: content.length,
        summary: fileSummary,
        content,
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
  async args => {
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

    // Set phase context in phaseLogger for all subsequent logs
    const phaseLogger = getPhaseLogger();
    const currentPhaseInfo = project.phases[project.currentPhase];
    phaseLogger.setContext({
      phase: project.currentPhase,
      stage: currentPhaseInfo?.plannerStage,
      projectId: project.id,
    });

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
 *
 * SIMPLIFIED: Most content registration (characters, settings) is now handled
 * automatically by the framework when content is approved. Use generate_content
 * instead of manually calling add_character/add_setting.
 */
export const updateProjectTool: ToolDefinition = createTool(
  'update_project',
  `Update project state and control workflow transitions.

## Core Actions (use these):
- "create": Create a new project. Data: { original_input: string }
- "set_input_type": Mark input type. Data: { input_type: 'idea'|'story' }
  - Use 'story' if user provided a complete story/chapter (skips plot and story phases)
- "transition_phase": Move to next phase when current is complete. Data: {}
- "update_phase": Update phase status. Data: { phase: string, status: 'pending'|'in_progress'|'completed' }
- "update_planner_stage": Update planner stage. Data: { phase: string, stage: 'planning'|'verify'|'refining'|'complete' }

## Asset Actions (for images/videos):
- "add_asset": Register a generated asset. Data: { id, type, path, metadata? }
- "set_final_video": Set final video info. Data: { artifactId, path, duration }
- "update_scene_approval": Update scene approval. Data: { scene_number, approval_type, status, artifactId? }

## Deprecated Actions (framework handles these automatically):
- add_character, update_character, update_character_approval - Use generate_content(content_type: 'character') instead
- add_setting, update_setting, update_setting_approval - Use generate_content(content_type: 'setting') instead
- add_scene, update_scene - Use generate_content(content_type: 'scene') instead`,
  {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          // Core workflow actions
          'create',
          'set_input_type',
          'transition_phase',
          'update_phase',
          'update_planner_stage',
          'set_title',
          // Asset actions
          'add_asset',
          'set_final_video',
          'update_scene_approval',
          // Deprecated but still supported for backward compatibility
          'add_character',
          'update_character',
          'update_character_approval',
          'add_setting',
          'update_setting',
          'update_setting_approval',
          'add_scene',
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
  async args => {
    const action = args['action'] as string;
    const data = args['data'] as Record<string, unknown>;

    try {
      switch (action) {
        case 'create': {
          let originalInput = data['original_input'] as string;
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
          const phase = (data['phase'] || data['phase_name']) as string;
          const status = data['status'] as PhaseStatus;
          if (!phase || !status) {
            return { status: 'error', error: 'phase (or phase_name) and status are required' };
          }
          if (!project.phases[phase]) {
            return { status: 'error', error: `Phase '${phase}' does not exist in this project. Available phases: ${Object.keys(project.phases).join(', ')}` };
          }
          updatePhaseStatus(project, phase, status);
          return {
            status: 'success',
            message: `Phase ${phase} updated to ${status}`,
            current_phase: project.currentPhase,
          };
        }

        case 'update_planner_stage': {
          const logger = getWorkflowLogger();
          const phaseLogger = getPhaseLogger();
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          // Accept both 'phase' and 'phase_name' for compatibility
          const phase = (data['phase'] || data['phase_name']) as string;
          const stage = data['stage'] as PlannerStage;
          if (!phase || !stage) {
            return { status: 'error', error: 'phase (or phase_name) and stage are required' };
          }
          if (!project.phases[phase]) {
            return { status: 'error', error: `Phase '${phase}' does not exist in this project. Available phases: ${Object.keys(project.phases).join(', ')}` };
          }
          const validStages = ['planning', 'verify', 'refining', 'complete'];
          if (!validStages.includes(stage)) {
            return {
              status: 'error',
              error: `Invalid stage. Must be one of: ${validStages.join(', ')}`,
            };
          }
          updatePlannerStage(project, phase, stage);

          // Check if this is a per-item phase
          const phaseConfig = PHASE_CONFIGS[phase as WorkflowPhase];
          const isPerItemPhase = phaseConfig?.requiresPerItemApproval ?? false;

          // For per-item phases, phase is NOT complete when planner stage is complete
          // The phase is only complete when all items are approved
          const phaseCompleted = stage === 'complete' && !isPerItemPhase;
          logger.logPlannerStage(phase, stage, phaseCompleted);

          // Update phase logger context with new stage
          phaseLogger.stageTransition(stage, `Phase ${phase} entered ${stage} stage`);

          if (stage === 'complete' && isPerItemPhase) {
            return {
              status: 'success',
              message: `Planning for ${phase} is complete. Now you must process each item individually. Generate content/images/videos for each item, get approval, then mark the phase complete when ALL items are approved.`,
              current_phase: project.currentPhase,
              phase_status: project.phases[phase]?.status,
              phase_completed: false,
              requires_per_item_processing: true,
              next_action:
                'Process each item one by one, get individual approvals, then transition when all items are approved.',
            };
          }

          return {
            status: 'success',
            message: phaseCompleted
              ? `Planner stage for ${phase} updated to ${stage}. Phase ${phase} is now completed.`
              : `Planner stage for ${phase} updated to ${stage}`,
            current_phase: project.currentPhase,
            phase_status: project.phases[phase]?.status,
            phase_completed: phaseCompleted,
            next_action: phaseCompleted
              ? 'IMPORTANT: Phase is complete. Call transition_phase immediately to move to the next phase, then continue working. Do NOT stop or ask the user what to do.'
              : 'Continue with the current phase work.',
          };
        }

        case 'transition_phase': {
          const logger = getWorkflowLogger();
          const phaseLogger = getPhaseLogger();
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const beforePhase = project.currentPhase;
          const beforeStatus = project.phases[beforePhase]?.status;

          const result = transitionToNextPhase(project);
          logger.logPhaseTransition(
            beforePhase,
            result.project.currentPhase,
            result.reason,
            result.transitioned
          );

          // Update phase logger context on successful transition
          if (result.transitioned) {
            phaseLogger.phaseTransition(beforePhase, result.project.currentPhase, result.reason);
          }

          // Get the new phase display name (works for both narrative and template phases)
          const newPhaseKey = result.project.currentPhase;
          const narrativePhaseConfig = PHASE_CONFIGS[newPhaseKey as WorkflowPhase];
          const newPhaseName = narrativePhaseConfig?.displayName ?? newPhaseKey;

          return {
            status: 'success',
            transitioned: result.transitioned,
            reason: result.reason,
            current_phase: result.project.currentPhase,
            new_phase_name: newPhaseName,
            next_action: result.transitioned
              ? `IMPORTANT: You have transitioned to a new phase. Update your todo list (mark the previous phase complete, mark the new phase in_progress), then call read_project immediately to get the instructions for the ${newPhaseName} phase and continue working.`
              : 'Phase transition not needed. Call read_project to check current state.',
            debug: {
              before_phase: beforePhase,
              before_status: beforeStatus,
              after_phase: result.project.currentPhase,
            },
            // Include phase transition data for UI banner display
            ...(result.transitioned && {
              _phaseTransition: {
                fromPhase: beforePhase,
                toPhase: result.project.currentPhase,
                displayName: narrativePhaseConfig?.displayName,
                description: `Working on ${newPhaseName}`,
              },
            }),
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
          if (!projectExists()) {
            return { status: 'error', error: 'No project found' };
          }
          const success = updateCharacter(name, updates);
          if (!success) {
            return { status: 'error', error: `Character "${name}" not found` };
          }
          return { status: 'success', message: `Character "${name}" updated` };
        }

        case 'update_character_approval': {
          const name = data['name'] as string;
          const approvalStatus = data['status'] as ItemApprovalStatus;
          const approvalType = (data['approval_type'] as 'content' | 'image') || 'content';
          if (!name || !approvalStatus) {
            return {
              status: 'error',
              error: 'name and status are required for update_character_approval',
            };
          }
          if (!projectExists()) {
            return { status: 'error', error: 'No project found' };
          }
          // Also update character with artifact IDs if provided
          const artifactUpdates: Partial<CharacterData> = {};
          if (data['contentArtifactId']) {
            artifactUpdates.contentArtifactId = data['contentArtifactId'] as string;
          }
          if (data['referenceImageId']) {
            artifactUpdates.referenceImageId = data['referenceImageId'] as string;
          }
          if (data['referenceImagePath']) {
            artifactUpdates.referenceImagePath = data['referenceImagePath'] as string;
          }
          if (Object.keys(artifactUpdates).length > 0) {
            updateCharacter(name, artifactUpdates);
          }
          const success = updateCharacterApproval(name, approvalStatus, approvalType);
          if (!success) {
            return { status: 'error', error: `Character "${name}" not found` };
          }
          const typeLabel = approvalType === 'image' ? 'reference image' : 'content';
          return {
            status: 'success',
            message: `Character "${name}" ${typeLabel} approval updated to ${approvalStatus}`,
          };
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
          if (!projectExists()) {
            return { status: 'error', error: 'No project found' };
          }
          const success = updateSetting(name, updates);
          if (!success) {
            return { status: 'error', error: `Setting "${name}" not found` };
          }
          return { status: 'success', message: `Setting "${name}" updated` };
        }

        case 'update_setting_approval': {
          const name = data['name'] as string;
          const approvalStatus = data['status'] as ItemApprovalStatus;
          const approvalType = (data['approval_type'] as 'content' | 'image') || 'content';
          if (!name || !approvalStatus) {
            return {
              status: 'error',
              error: 'name and status are required for update_setting_approval',
            };
          }
          if (!projectExists()) {
            return { status: 'error', error: 'No project found' };
          }
          // Also update setting with artifact IDs if provided
          const artifactUpdates: Partial<SettingData> = {};
          if (data['contentArtifactId']) {
            artifactUpdates.contentArtifactId = data['contentArtifactId'] as string;
          }
          if (data['referenceImageId']) {
            artifactUpdates.referenceImageId = data['referenceImageId'] as string;
          }
          if (data['referenceImagePath']) {
            artifactUpdates.referenceImagePath = data['referenceImagePath'] as string;
          }
          if (Object.keys(artifactUpdates).length > 0) {
            updateSetting(name, artifactUpdates);
          }
          const success = updateSettingApproval(name, approvalStatus, approvalType);
          if (!success) {
            return { status: 'error', error: `Setting "${name}" not found` };
          }
          const typeLabel = approvalType === 'image' ? 'reference image' : 'content';
          return {
            status: 'success',
            message: `Setting "${name}" ${typeLabel} approval updated to ${approvalStatus}`,
          };
        }

        case 'add_scene': {
          const sceneNumber = data['scene_number'] as number;
          if (sceneNumber === undefined) {
            return { status: 'error', error: 'scene_number is required for add_scene' };
          }

          // HARD LIMIT: Maximum 12 scenes allowed
          const MAX_SCENES = 12;
          if (sceneNumber > MAX_SCENES) {
            return {
              status: 'error',
              error: `⛔ SCENE LIMIT EXCEEDED: Maximum ${MAX_SCENES} scenes allowed. You are trying to create scene ${sceneNumber}. STOP creating scenes and transition to the next phase immediately using update_project(action: 'transition_phase').`,
              limit_exceeded: true,
              max_scenes: MAX_SCENES,
              attempted_scene: sceneNumber,
            };
          }

          const title = data['title'] as string | undefined;
          const sceneRef = addNewScene(sceneNumber, title);
          // Also update with any additional data if provided
          const additionalUpdates: Partial<SceneRef> = {};
          if (data['file']) {
            additionalUpdates.file = data['file'] as string;
          }
          if (data['description']) {
            additionalUpdates.description = data['description'] as string;
          }
          if (Object.keys(additionalUpdates).length > 0) {
            updateScene(sceneNumber, additionalUpdates);
          }

          // Warn if approaching limit
          if (sceneNumber >= MAX_SCENES - 2) {
            return {
              status: 'success',
              message: `Scene ${sceneRef.sceneNumber} reference added`,
              warning: `⚠️ You have created ${sceneNumber} scenes. Maximum is ${MAX_SCENES}. Consider wrapping up the scene phase soon.`,
            };
          }

          return { status: 'success', message: `Scene ${sceneRef.sceneNumber} reference added` };
        }

        case 'update_scene_approval': {
          const sceneNumber = data['scene_number'] as number;
          const approvalType = data['approval_type'] as 'content' | 'image' | 'video';
          const approvalStatus = data['status'] as ItemApprovalStatus;
          if (sceneNumber === undefined || !approvalType || !approvalStatus) {
            return {
              status: 'error',
              error:
                'scene_number, approval_type, and status are required for update_scene_approval',
            };
          }
          if (!projectExists()) {
            return { status: 'error', error: 'No project found' };
          }
          // Update scene with artifact/prompt info if provided
          const sceneUpdates: Partial<SceneRef> = {};
          if (data['artifactId']) {
            if (approvalType === 'image') {
              sceneUpdates.imageArtifactId = data['artifactId'] as string;
            } else if (approvalType === 'video') {
              sceneUpdates.videoArtifactId = data['artifactId'] as string;
            }
          }
          if (data['prompt']) {
            sceneUpdates.imagePrompt = data['prompt'] as string;
          }
          if (Object.keys(sceneUpdates).length > 0) {
            updateScene(sceneNumber, sceneUpdates);
          }
          const success = updateSceneApproval(sceneNumber, approvalType, approvalStatus);
          if (!success) {
            return { status: 'error', error: `Scene ${sceneNumber} not found` };
          }
          return {
            status: 'success',
            message: `Scene ${sceneNumber} ${approvalType} approval updated to ${approvalStatus}`,
          };
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
          if (!projectExists()) {
            return { status: 'error', error: 'No project found' };
          }
          const success = updateScene(sceneNumber, updates);
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
            return {
              status: 'error',
              error: 'artifactId and path are required for set_final_video',
            };
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

        case 'set_input_type': {
          const inputType = data['input_type'] as InputType;
          if (!inputType || !['idea', 'story'].includes(inputType)) {
            return { status: 'error', error: 'input_type must be "idea" or "story"' };
          }

          const updatedProject = setProjectInputType(inputType);
          if (!updatedProject) {
            return { status: 'error', error: 'No project found' };
          }

          const inputTypeConfig = INPUT_TYPE_CONFIGS[inputType];
          const skippedPhases =
            inputTypeConfig.skipPhases.length > 0 ? inputTypeConfig.skipPhases.join(', ') : 'none';

          return {
            status: 'success',
            message: `Input type set to "${inputTypeConfig.displayName}"`,
            input_type: inputType,
            current_phase: updatedProject.currentPhase,
            skipped_phases: skippedPhases,
            note:
              inputType === 'story'
                ? `Skipped phases: ${skippedPhases}. The story has been saved to plans/story.md. Proceeding to ${updatedProject.currentPhase} phase.`
                : 'Starting from the first phase.',
          };
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
 * Get workflow file tools for the orchestrator.
 * Only includes project state tools - content files are handled by subagents via Task.
 */
export function getWorkflowFileTools(): ToolDefinition[] {
  return [listProjectFilesTool, readProjectTool, updateProjectTool];
}

/**
 * Get all file tools including read_file/import_file (for subagents that need direct file access).
 */
export function getAllFileTools(): ToolDefinition[] {
  return [listProjectFilesTool, readFileTool, importFileTool, readProjectTool, updateProjectTool];
}

/**
 * Get all artifact tools for fine-grained control.
 */
export function getAllArtifactTools(): ToolDefinition[] {
  return [
    regenerateArtifactTool,
    replaceArtifactTool,
    editPromptTool,
    comparePromptsTool,
    restorePromptTool,
    jumpToArtifactTool,
    listArtifactsTool,
    getArtifactStatusTool,
    uploadExternalAssetTool,
    listExternalAssetsTool,
    deleteExternalAssetTool,
  ];
}
