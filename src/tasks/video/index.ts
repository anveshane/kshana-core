/**
 * Video creation task module.
 * Provides video-specific tools, prompts, and agent factory.
 * Supports both legacy mode and new state-based workflow mode.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { GenericAgent } from '../../core/agent/index.js';
import { LLMClient, type LLMClientConfig } from '../../core/llm/index.js';
import { ToolRegistry, createDefaultToolRegistry } from '../../core/tools/index.js';
import { registerComplexTool } from '../../core/tools/ToolCategories.js';
import { contextStore } from '../../core/context/index.js';
import {
  createPlannerTools,
  type PlannerToolContext,
} from '../../core/tools/builtin/plannerTools.js';
import { BackwardPlanner, AssetScanner } from '../../core/planner/index.js';
import type { UserGoal, ExecutionPlan, AssetRegistry } from '../../core/planner/types.js';
import { getVideoGenerationTools, VIDEO_COMPLEX_TOOLS } from './tools.js';
import { VIDEO_CREATION_SYSTEM_PROMPT, getVideoCreationPrompt } from './prompts.js';
import { getPhaseLogger } from '../../utils/phaseLogger.js';

// Workflow imports
import {
  getWorkflowFileTools,
  getAllFileTools,
  getAllArtifactTools,
  getOrCreateProject,
  loadProject,
  getCurrentPhase,
  WorkflowPhase,
  PHASE_CONFIGS,
  getProjectDir,
  // Style and input type configs
  STYLE_CONFIGS,
  INPUT_TYPE_CONFIGS,
  // Generic template-aware imports
  GenericProjectManager,
  createProjectManager,
} from './workflow/index.js';

// Template system imports
import {
  initializeTemplates,
  listTemplates,
  detectTemplate,
  getTemplateOrThrow,
  TEMPLATE_IDS,
} from '../../templates/index.js';
import type { VideoTemplate, GenericProjectFile } from '../../core/templates/types.js';

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

// Re-export state types
export { resetProjectState, setCurrentProjectId } from './state.js';
export type { Character, Setting, StoryboardScene, ProjectState } from './state.js';

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

  // Add video generation tools
  for (const tool of getVideoGenerationTools()) {
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
  const {
    llmConfig,
    maxIterations = 100,
    includeCharacterGuidelines,
    includeStoryboardGuidelines,
  } = config;

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
 * Includes file tools for reading story content, which is essential for planning phases.
 * Generation tools (images, videos, stitch) are handled by subagents via Task.
 */
export function createWorkflowToolRegistry(): ToolRegistry {
  // Start with default generic tools (think, AskUserQuestion, Task, EnterPlanMode, ExitPlanMode, TodoWrite, context tools)
  const registry = createDefaultToolRegistry();

  // Add ALL file tools (read_file, import_file, read_project, update_project)
  // read_file is needed for orchestrator to read story content before creating character/setting todos
  // Generation tools (images, videos, stitch) are handled by subagents via Task tool
  for (const tool of getAllFileTools()) {
    registry.register(tool);
  }

  // Add artifact tools for fine-grained control
  for (const tool of getAllArtifactTools()) {
    registry.register(tool);
  }

  // Add image/video generation tools so image-generator/video-assembler subagents can submit jobs
  for (const tool of getVideoGenerationTools()) {
    registry.register(tool);
  }

  // Mark complex tools (generate_image, generate_video, edit_image) for confirmation flow
  for (const toolName of VIDEO_COMPLEX_TOOLS) {
    registerComplexTool(toolName);
  }

  return registry;
}

/**
 * Create a tool registry with workflow tools AND planner tools for goal-driven workflow.
 * This enables the backward-planning approach where the agent works from goals.
 */
export function createGoalDrivenToolRegistry(
  templateId?: string,
  basePath: string = process.cwd()
): ToolRegistry {
  // Start with base workflow tools
  const registry = createWorkflowToolRegistry();

  // Initialize templates and get the template
  initializeTemplates();
  const finalTemplateId = templateId || TEMPLATE_IDS.NARRATIVE;
  const template = getTemplateOrThrow(finalTemplateId);

  // Create project manager to get project state
  const projectManager = createProjectManager(basePath);
  const project = projectManager.projectExists()
    ? projectManager.loadProjectSync()
    : projectManager.createEmptyProject(finalTemplateId);

  // Create planner tool context
  const plannerContext: PlannerToolContext = {
    template,
    project,
    projectDir: getProjectDir(basePath),
  };

  // Add planner tools
  for (const tool of createPlannerTools(plannerContext)) {
    registry.register(tool);
  }

  return registry;
}

/**
 * DEPRECATED: Context loading has been replaced with dynamic file discovery.
 *
 * Agents now use:
 * - list_project_files() to discover what content exists
 * - read_file() to read specific content when needed
 *
 * This function is kept for API compatibility but does nothing.
 */
export function loadProjectFilesAsContexts(_basePath: string = process.cwd()): string[] {
  // No longer loads contexts - agents use list_project_files + read_file instead
  return [];
}

/**
 * Create a GenericAgent configured for workflow-based video creation.
 * Uses state-based approach with project files in .kshana/ directory.
 */
export function createWorkflowVideoAgent(config: WorkflowVideoAgentConfig): GenericAgent {
  const { llmConfig, maxIterations = 100, originalInput = '', basePath = process.cwd() } = config;

  // Initialize or load project
  const project = getOrCreateProject(originalInput, undefined, basePath);
  const currentPhase = getCurrentPhase(project);
  const phaseConfig = PHASE_CONFIGS[currentPhase as WorkflowPhase];

  // Load existing project files into context store
  // This makes them available to dispatch_agent and dispatch_content_agent
  const loadedContexts = loadProjectFilesAsContexts(basePath);

  // Create tool registry with workflow tools
  const registry = createWorkflowToolRegistry();

  // Create LLM client
  const llm = new LLMClient(llmConfig);

  // Build custom prompt with workflow context (include loaded contexts info)
  const customPrompt = buildWorkflowAgentPrompt(project, currentPhase as WorkflowPhase, loadedContexts);

  // Create the generic agent with workflow customization
  const agent = new GenericAgent(registry.getAll(), llm, {
    maxIterations,
    customPrompt,
    name: `workflow-video-agent-${currentPhase}`,
  });

  return agent;
}

/**
 * Build the custom prompt for the workflow agent.
 * Uses the skill-based architecture - the orchestrator prompt handles workflow logic.
 * Includes full project context so the LLM knows the project type, style, and user's intent.
 */
function buildWorkflowAgentPrompt(
  project: ReturnType<typeof loadProject>,
  currentPhase: WorkflowPhase,
  loadedContexts: string[] = []
): string {
  const phaseConfig = PHASE_CONFIGS[currentPhase];

  // Get style and input type display names
  const styleDisplay = project?.style
    ? (STYLE_CONFIGS[project.style]?.displayName ?? project.style)
    : 'Not set';
  const inputTypeDisplay = project?.inputType
    ? (INPUT_TYPE_CONFIGS[project.inputType]?.displayName ?? project.inputType)
    : 'Not set';

  // Build loaded contexts section
  let loadedContextsSection = '';
  if (loadedContexts.length > 0) {
    loadedContextsSection = `
## Available Contexts
The following project files have been loaded as contexts:
${loadedContexts.map(c => `- ${c}`).join('\n')}
`;
  }

  // Build project type description based on template/workflow
  const projectTypeDescription = `
## Project Type: Narrative Story Video
This is a **Narrative Story Video** project. The user wants to create a video from a story or narrative content.

**Visual Style**: ${styleDisplay}
All generated images should follow this visual style.

**Input Type**: ${inputTypeDisplay}
${project?.inputType === 'story' ? 'The user has provided complete story/chapter content. Extract and organize this content.' : 'The user has provided a story idea. Develop it into full content.'}

## What This Means For You
When the user provides content (story, chapter, text):
1. **DO NOT ask what they want to do** - they want to create a video from this content
2. **Process the content** according to the current phase
3. **Follow the workflow**: story → characters/settings → scenes → images → video

The user has already chosen "Narrative Story Video" and "${styleDisplay}" style. Honor these choices.
`;

  // Build sub-agent info section
  const subAgentSection = `
## Available Sub-Agents

You can delegate work using these dispatch tools:

### dispatch_explore(query)
Research agent that reads documentation and returns focused summaries.
Use for: Understanding workflows, finding patterns, checking documentation.

### dispatch_skill(skill_name, task)
Specialized skill agents for creative work.

| skill_name | Use For |
|------------|---------|
| content-writing | Plots, stories, characters, settings, scenes, narration |
| image-prompting | Visual descriptions for image generation |
| video-direction | Motion/camera descriptions for video clips |
| research-synthesis | Documentary research and fact-gathering |
| narration-scripting | Voice-over scripts with delivery marks |

### Direct Tools (no dispatch needed)
- \`read_project\` - Read project.json with file summaries
- \`update_project\` - Update project state, phase transitions
- \`AskUserQuestion\` - Ask user for input with options
- \`generate_content\` - Generate content (auto-injects context)
`;

  // Build project state section
  const projectSection = `
${projectTypeDescription}

## Current Project State
- **Project ID**: ${project?.id ?? 'new'}
- **Project Title**: ${project?.title || '(not set)'}
- **Visual Style**: ${styleDisplay}
- **Input Type**: ${inputTypeDisplay}
- **Current Phase**: ${phaseConfig.displayName}
${phaseConfig.isExpensive ? '\n**Note**: This phase involves expensive operations. Get user approval before generation.' : ''}
${loadedContextsSection}
${subAgentSection}
`;

  return projectSection.trim();
}

/**
 * Get a list of all workflow tool names.
 */
export function getWorkflowToolNames(): string[] {
  return [
    // File tools
    'read_file',
    'import_file',
    'read_project',
    'update_project',
    // Stitching
    'stitch_videos',
    // Plus all video tools
    ...getVideoToolNames(),
  ];
}

// =============================================================================
// TEMPLATE-BASED WORKFLOW (v3.0)
// =============================================================================

/**
 * Configuration options for creating a template-based video agent.
 */
export interface TemplateVideoAgentConfig {
  llmConfig: LLMClientConfig;
  maxIterations?: number;
  /** Template ID to use (auto-detected if not provided) */
  templateId?: string;
  /** Original user input/content */
  originalInput?: string;
  /** Project title */
  title?: string;
  /** Visual style ID */
  style?: string;
  /** Base path for project directory (defaults to cwd) */
  basePath?: string;
}

/**
 * Result of template detection
 */
export interface TemplateDetectionResult {
  templateId: string;
  templateName: string;
  inputTypeId: string;
  confidence: number;
  alternatives: Array<{ id: string; displayName: string; description: string }>;
}

/**
 * Initialize the template system.
 * Must be called before using template-based workflow.
 */
export function initializeVideoTemplates(): void {
  initializeTemplates();
}

/**
 * Get available video templates.
 */
export function getAvailableTemplates(): Array<{
  id: string;
  displayName: string;
  description: string;
}> {
  initializeTemplates();
  return listTemplates();
}

/**
 * Detect the best template for given content.
 */
export function detectVideoTemplate(content: string): TemplateDetectionResult | null {
  initializeTemplates();
  const result = detectTemplate(content);

  if (!result) {
    return null;
  }

  const template = getTemplateOrThrow(result.templateId);
  const alternatives = listTemplates().filter(t => t.id !== result.templateId);

  return {
    templateId: result.templateId,
    templateName: template.displayName,
    inputTypeId: result.inputTypeId,
    confidence: result.confidence,
    alternatives,
  };
}

/**
 * Create a GenericAgent configured for template-based video creation.
 * This is the v3.0 template-aware workflow.
 */
export async function createTemplateVideoAgent(config: TemplateVideoAgentConfig): Promise<{
  agent: GenericAgent;
  projectManager: GenericProjectManager;
  template: VideoTemplate;
}> {
  const {
    llmConfig,
    maxIterations = 100,
    templateId,
    originalInput = '',
    title = 'Untitled Project',
    style,
    basePath = process.cwd(),
  } = config;

  // Initialize templates
  initializeTemplates();

  // Determine template
  let finalTemplateId = templateId;
  let inputTypeId: string | undefined;

  if (!finalTemplateId && originalInput) {
    // Auto-detect template
    const detection = detectTemplate(originalInput);
    if (detection) {
      finalTemplateId = detection.templateId;
      inputTypeId = detection.inputTypeId;
    }
  }

  // Default to narrative if no template detected
  finalTemplateId = finalTemplateId || TEMPLATE_IDS.NARRATIVE;
  const template = getTemplateOrThrow(finalTemplateId);

  // Create project manager
  const projectManager = createProjectManager(basePath);

  // Create or load project
  let project;
  if (projectManager.projectExists()) {
    project = await projectManager.loadProject();
  } else {
    project = await projectManager.createProject({
      title,
      templateId: finalTemplateId,
      style: style || template.defaultStyle,
      inputType: inputTypeId,
      inputContent: originalInput,
    });
  }

  // Get current phase info
  const currentPhase = projectManager.getCurrentPhase();
  const phaseInfo = template.phases?.find((p: { id: string }) => p.id === currentPhase);

  // Load contexts from disk
  const contexts = loadProjectFilesAsContexts(basePath);

  // Create tool registry
  const registry = createWorkflowToolRegistry();

  // Create LLM client
  const llm = new LLMClient(llmConfig);

  // Build template-aware prompt
  const customPrompt = buildTemplateAgentPrompt(template, project, phaseInfo, contexts);

  // Create the agent
  const agent = new GenericAgent(registry.getAll(), llm, {
    maxIterations,
    customPrompt,
    name: `template-video-agent-${finalTemplateId}`,
  });

  return { agent, projectManager, template };
}

/**
 * Build the custom prompt for a template-based agent.
 */
function buildTemplateAgentPrompt(
  template: VideoTemplate,
  project: GenericProjectFile | null,
  currentPhase: { id: string; displayName: string; description: string } | undefined,
  loadedContexts: string[]
): string {
  // Build artifact types summary
  const artifactsSummary = Object.entries(template.artifactTypes)
    .map(([id, def]) => `- **${def.displayName}** (${def.category}): ${def.description}`)
    .join('\n');

  // Build phases summary if available
  let phasesSummary = 'No phases defined - artifact-driven workflow.';
  if (template.phases && template.phases.length > 0) {
    phasesSummary = template.phases
      .map((p, i) => `${i + 1}. **${p.displayName}**: ${p.description}`)
      .join('\n');
  }

  // Build loaded contexts section
  let loadedContextsSection = 'No existing project files loaded yet.';
  if (loadedContexts.length > 0) {
    loadedContextsSection = `## Available Contexts
The following project files have been loaded as contexts:
${loadedContexts.map(c => `- ${c}`).join('\n')}

Use the \`generate_content\` tool for creating content - it automatically injects the correct contexts.`;
  }

  // Current phase info
  let currentPhaseSection = '';
  if (currentPhase) {
    currentPhaseSection = `
## Current Phase: ${currentPhase.displayName}
${currentPhase.description}
`;
  }

  return `# ${template.displayName} - Video Creation Workflow

${template.description}

## Project Information
- **Project ID**: ${project?.id ?? 'new'}
- **Title**: ${project?.title || '(not set)'}
- **Template**: ${template.displayName} (v${template.version})
- **Style**: ${project?.style || template.defaultStyle}

${currentPhaseSection}

## Workflow Phases
${phasesSummary}

## Artifact Types
${artifactsSummary}

${loadedContextsSection}

## Your Role

You are an orchestrator guiding the user through the video creation process.

### Guidelines

1. **Follow the artifact dependency order** - Check dependencies before creating artifacts
2. **Get approval for expensive operations** - Image and video generation require confirmation
3. **Track progress** - Use update_project to track artifact status
4. **Offer choices** - When multiple approaches are valid, present options to the user
5. **Explain what you're doing** - Keep the user informed of progress

### Available Tools

- **read_project**: Read current project state
- **update_project**: Update project state (artifacts, phases)
- **read_file**: Read project files
- **import_file**: Import/copy external files into the project
- **generate_content**: Generate content using AI (with automatic context injection)
- **ask_user**: Ask user for input or confirmation
- **Task**: Dispatch subagents for complex tasks

### Getting Started

1. Read the current project state with read_project
2. Determine what artifact to work on next based on dependencies
3. Create or update artifacts as needed
4. Get user approval for completed artifacts
5. Proceed to the next artifact or phase
`;
}

/**
 * Get template by ID.
 */
export function getVideoTemplate(templateId: string): VideoTemplate {
  initializeTemplates();
  return getTemplateOrThrow(templateId);
}

/**
 * Re-export template IDs for convenience.
 */
export { TEMPLATE_IDS } from '../../templates/index.js';
