/**
 * DAG-driven content generation executor.
 *
 * Handles deterministic content generation for the 5 core narrative types:
 * plot, story, character, setting, scene.
 *
 * Each type follows a fixed sequence: validate → resolve output → load context →
 * assemble prompts → single streaming LLM call → clean → validate → persist → update registry.
 *
 * The LLM call has NO tools — all context is pre-assembled. This eliminates
 * the multi-round subagent loop that the legacy contentState path uses.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { LLMClient, Message } from '../../llm/index.js';
import type { ProjectFile, CharacterData, SettingData, ContentTypeName, SceneRef } from '../../../tasks/video/workflow/types.js';
import {
  createDefaultCharacterData,
  createDefaultSettingData,
} from '../../../tasks/video/workflow/types.js';
import {
  getProjectDir,
  loadProject,
  updateContentStatus,
  addProjectFile,
  addContentItem,
} from '../../../tasks/video/workflow/ProjectManager.js';
import { loadContentTypeSkills } from '../../prompts/loader.js';
import { buildContentDAGPrompts } from '../../prompts/contentDAGPrompt.js';
import { buildPreloadedContext } from '../../agent/contentContext.js';
import { computeDurationBudget } from '../../../utils/durationUtils.js';
import { getPhaseLogger } from '../../../utils/phaseLogger.js';
import { CONTENT_TYPE_OUTPUT_FILES } from './generateContentTool.js';

const logger = getPhaseLogger();

function debugLog(component: string, message: string) {
  logger.debug(component, 'contentDAG', message);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentType = 'plot' | 'story' | 'character' | 'setting' | 'scene';

export const DAG_CONTENT_TYPES: ContentType[] = ['plot', 'story', 'character', 'setting', 'scene'];

export interface ContentDAGParams {
  content_type: ContentType;
  instruction: string;
  name?: string;
  scene_number?: number;
  chapter_number?: number;
  overwrite?: boolean;
}

export interface ContentDAGResult {
  status: 'success' | 'error' | 'already_exists';
  content_type: string;
  output_file: string;
  content?: string;
  name?: string;
  summary?: string;
  files_read?: string[];
  registry_updated?: boolean;
  registry_action?: string;
  message?: string;
  error?: string;
}

/** Emitter callback for tool_streaming events. */
interface ToolStreamingPayload {
  type: 'tool_streaming';
  toolCallId: string;
  toolName?: string;
  chunk: string;
  done: boolean;
}
type EmitFn = (event: ToolStreamingPayload) => void;

// ---------------------------------------------------------------------------
// Output file resolution
// ---------------------------------------------------------------------------

function resolveOutputFile(params: ContentDAGParams): string {
  const base = CONTENT_TYPE_OUTPUT_FILES[params.content_type] || `plans/${params.content_type}.md`;

  switch (params.content_type) {
    case 'plot':
      return base; // plans/plot.md
    case 'story': {
      const chapter = params.chapter_number ?? 1;
      return `${base.replace(/\/$/, '')}/chapter-${chapter}.story.md`;
    }
    case 'character': {
      if (!params.name) return base;
      const safeName = params.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      return `${base.replace(/\/$/, '')}/${safeName}.profile.md`;
    }
    case 'setting': {
      if (!params.name) return base;
      const safeName = params.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      return `${base.replace(/\/$/, '')}/${safeName}.profile.md`;
    }
    case 'scene': {
      if (params.scene_number !== undefined) {
        return `${base.replace(/\/$/, '')}/scene-${params.scene_number}.md`;
      }
      return base;
    }
    default:
      return base;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateParams(params: ContentDAGParams): string | null {
  if (params.content_type === 'character' || params.content_type === 'setting') {
    if (!params.name) return `'name' is required for ${params.content_type}`;
  }
  if (params.content_type === 'scene') {
    if (params.scene_number === undefined) return `'scene_number' is required for scene`;
  }
  if (!params.instruction) {
    return `'instruction' is required`;
  }
  return null;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Content-type-specific structural validation. */
function validateOutput(content: string, contentType: ContentType): ValidationResult {
  if (!content || content.trim().length === 0) {
    return { valid: false, error: 'LLM returned empty output' };
  }

  // Check for tool-call XML that shouldn't be in DAG output
  if (/<tool_call>|<function_call>|<\|tool_call\|>/.test(content)) {
    return { valid: false, error: 'Output contains tool-call XML — this is a content-only pipeline' };
  }

  switch (contentType) {
    case 'plot':
      if (content.trim().length < 100) {
        return { valid: false, error: 'Plot is too short (< 100 chars)' };
      }
      if (!/^#+\s/m.test(content)) {
        return { valid: false, error: 'Plot should contain at least one markdown heading' };
      }
      break;

    case 'story':
      if (content.trim().length < 500) {
        return { valid: false, error: 'Story is too short (< 500 chars)' };
      }
      if (!/^#+\s/m.test(content)) {
        return { valid: false, error: 'Story should contain at least one markdown heading' };
      }
      break;

    case 'character': {
      if (content.trim().length < 300) {
        return { valid: false, error: 'Character profile is too short (< 300 chars)' };
      }
      const expectedSections = [
        /appearance|physical|looks/i,
        /personality|temperament|traits/i,
        /background|history|backstory/i,
        /motivation|goal|drive/i,
        /role|purpose/i,
        /relationship|connection/i,
        /voice|speech|manner/i,
      ];
      const matched = expectedSections.filter(re => re.test(content)).length;
      if (matched < 3) {
        return { valid: false, error: `Character profile missing key sections (found ${matched}/7 expected sections)` };
      }
      break;
    }

    case 'setting': {
      if (content.trim().length < 200) {
        return { valid: false, error: 'Setting description is too short (< 200 chars)' };
      }
      const settingSections = [
        /location|place|area/i,
        /atmosphere|mood|ambiance/i,
        /layout|features|detail/i,
        /sensory|sound|smell|texture/i,
      ];
      const settingMatched = settingSections.filter(re => re.test(content)).length;
      if (settingMatched < 2) {
        return { valid: false, error: `Setting description missing key sections (found ${settingMatched}/4 expected sections)` };
      }
      break;
    }

    case 'scene':
      if (content.trim().length < 200) {
        return { valid: false, error: 'Scene description is too short (< 200 chars)' };
      }
      break;
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Output cleaning
// ---------------------------------------------------------------------------

/**
 * Strip thinking tags, preamble, and other noise from LLM output.
 *
 * Different models contaminate output in different ways:
 * - DeepSeek: <think>...</think>
 * - Qwen3.5: plain-text "Thinking Process:" preamble (no tags)
 * - Other models: <thinking>, <reasoning>, <reflection>, <thought>, <|think|>
 * - Some models: trailing reflection/analysis after content
 * - Some models: wrap content in markdown code fences
 * - Some models: emit tool-call XML
 */
export function cleanOutput(raw: string): string {
  if (!raw) return raw;

  let cleaned = raw;

  // 1. Strip all known thinking/reasoning tag variants (greedy within each pair)
  cleaned = cleaned.replace(/<(?:think|thinking|reasoning|reflection|thought)>[\s\S]*?<\/(?:think|thinking|reasoning|reflection|thought)>/gi, '');

  // Also handle pipe-delimited variants: <|think|>...<|/think|>
  cleaned = cleaned.replace(/<\|(?:think|thinking)\|>[\s\S]*?<\|\/(?:think|thinking)\|>/gi, '');

  // 2. Strip <generated_content> tags if present
  cleaned = cleaned.replace(/<\/?generated_content>/g, '');

  // 3. Strip tool-call XML that shouldn't be in DAG output
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  cleaned = cleaned.replace(/<function_call>[\s\S]*?<\/function_call>/g, '');
  cleaned = cleaned.replace(/<\|tool_call\|>[\s\S]*?<\|\/tool_call\|>/g, '');

  // 4. Unwrap markdown code fences if the entire content is wrapped in one
  const fenceMatch = cleaned.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1]!;
  }

  // 5. Strip everything before the first markdown heading.
  //    This catches any remaining preamble (Qwen "Thinking Process:", model
  //    disclaimers, etc.) that isn't wrapped in tags.
  const firstHeadingIdx = cleaned.search(/^#{1,6}\s/m);
  if (firstHeadingIdx > 0) {
    cleaned = cleaned.slice(firstHeadingIdx);
  }

  // 6. Strip trailing reflection/analysis that some models append after content.
  //    Look for a "---" or "***" separator followed by non-heading text at the end.
  cleaned = cleaned.replace(/\n(?:---|\*\*\*)\s*\n(?:(?!^#)[\s\S])*$/m, '');

  return cleaned.trim();
}

/**
 * For character/setting: ensure the content has a `# Name` H1 heading.
 *
 * loadProject() scans disk files and extracts the name from the `#` heading.
 * If the LLM writes "# Character Profile: Jan the Blacksmith" or starts
 * directly with "## Description" (no H1), the disk scan creates a wrong/missing
 * entry. This function ensures the canonical name is the first H1 heading.
 */
export function normalizeHeading(content: string, contentType: ContentType, name?: string): string {
  if (!name || (contentType !== 'character' && contentType !== 'setting')) return content;

  // Check if there's already an H1 heading (exactly one #, not ##)
  const h1Match = content.match(/^(#\s+.+)$/m);
  if (h1Match) {
    // Check it's truly H1 (not ## or ###)
    const line = h1Match[1]!;
    if (/^#\s/.test(line) && !/^##/.test(line)) {
      // Replace existing H1 with canonical name
      return content.replace(/^#\s+.+$/m, `# ${name}`);
    }
  }

  // No H1 found — prepend one (model started with ## or no heading)
  return `# ${name}\n\n${content}`;
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

function extractMetadata(content: string, params: ContentDAGParams): { name?: string; summary?: string } {
  // Name: use params.name for character/setting, or extract from first heading
  let name = params.name;
  if (!name) {
    const headingMatch = content.match(/^#+\s+(.+)$/m);
    if (headingMatch) {
      name = headingMatch[1]!.trim();
    }
  }

  // Summary: first paragraph, ≤200 chars
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim() && !p.trim().startsWith('#'));
  const firstParagraph = paragraphs[0]?.trim() ?? '';
  const summary = firstParagraph.length > 200 ? firstParagraph.slice(0, 197) + '...' : firstParagraph;

  return { name, summary };
}

// ---------------------------------------------------------------------------
// Duration section builder
// ---------------------------------------------------------------------------

function buildDurationSection(project: ProjectFile): string {
  if (!project.targetDuration) return '';

  const totalDuration = project.targetDuration;
  const budget = computeDurationBudget(totalDuration);
  if (!budget) return '';

  let scopeGuidance: string;
  if (totalDuration <= 30) scopeGuidance = 'This is a very short video — focus on ONE key moment, 2-3 scenes max.';
  else if (totalDuration <= 60) scopeGuidance = 'This is a short video — cover only the core dramatic arc.';
  else if (totalDuration <= 120) scopeGuidance = 'This is a medium-length video — cover the main narrative with moderate detail.';
  else scopeGuidance = 'This is a longer video — a fuller narrative is appropriate.';

  return `<duration_constraints>
Target video duration: ${totalDuration} seconds
Minimum total shots needed: ${budget.minTotalShots} (across all scenes)
Suggested scene range: ${budget.suggestedSceneRange.min}-${budget.suggestedSceneRange.max} (let the narrative determine the exact count)
Average shot duration: ~${budget.avgShotDuration} seconds
Each scene may have 1-3 shots based on its complexity.
CRITICAL: Minimum shot duration is 4 seconds. The video model produces empty/failed output below 4s. Prefer 5-8 second shots.
${scopeGuidance}
</duration_constraints>`;
}

// ---------------------------------------------------------------------------
// Registry updates
// ---------------------------------------------------------------------------

interface RegistryUpdateResult {
  updated: boolean;
  action?: string;
}

function updateRegistry(
  contentType: ContentType,
  params: ContentDAGParams,
  content: string,
  outputFile: string,
  basePath: string,
): RegistryUpdateResult {
  // loadProject() expects a base path (e.g. cwd), not a resolved project dir.
  // It internally calls getProjectDir(basePath) to find the project.
  const project = loadProject(basePath);
  if (!project) {
    return { updated: false };
  }

  try {
    switch (contentType) {
      case 'character': {
        const charName = params.name!;
        const firstParagraph = content.split('\n\n').find(p => p.trim() && !p.trim().startsWith('#'))?.trim() ?? '';
        const description = firstParagraph.slice(0, 200);

        // Directly update project.characters[] instead of calling saveCharacter(),
        // which writes a duplicate .md file and triggers loadProject() disk scan
        // that can extract a different name from the LLM heading.
        const character: CharacterData = {
          ...createDefaultCharacterData(charName),
          description,
          approvalStatus: 'approved' as const,
        };
        const existingIdx = project.characters.findIndex(c => c.name.toLowerCase() === charName.toLowerCase());
        if (existingIdx >= 0) {
          project.characters[existingIdx] = character;
        } else {
          project.characters.push(character);
        }
        addContentItem(project, 'characters' as ContentTypeName, charName, outputFile, basePath);
        addProjectFile(project, 'character', outputFile, charName, basePath);

        debugLog('ContentDAG', `Saved character "${charName}" to project registry`);
        return { updated: true, action: `add_character: ${charName}` };
      }

      case 'setting': {
        const settingName = params.name!;
        const firstParagraph = content.split('\n\n').find(p => p.trim() && !p.trim().startsWith('#'))?.trim() ?? '';
        const description = firstParagraph.slice(0, 200);

        // Directly update project.settings[] instead of calling saveSetting()
        const setting: SettingData = {
          ...createDefaultSettingData(settingName),
          description,
          approvalStatus: 'approved' as const,
        };
        const existingIdx = project.settings.findIndex(s => s.name.toLowerCase() === settingName.toLowerCase());
        if (existingIdx >= 0) {
          project.settings[existingIdx] = setting;
        } else {
          project.settings.push(setting);
        }
        addContentItem(project, 'settings' as ContentTypeName, settingName, outputFile, basePath);
        addProjectFile(project, 'setting', outputFile, settingName, basePath);

        debugLog('ContentDAG', `Saved setting "${settingName}" to project registry`);
        return { updated: true, action: `add_setting: ${settingName}` };
      }

      case 'scene': {
        const sceneNumber = params.scene_number!;

        // Push to project.scenes[] array — this is the fix for the bug
        const existingSceneIdx = project.scenes.findIndex(s => s.sceneNumber === sceneNumber);
        const sceneRef: SceneRef = {
          sceneNumber,
          file: outputFile,
          title: params.name ?? `Scene ${sceneNumber}`,
          description: content.split('\n\n')[0]?.slice(0, 200),
          contentApprovalStatus: 'approved',
          imageApprovalStatus: 'pending',
          videoApprovalStatus: 'pending',
          regenerationCount: 0,
        };

        if (existingSceneIdx >= 0) {
          project.scenes[existingSceneIdx] = { ...project.scenes[existingSceneIdx], ...sceneRef };
        } else {
          project.scenes.push(sceneRef);
        }

        // Also update content.scenes status
        updateContentStatus(project, 'scenes' as ContentTypeName, 'available', basePath);

        // Track in files array
        addProjectFile(project, 'scene', outputFile, `Scene ${sceneNumber}`, basePath);

        debugLog('ContentDAG', `Registered scene ${sceneNumber} in project.scenes[] and content registry`);
        return { updated: true, action: `add_scene: ${sceneNumber}` };
      }

      case 'plot':
      case 'story': {
        updateContentStatus(project, contentType as ContentTypeName, 'available', basePath);
        addProjectFile(project, contentType, outputFile, undefined, basePath);
        debugLog('ContentDAG', `Updated ${contentType} status to available`);
        return { updated: true, action: `update_content_status: ${contentType}` };
      }

      default:
        return { updated: false };
    }
  } catch (error) {
    debugLog('ContentDAG', `Registry update failed: ${String(error)}`);
    return { updated: false };
  }
}

// ---------------------------------------------------------------------------
// Main Executor
// ---------------------------------------------------------------------------

export class ContentDAGExecutor {
  /** Resolved project directory (e.g. /path/to/story.kshana) — for direct file I/O */
  private projectDir: string;

  constructor(
    private llm: LLMClient,
    /** Base path (e.g. cwd). ProjectManager functions derive projectDir from this + session context. */
    private basePath: string,
    private emit: EmitFn,
    private toolCallId: string,
  ) {
    this.projectDir = getProjectDir(basePath);
  }

  async execute(params: ContentDAGParams): Promise<ContentDAGResult> {
    // 1. Validate params
    const validationError = validateParams(params);
    if (validationError) {
      return {
        status: 'error',
        content_type: params.content_type,
        output_file: '',
        error: validationError,
      };
    }

    // 2. Resolve output file
    const outputFile = resolveOutputFile(params);

    // 3. Check existing (unless overwrite)
    if (!params.overwrite) {
      const fullPath = path.join(this.projectDir, outputFile);
      if (fs.existsSync(fullPath)) {
        try {
          const existingContent = fs.readFileSync(fullPath, 'utf-8');
          if (existingContent.trim().length > 0) {
            debugLog('ContentDAG', `File already exists at ${outputFile}, returning existing content`);
            return {
              status: 'already_exists',
              content_type: params.content_type,
              output_file: outputFile,
              content: existingContent,
              message: `Content already exists at ${outputFile}. Use overwrite: true to regenerate.`,
            };
          }
        } catch {
          // Fall through to generation
        }
      }
    }

    // 4. Load project
    // IMPORTANT: loadProject() expects a *base path* (e.g. cwd), NOT a resolved
    // project dir. It internally calls getProjectDir(basePath) which joins the
    // session's activeProjectDir onto basePath. Passing an already-resolved
    // projectDir causes double-nesting (projectDir/projectDir/project.json).
    debugLog('ContentDAG', `Loading project (basePath=${this.basePath}, projectDir=${this.projectDir})`);
    const project = loadProject(this.basePath);
    if (!project) {
      debugLog('ContentDAG', `No project found — loadProject(${this.basePath}) returned null`);
      return {
        status: 'error',
        content_type: params.content_type,
        output_file: outputFile,
        error: 'No project found. Create a project first.',
      };
    }

    try {
      // 5. Resolve context via buildPreloadedContext
      const preloaded = buildPreloadedContext(
        params.content_type,
        params.name,
        params.scene_number,
        undefined, // shotNumber
        params.chapter_number,
        project,
      );

      const contextBlock = preloaded?.contextBlock ?? `No context available for ${params.content_type}. Generate based on instruction only.`;
      const filesRead = preloaded?.filesRead ?? [];

      debugLog('ContentDAG', `Loaded context: ${filesRead.length} files (${filesRead.join(', ')})`);

      // 6. Build duration section
      const durationSection = buildDurationSection(project);

      // 7. Resolve skill content
      let skillContent = '';
      const skills = loadContentTypeSkills(params.content_type, undefined, this.projectDir);
      if (skills.content) {
        skillContent = skills.content;
        debugLog('ContentDAG', `Loaded skills: ${skills.loadedFiles.join(', ')}`);
      }

      // 8. Assemble prompts
      const { system, user } = buildContentDAGPrompts({
        contentType: params.content_type,
        instruction: params.instruction,
        preloadedContext: contextBlock,
        durationSection: durationSection || undefined,
        skillContent: skillContent || undefined,
      });

      // 9. Streaming LLM call
      debugLog('ContentDAG', `Making streaming LLM call for ${params.content_type}`);
      let rawOutput = await this.streamGenerate(system, user, params.content_type);

      // 10. Clean output + normalize heading for character/setting
      rawOutput = cleanOutput(rawOutput);
      rawOutput = normalizeHeading(rawOutput, params.content_type, params.name);

      // 11. Validate output
      const validation = validateOutput(rawOutput, params.content_type);
      if (!validation.valid) {
        debugLog('ContentDAG', `Validation failed: ${validation.error}. Retrying with feedback.`);

        // Retry once with feedback
        const retryUser = `${user}\n\n---\n\nYour previous output had an issue: ${validation.error}\n\nPlease regenerate. Output ONLY the content in markdown format — no thinking, no tags, no tool calls.`;
        rawOutput = await this.streamGenerate(system, retryUser, params.content_type);
        rawOutput = cleanOutput(rawOutput);
        rawOutput = normalizeHeading(rawOutput, params.content_type, params.name);

        const retryValidation = validateOutput(rawOutput, params.content_type);
        if (!retryValidation.valid) {
          debugLog('ContentDAG', `Retry validation also failed: ${retryValidation.error}. Persisting anyway.`);
        }
      }

      // 12. Extract metadata
      const metadata = extractMetadata(rawOutput, params);

      // 13. Update registry BEFORE persisting file to disk.
      //     loadProject() scans characters/ and settings/ dirs for .profile.md
      //     files and auto-registers entities from headings. If we persist first,
      //     the scan picks up the LLM heading (e.g. "Jan the Blacksmith") as a
      //     separate entity from params.name ("Jan"). Registering first means our
      //     entry is already in the project when the file hits disk.
      const registryResult = updateRegistry(params.content_type, params, rawOutput, outputFile, this.basePath);

      // 14. Persist file (after registry update)
      this.persistFile(outputFile, rawOutput);

      return {
        status: 'success',
        content_type: params.content_type,
        output_file: outputFile,
        content: rawOutput,
        name: metadata.name,
        summary: metadata.summary,
        files_read: filesRead,
        registry_updated: registryResult.updated,
        registry_action: registryResult.action,
        message: `Generated ${params.content_type} at ${outputFile}`,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      debugLog('ContentDAG', `DAG execution failed: ${errorMessage}`);
      return {
        status: 'error',
        content_type: params.content_type,
        output_file: outputFile,
        error: errorMessage,
      };
    }
  }

  /** Streaming LLM call with tool_streaming events. */
  private async streamGenerate(system: string, user: string, contentType: string): Promise<string> {
    const messages: Message[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    let fullContent = '';
    const maxTokens = contentType === 'story' ? 4000 : 2000;

    for await (const chunk of this.llm.generateStream({ messages, temperature: 0.7, maxTokens })) {
      if (chunk.content) {
        fullContent += chunk.content;
        this.emit({
          type: 'tool_streaming',
          toolCallId: this.toolCallId,
          toolName: 'generate_content',
          chunk: chunk.content,
          done: false,
        });
      }
    }

    // Emit done marker
    this.emit({
      type: 'tool_streaming',
      toolCallId: this.toolCallId,
      toolName: 'generate_content',
      chunk: '',
      done: true,
    });

    return fullContent;
  }

  /** Write content to disk. */
  private persistFile(outputFile: string, content: string): void {
    const fullPath = path.join(this.projectDir, outputFile);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
    debugLog('ContentDAG', `Persisted ${outputFile}`);
  }
}
