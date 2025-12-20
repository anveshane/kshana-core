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
  setProjectInputType,
} from './ProjectManager.js';
import type { ProjectFile, CharacterData, SettingData, SceneRef, AssetInfo, PhaseStatus, ItemApprovalStatus, InputType } from './types.js';
import { PlannerStage, createDefaultCharacterData, createDefaultSettingData, createDefaultSceneRef, PHASE_CONFIGS, WorkflowPhase, INPUT_TYPE_CONFIGS } from './types.js';
import { LLMClient } from '../../../core/llm/index.js';
import { contextStore } from '../../../core/context/index.js';

/**
 * Expand context references (e.g., $wakes) to their actual stored content.
 * Returns the original string if it's not a context reference.
 */
function expandContextRef(value: string): string {
  if (value.startsWith('$') && value.length > 1) {
    const stored = contextStore.get(value);
    if (stored) {
      return stored.content;
    }
  }
  return value;
}

/**
 * Validates if the input is a valid story idea using an LLM call.
 * Returns { valid: true } if valid, or { valid: false, reason: string } if invalid.
 */
async function validateStoryInput(input: string): Promise<{ valid: boolean; reason?: string }> {
  const trimmed = input.trim();

  // Too short to be a meaningful story idea
  if (trimmed.length < 10) {
    return { valid: false, reason: 'Input is too short to be a story idea' };
  }

  // Quick heuristic checks for obvious garbage
  const looksLikeGarbage = detectGarbageInput(trimmed);
  if (looksLikeGarbage) {
    return { valid: false, reason: looksLikeGarbage };
  }

  try {
    const client = new LLMClient();

    const validationPrompt = `You are a strict input validator for a video generation tool. Your job is to determine if the user's input is a valid STORY IDEA that can be turned into a video.

VALID inputs (respond with "VALID"):
- Story concepts or narratives (e.g., "A detective solves a mystery in space")
- Theme/genre requests (e.g., "Make a horror story about a haunted house")
- Scripts, outlines, or synopses
- Descriptions of events, characters, or plots
- Existing stories to adapt

INVALID inputs (respond with "INVALID: [reason]"):
- Philosophical statements or manifestos
- Rhetorical questions that don't describe a story
- Technical discussions or explanations
- Promotional content or calls to action
- Random pasted text, articles, or essays
- Questions asking for information (not story requests)
- Meta-commentary about storytelling itself (unless it's a story ABOUT storytelling)
- Gibberish, random characters, or nonsensical text
- Single words or very short phrases that don't describe a story
- Keyboard mashing or test input (e.g., "asdfasdf", "test123")

Be STRICT. The input must describe or request an actual story/narrative that can be visualized.
When in doubt, respond with INVALID.

User input:
"""
${trimmed}
"""

Respond with ONLY "VALID" or "INVALID: [brief reason]"`;

    const response = await client.generate({
      messages: [{ role: 'user', content: validationPrompt }],
      temperature: 0.1,
      maxTokens: 100,
    });

    const result = response.content?.trim() || '';

    if (result.toUpperCase().startsWith('VALID')) {
      return { valid: true };
    } else if (result.toUpperCase().startsWith('INVALID')) {
      const reason = result.replace(/^INVALID:\s*/i, '').trim() || 'This does not appear to be a story idea';
      return { valid: false, reason };
    }

    // If we can't parse the response clearly, reject to be safe
    console.warn('Could not parse LLM validation response, rejecting input:', result);
    return { valid: false, reason: 'Unable to validate - please provide a clearer story idea' };
  } catch (error) {
    // If LLM validation fails, reject to be safe rather than allowing garbage through
    console.warn('Story input validation failed:', error);
    return { valid: false, reason: 'Validation service unavailable - please try again' };
  }
}

/**
 * Quick heuristic checks to detect obvious garbage input before calling the LLM.
 * Returns a reason string if garbage is detected, or null if input passes basic checks.
 */
function detectGarbageInput(input: string): string | null {
  const trimmed = input.trim();

  // Check for keyboard mashing patterns (repeated characters, random letters)
  const keyboardMashPattern = /^[a-z]{10,}$/i;
  if (keyboardMashPattern.test(trimmed.replace(/\s/g, ''))) {
    const uniqueChars = new Set(trimmed.toLowerCase().replace(/\s/g, ''));
    if (uniqueChars.size < 5 && trimmed.length > 15) {
      return 'Random repeated characters - not a story idea';
    }
  }

  // Check for test/placeholder input
  const testPatterns = [
    /^test\s*\d*$/i,
    /^hello\s*world$/i,
    /^asdf/i,
    /^qwerty/i,
    /^[0-9\s]+$/,
    /^\.+$/,
    /^-+$/,
    /^_+$/,
  ];
  for (const pattern of testPatterns) {
    if (pattern.test(trimmed)) {
      return 'Test or placeholder input - not a story idea';
    }
  }

  // Check for mostly non-alphabetic content (likely gibberish)
  const alphabeticRatio = (trimmed.match(/[a-zA-Z]/g) || []).length / trimmed.length;
  if (trimmed.length > 20 && alphabeticRatio < 0.3) {
    return 'Input appears to be mostly symbols or numbers - not a story idea';
  }

  // Check for extremely repetitive content
  const words = trimmed.toLowerCase().split(/\s+/);
  if (words.length > 5) {
    const uniqueWords = new Set(words);
    if (uniqueWords.size < words.length * 0.3) {
      return 'Input is too repetitive - please provide a story idea';
    }
  }

  // Passed basic checks
  return null;
}

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
- "update_character_approval": Update character approval. Data: { name, status, approval_type?: 'content'|'image', contentArtifactId?, referenceImageId? }
- "add_setting": Register a setting. Data: { name, description?, visual_description?, approval_status? }
- "update_setting": Update an existing setting. Data: { name, updates: { ... } }
- "update_setting_approval": Update setting approval. Data: { name, status, approval_type?: 'content'|'image', contentArtifactId?, referenceImageId? }
- "add_scene": Register a scene reference. Data: { scene_number, title?, description? }
- "update_scene": Update scene reference. Data: { scene_number, updates: { ... } }
- "update_scene_approval": Update scene approval. Data: { scene_number, approval_type: 'content'|'image'|'video', status, artifactId? }
- "add_asset": Register a generated asset. Data: { id, type, path, metadata? }
- "set_final_video": Set the final video info. Data: { artifactId, path, duration }
- "set_input_type": Set the input type after analyzing user input. Data: { input_type: 'idea'|'story' }. Use 'story' if user provided a complete story/chapter (skips plot and story phases).`,
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
          'set_input_type',
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
          let originalInput = data['original_input'] as string;
          if (!originalInput) {
            return { status: 'error', error: 'original_input is required for create action' };
          }

          // Expand context references (e.g., $wakes -> actual content)
          originalInput = expandContextRef(originalInput);

          // Validate that the input is actually a story idea
          const validation = await validateStoryInput(originalInput);
          if (!validation.valid) {
            return {
              status: 'invalid_input',
              rejected: true,
              error: validation.reason,
              action_required: 'STOP - Do not proceed with the workflow. Display the message below to the user and wait for them to provide a valid story idea.',
              message: `I'd love to help you create a video, but I need a story to work with.

What you shared appears to be: ${validation.reason}

Please share:
- A story concept or narrative (e.g., "A detective solves a mystery in space")
- A theme/genre you'd like to explore (e.g., "Make a horror story about a haunted house")
- A script or outline to adapt

What story would you like to turn into a video?`,
            };
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

          // Check if this is a per-item phase
          const phaseConfig = PHASE_CONFIGS[phase as WorkflowPhase];
          const isPerItemPhase = phaseConfig?.requiresPerItemApproval ?? false;

          // For per-item phases, phase is NOT complete when planner stage is complete
          // The phase is only complete when all items are approved
          const phaseCompleted = stage === 'complete' && !isPerItemPhase;
          logger.logPlannerStage(phase, stage, phaseCompleted);

          if (stage === 'complete' && isPerItemPhase) {
            return {
              status: 'success',
              message: `Planning for ${phase} is complete. Now you must process each item individually. Generate content/images/videos for each item, get approval, then mark the phase complete when ALL items are approved.`,
              current_phase: project.currentPhase,
              phase_status: project.phases[phase]?.status,
              phase_completed: false,
              requires_per_item_processing: true,
              next_action: 'Process each item one by one, get individual approvals, then transition when all items are approved.',
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

          // Get the new phase config for the next action instruction
          const newPhaseConfig = PHASE_CONFIGS[result.project.currentPhase as WorkflowPhase];

          return {
            status: 'success',
            transitioned: result.transitioned,
            reason: result.reason,
            current_phase: result.project.currentPhase,
            new_phase_name: newPhaseConfig?.displayName ?? result.project.currentPhase,
            next_action: result.transitioned
              ? `IMPORTANT: You have transitioned to a new phase. Do NOT stop or ask the user what to do next. Call read_project immediately to get the instructions for the ${newPhaseConfig?.displayName ?? 'new'} phase and continue working.`
              : 'Phase transition not needed. Call read_project to check current state.',
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
            return { status: 'error', error: 'name and status are required for update_character_approval' };
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
          return { status: 'success', message: `Character "${name}" ${typeLabel} approval updated to ${approvalStatus}` };
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
            return { status: 'error', error: 'name and status are required for update_setting_approval' };
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
          return { status: 'success', message: `Setting "${name}" ${typeLabel} approval updated to ${approvalStatus}` };
        }

        case 'add_scene': {
          const sceneNumber = data['scene_number'] as number;
          if (sceneNumber === undefined) {
            return { status: 'error', error: 'scene_number is required for add_scene' };
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
          return { status: 'success', message: `Scene ${sceneRef.sceneNumber} reference added` };
        }

        case 'update_scene_approval': {
          const sceneNumber = data['scene_number'] as number;
          const approvalType = data['approval_type'] as 'content' | 'image' | 'video';
          const approvalStatus = data['status'] as ItemApprovalStatus;
          if (sceneNumber === undefined || !approvalType || !approvalStatus) {
            return { status: 'error', error: 'scene_number, approval_type, and status are required for update_scene_approval' };
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
          const skippedPhases = inputTypeConfig.skipPhases.length > 0
            ? inputTypeConfig.skipPhases.join(', ')
            : 'none';

          return {
            status: 'success',
            message: `Input type set to "${inputTypeConfig.displayName}"`,
            input_type: inputType,
            current_phase: updatedProject.currentPhase,
            skipped_phases: skippedPhases,
            note: inputType === 'story'
              ? 'Plot and Story phases have been skipped. The story has been saved to plans/story.md. Proceeding to Characters & Settings phase.'
              : 'Starting from Plot phase.',
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
 * Get all workflow file tools.
 */
export function getWorkflowFileTools(): ToolDefinition[] {
  return [readFileTool, writeFileTool, readProjectTool, updateProjectTool];
}
