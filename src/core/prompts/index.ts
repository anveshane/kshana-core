/**
 * System prompts for the generic agent framework.
 * Reads prompts from JSON files in /prompts/ directory.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDefinition } from '../llm/index.js';

// Get project root (3 levels up from src/core/prompts/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', '..', '..', 'prompts');
const WORKFLOW_PROMPTS_DIR = join(PROMPTS_DIR, 'workflow');

/**
 * Prompt JSON schema
 */
interface PromptJson {
  name: string;
  description: string;
  version: string;
  content: string;
  metadata?: {
    sections?: string[];
    created_at?: string;
    source?: string;
  };
  extensions?: Record<string, string>;
}

/**
 * Load a prompt from JSON file.
 */
function loadPrompt(name: string): PromptJson {
  const filePath = join(PROMPTS_DIR, `${name}.json`);
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as PromptJson;
}

// Load prompts from JSON files
const basePrompt = loadPrompt('base');
const orchestratorPrompt = loadPrompt('orchestrator');
const subAgentPrompt = loadPrompt('subAgent');
const planningPrompt = loadPrompt('planning');
const contentPrompt = loadPrompt('content');
const imageGenerationPrompt = loadPrompt('imageGeneration');
const videoGenerationPrompt = loadPrompt('videoGeneration');

// Export prompt content for backwards compatibility
export const GENERIC_AGENT_BASE_PROMPT = basePrompt.content;
export const GENERIC_AGENT_ORCHESTRATOR_SECTION = orchestratorPrompt.content;
export const GENERIC_AGENT_SUB_AGENT_SECTION = subAgentPrompt.content;
export const PLANNING_AGENT_PROMPT = planningPrompt.content;
export const CONTENT_AGENT_PROMPT = contentPrompt.content;
export const IMAGE_GENERATION_AGENT_PROMPT = imageGenerationPrompt.content;
export const VIDEO_GENERATION_AGENT_PROMPT = videoGenerationPrompt.content;

// Combined prompt for main agent (base + orchestrator)
export const GENERIC_AGENT_SYSTEM_PROMPT =
  GENERIC_AGENT_BASE_PROMPT + GENERIC_AGENT_ORCHESTRATOR_SECTION;

// Tool categories for prompt building
const COMPLEX_TOOLS = new Set(['generate_image', 'generate_video', 'edit_image']);

function isComplexTool(toolName: string): boolean {
  return COMPLEX_TOOLS.has(toolName);
}

/**
 * Build tool descriptions section for the system prompt.
 */
function buildToolDescriptions(tools: Map<string, ToolDefinition>): string {
  const lines = ['## Available Tools', ''];
  for (const [name, tool] of tools) {
    const category = isComplexTool(name) ? 'complex' : 'simple';
    lines.push(`- \`${name}\` (${category}): ${tool.description}`);
  }
  return lines.join('\n');
}

/**
 * Context variable info for the system prompt.
 * variableName is used as the primary reference (e.g., "$plan", "$chapter_1")
 */
export interface ContextVariable {
  variableName: string; // Primary key like $chapter_1 (used as context_ref)
  label: string;        // Description
  charCount: number;    // Size
}

/**
 * Build context variables section for the system prompt.
 * These are large content blocks stored by reference that the agent can access.
 * Provides clear guidance on what each variable contains and how to use it.
 */
export function buildContextVariablesSection(variables: ContextVariable[]): string {
  if (variables.length === 0) {
    return '';
  }

  const lines = [
    '## Stored Context Variables',
    '',
    'The following content has been stored for use with sub-agents. **Use these when dispatching tasks that need this content.**',
    '',
  ];

  for (const v of variables) {
    lines.push(`### ${v.variableName}`);
    lines.push(`- **context_ref**: \`"${v.variableName}"\``);
    lines.push(`- **Content**: ${v.label}`);
    lines.push(`- **Size**: ${v.charCount.toLocaleString()} characters`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('**How to use stored context:**');
  lines.push('');
  lines.push('When dispatching a sub-agent that needs content from a stored variable:');
  lines.push('1. Identify which variable contains the relevant content');
  lines.push('2. Pass its `context_ref` to the dispatch tool');
  lines.push('3. Do NOT summarize the content inline - the full content will be provided');
  lines.push('');

  if (variables.length > 0) {
    const varNames = variables.map(v => `"${v.variableName}"`).join(', ');
    lines.push('**Example:**');
    lines.push('```');
    lines.push(`// Pass ALL relevant contexts to content agents:`);
    lines.push(`dispatch_content_agent(task="...", content_type="...", context_refs=[${varNames}])`);
    lines.push('```');
  }

  return lines.join('\n');
}

/**
 * Build the complete system message for an agent.
 * Uses XML tags to wrap custom prompts for clear structure.
 *
 * @param isSubAgent - Whether this is a sub-agent
 * @param tools - Map of tool name to tool definition
 * @param customPrompt - Optional custom prompt to append (domain-specific)
 */
export function buildSystemMessage(
  isSubAgent: boolean,
  tools: Map<string, ToolDefinition>,
  customPrompt?: string
): string {
  let prompt: string;

  if (isSubAgent) {
    // Sub-agents get base + sub-agent section (no orchestrator)
    prompt = GENERIC_AGENT_BASE_PROMPT + '\n' + GENERIC_AGENT_SUB_AGENT_SECTION;
  } else {
    // Main agent gets base + orchestrator section
    prompt = GENERIC_AGENT_SYSTEM_PROMPT;
  }

  // Add tool descriptions wrapped in XML tags
  prompt += '\n\n<tools>\n' + buildToolDescriptions(tools) + '\n</tools>';

  // Add custom domain-specific prompt if provided, wrapped in XML tags
  if (customPrompt) {
    prompt += '\n\n<custom_instructions>\n' + customPrompt + '\n</custom_instructions>';
  }

  return prompt;
}

/**
 * Get prompt metadata (version, sections, etc.)
 */
export function getPromptMetadata(name: 'base' | 'orchestrator' | 'subAgent' | 'planning'): PromptJson {
  return loadPrompt(name);
}

/**
 * Build the planning sub-agent system prompt with task and context substitution.
 * Uses XML tags to wrap interpolated values for clear structure.
 *
 * @param task - The task description for the planning agent
 * @param context - Optional context/background information
 * @returns The complete planning system prompt
 */
export function buildPlanningPrompt(task: string, context?: string): string {
  const taskSection = `<task>\n${task}\n</task>`;
  const contextSection = context ? `\n<context>\n${context}\n</context>` : '';
  return PLANNING_AGENT_PROMPT
    .replace('{{task}}', taskSection)
    .replace('{{context}}', contextSection);
}

/**
 * Content types supported by the content agent.
 */
export type ContentType = 'plot' | 'story' | 'character' | 'setting' | 'scene' | 'narration';

/**
 * Build the content creation sub-agent system prompt.
 * Used for creative writing tasks like stories, characters, and scene descriptions.
 *
 * @param task - The content creation task description
 * @param contentType - Type of content to generate (plot, story, character, etc.)
 * @param context - Optional background context (existing story elements, etc.)
 * @returns The complete content agent system prompt
 */
export function buildContentPrompt(
  task: string,
  contentType: ContentType,
  context?: string
): string {
  const taskSection = `<task>\n${task}\n</task>`;
  const contextSection = context ? `\n<context>\n${context}\n</context>` : '';
  return CONTENT_AGENT_PROMPT
    .replace('{{task}}', taskSection)
    .replace('{{content_type}}', contentType)
    .replace('{{context}}', contextSection);
}

/**
 * Wrap user task in XML tags for structured prompts.
 */
export function wrapUserTask(task: string): string {
  return `<user_task>\n${task}\n</user_task>`;
}

/**
 * Wrap custom prompt in XML tags.
 */
export function wrapCustomPrompt(prompt: string): string {
  return `<custom_instructions>\n${prompt}\n</custom_instructions>`;
}

/**
 * Build the image generation sub-agent system prompt with task and context substitution.
 * Uses XML tags to wrap interpolated values for clear structure.
 *
 * @param task - Description of the image to generate
 * @param context - Optional context (character details, scene info, etc.)
 * @returns The complete image generation system prompt
 */
export function buildImageGenerationPrompt(task: string, context?: string): string {
  const taskSection = `<task>\n${task}\n</task>`;
  const contextSection = context ? `\n<context>\n${context}\n</context>` : '';
  return IMAGE_GENERATION_AGENT_PROMPT
    .replace('{{task}}', taskSection)
    .replace('{{context}}', contextSection);
}

/**
 * Video generation prompt options.
 */
export interface VideoGenerationPromptOptions {
  task: string;
  sceneNumber: number;
  sceneImageArtifactId: string;
  motionDescription?: string;
  context?: string;
}

/**
 * Build the video generation sub-agent system prompt with task and context substitution.
 * Used for animating scene images into video clips.
 *
 * @param options - Video generation options including task, scene info, and motion description
 * @returns The complete video generation system prompt
 */
export function buildVideoGenerationPrompt(options: VideoGenerationPromptOptions): string {
  const { task, sceneNumber, sceneImageArtifactId, motionDescription, context } = options;

  const taskSection = `<task>\n${task}\n</task>`;
  const contextSection = context ? `\n<context>\n${context}\n</context>` : '';
  const sceneNumberStr = String(sceneNumber);
  const motionStr = motionDescription || 'subtle camera movement, natural motion';

  return VIDEO_GENERATION_AGENT_PROMPT
    .replace('{{task}}', taskSection)
    .replace('{{context}}', contextSection)
    .replace('{{scene_number}}', sceneNumberStr)
    .replace('{{scene_image_artifact_id}}', sceneImageArtifactId)
    .replace('{{motion_description}}', motionStr);
}

// ============================================================================
// Workflow Prompt Functions
// ============================================================================

/**
 * Workflow prompt names that can be loaded.
 */
export type WorkflowPromptName =
  // Legacy prompts
  | 'story-discovery'
  | 'character-descriptions'
  | 'three-acts'
  | 'act-scenes'
  | 'storyboard-images'
  | 'video-generation'
  | 'final-signoff'
  // 8-phase workflow prompts
  | 'orchestrator'
  | 'plot'
  | 'story'
  | 'characters-settings'
  | 'scenes'
  | 'character-setting-images'
  | 'scene-images'
  | 'video'
  | 'video-combine';

/**
 * Load a workflow prompt from the workflow prompts directory.
 * @param name - Name of the workflow prompt (without .json extension)
 * @returns The prompt JSON or null if not found
 */
export function loadWorkflowPrompt(name: WorkflowPromptName): PromptJson | null {
  const filePath = join(WORKFLOW_PROMPTS_DIR, `${name}.json`);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as PromptJson;
  } catch {
    return null;
  }
}

/**
 * Build a workflow phase prompt with variable substitution.
 *
 * @param phaseName - Name of the workflow phase prompt
 * @param variables - Variables to substitute in the prompt (e.g., task, context, output_file)
 * @returns The complete prompt with variables substituted
 */
export function buildWorkflowPhasePrompt(
  phaseName: WorkflowPromptName,
  variables: Record<string, string>
): string | null {
  const prompt = loadWorkflowPrompt(phaseName);

  if (!prompt) {
    return null;
  }

  let content = prompt.content;

  // Substitute all variables
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    content = content.replace(new RegExp(placeholder, 'g'), value);
  }

  return content;
}

/**
 * Build a planner agent prompt for a specific workflow phase.
 * This wraps the workflow phase prompt with appropriate XML tags.
 *
 * @param phaseName - The workflow phase
 * @param task - The task description
 * @param context - Context from previous phases
 * @param outputFile - File path where plan should be written
 * @returns The complete planner prompt
 */
export function buildWorkflowPlannerPrompt(
  phaseName: WorkflowPromptName,
  task: string,
  context: string,
  outputFile: string
): string {
  const prompt = buildWorkflowPhasePrompt(phaseName, {
    task,
    context,
    output_file: outputFile,
  });

  if (!prompt) {
    // Fallback to generic planning prompt
    return buildPlanningPrompt(task, context);
  }

  return prompt;
}

/**
 * Get the orchestrator prompt for workflow-based video generation.
 * @returns The orchestrator prompt content or null
 */
export function getWorkflowOrchestratorPrompt(): string | null {
  const prompt = loadWorkflowPrompt('orchestrator');
  return prompt?.content ?? null;
}

/**
 * List all available workflow prompts.
 * @returns Array of available prompt names
 */
export function listWorkflowPrompts(): WorkflowPromptName[] {
  return [
    // Legacy prompts
    'story-discovery',
    'character-descriptions',
    'three-acts',
    'act-scenes',
    'storyboard-images',
    'video-generation',
    'final-signoff',
    // 8-phase workflow prompts
    'orchestrator',
    'plot',
    'story',
    'characters-settings',
    'scenes',
    'character-setting-images',
    'scene-images',
    'video',
    'video-combine',
  ];
}
