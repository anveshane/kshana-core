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
const imageGenerationPrompt = loadPrompt('imageGeneration');

// Export prompt content for backwards compatibility
export const GENERIC_AGENT_BASE_PROMPT = basePrompt.content;
export const GENERIC_AGENT_ORCHESTRATOR_SECTION = orchestratorPrompt.content;
export const GENERIC_AGENT_SUB_AGENT_SECTION = subAgentPrompt.content;
export const PLANNING_AGENT_PROMPT = planningPrompt.content;
export const IMAGE_GENERATION_AGENT_PROMPT = imageGenerationPrompt.content;

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

// ============================================================================
// Workflow Prompt Functions
// ============================================================================

/**
 * Workflow prompt names that can be loaded.
 */
export type WorkflowPromptName =
  | 'story-discovery'
  | 'character-descriptions'
  | 'three-acts'
  | 'act-scenes'
  | 'storyboard-images'
  | 'video-generation'
  | 'orchestrator'
  | 'final-signoff';

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
    'story-discovery',
    'character-descriptions',
    'three-acts',
    'act-scenes',
    'storyboard-images',
    'video-generation',
    'orchestrator',
    'final-signoff',
  ];
}
