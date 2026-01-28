/**
 * System prompts for the generic agent framework.
 * Reads prompts from markdown files in /prompts/ directory.
 */
import type { ToolDefinition } from '../llm/index.js';
import { loadAndRenderMarkdown, type PromptContext } from './loader.js';
import os from 'os';
import { existsSync } from 'fs';
import path from 'path';

// NOTE: These are loaded at runtime via buildSystemMessage/build*Prompt functions.
export const GENERIC_AGENT_BASE_PROMPT = '';
export const GENERIC_AGENT_ORCHESTRATOR_SECTION = '';
export const GENERIC_AGENT_SUB_AGENT_SECTION = '';
export const PLANNING_AGENT_PROMPT = '';
export const CONTENT_AGENT_PROMPT = '';
export const IMAGE_GENERATION_AGENT_PROMPT = '';
export const VIDEO_GENERATION_AGENT_PROMPT = '';

export interface PromptRuntimeContext {
  working_directory?: string;
  is_git_repo?: string;
  platform?: string;
  os_version?: string;
  date?: string;
  model_name?: string;
  model_id?: string;
  subagent_types?: { name: string; description: string; tools: string }[];
}

function toPromptContext(ctx: PromptRuntimeContext): PromptContext {
  return ctx as unknown as PromptContext;
}

// NOTE: Tool descriptions are provided via the LLM API's tools parameter,
// not in the system message. This avoids duplication.

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
/**
 * Check if the current working directory is a git repository.
 */
function isGitRepo(dir: string): boolean {
  return existsSync(path.join(dir, '.git'));
}

/**
 * Build the runtime environment context with actual system values.
 */
function buildEnvContext(): PromptRuntimeContext {
  const cwd = process.cwd();
  return {
    working_directory: cwd,
    is_git_repo: isGitRepo(cwd) ? 'Yes' : 'No',
    platform: process.platform,
    os_version: os.release(),
    date: new Date().toISOString().split('T')[0],
    // model_name and model_id are set by the caller if needed
  };
}

export function buildSystemMessage(
  isSubAgent: boolean,
  tools: Map<string, ToolDefinition>,
  customPrompt?: string
): string {
  const envContext = buildEnvContext();

  const base = loadAndRenderMarkdown('system/base.md', toPromptContext(envContext));
  const roleSection = isSubAgent
    ? loadAndRenderMarkdown('system/subagent.md', toPromptContext(envContext))
    : loadAndRenderMarkdown('system/orchestrator.md', toPromptContext(envContext));
  const env = loadAndRenderMarkdown('system/env.md', toPromptContext(envContext));

  let prompt = [base, roleSection, env].filter(Boolean).join('\n\n');

  // NOTE: Tool descriptions are NOT included here - they are provided via the LLM API's tools parameter.
  // This avoids duplicating tool info in both the system message and the API tools array.

  // Add custom domain-specific prompt if provided, wrapped in XML tags
  if (customPrompt) {
    prompt += '\n\n<custom_instructions>\n' + customPrompt + '\n</custom_instructions>';
  }

  return prompt;
}

/**
 * Get prompt metadata (version, sections, etc.)
 */
// Metadata is no longer tracked in JSON.
export function getPromptMetadata(): null {
  return null;
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
  const base = loadAndRenderMarkdown('system/base.md', {});
  const sub = loadAndRenderMarkdown('system/subagent.md', {});
  const plan = loadAndRenderMarkdown('subagents/plan.md', {});
  return [base, sub, plan, taskSection, contextSection].filter(Boolean).join('\n\n');
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
  const base = loadAndRenderMarkdown('system/base.md', {});
  const sub = loadAndRenderMarkdown('system/subagent.md', {});
  const content = loadAndRenderMarkdown('subagents/content-creator.md', { content_type: contentType });
  return [base, sub, content, taskSection, contextSection].filter(Boolean).join('\n\n');
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
  const base = loadAndRenderMarkdown('system/base.md', {});
  const sub = loadAndRenderMarkdown('system/subagent.md', {});
  const img = loadAndRenderMarkdown('subagents/image-generator.md', {});
  return [base, sub, img, taskSection, contextSection].filter(Boolean).join('\n\n');
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
  const motionStr = motionDescription ?? 'subtle camera movement, natural motion';

  const base = loadAndRenderMarkdown('system/base.md', {});
  const sub = loadAndRenderMarkdown('system/subagent.md', {});
  const vid = loadAndRenderMarkdown('subagents/video-assembler.md', {});

  const sceneSection = `<scene>\n<scene_number>\n${sceneNumberStr}\n</scene_number>\n<scene_image_artifact_id>\n${sceneImageArtifactId}\n</scene_image_artifact_id>\n<motion_description>\n${motionStr}\n</motion_description>\n</scene>`;

  return [base, sub, vid, taskSection, contextSection, sceneSection].filter(Boolean).join('\n\n');
}
