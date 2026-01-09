/**
 * File tools for the workflow - read_file, write_file, read_project, update_project.
 * These tools allow agents to read/write project files and manage project state.
 */

import { createTool } from '../../../core/tools/index.js';
import type { ToolDefinition } from '../../../core/llm/index.js';
import { getWorkflowLogger } from './WorkflowLogger.js';
import { getPhaseLogger } from '../../../utils/phaseLogger.js';
import { loadAndRenderMarkdown } from '../../../core/prompts/loader.js';
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
  loadCharacterMarkdown,
  loadSettingMarkdown,
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
  updatePlanStage,
  checkPlanningDeliverables,
} from './ProjectManager.js';
import type { ProjectFile, CharacterData, SettingData, SceneRef, AssetInfo, PhaseStatus, ItemApprovalStatus, InputType, ContentTypeName } from './types.js';
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

function looksLikeSrtInput(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }
  const timestampPattern = /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/;
  if (!timestampPattern.test(trimmed)) {
    return false;
  }
  const firstLine = trimmed.split(/\r?\n/, 1)[0] || '';
  return /^\d+$/.test(firstLine.trim());
}

/**
 * Validates if the input is a valid story idea using an LLM call.
 * Returns { valid: true } if valid, or { valid: false, reason: string } if invalid.
 */
async function validateStoryInput(input: string): Promise<{ valid: boolean; reason?: string }> {
  const trimmed = input.trim();

  if (looksLikeSrtInput(trimmed)) {
    return { valid: true };
  }

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

    // Load validation prompt from file
    const validationPrompt = loadAndRenderMarkdown('video/validation.md', {
      user_input: trimmed,
    });

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
    // If validation fails due to connection/API errors, allow workflow to continue
    // The basic heuristics (length, garbage detection) already passed, so it's likely valid
    // Connection errors shouldn't block the entire workflow
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isConnectionError = errorMessage.toLowerCase().includes('connection') || 
                              errorMessage.toLowerCase().includes('econnrefused') ||
                              errorMessage.toLowerCase().includes('network');
    
    if (isConnectionError) {
      console.warn('Story input validation failed due to connection error, allowing workflow to continue:', error);
      // Allow workflow to proceed - basic heuristics already passed
      return { valid: true };
    }
    
    // For other errors, still reject to be safe
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
- Narrative content: agent/script/plot.md, agent/script/story.md, agent/script/narration.md
- Plan files: agent/plans/plot-plan.md, agent/plans/story-plan.md, agent/plans/scenes-plan.md, etc.
- Character files: agent/characters/[name].md
- Setting files: agent/settings/[name].md
- Scene files: agent/scenes/scene-XXX/scene.md
- Original input: agent/original_input.md
- Asset manifest: agent/manifest.json

Returns the file content as a string, or an error if file doesn't exist.`,
  {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Relative path within .kshana directory (e.g., "agent/script/plot.md" or "agent/plans/plot-plan.md")',
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
- Narrative content: agent/script/plot.md, agent/script/story.md, agent/script/narration.md
- Plan files: agent/plans/plot-plan.md, agent/plans/story-plan.md, agent/plans/scenes-plan.md, etc.
- Scene files: agent/scenes/scene-XXX/scene.md
- Any other text files within the project

For structured data (characters, settings, assets, scenes), prefer using update_project instead.`,
  {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Relative path within .kshana directory (e.g., "agent/script/plot.md" or "agent/plans/plot-plan.md")',
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

      // Track plot/story content in the content registry for persistence
      const project = loadProject();
      if (project) {
        // Map file paths to content types
        const fileToContentType: Record<string, ContentTypeName> = {
          'agent/script/plot.md': 'plot',
          'script/plot.md': 'plot',
          'agent/plans/plot.md': 'plot', // Backward compatibility
          'plans/plot.md': 'plot', // Backward compatibility
          'agent/script/story.md': 'story',
          'script/story.md': 'story',
          'agent/plans/story.md': 'story', // Backward compatibility
          'plans/story.md': 'story', // Backward compatibility
        };
        const contentType = fileToContentType[filePath];
        if (contentType) {
          updateContentStatus(project, contentType, 'available');
        }
      }

      // Generate a preview of the saved content (first 500 chars)
      const preview = content.length > 500 ? content.substring(0, 500) + '...' : content;
      const previewLines = preview.split('\n').slice(0, 10).join('\n');
      const truncatedPreview = previewLines.length < preview.length ? previewLines + '\n...' : previewLines;

      return {
        status: 'success',
        message: `File written successfully: ${filePath}`,
        file_path: filePath,
        bytes_written: content.length,
        preview: truncatedPreview,
        total_lines: content.split('\n').length,
      };
    } catch (error) {
      return {
        status: 'error',
        error: `Failed to write file: ${String(error)}`,
      };
    }
  }
);

export const readTranscriptTool: ToolDefinition = createTool(
  'read_transcript',
  'Read raw SRT transcript text from agent/original_input.md.',
  {
    type: 'object',
    properties: {},
    required: [],
  },
  async () => {
    const content = readProjectFile('agent/original_input.md');
    if (content === null) {
      return { status: 'error', error: 'Transcript not found at agent/original_input.md' };
    }
    return { status: 'success', file_path: 'agent/original_input.md', content };
  }
);

export const writePlacementPlanTool: ToolDefinition = createTool(
  'write_placement_plan',
  'Write image placement plan content to agent/content/image-placements.md.',
  {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Placement plan content' },
    },
    required: ['content'],
  },
  async (args) => {
    const content = args['content'] as string;
    try {
      writeProjectFile('agent/content/image-placements.md', content);
      return {
        status: 'success',
        file_path: 'agent/content/image-placements.md',
        bytes_written: content.length,
      };
    } catch (error) {
      return { status: 'error', error: `Failed to write placement plan: ${String(error)}` };
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

    // Set phase context in phaseLogger for all subsequent logs
    const phaseLogger = getPhaseLogger();
    phaseLogger.setContext({
      phase: project.currentPhase,
      stage: project.plan.stage,
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
- "update_plan_stage": Update the project-level master plan stage. Data: { stage: 'planning'|'verify'|'refining'|'complete' }
- "update_phase": Update a phase status. Data: { phase: string, status: 'pending'|'in_progress'|'completed' }
- "update_planner_stage": DEPRECATED - redirects to update_plan_stage
- "transition_phase": Automatically transition to next phase if master plan is approved and current phase is complete
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
- "set_input_type": Set the input type after analyzing user input. Data: { input_type: 'idea'|'story'|'youtube_srt'|'script' }. Use 'youtube_srt' when the user provides SRT content.`,
  {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'create',
          'set_title',
          'update_plan_stage',
          'update_phase',
          'update_planner_stage', // Deprecated - redirects to update_plan_stage
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

          // Check if project already exists - don't overwrite it
          const existingProject = loadProject();
          if (existingProject) {
            return {
              status: 'error',
              error: 'Project already exists. Use a different action to update the project.',
              existing_project_id: existingProject.id,
              message: 'A project already exists. To start a new project, you must first delete or complete the existing one.',
            };
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
          const phaseConfig = PHASE_CONFIGS[phase as WorkflowPhase];
          const phaseDisplayName = phaseConfig?.displayName || phase;
          updatePhaseStatus(project, phase, status);
          
          // Get project summary for context
          const summary = getProjectSummary();
          
          return { 
            status: 'success', 
            message: `Phase "${phaseDisplayName}" updated to ${status}`, 
            phase: phase,
            phase_display_name: phaseDisplayName,
            phase_status: status,
            current_phase: project.currentPhase,
            project_summary: summary,
          };
        }

        case 'update_plan_stage': {
          // Update the project-level master plan stage
          const logger = getWorkflowLogger();
          const phaseLogger = getPhaseLogger();
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const stage = data['stage'] as PlannerStage;
          if (!stage) {
            return { status: 'error', error: 'stage is required' };
          }
          const validStages = ['planning', 'verify', 'refining', 'complete'];
          if (!validStages.includes(stage)) {
            return { status: 'error', error: `Invalid stage. Must be one of: ${validStages.join(', ')}` };
          }
          
          updatePlanStage(project, stage);
          
          const planApproved = stage === 'complete';
          logger.logPlannerStage('master_plan', stage, planApproved);
          phaseLogger.stageTransition(stage, `Master plan entered ${stage} stage`);

          if (planApproved) {
            return {
              status: 'success',
              message: `Master plan approved! You can now execute phases. Current phase: ${project.currentPhase}`,
              plan_id: project.plan.planId,
              plan_stage: project.plan.stage,
              current_phase: project.currentPhase,
              next_action: 'Start executing the current phase based on the approved master plan.',
            };
          }

          return {
            status: 'success',
            message: `Master plan stage updated to ${stage}`,
            plan_id: project.plan.planId,
            plan_stage: project.plan.stage,
            current_phase: project.currentPhase,
          };
        }

        case 'update_planner_stage': {
          // DEPRECATED: Redirect to update_plan_stage for backward compatibility
          const logger = getWorkflowLogger();
          const phaseLogger = getPhaseLogger();
          const project = loadProject();
          if (!project) {
            return { status: 'error', error: 'No project found' };
          }
          const stage = data['stage'] as PlannerStage;
          if (!stage) {
            return { status: 'error', error: 'stage is required' };
          }
          const validStages = ['planning', 'verify', 'refining', 'complete'];
          if (!validStages.includes(stage)) {
            return { status: 'error', error: `Invalid stage. Must be one of: ${validStages.join(', ')}` };
          }
          
          // Redirect to project-level plan update
          updatePlanStage(project, stage);
          
          const planApproved = stage === 'complete';
          logger.logPlannerStage('master_plan', stage, planApproved);
          phaseLogger.stageTransition(stage, `Master plan entered ${stage} stage (via deprecated update_planner_stage)`);

          return {
            status: 'success',
            message: planApproved
              ? `Master plan approved! Now execute the current phase: ${project.currentPhase}`
              : `Master plan stage updated to ${stage}`,
            plan_id: project.plan.planId,
            plan_stage: project.plan.stage,
            current_phase: project.currentPhase,
            deprecated_notice: 'update_planner_stage is deprecated. Use update_plan_stage instead.',
            next_action: planApproved
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
          const beforeStatus = project.phases[beforePhase as keyof typeof project.phases]?.status;

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

          // Get the new phase config for the next action instruction
          const newPhaseConfig = PHASE_CONFIGS[result.project.currentPhase as WorkflowPhase];

          // Get project summary for context
          const summary = getProjectSummary();
          
          // Check if Planning phase deliverables exist but phase isn't completed
          let nextAction = result.transitioned
            ? `IMPORTANT: You have transitioned to a new phase. Update your todo list (mark the previous phase complete, mark the new phase in_progress), then call read_project immediately to get the instructions for the ${newPhaseConfig?.displayName ?? 'new'} phase and continue working.`
            : 'Phase transition not needed. Call read_project to check current state.';
          
          let reason = result.reason;
          
          // Enhanced guidance for Planning phase when deliverables exist but phase isn't completed
          if (!result.transitioned && result.reason.includes('in progress')) {
            if (project.currentPhase === WorkflowPhase.PLANNING) {
              const planningDeliverablesExist = checkPlanningDeliverables(project);
              if (planningDeliverablesExist) {
                nextAction = `Planning phase deliverables exist but phase is not marked as completed. First call update_project(action='update_phase', data={phase: 'planning', status: 'completed'}), then call transition_phase again.`;
                reason = `Planning phase is in progress. Mark as completed first.`;
              }
            }
          }
          
          return {
            status: 'success',
            transitioned: result.transitioned,
            reason: reason,
            current_phase: result.project.currentPhase,
            new_phase_name: newPhaseConfig?.displayName ?? result.project.currentPhase,
            previous_phase: beforePhase,
            previous_phase_status: beforeStatus,
            project_summary: summary,
            next_action: nextAction,
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
                displayName: newPhaseConfig?.displayName,
                description: `Working on ${newPhaseConfig?.displayName ?? result.project.currentPhase}`,
              },
            }),
          };
        }

        case 'add_character': {
          const name = data['name'] as string;
          if (!name) {
            return { status: 'error', error: 'name is required for add_character' };
          }
          
          // Check if the character file already exists (created by Task tool)
          // If so, DON'T overwrite it - just update project.json registry
          const existingContent = loadCharacterMarkdown(name);
          const fileAlreadyExists = existingContent !== null && existingContent.trim().length > 0;
          
          // Check if description is a variable reference (starts with $)
          const rawDescription = (data['description'] as string) || '';
          const isVariableRef = rawDescription.startsWith('$');
          
          // Create character with defaults and provided data
          const character: CharacterData = {
            ...createDefaultCharacterData(name),
            description: isVariableRef ? '' : rawDescription, // Don't store variable refs as content
            visualDescription: (data['visual_description'] as string) || '',
            approvalStatus: (data['approval_status'] as ItemApprovalStatus) || 'pending',
            referenceImageId: data['reference_image_id'] as string | undefined,
            referenceImagePath: data['reference_image_path'] as string | undefined,
          };
          
          // NEVER overwrite existing files - Task tool already created the .md file with full content
          // Only create new file if it doesn't exist and we have non-variable-ref content
          if (!fileAlreadyExists && !isVariableRef && (character.description || character.visualDescription)) {
            saveCharacter(character);
          } else {
            // Just update project.json registry without creating/overwriting file
            const project = loadProject();
            if (project) {
              const existingIndex = project.characters.findIndex(c => c.name === character.name);
              if (existingIndex >= 0) {
                project.characters[existingIndex] = character;
              } else {
                project.characters.push(character);
              }
              saveProject(project);
            }
          }
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
          
          // Check if the setting file already exists (created by Task tool)
          // If so, DON'T overwrite it - just update project.json registry
          const existingContent = loadSettingMarkdown(name);
          const fileAlreadyExists = existingContent !== null && existingContent.trim().length > 0;
          
          // Check if description is a variable reference (starts with $)
          const rawDescription = (data['description'] as string) || '';
          const isVariableRef = rawDescription.startsWith('$');
          
          // Create setting with defaults and provided data
          const setting: SettingData = {
            ...createDefaultSettingData(name),
            description: isVariableRef ? '' : rawDescription, // Don't store variable refs as content
            visualDescription: (data['visual_description'] as string) || '',
            approvalStatus: (data['approval_status'] as ItemApprovalStatus) || 'pending',
            referenceImageId: data['reference_image_id'] as string | undefined,
            referenceImagePath: data['reference_image_path'] as string | undefined,
          };
          
          // NEVER overwrite existing files - Task tool already created the .md file with full content
          // Only create new file if it doesn't exist and we have non-variable-ref content
          if (!fileAlreadyExists && !isVariableRef && (setting.description || setting.visualDescription)) {
            saveSetting(setting);
          } else {
            // Just update project.json registry without creating/overwriting file
            const project = loadProject();
            if (project) {
              const existingIndex = project.settings.findIndex(s => s.name === setting.name);
              if (existingIndex >= 0) {
                project.settings[existingIndex] = setting;
              } else {
                project.settings.push(setting);
              }
              saveProject(project);
            }
          }
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

          // HARD LIMIT: Maximum 12 scenes allowed
          const MAX_SCENES = 12;
          if (sceneNumber > MAX_SCENES) {
            return {
              status: 'error',
              error: `⛔ SCENE LIMIT EXCEEDED: Maximum ${MAX_SCENES} scenes allowed. You are trying to create scene ${sceneNumber}. STOP creating scenes and transition to the next phase immediately using update_project(action: 'transition_phase', data: { next_phase: 'character_setting_images' })`,
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
          const validInputTypes: InputType[] = ['idea', 'story', 'youtube_srt', 'script'];
          if (!inputType || !validInputTypes.includes(inputType)) {
            return { status: 'error', error: `input_type must be one of: ${validInputTypes.join(', ')}` };
          }

          // Check if input type is already set to the same value to prevent loops
          const currentProject = loadProject();
          if (!currentProject) {
            return { status: 'error', error: 'No project found' };
          }

          if (currentProject.inputType === inputType) {
            // Input type is already set to the requested value - return success without updating
            const inputTypeConfig = INPUT_TYPE_CONFIGS[inputType];
            const summary = getProjectSummary();
            return {
              status: 'success',
              message: `Input type is already set to "${inputTypeConfig.displayName}"`,
              input_type: inputType,
              current_phase: currentProject.currentPhase,
              project_summary: summary,
              skipped: true,
              note: 'Input type was already set to this value. No update needed.',
            };
          }

          const updatedProject = setProjectInputType(inputType);
          if (!updatedProject) {
            return { status: 'error', error: 'No project found' };
          }

          const inputTypeConfig = INPUT_TYPE_CONFIGS[inputType];
          const skippedPhases = inputTypeConfig.skipPhases.length > 0
            ? inputTypeConfig.skipPhases.join(', ')
            : 'none';

          const note = inputType === 'story'
            ? 'Plot and Story phases have been skipped. The story has been saved to script/story.md. Proceeding to Characters & Settings phase.'
            : inputType === 'youtube_srt'
              ? 'Transcript-first workflow enabled. Proceeding to Transcript Input phase.'
              : inputType === 'script'
                ? 'Transcript input skipped. Proceeding to Planning phase.'
                : 'Starting from Plot phase.';

          // Get project summary for context
          const summary = getProjectSummary();
          
          return {
            status: 'success',
            message: `Input type set to "${inputTypeConfig.displayName}"`,
            input_type: inputType,
            current_phase: updatedProject.currentPhase,
            project_summary: summary,
            skipped_phases: skippedPhases,
            note,
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
  return [readProjectTool, updateProjectTool, readTranscriptTool, writePlacementPlanTool];
}

/**
 * Get all file tools including read_file/write_file (for subagents that need direct file access).
 */
export function getAllFileTools(): ToolDefinition[] {
  return [readFileTool, writeFileTool, readProjectTool, updateProjectTool, readTranscriptTool, writePlacementPlanTool];
}
