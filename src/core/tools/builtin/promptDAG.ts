/**
 * DAG-driven prompt generation executor.
 *
 * Each prompt type (character_image, setting_image, scene_image, shot_image,
 * scene_video) has a fixed sequence of deterministic steps that resolve context,
 * assemble a focused LLM prompt, validate the output, and persist.
 *
 * The LLM call has NO tools — all context is pre-assembled. This eliminates
 * the multi-round subagent loop that generate_content uses.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { LLMClient, Message } from '../../llm/index.js';
import type { ProjectFile, CharacterData, SettingData } from '../../../tasks/video/workflow/types.js';
import {
  loadProject,
} from '../../../tasks/video/workflow/ProjectManager.js';
import { resolveGuide, type SkillResolutionContext } from '../../prompts/loader.js';
import { getProviderRegistry, type ProviderConfig } from '../../../services/providers/index.js';
import { getPhaseLogger } from '../../../utils/phaseLogger.js';
import type { PromptType } from './generatePromptTool.js';

const logger = getPhaseLogger();

function debugLog(component: string, message: string) {
  logger.debug(component, 'promptDAG', message);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptDAGParams {
  prompt_type: PromptType;
  name?: string;
  scene_number?: number;
  shot_number?: number;
  style_hints?: string;
  overwrite?: boolean;
}

export interface PromptDAGResult {
  status: 'success' | 'error' | 'already_exists';
  prompt_type: PromptType;
  output_file: string;
  content?: string;
  message?: string;
  error?: string;
  files_read?: string[];
}

/** Internal context threaded through DAG steps. */
interface DAGContext {
  params: PromptDAGParams;
  projectDir: string;
  project: ProjectFile;

  // Resolved entity
  entityName?: string;
  profileContent?: string;
  profilePath?: string;

  // Scene context
  sceneDescription?: string;
  sceneDescPath?: string;

  // Shot context (for shot_image)
  motionJson?: string;
  motionJsonPath?: string;
  shotDetails?: string;

  // Characters and settings in scope
  characters: CharacterData[];
  settings: SettingData[];

  // Reference images
  refImageEntries: RefImageEntry[];
  hasRefImages: boolean;
  generationMode: 'text_to_image' | 'image_text_to_image';

  // Skill/guide
  skillContent: string;
  skillSource: string;

  // Assembled LLM prompt
  systemPrompt: string;
  userPrompt: string;

  // LLM output
  rawOutput: string;

  // Output file
  outputFile: string;

  // Files read for debugging
  filesRead: string[];
}

interface RefImageEntry {
  name: string;
  type: 'character' | 'setting';
  path: string;
  exists: boolean;
}

// ---------------------------------------------------------------------------
// Output file resolution
// ---------------------------------------------------------------------------

const OUTPUT_FILE_PATTERNS: Record<PromptType, (p: PromptDAGParams) => string> = {
  character_image: (p) => {
    const safeName = (p.name ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return `prompts/images/characters/${safeName}.prompt.md`;
  },
  setting_image: (p) => {
    const safeName = (p.name ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return `prompts/images/settings/${safeName}.prompt.md`;
  },
  scene_image: (p) => `prompts/images/scenes/scene-${p.scene_number}.prompt.md`,
  shot_image: (p) => `prompts/images/shots/scene-${p.scene_number}-shot-${p.shot_number}.prompt.md`,
  scene_video: (p) => `prompts/videos/scenes/scene-${p.scene_number}.motion.json`,
};

// ---------------------------------------------------------------------------
// Content type to guide name mapping
// ---------------------------------------------------------------------------

const PROMPT_TYPE_TO_GUIDE: Record<PromptType, string> = {
  character_image: 'character_image_guide',
  setting_image: 'setting_image_guide',
  scene_image: 'scene_image_guide',
  shot_image: 'shot_image_guide',
  scene_video: 'scene_video_guide',
};

/** Maps prompt types to their content type names for skill resolution. */
const PROMPT_TYPE_TO_CONTENT_TYPE: Record<PromptType, string> = {
  character_image: 'character_image_prompt',
  setting_image: 'setting_image_prompt',
  scene_image: 'scene_image_prompt',
  shot_image: 'shot_image_prompt',
  scene_video: 'scene_video_prompt',
};

/** Capability required per prompt type (mirrors CONTENT_TYPE_CAPABILITY in prompts/index.ts). */
const PROMPT_TYPE_CAPABILITY: Record<PromptType, string> = {
  character_image: 'imageGeneration',
  setting_image: 'imageGeneration',
  scene_image: 'imageEditing',
  shot_image: 'imageEditing',
  scene_video: 'videoGeneration',
};

const COMFYUI_DEFAULT_WORKFLOWS: Record<string, string> = {
  videoGeneration: 'ltx23',
  imageGeneration: 'zimage',
  imageEditing: 'flux2_klein_edit',
};

// ---------------------------------------------------------------------------
// Length constraints
// ---------------------------------------------------------------------------

interface LengthConstraint {
  min: number;
  max: number;
  label: string;
}

function getLengthConstraint(
  generationMode: 'text_to_image' | 'image_text_to_image',
  providerId?: string,
): LengthConstraint {
  if (generationMode === 'text_to_image') {
    return { min: 80, max: 250, label: '80-250 words' };
  }
  // image_text_to_image
  if (providerId === 'comfyui') {
    // Klein works best with concise prose
    return { min: 30, max: 80, label: '30-80 words' };
  }
  return { min: 50, max: 120, label: '50-120 words' };
}

// ---------------------------------------------------------------------------
// File reading helpers
// ---------------------------------------------------------------------------

import { readProjectFile, getCharacterFilePath, getSettingFilePath } from '../../utils/projectFileUtils.js';

// ---------------------------------------------------------------------------
// DAG Steps
// ---------------------------------------------------------------------------

/** Validate required params per prompt type. */
function validateParams(params: PromptDAGParams): string | null {
  const { prompt_type, name, scene_number, shot_number } = params;

  if (prompt_type === 'character_image' || prompt_type === 'setting_image') {
    if (!name) return `'name' is required for ${prompt_type}`;
  }
  if (prompt_type === 'scene_image' || prompt_type === 'scene_video') {
    if (scene_number === undefined) return `'scene_number' is required for ${prompt_type}`;
  }
  if (prompt_type === 'shot_image') {
    if (scene_number === undefined) return `'scene_number' is required for shot_image`;
    if (shot_number === undefined) return `'shot_number' is required for shot_image`;
  }
  return null;
}

/** Step: resolve entity (character or setting) profile. */
function resolveEntity(ctx: DAGContext): void {
  const { params, project, projectDir } = ctx;
  const entityName = params.name!;
  ctx.entityName = entityName;

  if (params.prompt_type === 'character_image') {
    const char = project.characters.find(
      c => c.name.toLowerCase() === entityName.toLowerCase()
    );
    if (!char) {
      debugLog('PromptDAG', `Character "${entityName}" not found in project, using name as-is`);
    }
    const filePath = getCharacterFilePath(project, entityName);
    const content = readProjectFile(projectDir, filePath);
    if (content) {
      ctx.profileContent = content;
      ctx.profilePath = filePath;
      ctx.filesRead.push(filePath);
    }
    // Scope to just this character
    ctx.characters = char ? [char] : [];
    ctx.settings = [];
  } else if (params.prompt_type === 'setting_image') {
    const setting = project.settings.find(
      s => s.name.toLowerCase() === entityName.toLowerCase()
    );
    if (!setting) {
      debugLog('PromptDAG', `Setting "${entityName}" not found in project, using name as-is`);
    }
    const filePath = getSettingFilePath(project, entityName);
    const content = readProjectFile(projectDir, filePath);
    if (content) {
      ctx.profileContent = content;
      ctx.profilePath = filePath;
      ctx.filesRead.push(filePath);
    }
    ctx.characters = [];
    ctx.settings = setting ? [setting] : [];
  }
}

/** Step: resolve scene description. */
function resolveScene(ctx: DAGContext): void {
  const { params, project, projectDir } = ctx;
  const sceneNumber = params.scene_number!;

  // Try scene-specific file first
  const scene = project.scenes.find(s => s.sceneNumber === sceneNumber);
  let loaded = false;

  if (scene?.file) {
    const content = readProjectFile(projectDir, scene.file);
    if (content) {
      ctx.sceneDescription = content;
      ctx.sceneDescPath = scene.file;
      ctx.filesRead.push(scene.file);
      loaded = true;
    }
  }

  if (!loaded) {
    const fallbackPath = `plans/scenes/scene-${sceneNumber}.md`;
    const content = readProjectFile(projectDir, fallbackPath);
    if (content) {
      ctx.sceneDescription = content;
      ctx.sceneDescPath = fallbackPath;
      ctx.filesRead.push(fallbackPath);
      loaded = true;
    }
  }

  if (!loaded) {
    // Legacy single-file format
    const legacyPath = 'plans/scenes.md';
    const content = readProjectFile(projectDir, legacyPath);
    if (content) {
      ctx.sceneDescription = content;
      ctx.sceneDescPath = legacyPath;
      ctx.filesRead.push(legacyPath);
    }
  }

  // Resolve characters and settings appearing in all scenes (for scene-level prompts)
  ctx.characters = project.characters;
  ctx.settings = project.settings;
}

/** Step: read motion JSON and extract shot details (shot_image only). */
function resolveShot(ctx: DAGContext): void {
  const { params, projectDir } = ctx;
  const sceneNumber = params.scene_number!;
  const shotNumber = params.shot_number!;

  const motionPath = `prompts/videos/scenes/scene-${sceneNumber}.motion.json`;
  const motionContent = readProjectFile(projectDir, motionPath);

  if (!motionContent) {
    debugLog('PromptDAG', `Motion JSON not found at ${motionPath} — shot_image requires scene_video to be generated first`);
    return;
  }

  ctx.motionJson = motionContent;
  ctx.motionJsonPath = motionPath;
  ctx.filesRead.push(motionPath);

  // Extract the specific shot from the motion JSON
  try {
    const parsed = JSON.parse(motionContent);
    const shots = parsed.shots ?? parsed.scenes?.[0]?.shots ?? [];
    const shot = shots.find(
      (s: { shot_number?: number }) => s.shot_number === shotNumber
    );
    if (shot) {
      ctx.shotDetails = JSON.stringify(shot, null, 2);
    }
  } catch {
    debugLog('PromptDAG', `Failed to parse motion JSON at ${motionPath}`);
  }
}

/** Step: check reference images and build ref image entries. */
function checkRefImages(ctx: DAGContext): void {
  const { projectDir, characters, settings } = ctx;
  const entries: RefImageEntry[] = [];

  for (const char of characters) {
    if (char.referenceImagePath) {
      const fullPath = path.join(projectDir, char.referenceImagePath);
      entries.push({
        name: char.name,
        type: 'character',
        path: char.referenceImagePath,
        exists: fs.existsSync(fullPath),
      });
    }
  }

  for (const setting of settings) {
    if (setting.referenceImagePath) {
      const fullPath = path.join(projectDir, setting.referenceImagePath);
      entries.push({
        name: setting.name,
        type: 'setting',
        path: setting.referenceImagePath,
        exists: fs.existsSync(fullPath),
      });
    }
  }

  ctx.refImageEntries = entries;
  const existingRefs = entries.filter(e => e.exists);
  ctx.hasRefImages = existingRefs.length > 0;
  ctx.generationMode = ctx.hasRefImages ? 'image_text_to_image' : 'text_to_image';
}

/** Step: build the reference images section for the LLM prompt. */
function buildRefSection(ctx: DAGContext): string {
  const existingRefs = ctx.refImageEntries.filter(e => e.exists);
  if (existingRefs.length === 0) return '';

  const lines: string[] = ['## Reference Images'];
  // Characters first, then settings (ordering matters for "image N" references)
  const chars = existingRefs.filter(e => e.type === 'character');
  const sets = existingRefs.filter(e => e.type === 'setting');
  const ordered = [...chars, ...sets];

  ordered.forEach((entry, i) => {
    lines.push(`- image ${i + 1}: ${entry.name} (${entry.type}) — ${entry.path}`);
  });

  return lines.join('\n');
}

/** Step: resolve skill/guide based on provider config. */
function resolveSkillForType(ctx: DAGContext): void {
  const { params, projectDir } = ctx;
  const guideName = PROMPT_TYPE_TO_GUIDE[params.prompt_type];
  const contentType = PROMPT_TYPE_TO_CONTENT_TYPE[params.prompt_type];
  const capability = PROMPT_TYPE_CAPABILITY[params.prompt_type];

  // Resolve provider context
  let skillContext: SkillResolutionContext | undefined;
  try {
    const config: ProviderConfig = getProviderRegistry().getConfig();
    const providerId = config[capability as keyof ProviderConfig];
    if (providerId) {
      const workflowName = providerId === 'comfyui'
        ? COMFYUI_DEFAULT_WORKFLOWS[capability]
        : undefined;
      skillContext = { providerId, workflowName };
    }
  } catch {
    // Provider registry not initialized
  }

  const resolved = resolveGuide(guideName, contentType, skillContext, projectDir);
  ctx.skillContent = resolved.content;
  ctx.skillSource = resolved.source;

  debugLog('PromptDAG', `Resolved skill for ${params.prompt_type}: ${resolved.source}`);
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

/** Hard constraints injected into every prompt generation call. */
function buildHardConstraints(ctx: DAGContext): string {
  const { params, generationMode } = ctx;

  // Determine length constraint
  let providerId: string | undefined;
  try {
    const config = getProviderRegistry().getConfig();
    const capability = PROMPT_TYPE_CAPABILITY[params.prompt_type];
    providerId = config[capability as keyof ProviderConfig];
  } catch {
    // ignore
  }

  const lengthConstraint = getLengthConstraint(generationMode, providerId);

  // Video prompts (scene_video) have different constraints
  if (params.prompt_type === 'scene_video') {
    return `## HARD CONSTRAINTS
- Output MUST be valid JSON following the motion prompt schema.
- Each shot must have: shot_number, description, motion_description, camera_movement, duration_seconds.
- Minimum shot duration is 4 seconds. Prefer 5-8 second shots.
- Keep shot descriptions concise (1-2 sentences each).
- Cover the full scene narrative across all shots.`;
  }

  const lines: string[] = [
    '## HARD CONSTRAINTS',
    `- Write flowing prose — not comma-separated keywords, not a novel.`,
    `- Target length: ${lengthConstraint.label}. Every sentence must add visual information.`,
    `- One frozen instant — no motion verbs, no temporal language.`,
  ];

  if (generationMode === 'image_text_to_image') {
    lines.push(
      `- Reference every image as "image N" (with space before the number). Unreferenced images are ignored.`,
      `- Do NOT re-describe character/setting appearance — the reference image provides that.`,
    );
  } else {
    lines.push(
      `- Include full character/setting physical descriptions — there are no reference images.`,
    );
  }

  lines.push(
    `- Lighting is mandatory: specify source, direction, quality.`,
    `- Do NOT include narrative commentary — only what a camera captures.`,
  );

  // Format compliance — model-agnostic
  lines.push(
    '',
    '## FORMAT COMPLIANCE',
    '- Your FIRST line must be exactly: **Image Prompt:**',
    '- Do NOT output thinking, reasoning, notes, or meta-commentary.',
    '- Write real descriptive text — no placeholders or templates.',
    '- Stop immediately after the Aspect Ratio line.',
  );

  // Character-image-specific: neutral studio background
  if (params.prompt_type === 'character_image') {
    lines.push('- Background is ALWAYS plain neutral studio — no locations or environments.');
  }

  return lines.join('\n');
}

/** Assemble the system prompt for the LLM call. */
function assembleSystemPrompt(ctx: DAGContext, modelName?: string): void {
  const guide = ctx.skillContent || 'You are an expert image prompt writer.';
  // Prepend /no_think for Qwen thinking models to suppress chain-of-thought.
  // Other models ignore or may be confused by this directive.
  const isQwen = modelName ? /qwen/i.test(modelName) : false;
  ctx.systemPrompt = isQwen ? `/no_think\n${guide}` : guide;
}

/** Assemble the user prompt for the LLM call. */
function assembleUserPrompt(ctx: DAGContext): void {
  const { params } = ctx;
  const sections: string[] = [];

  // Add style hints if provided
  if (params.style_hints) {
    sections.push(`## Orchestrator Guidance\n${params.style_hints}`);
  }

  // Add entity profile (for character_image / setting_image)
  if (ctx.profileContent) {
    const label = params.prompt_type === 'character_image' ? 'Character Profile' : 'Setting Profile';
    sections.push(`## ${label}: ${ctx.entityName}\n${ctx.profileContent}`);
  }

  // Add scene description
  if (ctx.sceneDescription) {
    sections.push(`## Scene Description\n${ctx.sceneDescription}`);
  }

  // Add shot details (for shot_image)
  if (ctx.shotDetails) {
    sections.push(`## Shot Details (from motion prompt)\n\`\`\`json\n${ctx.shotDetails}\n\`\`\``);
  }

  // Add character/setting name lists for scene-level prompts
  if (params.prompt_type === 'scene_image' || params.prompt_type === 'scene_video' || params.prompt_type === 'shot_image') {
    if (ctx.characters.length > 0) {
      sections.push(`## Characters in Scene\n${ctx.characters.map(c => `- ${c.name}`).join('\n')}`);
    }
    if (ctx.settings.length > 0) {
      sections.push(`## Settings in Scene\n${ctx.settings.map(s => `- ${s.name}`).join('\n')}`);
    }
  }

  // Add reference images section
  const refSection = buildRefSection(ctx);
  if (refSection) {
    sections.push(refSection);
  }

  // Add generation mode info
  if (params.prompt_type !== 'scene_video') {
    sections.push(`## Generation Mode: ${ctx.generationMode}`);
  }

  // Add hard constraints
  sections.push(buildHardConstraints(ctx));

  // Final instruction — explicit "no reasoning" to prevent models from dumping chain-of-thought
  if (params.prompt_type === 'scene_video') {
    sections.push(`\n---\nWrite the multi-shot motion prompt JSON for this scene now. Output ONLY the JSON — no explanation, no reasoning, no commentary.`);
  } else {
    sections.push(`\n---\nWrite the image prompt now. Output ONLY the formatted prompt — start directly with "**Image Prompt:**". Do NOT output any thinking, reasoning, analysis, or explanation before the prompt. Just the prompt in the exact output format.`);
  }

  ctx.userPrompt = sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// LLM Call
// ---------------------------------------------------------------------------

async function llmGenerate(ctx: DAGContext, llm: LLMClient): Promise<void> {
  const messages: Message[] = [
    { role: 'system', content: ctx.systemPrompt },
    { role: 'user', content: ctx.userPrompt },
  ];

  debugLog('PromptDAG', `Making LLM call for ${ctx.params.prompt_type} (mode: ${ctx.generationMode})`);

  const response = await llm.generate({
    messages,
    temperature: 0.7,
    maxTokens: ctx.params.prompt_type === 'scene_video' ? 2000 : 1000,
  });

  ctx.rawOutput = cleanLLMOutput(response.content ?? '', ctx.params.prompt_type);
}

// ---------------------------------------------------------------------------
// Output Cleaning
// ---------------------------------------------------------------------------

/**
 * Strip reasoning/thinking text that some models (e.g., Qwen) emit before
 * the actual formatted output. For image prompts, we look for the start of
 * the expected format ("**Image Prompt:**") and discard everything before it.
 * For video prompts, we extract the JSON block.
 */
/**
 * Extract the structured image prompt format from raw LLM output.
 * Looks for the LAST occurrence of "**Image Prompt:**" and extracts
 * everything through the expected format sections, stripping trailing reasoning.
 *
 * Expected sections (in order): Image Prompt, Reference Images (optional),
 * Negative Prompt, Aspect Ratio, Generation Mode.
 */
function extractImagePromptFormat(raw: string): string | null {
  // Find the last occurrence of the format marker
  const marker = '**Image Prompt:**';
  const altMarker = 'Image Prompt:';

  let startIdx = raw.lastIndexOf(marker);
  let needsBoldPrefix = false;

  if (startIdx < 0) {
    startIdx = raw.lastIndexOf(altMarker);
    needsBoldPrefix = true;
  }
  if (startIdx < 0) return null;

  let extracted = raw.slice(startIdx);
  if (needsBoldPrefix) {
    extracted = '**' + extracted;
  }

  if (startIdx > 0) {
    debugLog('PromptDAG', `Stripped ${startIdx} chars of leading reasoning text`);
  }

  // Strip trailing reasoning: look for the last recognized format section
  // and cut everything after its value line(s)
  const trailingSections = [
    '**Generation Mode:**',
    '**Aspect Ratio:**',
    '**Negative Prompt:**',
  ];

  for (const section of trailingSections) {
    const sectionIdx = extracted.lastIndexOf(section);
    if (sectionIdx >= 0) {
      // Find end of the section value (next blank line or next section start or end of string)
      const afterSection = extracted.slice(sectionIdx + section.length);
      // The section value is typically on the same line or the next line
      const lines = afterSection.split('\n');
      let endOffset = 0;
      for (let i = 0; i < lines.length; i++) {
        endOffset += lines[i]!.length + 1; // +1 for newline
        const trimmed = lines[i]!.trim();
        // Stop after the first non-empty content line that isn't another format section
        if (trimmed && !trimmed.startsWith('**') && i > 0) {
          // We found the value line — include it and stop
          const result = extracted.slice(0, sectionIdx + section.length + endOffset).trim();
          if (result.length > 50) { // Sanity check: must be substantial
            debugLog('PromptDAG', `Trimmed trailing reasoning after "${section}"`);
            return result;
          }
        }
      }
      // If we get here, just take everything up to a reasonable point
      break;
    }
  }

  // Fallback: strip lines that look like reasoning (italic markdown markers, word count checks)
  const lines = extracted.split('\n');
  const cleanLines: string[] = [];
  let foundEndOfFormat = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Reasoning markers from thinking models
    if (trimmed.startsWith('*Word Count') ||
        trimmed.startsWith('*Flow') ||
        trimmed.startsWith('*Constraint') ||
        trimmed.startsWith('*Refin') ||
        trimmed.startsWith('*Draft') ||
        trimmed.startsWith('*Check') ||
        trimmed.startsWith('*Better') ||
        trimmed.startsWith('*Correction') ||
        trimmed.startsWith('*Decision') ||
        trimmed.startsWith('*Challenge') ||
        trimmed.startsWith('*Solution')) {
      foundEndOfFormat = true;
      continue;
    }
    if (foundEndOfFormat) continue;
    cleanLines.push(line);
  }

  return cleanLines.join('\n').trim();
}

function cleanLLMOutput(raw: string, promptType: PromptType): string {
  if (!raw) return raw;

  if (promptType === 'scene_video') {
    // For JSON output, extract the code block or the first { ... } structure
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) return codeBlockMatch[0]; // Keep the code block wrapper for later extraction

    // Try to find raw JSON object
    const jsonStart = raw.indexOf('{');
    if (jsonStart > 0) {
      return raw.slice(jsonStart);
    }
    return raw;
  }

  // For image prompts, find the LAST occurrence of the format marker.
  // Models with implicit thinking (e.g., Qwen3.5) may embed the format marker
  // inside their reasoning text, then output the real prompt later.
  const cleaned = extractImagePromptFormat(raw);
  if (cleaned) return cleaned;

  return raw;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationResult {
  valid: boolean;
  error?: string;
}

function validateOutput(ctx: DAGContext): ValidationResult {
  const { rawOutput, params, refImageEntries } = ctx;

  if (!rawOutput || rawOutput.trim().length === 0) {
    return { valid: false, error: 'LLM returned empty output' };
  }

  // For scene_video, validate JSON
  if (params.prompt_type === 'scene_video') {
    // Extract JSON from potential markdown code block
    const jsonMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, rawOutput];
    try {
      const parsed = JSON.parse(jsonMatch[1]!.trim());
      const shots = parsed.shots ?? [];
      if (!Array.isArray(shots) || shots.length === 0) {
        return { valid: false, error: 'Motion JSON must contain a "shots" array with at least one shot' };
      }
      for (const shot of shots) {
        if (!shot.shot_number || !shot.description) {
          return { valid: false, error: 'Each shot must have shot_number and description' };
        }
      }
    } catch {
      return { valid: false, error: 'Output is not valid JSON' };
    }
    return { valid: true };
  }

  // For image prompts, check output format
  if (!rawOutput.includes('**Image Prompt:**') && !rawOutput.includes('Image Prompt:')) {
    return { valid: false, error: 'Output missing "Image Prompt:" section' };
  }

  // Check that reference images are referenced (for image_text_to_image mode)
  if (ctx.generationMode === 'image_text_to_image') {
    const existingRefs = refImageEntries.filter(e => e.exists);
    for (let i = 0; i < existingRefs.length; i++) {
      const imageRef = `image ${i + 1}`;
      if (!rawOutput.toLowerCase().includes(imageRef)) {
        debugLog('PromptDAG', `Warning: reference "${imageRef}" (${existingRefs[i]!.name}) not found in output`);
        // This is a warning, not a hard failure — the LLM might phrase it differently
      }
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function persist(ctx: DAGContext): void {
  const { projectDir, outputFile, rawOutput, params } = ctx;
  const fullPath = path.join(projectDir, outputFile);

  // Ensure directory exists
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // For scene_video, extract and save clean JSON
  if (params.prompt_type === 'scene_video') {
    const jsonMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/);
    const cleanJson = jsonMatch ? jsonMatch[1]!.trim() : rawOutput.trim();
    // Pretty-print the JSON
    try {
      const parsed = JSON.parse(cleanJson);
      fs.writeFileSync(fullPath, JSON.stringify(parsed, null, 2), 'utf-8');
    } catch {
      fs.writeFileSync(fullPath, cleanJson, 'utf-8');
    }
  } else {
    fs.writeFileSync(fullPath, rawOutput, 'utf-8');
  }

  debugLog('PromptDAG', `Persisted ${params.prompt_type} prompt to ${outputFile}`);
}

// ---------------------------------------------------------------------------
// Main Executor
// ---------------------------------------------------------------------------

export class PromptDAGExecutor {
  constructor(
    private llm: LLMClient,
    private projectDir: string,
  ) {}

  async execute(params: PromptDAGParams): Promise<PromptDAGResult> {
    // 1. Validate params
    const validationError = validateParams(params);
    if (validationError) {
      return {
        status: 'error',
        prompt_type: params.prompt_type,
        output_file: '',
        error: validationError,
      };
    }

    // 2. Resolve output file
    const outputFile = OUTPUT_FILE_PATTERNS[params.prompt_type](params);

    // 3. Check if already exists (unless overwrite)
    if (!params.overwrite) {
      const fullPath = path.join(this.projectDir, outputFile);
      if (fs.existsSync(fullPath)) {
        try {
          const existingContent = fs.readFileSync(fullPath, 'utf-8');
          if (existingContent.trim().length > 0) {
            debugLog('PromptDAG', `File already exists at ${outputFile}, returning existing content`);
            return {
              status: 'already_exists',
              prompt_type: params.prompt_type,
              output_file: outputFile,
              content: existingContent,
              message: `Prompt already exists at ${outputFile}. Use overwrite: true to regenerate.`,
            };
          }
        } catch {
          // Fall through to regeneration
        }
      }
    }

    // 4. Load project
    const project = loadProject();
    if (!project) {
      return {
        status: 'error',
        prompt_type: params.prompt_type,
        output_file: outputFile,
        error: 'No project found. Create a project first.',
      };
    }

    // 5. Initialize DAG context
    const ctx: DAGContext = {
      params,
      projectDir: this.projectDir,
      project,
      characters: [],
      settings: [],
      refImageEntries: [],
      hasRefImages: false,
      generationMode: 'text_to_image',
      skillContent: '',
      skillSource: 'none',
      systemPrompt: '',
      userPrompt: '',
      rawOutput: '',
      outputFile,
      filesRead: [],
    };

    try {
      // 6. Run DAG steps based on prompt type
      this.runDAGSteps(ctx, this.llm.getModel());

      // 7. LLM call
      await llmGenerate(ctx, this.llm);

      // 8. Validate
      const validation = validateOutput(ctx);
      if (!validation.valid) {
        debugLog('PromptDAG', `Validation failed: ${validation.error}. Retrying with feedback.`);

        // Retry once with feedback
        const retryMessages: Message[] = [
          { role: 'system', content: ctx.systemPrompt },
          { role: 'user', content: ctx.userPrompt },
          { role: 'assistant', content: ctx.rawOutput },
          {
            role: 'user',
            content: `Your output had a format issue: ${validation.error}\n\nPlease regenerate following the exact output format specified in the guide. ${params.prompt_type === 'scene_video' ? 'Output ONLY valid JSON.' : 'Include all required sections: Image Prompt, Negative Prompt, Aspect Ratio, Generation Mode.'}`,
          },
        ];

        const retryResponse = await this.llm.generate({
          messages: retryMessages,
          temperature: 0.7,
          maxTokens: params.prompt_type === 'scene_video' ? 2000 : 500,
        });

        ctx.rawOutput = retryResponse.content ?? ctx.rawOutput;

        const retryValidation = validateOutput(ctx);
        if (!retryValidation.valid) {
          debugLog('PromptDAG', `Retry validation also failed: ${retryValidation.error}. Persisting anyway.`);
        }
      }

      // 9. Persist
      persist(ctx);

      return {
        status: 'success',
        prompt_type: params.prompt_type,
        output_file: outputFile,
        content: ctx.rawOutput,
        message: `Generated ${params.prompt_type} prompt at ${outputFile}`,
        files_read: ctx.filesRead,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      debugLog('PromptDAG', `DAG execution failed: ${errorMessage}`);
      return {
        status: 'error',
        prompt_type: params.prompt_type,
        output_file: outputFile,
        error: errorMessage,
      };
    }
  }

  /** Run the deterministic DAG steps for the given prompt type. */
  private runDAGSteps(ctx: DAGContext, modelName?: string): void {
    const { prompt_type } = ctx.params;

    switch (prompt_type) {
      case 'character_image':
      case 'setting_image':
        resolveEntity(ctx);
        checkRefImages(ctx);
        resolveSkillForType(ctx);
        assembleSystemPrompt(ctx, modelName);
        assembleUserPrompt(ctx);
        break;

      case 'scene_image':
        resolveScene(ctx);
        checkRefImages(ctx);
        resolveSkillForType(ctx);
        assembleSystemPrompt(ctx, modelName);
        assembleUserPrompt(ctx);
        break;

      case 'shot_image': {
        // Dependency check: scene_video must exist
        const motionPath = `prompts/videos/scenes/scene-${ctx.params.scene_number}.motion.json`;
        const motionExists = fs.existsSync(path.join(ctx.projectDir, motionPath));
        if (!motionExists) {
          throw new Error(
            `scene_video prompt for scene ${ctx.params.scene_number} must be generated before shot_image. ` +
            `Expected: ${motionPath}`
          );
        }
        resolveScene(ctx);
        resolveShot(ctx);
        checkRefImages(ctx);
        resolveSkillForType(ctx);
        assembleSystemPrompt(ctx, modelName);
        assembleUserPrompt(ctx);
        break;
      }

      case 'scene_video':
        resolveScene(ctx);
        checkRefImages(ctx);
        resolveSkillForType(ctx);
        assembleSystemPrompt(ctx, modelName);
        assembleUserPrompt(ctx);
        break;
    }
  }
}
