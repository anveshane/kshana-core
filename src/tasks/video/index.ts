/**
 * Video creation task module.
 * Provides video-specific tools, prompts, and agent factory.
 * Supports both legacy mode and new state-based workflow mode.
 */
import { GenericAgent } from '../../core/agent/index.js';
import { LLMClient, type LLMClientConfig } from '../../core/llm/index.js';
import { ToolRegistry, createDefaultToolRegistry, dispatchImageAgentTool } from '../../core/tools/index.js';
import { registerComplexTool } from '../../core/tools/ToolCategories.js';
import { getVideoGenerationTools, VIDEO_COMPLEX_TOOLS } from './tools.js';
import { getProjectStateTools } from './state.js';
import { VIDEO_CREATION_SYSTEM_PROMPT, getVideoCreationPrompt } from './prompts.js';

// Workflow imports
import {
  getAllWorkflowTools,
  getOrCreateProject,
  loadProject,
  getCurrentPhase,
  WorkflowPhase,
  PHASE_CONFIGS,
} from './workflow/index.js';

// Re-export prompts
export { VIDEO_CREATION_SYSTEM_PROMPT, getVideoCreationPrompt } from './prompts.js';

// Re-export tools
export {
  generateImageTool,
  generateVideoTool,
  editImageTool,
  waitForJobTool,
  getVideoGenerationTools,
  VIDEO_COMPLEX_TOOLS,
} from './tools.js';

// Re-export state
export {
  readProjectStateTool,
  writeProjectStateTool,
  getProjectStateTools,
  resetProjectState,
  setCurrentProjectId,
} from './state.js';
export type {
  Character,
  Setting,
  StoryboardScene,
  ProjectState,
} from './state.js';

// Re-export workflow module
export * from './workflow/index.js';

/**
 * Configuration options for creating a video agent.
 */
export interface VideoAgentConfig {
  llmConfig: LLMClientConfig;
  maxIterations?: number;
  includeCharacterGuidelines?: boolean;
  includeStoryboardGuidelines?: boolean;
}

/**
 * Create a tool registry with all video creation tools.
 * Combines generic tools with video-specific tools.
 */
export function createVideoToolRegistry(): ToolRegistry {
  // Start with default generic tools (think, ask_user, todos)
  const registry = createDefaultToolRegistry();

  // Add dispatch_image_agent for image prompt crafting
  registry.register(dispatchImageAgentTool);

  // Add video generation tools
  for (const tool of getVideoGenerationTools()) {
    registry.register(tool);
  }

  // Add project state tools
  for (const tool of getProjectStateTools()) {
    registry.register(tool);
  }

  // Register video tools as complex (require confirmation)
  for (const toolName of VIDEO_COMPLEX_TOOLS) {
    registerComplexTool(toolName);
  }

  return registry;
}

/**
 * Create a GenericAgent configured for video creation tasks.
 * This injects the video-specific prompt and tools into the generic agent.
 */
export function createVideoAgent(config: VideoAgentConfig): GenericAgent {
  const { llmConfig, maxIterations = 100, includeCharacterGuidelines, includeStoryboardGuidelines } = config;

  // Create tool registry with video tools
  const registry = createVideoToolRegistry();

  // Create LLM client
  const llm = new LLMClient(llmConfig);

  // Get the video-specific prompt
  const customPrompt = getVideoCreationPrompt({
    includeCharacterGuidelines,
    includeStoryboardGuidelines,
  });

  // Create the generic agent with video customization
  const agent = new GenericAgent(registry.getAll(), llm, {
    maxIterations,
    customPrompt,
    name: 'video-agent',
  });

  return agent;
}

/**
 * Get a list of all video-specific tool names.
 */
export function getVideoToolNames(): string[] {
  return [
    // Generation tools
    'generate_image',
    'generate_video',
    'edit_image',
    'wait_for_job',
    // State tools
    'read_project_state',
    'write_project_state',
  ];
}

/**
 * Check if a tool is a video-specific complex tool.
 */
export function isVideoComplexTool(toolName: string): boolean {
  return VIDEO_COMPLEX_TOOLS.has(toolName);
}

/**
 * Configuration options for creating a workflow-based video agent.
 */
export interface WorkflowVideoAgentConfig {
  llmConfig: LLMClientConfig;
  maxIterations?: number;
  /** Original user input/story idea */
  originalInput?: string;
  /** Base path for project directory (defaults to cwd) */
  basePath?: string;
}

/**
 * Create a tool registry with workflow tools for state-based video creation.
 * Includes file tools, project tools, and all generation tools.
 */
export function createWorkflowToolRegistry(): ToolRegistry {
  // Start with default generic tools (think, ask_user, dispatch_agent, todos)
  const registry = createDefaultToolRegistry();

  // Add dispatch_image_agent for image prompt crafting
  registry.register(dispatchImageAgentTool);

  // Add video generation tools
  for (const tool of getVideoGenerationTools()) {
    registry.register(tool);
  }

  // Add workflow file tools (read_file, write_file, read_project, update_project, stitch_videos)
  for (const tool of getAllWorkflowTools()) {
    registry.register(tool);
  }

  // Register video tools as complex (require confirmation)
  for (const toolName of VIDEO_COMPLEX_TOOLS) {
    registerComplexTool(toolName);
  }

  return registry;
}

/**
 * Create a GenericAgent configured for workflow-based video creation.
 * Uses state-based approach with project files in .kshana/ directory.
 */
export function createWorkflowVideoAgent(config: WorkflowVideoAgentConfig): GenericAgent {
  const {
    llmConfig,
    maxIterations = 100,
    originalInput = '',
    basePath = process.cwd(),
  } = config;

  // Initialize or load project
  const project = getOrCreateProject(originalInput, basePath);
  const currentPhase = getCurrentPhase(project);
  const phaseConfig = PHASE_CONFIGS[currentPhase];

  // Create tool registry with workflow tools
  const registry = createWorkflowToolRegistry();

  // Create LLM client
  const llm = new LLMClient(llmConfig);

  // Build custom prompt with workflow context
  const customPrompt = buildWorkflowAgentPrompt(project, currentPhase);

  // Create the generic agent with workflow customization
  const agent = new GenericAgent(registry.getAll(), llm, {
    maxIterations,
    customPrompt,
    name: `workflow-video-agent-${currentPhase}`,
  });

  return agent;
}

/**
 * Build the custom prompt for the workflow agent based on current phase.
 */
function buildWorkflowAgentPrompt(
  project: ReturnType<typeof loadProject>,
  currentPhase: WorkflowPhase
): string {
  const phaseConfig = PHASE_CONFIGS[currentPhase];

  // Base workflow instructions
  let prompt = `# Video Generation Workflow Agent

You are a video generation orchestrator using a state-based workflow approach.

## Current Project
- **Project ID**: ${project?.id ?? 'new'}
- **Title**: ${project?.title || '(not set)'}
- **Current Phase**: ${phaseConfig.displayName} (${currentPhase})

## Project Location
All project files are stored in the \`.kshana/\` directory in the current working directory.

## Your Current Task
You are in the **${phaseConfig.displayName}** phase.

`;

  // Add phase-specific instructions
  switch (currentPhase) {
    case WorkflowPhase.PROJECT_INIT:
      prompt += `
### Project Initialization
1. Read the user's input to understand their story idea
2. Create the project structure if not already created
3. Move to Story Discovery phase
`;
      break;

    case WorkflowPhase.STORY_DISCOVERY:
      prompt += `
### Story Discovery Phase
1. Check if \`plans/story-discovery.md\` has content using \`read_file\`
2. If empty, use \`dispatch_agent\` with:
   - task: "Discover and develop the story based on user input"
   - context: The user's original story idea and any clarifications
3. The planner will write to \`plans/story-discovery.md\`
4. Once plan is written, present it to user for approval
5. After approval, update phase status to 'completed'
`;
      break;

    case WorkflowPhase.CHARACTER_DESCRIPTIONS:
      prompt += `
### Character Descriptions Phase
1. Read \`plans/story-discovery.md\` for context
2. Check if \`plans/characters.md\` has content
3. If empty, use \`dispatch_agent\` with:
   - task: "Create detailed visual descriptions for all characters"
   - context: Story discovery content
4. After plan approval, generate reference images for each character
5. Use \`dispatch_image_agent\` with image_type: 'character_ref'
6. Save character data using \`update_project\` action: 'add_character'
`;
      break;

    case WorkflowPhase.THREE_ACTS:
      prompt += `
### 3-Act Structure Phase
1. Read story and character plans for context
2. Check if \`plans/three-acts.md\` has content
3. If empty, use \`dispatch_agent\` for 3-act planning
4. After approval, create scene breakdowns for each act:
   - Dispatch planner for Act 1 → \`plans/act-1-scenes.md\`
   - Dispatch planner for Act 2 → \`plans/act-2-scenes.md\`
   - Dispatch planner for Act 3 → \`plans/act-3-scenes.md\`
5. Register scenes using \`update_project\` action: 'add_scene'
`;
      break;

    case WorkflowPhase.STORYBOARD_IMAGES:
      prompt += `
### Storyboard Images Phase
1. Read scene plans and character data
2. Get character reference image IDs from \`read_project\`
3. Check if \`plans/storyboard.md\` has content
4. If empty, use \`dispatch_agent\` for storyboard planning
5. After approval, generate images for each scene
6. Use \`dispatch_image_agent\` with:
   - image_type: 'scene'
   - reference_images: character reference IDs
7. Update scenes with imageArtifactId
`;
      break;

    case WorkflowPhase.VIDEO_GENERATION:
      prompt += `
### Video Generation Phase
1. Read storyboard plan and get image artifact IDs
2. Check if \`plans/video-generation.md\` has content
3. If empty, use \`dispatch_agent\` for video planning
4. After approval, generate videos for each scene
5. Use \`generate_video\` with scene image artifacts
6. Update scenes with videoArtifactId
`;
      break;

    case WorkflowPhase.VIDEO_STITCHING:
      prompt += `
### Video Stitching Phase
1. Get all video artifact IDs from project scenes
2. Use \`stitch_videos\` tool with ordered video IDs
3. The stitching follows: full = scene1 + scene2; full = full + scene3; ...
4. Wait for stitching job to complete
5. Mark phase complete when done
`;
      break;

    case WorkflowPhase.FINAL_SIGNOFF:
      prompt += `
### Final Signoff Phase
1. Read project summary
2. Present final video to user
3. Ask for approval
4. If approved, mark workflow complete
5. If changes needed, guide user to appropriate phase
`;
      break;

    case WorkflowPhase.COMPLETED:
      prompt += `
### Workflow Complete
The video has been generated and approved.
Offer to help with any final adjustments or start a new project.
`;
      break;
  }

  // Add checkpoint reminder for expensive phases
  if (phaseConfig.isExpensive) {
    prompt += `
## Important: Checkpoint Required
This phase involves expensive operations (${phaseConfig.displayName}).
You MUST get user approval before starting generation.
Use \`ask_user\` with is_confirmation: true before proceeding.
`;
  }

  return prompt;
}

/**
 * Get a list of all workflow tool names.
 */
export function getWorkflowToolNames(): string[] {
  return [
    // File tools
    'read_file',
    'write_file',
    'read_project',
    'update_project',
    // Stitching
    'stitch_videos',
    // Plus all video tools
    ...getVideoToolNames(),
  ];
}
