/**
 * Shared test utilities for narrative pipeline checkpoint tests.
 *
 * Sets up a real project at a given state, runs GenericAgent to produce the
 * next artifact, then judges the output with the LLM judge.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { LLMClient, getLLMConfig } from '../../src/core/llm/index.js';
import { setActiveProjectDir } from '../../src/tasks/video/workflow/activeProject.js';
import {
  createProject,
  saveProject,
  getProjectDir,
  loadProject,
} from '../../src/tasks/video/workflow/ProjectManager.js';
import {
  WorkflowPhase,
  PlannerStage,
  type ProjectFile,
} from '../../src/tasks/video/workflow/types.js';
import { createWorkflowVideoAgent } from '../../src/tasks/video/index.js';
import type { ToolResultEvent } from '../../src/events/events.js';
import {
  JudgeLLMClient,
  type JudgeRubric,
} from '../../src/testing/JudgeLLMClient.js';

// ---------------------------------------------------------------------------
// LLM Setup
// ---------------------------------------------------------------------------

/** Create an LLM client using the same config as production. */
export function createTestLLMClient(): LLMClient {
  const config = getLLMConfig();
  return new LLMClient(config);
}

/** Check if the LLM is available by sending a trivial prompt. */
export async function checkLLMAvailability(llm: LLMClient): Promise<boolean> {
  try {
    const response = await llm.generate({
      messages: [
        { role: 'system', content: 'You are a test assistant.' },
        { role: 'user', content: 'Reply with the single word: ok' },
      ],
      temperature: 0,
      maxTokens: 16,
    });
    return !!response.content;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Project Scaffolding
// ---------------------------------------------------------------------------

export interface ProjectScaffold {
  basePath: string;
  projectDir: string;
  project: ProjectFile;
}

/**
 * Create a temp directory with a real project structure.
 * Places fixture files and sets the project registry to the right state.
 */
export function scaffoldProject(opts: {
  /** Fixture files to place: Record<relativePath, content> */
  files: Record<string, string>;
  /** Which phase should be "current" (the one the agent will work on) */
  currentPhase: WorkflowPhase;
  /** Phases to mark as completed (everything before currentPhase) */
  completedPhases: WorkflowPhase[];
  /** Original input text */
  originalInput: string;
  /** Content registry overrides */
  contentOverrides?: Partial<ProjectFile['content']>;
}): ProjectScaffold {
  const id = randomBytes(4).toString('hex');
  const basePath = join(tmpdir(), `checkpoint-test-${id}`);
  mkdirSync(basePath, { recursive: true });

  // Create the project (this sets up directory structure + project.json)
  const project = createProject(
    opts.originalInput,
    'cinematic_realism',
    basePath,
  );

  const projectDir = getProjectDir(basePath);

  // Write fixture files into the project directory
  for (const [relativePath, content] of Object.entries(opts.files)) {
    const fullPath = join(projectDir, relativePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }

  // Mark completed phases
  for (const phase of opts.completedPhases) {
    if (project.phases[phase]) {
      project.phases[phase].status = 'completed';
      project.phases[phase].completedAt = Date.now();
      project.phases[phase].plannerStage = PlannerStage.COMPLETE;
    }
  }

  // Set current phase
  project.currentPhase = opts.currentPhase;
  if (project.phases[opts.currentPhase]) {
    project.phases[opts.currentPhase].status = 'in_progress';
  }

  // Apply content registry overrides
  if (opts.contentOverrides) {
    Object.assign(project.content, opts.contentOverrides);
  }

  // Save updated project
  saveProject(project, basePath);

  return { basePath, projectDir, project };
}

// ---------------------------------------------------------------------------
// Agent Runner
// ---------------------------------------------------------------------------

export interface TransitionResult {
  /** The content produced by generate_content */
  content: string | null;
  /** The content type that was generated */
  contentType: string | null;
  /** The output file path (relative) */
  outputFile: string | null;
  /** Agent result status */
  agentStatus: string;
  /** All tool_result events captured */
  toolResults: Array<{ toolName: string; result: unknown }>;
}

/**
 * Run the agent from a scaffolded project state until it produces one artifact
 * via generate_content, then stop it.
 */
export async function runAgentTransition(opts: {
  basePath: string;
  task: string;
  maxIterations?: number;
}): Promise<TransitionResult> {
  const { basePath, task, maxIterations = 30 } = opts;

  // Point the global project dir to our temp project
  const project = loadProject(basePath);
  if (!project) throw new Error('Failed to load scaffolded project');
  const projectDir = getProjectDir(basePath);
  setActiveProjectDir(projectDir);

  const llmConfig = getLLMConfig();
  const agent = createWorkflowVideoAgent({
    llmConfig,
    maxIterations,
    originalInput: '',
    basePath,
  });

  // Set autonomous mode so it doesn't pause for approval
  agent.setAutonomousMode(true);

  const captured: TransitionResult = {
    content: null,
    contentType: null,
    outputFile: null,
    agentStatus: 'unknown',
    toolResults: [],
  };

  // Listen for generate_content / generate_prompt completion and stop the agent
  agent.on('tool_result', (event: ToolResultEvent) => {
    captured.toolResults.push({
      toolName: event.toolName,
      result: event.result,
    });

    if (event.toolName === 'generate_content') {
      const result = event.result as Record<string, unknown>;
      // ContentDAGExecutor returns 'success', legacy path returns 'approved'
      if (result['status'] === 'approved' || result['status'] === 'success') {
        captured.contentType = result['content_type'] as string;
        captured.outputFile = result['output_file'] as string;
        // DAG path returns content directly; also try reading from disk
        captured.content = (result['content'] as string) || null;
        if (!captured.content && captured.outputFile) {
          const fullPath = join(projectDir, captured.outputFile);
          if (existsSync(fullPath)) {
            captured.content = readFileSync(fullPath, 'utf-8');
          }
        }
        // Stop the agent — we got our artifact
        agent.stop();
      }
    }

    if (event.toolName === 'generate_prompt') {
      const result = event.result as Record<string, unknown>;
      if (result['status'] === 'success') {
        captured.contentType = result['prompt_type'] as string;
        captured.outputFile = result['output_file'] as string;
        // generate_prompt returns content directly in the result
        captured.content = (result['content'] as string) || null;
        // Also try reading from disk as fallback
        if (!captured.content && captured.outputFile) {
          const fullPath = join(projectDir, captured.outputFile);
          if (existsSync(fullPath)) {
            captured.content = readFileSync(fullPath, 'utf-8');
          }
        }
        agent.stop();
      }
    }
  });

  // Initialize and run
  await agent.initialize();
  const result = await agent.run(task);
  captured.agentStatus = result.status;

  return captured;
}

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

/** Create a judge LLM client from env config. */
export function createJudge(): JudgeLLMClient {
  return new JudgeLLMClient();
}

/** Check if the judge LLM is available. */
export async function checkJudgeAvailability(judge: JudgeLLMClient): Promise<boolean> {
  try {
    const response = await judge.generate({
      messages: [
        { role: 'user', content: 'Reply with ONLY the single word: ok' },
      ],
      temperature: 0,
      maxTokens: 128,
    });
    return !!response.content;
  } catch (err) {
    console.warn('Judge availability check failed:', (err as Error).message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Structural Validators
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate a scene description has required structural elements. */
export function validateScene(content: string): ValidationResult {
  const errors: string[] = [];
  if (!content || content.trim().length === 0) errors.push('Scene content is empty');
  if (content.length < 200) errors.push(`Scene too short (${content.length} chars, need >200)`);

  // Should reference characters or setting elements from the project
  const hasCharRef = /jan|maren|blacksmith|elder/i.test(content);
  const hasSettingRef = /forge|village|ashenmere|anvil|mountain/i.test(content);
  if (!hasCharRef) errors.push('Scene does not reference any known characters');
  if (!hasSettingRef) errors.push('Scene does not reference any known settings/locations');

  // Should have visual detail
  const hasVisual = /light|shadow|dark|glow|fire|smoke|color|warm|cold|stone|wood/i.test(content);
  if (!hasVisual) errors.push('Scene lacks visual/atmospheric details');

  // Should not have tag contamination
  if (/<think>/i.test(content)) errors.push('Contains <think> tag contamination');
  if (/<generated_content>/i.test(content)) errors.push('Contains leaked <generated_content> tags');

  return { valid: errors.length === 0, errors };
}

/** Validate a scene_video_prompt JSON has required structure. */
export function validateVideoPromptJSON(content: string): ValidationResult {
  const errors: string[] = [];
  if (!content || content.trim().length === 0) {
    errors.push('Video prompt content is empty');
    return { valid: false, errors };
  }

  // Try to extract JSON from markdown fences or raw
  let jsonStr = content;
  const fenceMatch = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  else {
    const braceMatch = content.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    errors.push('Content is not valid JSON');
    return { valid: false, errors };
  }

  // Must have shots array
  if (!parsed['shots'] || !Array.isArray(parsed['shots'])) {
    errors.push('Missing "shots" array');
    return { valid: false, errors };
  }

  const shots = parsed['shots'] as Array<Record<string, unknown>>;
  if (shots.length === 0) {
    errors.push('"shots" array is empty');
    return { valid: false, errors };
  }

  // Validate each shot
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    if (!shot['prompt'] && !shot['description']) {
      errors.push(`Shot ${i + 1}: missing "prompt" or "description" field`);
    }
    if (shot['duration'] === undefined && shot['duration'] === null) {
      errors.push(`Shot ${i + 1}: missing "duration" field`);
    }
    if (!shot['shotType'] && !shot['shot_type'] && !shot['shotNumber'] && !shot['shot_number']) {
      errors.push(`Shot ${i + 1}: missing shot type/number identifier`);
    }
    // Each shot prompt should be descriptive (>30 chars)
    const prompt = (shot['prompt'] || shot['description'] || '') as string;
    if (prompt.length < 30) {
      errors.push(`Shot ${i + 1}: prompt too short (${prompt.length} chars, need >30)`);
    }
  }

  // Should have at least 3 shots for a scene
  if (shots.length < 2) {
    errors.push(`Only ${shots.length} shot(s) — a scene should typically have 3+ shots`);
  }

  return { valid: errors.length === 0, errors };
}

/** Validate a shot image prompt is suitable for image generation. */
export function validateShotImagePrompt(content: string): ValidationResult {
  const errors: string[] = [];
  if (!content || content.trim().length === 0) {
    errors.push('Shot image prompt is empty');
    return { valid: false, errors };
  }

  if (content.length < 50) {
    errors.push(`Shot image prompt too short (${content.length} chars, need >50)`);
  }

  // Should contain visual descriptors
  const hasVisual = /light|shadow|camera|shot|frame|composition|color|warm|cold|detail|depth|focus|angle|wide|close|medium/i.test(content);
  if (!hasVisual) {
    errors.push('Does not contain visual/composition descriptors');
  }

  // Should reference the scene content (forge, dusk, etc.)
  const hasSceneRef = /forge|dusk|village|blacksmith|anvil|fire|mountain|stone/i.test(content);
  if (!hasSceneRef) {
    errors.push('Does not reference scene elements');
  }

  // Should not be JSON (it should be a text prompt)
  if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
    errors.push('Shot image prompt appears to be JSON, not descriptive text');
  }

  // No tag contamination
  if (/<think>/i.test(content)) errors.push('Contains <think> tag contamination');
  if (/<generated_content>/i.test(content)) errors.push('Contains leaked <generated_content> tags');

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Rubrics
// ---------------------------------------------------------------------------

export const PLOT_RUBRIC: JudgeRubric = {
  name: 'Plot Quality',
  description: 'Evaluates whether the generated plot is a well-structured narrative outline.',
  dimensions: [
    {
      name: 'Structure',
      weight: 0.4,
      criteria: 'Has clear acts/sections, logical progression, beginning/middle/end.',
      scoringGuide: {
        excellent: 'Clear 3-act structure with well-defined turning points',
        good: 'Identifiable structure with some progression',
        adequate: 'Has some structure but loosely organized',
        poor: 'No discernible structure, reads like a stream of consciousness',
      },
    },
    {
      name: 'Relevance',
      weight: 0.3,
      criteria: 'Faithfully expands the input concept without contradicting it.',
      scoringGuide: {
        excellent: 'Perfectly captures and expands the input concept',
        good: 'Captures the key concept with minor additions',
        adequate: 'Loosely related but drifts from the concept',
        poor: 'Ignores or contradicts the input concept',
      },
    },
    {
      name: 'Completeness',
      weight: 0.3,
      criteria: 'Sufficient detail for a writer to develop into a full story.',
      scoringGuide: {
        excellent: 'Rich detail — characters, conflict, setting, resolution all present',
        good: 'Most elements present, enough to work from',
        adequate: 'Thin but has a basic outline',
        poor: 'Too sparse to serve as a writing guide',
      },
    },
  ],
};

export const SCENE_RUBRIC: JudgeRubric = {
  name: 'Scene Description Quality',
  description: 'Evaluates whether the generated scene description is detailed enough for visual production.',
  dimensions: [
    {
      name: 'Visual Detail',
      weight: 0.35,
      criteria: 'Contains specific visual moments, lighting, composition, and spatial relationships.',
      scoringGuide: {
        excellent: 'Multiple specific visual moments with lighting, framing, and spatial details',
        good: 'Has clear visual description with some specific moments',
        adequate: 'General visual sense but lacks specificity',
        poor: 'No visual detail — reads like a plot summary',
      },
    },
    {
      name: 'Character & Setting Grounding',
      weight: 0.3,
      criteria: 'References specific characters and settings from the project context.',
      scoringGuide: {
        excellent: 'Names characters, references their traits, ties to specific locations',
        good: 'References characters and settings by name',
        adequate: 'Generic references without specifics',
        poor: 'No connection to established characters or settings',
      },
    },
    {
      name: 'Emotional Arc',
      weight: 0.2,
      criteria: 'Has a clear emotional progression within the scene.',
      scoringGuide: {
        excellent: 'Clear emotional journey from start to end of scene',
        good: 'Identifiable mood or emotional shift',
        adequate: 'Flat emotional tone throughout',
        poor: 'No emotional content',
      },
    },
    {
      name: 'Actionability',
      weight: 0.15,
      criteria: 'Structured enough to derive shot lists and storyboards from.',
      scoringGuide: {
        excellent: 'Could directly derive a shot list — has key moments, beats, transitions',
        good: 'Has enough structure for a director to plan shots',
        adequate: 'Somewhat vague but gives a general sense',
        poor: 'Too abstract to plan any visual production',
      },
    },
  ],
};

export const SCENE_VIDEO_PROMPT_RUBRIC: JudgeRubric = {
  name: 'Scene Video Prompt Quality',
  description: 'Evaluates whether the generated multi-shot video prompt JSON is valid and production-ready.',
  dimensions: [
    {
      name: 'JSON Structure',
      weight: 0.25,
      criteria: 'Valid JSON with required fields: shots array, each shot has prompt, duration, shotType, cameraWork.',
      scoringGuide: {
        excellent: 'Valid JSON with all required fields on every shot, plus extras like mood/characters',
        good: 'Valid JSON with required fields present',
        adequate: 'Valid JSON but missing some fields on some shots',
        poor: 'Invalid JSON or missing shots array',
      },
    },
    {
      name: 'Prompt Quality',
      weight: 0.35,
      criteria: 'Each shot prompt is detailed, visual, and describes a specific moment.',
      scoringGuide: {
        excellent: 'Rich visual prompts with lighting, composition, character details, atmosphere',
        good: 'Clear visual prompts with reasonable detail',
        adequate: 'Brief or generic prompts',
        poor: 'Vague or non-visual prompts',
      },
    },
    {
      name: 'Scene Coverage',
      weight: 0.2,
      criteria: 'Shots collectively cover the full scene — key moments, transitions, emotional beats.',
      scoringGuide: {
        excellent: 'Full scene coverage with varied shot types and pacing',
        good: 'Covers main beats of the scene',
        adequate: 'Covers some of the scene but gaps exist',
        poor: 'Only covers a fragment of the scene',
      },
    },
    {
      name: 'Character Consistency',
      weight: 0.2,
      criteria: 'Character descriptions in prompts match their established profiles.',
      scoringGuide: {
        excellent: 'Detailed character descriptions matching profiles — appearance, clothing, mannerisms',
        good: 'Characters identifiable and mostly consistent',
        adequate: 'Characters mentioned but descriptions are generic',
        poor: 'Characters not described or contradict their profiles',
      },
    },
  ],
};

export const SHOT_IMAGE_PROMPT_RUBRIC: JudgeRubric = {
  name: 'Shot Image Prompt Quality',
  description: 'Evaluates whether the generated shot image prompt is suitable for image generation.',
  dimensions: [
    {
      name: 'Visual Specificity',
      weight: 0.4,
      criteria: 'Detailed visual description including composition, lighting, color palette, framing.',
      scoringGuide: {
        excellent: 'Precise composition, lighting direction, color palette, depth of field, framing details',
        good: 'Clear visual description with some technical specifics',
        adequate: 'General visual sense but lacks precision',
        poor: 'Vague or narrative-style description not suited for image generation',
      },
    },
    {
      name: 'Scene Fidelity',
      weight: 0.3,
      criteria: 'Matches the source scene description and shot specifications.',
      scoringGuide: {
        excellent: 'Perfectly captures the described shot — type, mood, camera angle all match',
        good: 'Captures the shot intent with minor variations',
        adequate: 'Loosely related but drifts from specifications',
        poor: 'Does not match the source shot at all',
      },
    },
    {
      name: 'Image-Gen Readiness',
      weight: 0.3,
      criteria: 'Written in a style that works well for text-to-image models (descriptive, comma-separated details).',
      scoringGuide: {
        excellent: 'Optimized for image generation — clear subject, style cues, quality tags',
        good: 'Reasonable format for image generation',
        adequate: 'Could work but needs reformatting',
        poor: 'Written as prose/narrative, not as an image prompt',
      },
    },
  ],
};

export const STORY_RUBRIC: JudgeRubric = {
  name: 'Story Quality',
  description: 'Evaluates whether the generated story chapter is engaging prose with proper narrative craft.',
  dimensions: [
    {
      name: 'Narrative Quality',
      weight: 0.35,
      criteria: 'Engaging prose with dialogue, sensory details, and character development.',
      scoringGuide: {
        excellent: 'Vivid, immersive prose with natural dialogue and rich sensory detail',
        good: 'Well-written with some dialogue and scene-setting',
        adequate: 'Readable but somewhat flat or generic',
        poor: 'Reads like a summary rather than a story',
      },
    },
    {
      name: 'Plot Fidelity',
      weight: 0.35,
      criteria: 'Faithfully follows the plot outline without contradicting key events.',
      scoringGuide: {
        excellent: 'Perfectly follows the plot while adding vivid detail',
        good: 'Follows the plot with minor creative liberties',
        adequate: 'Covers the plot loosely but misses some elements',
        poor: 'Deviates significantly from the plot outline',
      },
    },
    {
      name: 'Length & Substance',
      weight: 0.3,
      criteria: 'Substantial enough to serve as a chapter (500+ words, real scenes).',
      scoringGuide: {
        excellent: '800+ words with multiple scenes and emotional beats',
        good: '500-800 words with at least one full scene',
        adequate: '300-500 words, somewhat thin',
        poor: 'Under 300 words or reads like a summary',
      },
    },
  ],
};
