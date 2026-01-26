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
import { loadAndRenderMarkdown, loadMarkdown } from '../../core/prompts/loader.js';
import { getVideoGenerationTools, VIDEO_COMPLEX_TOOLS } from './tools.js';
import { getProjectStateTools } from './state.js';
import { VIDEO_CREATION_SYSTEM_PROMPT, getVideoCreationPrompt } from './prompts.js';
import { getPhaseLogger } from '../../utils/phaseLogger.js';

// Workflow imports
import {
  getWorkflowFileTools,
  getOrCreateProject,
  loadProject,
  getCurrentPhase,
  WorkflowPhase,
  PHASE_CONFIGS,
  getProjectDir,
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
 * Orchestrator only needs file/project tools - generation is handled by subagents via Task.
 */
export function createWorkflowToolRegistry(): ToolRegistry {
  // Start with default generic tools (think, AskUserQuestion, Task, EnterPlanMode, ExitPlanMode, TodoWrite, context tools)
  const registry = createDefaultToolRegistry();

  // Add workflow file tools (read_file, write_file, read_project, update_project)
  // Note: Generation tools (images, videos, stitch) are handled by subagents via Task tool
  for (const tool of getWorkflowFileTools()) {
    registry.register(tool);
  }

  return registry;
}

/**
 * Load existing project plan files into context store.
 * Returns array of context variable names that were loaded.
 *
 * Phase-specific loading could be added here in the future:
 * - plot phase: only original_input
 * - story phase: plot
 * - characters_settings: story
 * - scenes: story, characters
 * - images: characters, scenes
 * - video: scenes, images
 */
export function loadProjectFilesAsContexts(basePath: string = process.cwd()): string[] {
  const projectDir = getProjectDir(basePath);
  const plansDir = join(projectDir, 'plans');
  const loadedContexts: string[] = [];
  let totalChars = 0;

  const contextSizes: Record<string, number> = {};

  // Load the original user input first - this is critical for content generation
  // Variable name MUST be $original_input to match phase prompts
  const originalInputPath = join(projectDir, 'original_input.md');
  if (existsSync(originalInputPath)) {
    try {
      const content = readFileSync(originalInputPath, 'utf-8');
      if (content.trim().length > 0) {
        const { variableName } = contextStore.store(content, 'Original User Input', {
          source: 'user_input',
          variableBaseName: 'original_input',
        });
        loadedContexts.push(variableName);
        contextSizes['original_input'] = content.length;
        totalChars += content.length;
      }
    } catch {
      // Skip if can't be read
    }
  }

  // Plan files to load with their context labels
  const planFiles = [
    { file: 'plot.md', label: 'Plot Outline', varName: 'plot' },
    { file: 'story.md', label: 'Story', varName: 'story' },
    { file: 'scenes.md', label: 'Scenes', varName: 'scenes' },
    { file: 'characters.md', label: 'Characters', varName: 'characters' },
    { file: 'settings.md', label: 'Settings', varName: 'settings' },
    { file: 'images.md', label: 'Image Plan', varName: 'images' },
  ];

  for (const { file, label, varName } of planFiles) {
    const filePath = join(plansDir, file);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        if (content.trim().length > 0) {
          const { variableName } = contextStore.store(content, label, {
            source: 'tool',
            variableBaseName: varName,
          });
          loadedContexts.push(variableName);
          contextSizes[varName] = content.length;
          totalChars += content.length;
        }
      } catch {
        // Skip files that can't be read
      }
    }
  }

  // Log context loading metrics for phase-aware monitoring
  if (loadedContexts.length > 0) {
    const phaseLogger = getPhaseLogger();
    // Estimate tokens: ~3 chars per token
    const estimatedTokens = Math.ceil(totalChars / 3);
    phaseLogger.info('Workflow', 'context_loading', `Loaded ${loadedContexts.length} contexts (~${estimatedTokens} tokens)`, {
      contexts: loadedContexts,
      sizes: contextSizes,
      totalChars,
      estimatedTokens,
    });
  }

  return loadedContexts;
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
  const project = getOrCreateProject(originalInput, undefined, basePath);
  const currentPhase = getCurrentPhase(project);
  const phaseConfig = PHASE_CONFIGS[currentPhase];

  // Load existing project files into context store
  // This makes them available to dispatch_agent and dispatch_content_agent
  const loadedContexts = loadProjectFilesAsContexts(basePath);

  // Create tool registry with workflow tools
  const registry = createWorkflowToolRegistry();

  // Create LLM client
  const llm = new LLMClient(llmConfig);

  // Build custom prompt with workflow context (include loaded contexts info)
  const customPrompt = buildWorkflowAgentPrompt(project, currentPhase, loadedContexts);

  // Create the generic agent with workflow customization
  const agent = new GenericAgent(registry.getAll(), llm, {
    maxIterations,
    customPrompt,
    name: `workflow-video-agent-${currentPhase}`,
  });

  return agent;
}

/**
 * Map workflow phases to their prompt file paths.
 */
const PHASE_PROMPT_FILES: Record<WorkflowPhase, string> = {
  [WorkflowPhase.PLOT]: 'video/phases/plot.md',
  [WorkflowPhase.STORY]: 'video/phases/story.md',
  [WorkflowPhase.CHARACTERS_SETTINGS]: 'video/phases/characters-settings.md',
  [WorkflowPhase.SCENES]: 'video/phases/scenes.md',
  [WorkflowPhase.CHARACTER_SETTING_IMAGES]: 'video/phases/character-setting-images.md',
  [WorkflowPhase.SCENE_IMAGES]: 'video/phases/scene-images.md',
  [WorkflowPhase.VIDEO]: 'video/phases/video.md',
  [WorkflowPhase.VIDEO_COMBINE]: 'video/phases/video-combine.md',
  [WorkflowPhase.COMPLETED]: 'video/phases/completed.md',
};

/**
 * Build the custom prompt for the workflow agent based on current phase.
 * Loads prompts from markdown files for easier maintenance.
 */
function buildWorkflowAgentPrompt(
  project: ReturnType<typeof loadProject>,
  currentPhase: WorkflowPhase,
  loadedContexts: string[] = []
): string {
  const phaseConfig = PHASE_CONFIGS[currentPhase];

  // Build loaded contexts section
  let loadedContextsSection = 'No existing project files loaded yet.';
  if (loadedContexts.length > 0) {
    loadedContextsSection = `## Available Contexts
The following project files have been loaded as contexts:
${loadedContexts.map(c => `- ${c}`).join('\n')}

Use the \`generate_content\` tool for creating content - it automatically injects the correct contexts.
For example: \`generate_content(content_type: "plot")\` automatically uses \$original_input.`;
  }

  // Load phase-specific instructions from file
  const phasePromptFile = PHASE_PROMPT_FILES[currentPhase];
  let phaseInstructions = '';
  try {
    phaseInstructions = loadMarkdown(phasePromptFile);
  } catch {
    // Fallback if file not found
    phaseInstructions = `Phase instructions for ${currentPhase} not found.`;
  }

  // Build expensive checkpoint section
  let expensiveCheckpoint = '';
  if (phaseConfig.isExpensive) {
    expensiveCheckpoint = `
## Important: Checkpoint Required
This phase involves expensive operations (${phaseConfig.displayName}).
You MUST get user approval before starting generation.
`;
  }

  // Load and render the base workflow template
  return loadAndRenderMarkdown('video/workflow.md', {
    project_id: project?.id ?? 'new',
    project_title: project?.title || '(not set)',
    phase_display_name: phaseConfig.displayName,
    current_phase: currentPhase,
    loaded_contexts: loadedContextsSection,
    phase_instructions: phaseInstructions,
    expensive_checkpoint: expensiveCheckpoint,
  });
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
export function getAvailableTemplates(): Array<{ id: string; displayName: string; description: string }> {
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
  const alternatives = listTemplates().filter((t) => t.id !== result.templateId);

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
export async function createTemplateVideoAgent(
  config: TemplateVideoAgentConfig
): Promise<{
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
${loadedContexts.map((c) => `- ${c}`).join('\n')}

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
- **write_file**: Write project files
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
