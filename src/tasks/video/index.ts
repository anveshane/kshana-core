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
 * Uses simplified phases: plot → story → scenes → images → video
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

## Workflow Phases
plot → story → scenes → images → video

## How to Proceed
1. Call \`read_project\` to get the current project state and next action instructions
2. The \`next_action\` field will tell you exactly what to do
3. Follow the planner stage cycle: planning → verify → refining → complete

## Planner Stage Cycle
Each phase goes through these stages:
- **PLANNING**: Create the initial plan, write to plan file
- **VERIFY**: Present plan to user for approval (auto-approve after 15s if no response)
- **REFINING**: Apply user feedback if provided, update plan
- **COMPLETE**: Plan approved, mark phase complete and transition

## Your Current Task
You are in the **${phaseConfig.displayName}** phase.

`;

  // Add phase-specific instructions
  switch (currentPhase) {
    case WorkflowPhase.PLOT:
      prompt += `
### Plot Development Phase
1. Read the user's original input from \`read_project\`
2. Create a plot outline with main story beats
3. Write the plot to \`plans/plot.md\` using \`write_file\`
4. Update planner stage to 'verify' using \`update_project\`
5. Present plot to user with \`ask_user\`
6. After approval, update planner stage to 'complete' and mark phase completed
`;
      break;

    case WorkflowPhase.STORY:
      prompt += `
### Story Development Phase
1. Read \`plans/plot.md\` for context
2. Expand the plot into a full story with:
   - Character introductions and descriptions
   - Setting descriptions
   - Detailed narrative
3. Write to \`plans/story.md\`
4. Save characters using \`update_project\` action: 'add_character'
5. Save settings using \`update_project\` action: 'add_setting'
6. Follow the verify → complete cycle
`;
      break;

    case WorkflowPhase.SCENES:
      prompt += `
### Scene Breakdown Phase
1. Read \`plans/story.md\` for context
2. Break the story into individual visual scenes
3. Each scene should have:
   - Scene number
   - Description
   - Characters involved
   - Setting
   - Action/movement
4. Write to \`plans/scenes.md\`
5. Register each scene using \`update_project\` action: 'add_scene'
6. Follow the verify → complete cycle
`;
      break;

    case WorkflowPhase.IMAGES:
      prompt += `
### Image Generation Phase
1. Read \`plans/scenes.md\` and character/setting data
2. Create image prompts for each scene
3. Write image plan to \`plans/images.md\`
4. After approval, generate images using \`generate_image\` or \`dispatch_image_agent\`
5. Update scenes with imageArtifactId using \`update_project\` action: 'update_scene'
6. Mark phase complete when all images are generated
`;
      break;

    case WorkflowPhase.VIDEO:
      prompt += `
### Video Generation Phase
1. Read project to get all scene image artifact IDs
2. Create video generation plan in \`plans/video.md\`
3. After approval, generate videos for each scene using \`generate_video\`
4. Update scenes with videoArtifactId
5. Use \`stitch_videos\` to combine all scene videos
6. Wait for stitching job to complete
7. Mark phase complete
`;
      break;

    case WorkflowPhase.COMPLETED:
      prompt += `
### Workflow Complete
The video has been generated successfully.
Present the final video location to the user.
Offer to help with any adjustments or start a new project.
`;
      break;
  }

  // Add checkpoint reminder for expensive phases
  if (phaseConfig.isExpensive) {
    prompt += `
## Important: Checkpoint Required
This phase involves expensive operations (${phaseConfig.displayName}).
You MUST get user approval before starting generation.
Use \`ask_user\` to confirm before proceeding with generation.
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
