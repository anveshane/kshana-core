/**
 * System prompts for the generic agent framework.
 * Reads prompts from markdown files in /prompts/ directory.
 */
import type { ToolDefinition } from '../llm/index.js';
import { loadAndRenderMarkdown, loadMarkdown, loadContentTypeSkills, resolveGuide, type PromptContext, type SkillResolutionContext } from './loader.js';
import { getProviderRegistry, type ProviderConfig } from '../../services/providers/index.js';
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
 * DEPRECATED: Context variable info - no longer used.
 * Context variables have been replaced with dynamic file discovery.
 */
export interface ContextVariable {
  variableName: string;
  label: string;
  charCount: number;
}

/**
 * DEPRECATED: No longer builds context variables section.
 * Context variables have been replaced with dynamic file discovery.
 * Agents use list_project_files() + read_file() instead.
 *
 * Always returns empty string.
 */
export function buildContextVariablesSection(_variables: ContextVariable[]): string {
  // Context variables are no longer used - return empty
  // Agents now use list_project_files() + read_file() for content discovery
  return '';
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

/**
 * Build a project state section for injection into the orchestrator prompt.
 * Returns empty string if no project state provided.
 */
function buildProjectStateSection(projectState: Record<string, unknown> | null): string {
  if (!projectState) {
    return '';
  }

  // Extract file paths for prominent display
  const files = (projectState['files'] as Array<{ path: string; type: string; name?: string }>) || [];
  const filesByType: Record<string, string[]> = {};
  for (const file of files) {
    const type = file.type || 'other';
    if (!filesByType[type]) filesByType[type] = [];
    const display = file.name ? `${file.path} (${file.name})` : file.path;
    filesByType[type].push(display);
  }

  let filesList = '';
  for (const [type, paths] of Object.entries(filesByType)) {
    if (paths.length > 0) {
      filesList += `\n**${type}**: ${paths.join(', ')}`;
    }
  }

  // Extract goal for prominent display
  const goal = projectState['goal'] as { description?: string; targetArtifacts?: string[]; status?: string; achievedAt?: number } | undefined;
  let goalSection = '';
  if (goal) {
    goalSection = `\n## Current Goal\n- **Description**: ${goal.description}\n- **Targets**: ${(goal.targetArtifacts || []).join(', ')}\n- **Status**: ${goal.status}${goal.achievedAt ? ' (completed)' : ''}\n`;
  } else {
    goalSection = `\n## Current Goal\nNo goal set. Understand user intent and call \`set_goal\` to persist it.\n`;
  }

  return `
<project_state>
The following is the current project state. This is automatically injected - you do NOT need to call read_project at the start.
${goalSection}
## Available Files (use EXACT paths with read_file)
${filesList || 'No files created yet.'}

**IMPORTANT**: Use the exact file paths shown above. Do NOT construct paths from array indices (e.g., "0.md", "1.md" are WRONG).

## Full Project State
\`\`\`json
${JSON.stringify(projectState, null, 2)}
\`\`\`

**When to use read_project:**
- Only call \`read_project\` if you believe the project state has changed (e.g., after content generation/approval)
- Only call it if you need the updated state to make a decision
- Do NOT call it at the start of a conversation - you already have the state above
</project_state>
`;
}

export function buildSystemMessage(
  isSubAgent: boolean,
  tools: Map<string, ToolDefinition>,
  customPrompt?: string,
  projectState?: Record<string, unknown> | null
): string {
  const envContext = buildEnvContext();

  const base = loadAndRenderMarkdown('system/base.md', toPromptContext(envContext));
  const roleSection = isSubAgent
    ? loadAndRenderMarkdown('system/subagent.md', toPromptContext(envContext))
    : loadAndRenderMarkdown('system/orchestrator.md', toPromptContext(envContext));
  let prompt = [base, roleSection].filter(Boolean).join('\n\n');

  // NOTE: Tool descriptions are NOT included here - they are provided via the LLM API's tools parameter.
  // This avoids duplicating tool info in both the system message and the API tools array.

  // Add project state for main orchestrator (not sub-agents)
  if (!isSubAgent && projectState) {
    prompt += '\n\n' + buildProjectStateSection(projectState);
  }

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
export type ContentType = 'plot' | 'story' | 'character' | 'setting' | 'scene' | 'narration'
  | 'character_image_prompt' | 'setting_image_prompt' | 'scene_image_prompt' | 'scene_video_prompt'
  | 'shot_image_prompt';

/** Map content types to the generation capability they require. */
const CONTENT_TYPE_CAPABILITY: Partial<Record<ContentType, string>> = {
  scene_video_prompt: 'videoGeneration',
  scene_image_prompt: 'imageEditing',
  character_image_prompt: 'imageGeneration',
  setting_image_prompt: 'imageGeneration',
  shot_image_prompt: 'imageEditing',
};

/** Default ComfyUI workflow names per capability. */
const COMFYUI_DEFAULT_WORKFLOWS: Record<string, string> = {
  videoGeneration: 'ltx23',
  imageGeneration: 'zimage',
  imageEditing: 'flux2_klein_edit',
};

/**
 * Resolve the default ComfyUI workflow name for a given capability.
 * Returns undefined if the capability is unknown.
 */
export function getDefaultWorkflowForCapability(capability: string): string | undefined {
  return COMFYUI_DEFAULT_WORKFLOWS[capability];
}

/**
 * Resolve the skill context (provider + workflow) for a given content type
 * by reading the active provider configuration from ProviderRegistry.
 */
function resolveSkillContext(contentType: ContentType): SkillResolutionContext | undefined {
  const capability = CONTENT_TYPE_CAPABILITY[contentType];
  if (!capability) return undefined;

  try {
    const config: ProviderConfig = getProviderRegistry().getConfig();

    // capability key matches config key names (videoGeneration, imageGeneration, imageEditing)
    const providerId = config[capability as keyof ProviderConfig];
    if (!providerId) return undefined;

    const workflowName = providerId === 'comfyui'
      ? COMFYUI_DEFAULT_WORKFLOWS[capability]
      : undefined;

    return { providerId, workflowName };
  } catch {
    // ProviderRegistry not initialised yet — no skill injection
    return undefined;
  }
}

/**
 * Build the content creation sub-agent system prompt.
 * Used for creative writing tasks like stories, characters, and scene descriptions.
 *
 * @param task - The content creation task description
 * @param contentType - Type of content to generate (plot, story, character, etc.)
 * @param context - Optional background context (existing story elements, etc.)
 * @returns The complete content agent system prompt
 */
export interface ContentPromptResult {
  /** The complete system prompt string. */
  prompt: string;
  /** Filenames of injected model skill files (empty if none). */
  injectedSkills: string[];
}

/** Content types whose guides are injected via template variables (not <model_skills>). */
const GUIDE_INJECTED_TYPES: Record<string, ContentType> = {
  character_image_guide: 'character_image_prompt',
  setting_image_guide: 'setting_image_prompt',
  scene_image_guide: 'scene_image_prompt',
  scene_video_guide: 'scene_video_prompt',
  shot_image_guide: 'shot_image_prompt',
};

export function buildContentPrompt(
  task: string,
  contentType: ContentType,
  context?: string,
  projectDir?: string,
): ContentPromptResult {
  const taskSection = `<task>\n${task}\n</task>`;
  const contextSection = context ? `\n<context>\n${context}\n</context>` : '';
  const base = loadAndRenderMarkdown('system/base.md', {});
  const sub = loadAndRenderMarkdown('system/subagent.md', {});

  // Resolve image guides and inject as template variables
  const templateVars: Record<string, unknown> = { content_type: contentType };
  const allInjectedSkills: string[] = [];

  for (const [guideName, guideContentType] of Object.entries(GUIDE_INJECTED_TYPES)) {
    if (guideContentType !== contentType) {
      templateVars[guideName] = '';  // suppress {{#if}} block for irrelevant guides
      continue;
    }
    const guideSkillCtx = resolveSkillContext(guideContentType);
    const resolved = resolveGuide(guideName, guideContentType, guideSkillCtx, projectDir);
    templateVars[guideName] = resolved.content;
    if (resolved.source !== 'none' && !resolved.source.startsWith('default:')) {
      allInjectedSkills.push(resolved.source);
    }
  }

  const content = loadAndRenderMarkdown('subagents/content-creator.md', templateVars as PromptContext);

  // For content types NOT handled by template injection, still inject <model_skills>
  const guideInjectedSet = new Set(Object.values(GUIDE_INJECTED_TYPES));
  let skillsSection = '';
  if (!guideInjectedSet.has(contentType)) {
    const skillContext = resolveSkillContext(contentType);
    const skills = loadContentTypeSkills(contentType, skillContext, projectDir);
    if (skills.content) {
      skillsSection = `\n<model_skills>\n${skills.content}\n</model_skills>`;
      allInjectedSkills.push(...skills.loadedFiles);
    }
  }

  const prompt = [base, sub, content, skillsSection, taskSection, contextSection].filter(Boolean).join('\n\n');
  return { prompt, injectedSkills: allInjectedSkills };
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

/**
 * Skill types supported by the skill-based architecture.
 */
export type SkillType =
  | 'content-writing'
  | 'image-prompting'
  | 'video-direction'
  | 'research-synthesis'
  | 'narration-scripting';

/**
 * Build the explore agent system prompt.
 * The explore agent reads documentation and summarizes relevant guidance for the orchestrator.
 *
 * @param query - The query describing what guidance is needed
 * @returns The complete explore agent system prompt
 */
export function buildExplorePrompt(query: string): string {
  const querySection = `<query>\n${query}\n</query>`;
  const base = loadAndRenderMarkdown('system/base.md', {});
  const sub = loadAndRenderMarkdown('system/subagent.md', {});
  const explore = loadAndRenderMarkdown('system/explore.md', {});
  return [base, sub, explore, querySection].filter(Boolean).join('\n\n');
}

/**
 * Build a skill agent system prompt.
 * Skill agents are specialized subagents that handle specific creative capabilities.
 *
 * @param skillName - The skill type (content-writing, image-prompting, etc.)
 * @param task - The task description for the skill agent
 * @param context - Optional context (project state, previous content, etc.)
 * @returns The complete skill agent system prompt
 */
/**
 * Build the Remotion infographic agent system prompt.
 * Combines the agent prompt with placement data and skill rules.
 *
 * @param placementsJson - JSON string of placements to generate
 * @param skillsContent - Markdown string of selected Remotion skills/rules
 * @returns The complete Remotion agent system prompt
 */
export function buildRemotionAgentPrompt(placementsJson: string, skillsContent: string): string {
  const base = loadMarkdown('subagents/remotion-agent.md');
  const placementsSection = `<placements>\n${placementsJson}\n</placements>`;
  const skillsSection = `<remotion_skills>\n${skillsContent}\n</remotion_skills>`;
  return [base, placementsSection, skillsSection].filter(Boolean).join('\n\n');
}

export function buildSkillPrompt(
  skillName: SkillType,
  task: string,
  context?: string
): string {
  const taskSection = `<task>\n${task}\n</task>`;
  const contextSection = context ? `\n<context>\n${context}\n</context>` : '';
  const base = loadAndRenderMarkdown('system/base.md', {});
  const sub = loadAndRenderMarkdown('system/subagent.md', {});
  const skill = loadAndRenderMarkdown(`skills/${skillName}.md`, {});
  return [base, sub, skill, taskSection, contextSection].filter(Boolean).join('\n\n');
}
