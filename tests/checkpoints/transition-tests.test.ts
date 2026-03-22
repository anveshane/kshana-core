/**
 * Narrative Pipeline Transition Tests
 *
 * Tests each A→B transition by:
 * 1. Scaffolding a real project at state A (with fixture artifacts on disk)
 * 2. Running GenericAgent from that state — full orchestration, tool loop, generate_content
 * 3. Stopping the agent after it produces artifact B
 * 4. Judging artifact B quality with the LLM judge
 *
 * These test the actual pipeline — prompts, tool wiring, context loading, agent decisions.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WorkflowPhase } from '../../src/tasks/video/workflow/types.js';
import type { LLMClient } from '../../src/core/llm/index.js';
import {
  createTestLLMClient,
  checkLLMAvailability,
  scaffoldProject,
  runAgentTransition,
  createJudge,
  checkJudgeAvailability,
  validateScene,
  validateVideoPromptJSON,
  validateShotImagePrompt,
  PLOT_RUBRIC,
  STORY_RUBRIC,
  SCENE_RUBRIC,
  SCENE_VIDEO_PROMPT_RUBRIC,
  SHOT_IMAGE_PROMPT_RUBRIC,
} from './transition-helpers.js';
import type { JudgeLLMClient } from '../../src/testing/JudgeLLMClient.js';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(__dirname, 'fixtures', 'narrative');
const OUTPUT_DIR = join(process.cwd(), 'test-output', 'checkpoints');

function loadFixture(filename: string): string {
  return readFileSync(join(FIXTURE_DIR, filename), 'utf-8');
}

function saveOutput(name: string, content: string): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, name), content, 'utf-8');
}

/** Save debug JSON showing agent tool call trace. */
function saveDebug(name: string, result: { agentStatus: string; contentType: string | null; outputFile: string | null; content: string | null; toolResults: Array<{ toolName: string; result: unknown }> }): void {
  saveOutput(name, JSON.stringify({
    agentStatus: result.agentStatus,
    contentType: result.contentType,
    outputFile: result.outputFile,
    hasContent: !!result.content,
    toolResults: result.toolResults.map(t => ({
      toolName: t.toolName,
      resultKeys: Object.keys(t.result as Record<string, unknown>),
      status: (t.result as Record<string, unknown>)['status'],
      contentType: (t.result as Record<string, unknown>)['content_type'],
    })),
  }, null, 2));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Narrative Pipeline Transitions', () => {
  let llm: LLMClient;
  let judge: JudgeLLMClient;
  let llmAvailable = false;
  let judgeAvailable = false;

  beforeAll(async () => {
    llm = createTestLLMClient();
    llmAvailable = await checkLLMAvailability(llm);
    if (!llmAvailable) {
      console.warn('LLM not available — skipping checkpoint tests');
      return;
    }

    judge = createJudge();
    judgeAvailable = await checkJudgeAvailability(judge);
    if (!judgeAvailable) {
      console.warn('Judge LLM not available — tests will run without quality scoring');
    }
  }, 30_000);

  // ---- 1. input → plot ----
  it('input -> plot', async () => {
    if (!llmAvailable) return;

    const input = loadFixture('input.txt');

    // Scaffold: fresh project, plot phase is current
    const { basePath } = scaffoldProject({
      files: {},
      currentPhase: WorkflowPhase.PLOT,
      completedPhases: [],
      originalInput: input,
    });

    // Run agent — it should produce a plot
    const result = await runAgentTransition({
      basePath,
      task: `Read the project state, then use generate_content with content_type="plot" to create a plot outline for this narrative concept. The original input is: "${input.trim()}"`,
    });

    saveDebug('01-plot-debug.json', result);

    expect(result.content, 'Agent should produce content').toBeTruthy();
    expect(result.contentType).toBe('plot');

    saveOutput('01-plot.md', result.content!);

    // Judge the output
    if (judgeAvailable && result.content) {
      const score = await judge.score(PLOT_RUBRIC, input, result.content);
      saveOutput('01-plot-judge.json', JSON.stringify(score, null, 2));
      if (score.raw) {
        expect(score.overallScore, `Plot quality score ${score.overallScore} should be >= 0.5`).toBeGreaterThanOrEqual(0.5);
      }
    }
  }, 120_000);

  // ---- 2. plot → story ----
  it('plot -> story', async () => {
    if (!llmAvailable) return;

    const input = loadFixture('input.txt');
    const plot = loadFixture('plot.md');

    // Scaffold: project with plot completed, story phase is current
    const { basePath } = scaffoldProject({
      files: {
        'plans/plot.md': plot,
      },
      currentPhase: WorkflowPhase.STORY,
      completedPhases: [WorkflowPhase.PLOT],
      originalInput: input,
      contentOverrides: {
        plot: { status: 'available', file: 'plans/plot.md' },
      },
    });

    // Run agent — it should produce a story chapter
    const result = await runAgentTransition({
      basePath,
      task: 'Read the project state, then use generate_content with content_type="story" to write a detailed story chapter based on the plot outline. Write vivid, engaging prose with dialogue, sensory details, and character development. Focus on Chapter 1.',
    });

    saveDebug('02-story-debug.json', result);

    expect(result.content, 'Agent should produce content').toBeTruthy();
    expect(result.contentType).toBe('story');

    saveOutput('02-story.md', result.content!);

    // Judge the output
    if (judgeAvailable && result.content) {
      const score = await judge.score(STORY_RUBRIC, plot, result.content);
      saveOutput('02-story-judge.json', JSON.stringify(score, null, 2));
      if (score.raw) {
        expect(score.overallScore, `Story quality score ${score.overallScore} should be >= 0.5`).toBeGreaterThanOrEqual(0.5);
      }
    }
  }, 120_000);

  // ---- 3. story + characters + settings → scene ----
  it('story + chars + settings -> scene', async () => {
    if (!llmAvailable) return;

    const input = loadFixture('input.txt');
    const plot = loadFixture('plot.md');
    const story = loadFixture('chapter-1.story.md');
    const character = loadFixture('character-jan.profile.md');
    const setting = loadFixture('setting-village.profile.md');

    const { basePath } = scaffoldProject({
      files: {
        'plans/plot.md': plot,
        'plans/chapters/chapter-1.story.md': story,
        'characters/jan.profile.md': character,
        'settings/village.profile.md': setting,
      },
      currentPhase: WorkflowPhase.SCENES,
      completedPhases: [
        WorkflowPhase.PLOT,
        WorkflowPhase.STORY,
        WorkflowPhase.CHARACTERS_SETTINGS,
      ],
      originalInput: input,
      contentOverrides: {
        plot: { status: 'available', file: 'plans/plot.md' },
        story: { status: 'available', file: 'plans/chapters/chapter-1.story.md' },
        characters: { status: 'available', items: ['Jan'], itemFiles: { 'Jan': 'characters/jan.profile.md' } },
        settings: { status: 'available', items: ['Ashenmere Village'], itemFiles: { 'Ashenmere Village': 'settings/village.profile.md' } },
      },
    });

    const result = await runAgentTransition({
      basePath,
      task: 'Read the project state, then use generate_content with content_type="scene" and scene_number=1 to create scene 1: Jan at the forge at dusk. Describe the setting, characters present, action, emotional arc, and key visual moments.',
    });

    saveDebug('03-scene-debug.json', result);

    expect(result.content, 'Agent should produce scene content').toBeTruthy();
    expect(result.contentType).toBe('scene');

    saveOutput('03-scene.md', result.content!);

    // Structural validation
    const sceneValidation = validateScene(result.content!);
    saveOutput('03-scene-validation.json', JSON.stringify(sceneValidation, null, 2));
    expect(sceneValidation.errors, `Scene structural errors: ${sceneValidation.errors.join('; ')}`).toEqual([]);

    if (judgeAvailable && result.content) {
      const judgeInput = `Story:\n${story}\n\nCharacter:\n${character}\n\nSetting:\n${setting}`;
      const score = await judge.score(SCENE_RUBRIC, judgeInput, result.content);
      saveOutput('03-scene-judge.json', JSON.stringify(score, null, 2));
      if (score.raw) {
        expect(score.overallScore, `Scene quality score ${score.overallScore} should be >= 0.5`).toBeGreaterThanOrEqual(0.5);
      }
    }
  }, 120_000);

  // ---- 4. scene + refs → scene_video_prompt ----
  it('scene + refs -> scene_video_prompt', async () => {
    if (!llmAvailable) return;

    const input = loadFixture('input.txt');
    const plot = loadFixture('plot.md');
    const story = loadFixture('chapter-1.story.md');
    const character = loadFixture('character-jan.profile.md');
    const setting = loadFixture('setting-village.profile.md');
    const scene = loadFixture('scene-1.md');

    const { basePath, project } = scaffoldProject({
      files: {
        'plans/plot.md': plot,
        'plans/chapters/chapter-1.story.md': story,
        'characters/jan.profile.md': character,
        'settings/village.profile.md': setting,
        'plans/scenes/scene-1.md': scene,
      },
      currentPhase: WorkflowPhase.VIDEO,
      completedPhases: [
        WorkflowPhase.PLOT,
        WorkflowPhase.STORY,
        WorkflowPhase.CHARACTERS_SETTINGS,
        WorkflowPhase.SCENES,
        WorkflowPhase.CHARACTER_SETTING_IMAGES,
        WorkflowPhase.SCENE_IMAGES,
      ],
      originalInput: input,
      contentOverrides: {
        plot: { status: 'available', file: 'plans/plot.md' },
        story: { status: 'available', file: 'plans/chapters/chapter-1.story.md' },
        characters: { status: 'available', items: ['Jan'], itemFiles: { 'Jan': 'characters/jan.profile.md' } },
        settings: { status: 'available', items: ['Ashenmere Village'], itemFiles: { 'Ashenmere Village': 'settings/village.profile.md' } },
        scenes: { status: 'available', items: ['1'], itemFiles: { '1': 'plans/scenes/scene-1.md' } },
      },
    });

    // Also need scene refs in the project's scenes array
    project.scenes = [{
      sceneNumber: 1,
      file: 'plans/scenes/scene-1.md',
      title: 'The Forge at Dusk',
      description: 'Jan works at the forge as shadows grow unnaturally long.',
      contentApprovalStatus: 'approved',
      contentApprovedAt: Date.now(),
      imageApprovalStatus: 'approved',
      imageApprovedAt: Date.now(),
      videoApprovalStatus: 'pending',
      videoPromptApprovalStatus: 'pending',
      regenerationCount: 0,
    }];
    project.characters = [{
      name: 'Jan',
      description: 'A 25-year-old blacksmith',
      visualDescription: 'Broad muscular build, short dark brown hair, leather apron',
      approvalStatus: 'approved',
      approvedAt: Date.now(),
      referenceImageApprovalStatus: 'approved',
      regenerationCount: 0,
    }];
    project.settings = [{
      name: 'Ashenmere Village',
      description: 'Remote mountain village',
      visualDescription: 'Stone-and-timber buildings with slate roofs',
      approvalStatus: 'approved',
      approvedAt: Date.now(),
      referenceImageApprovalStatus: 'approved',
      regenerationCount: 0,
    }];

    // Save updated project with scene/character/setting data
    const { saveProject } = await import('../../src/tasks/video/workflow/ProjectManager.js');
    saveProject(project, basePath);

    const result = await runAgentTransition({
      basePath,
      task: 'Read the project state, then use generate_prompt with prompt_type="scene_video", scene_number=1 to generate a multi-shot video prompt for scene 1 (The Forge at Dusk).',
    });

    saveDebug('04-scene-video-prompt-debug.json', result);

    expect(result.content, 'Agent should produce video prompt content').toBeTruthy();
    expect(result.contentType).toBe('scene_video');

    saveOutput('04-scene-video-prompt.json', result.content!);

    // Structural validation — must be valid JSON with shots array
    const videoValidation = validateVideoPromptJSON(result.content!);
    saveOutput('04-scene-video-prompt-validation.json', JSON.stringify(videoValidation, null, 2));
    expect(videoValidation.errors, `Video prompt structural errors: ${videoValidation.errors.join('; ')}`).toEqual([]);

    if (judgeAvailable && result.content) {
      const judgeInput = `Scene:\n${scene}\n\nCharacter:\n${character}\n\nSetting:\n${setting}`;
      const score = await judge.score(SCENE_VIDEO_PROMPT_RUBRIC, judgeInput, result.content);
      saveOutput('04-scene-video-prompt-judge.json', JSON.stringify(score, null, 2));
      if (score.raw) {
        expect(score.overallScore, `Video prompt quality score ${score.overallScore} should be >= 0.5`).toBeGreaterThanOrEqual(0.5);
      }
    }
  }, 120_000);

  // ---- 5. scene_video_prompt → shot_image_prompt ----
  it('scene_video_prompt -> shot_image_prompt', async () => {
    if (!llmAvailable) return;

    const input = loadFixture('input.txt');
    const plot = loadFixture('plot.md');
    const story = loadFixture('chapter-1.story.md');
    const character = loadFixture('character-jan.profile.md');
    const setting = loadFixture('setting-village.profile.md');
    const scene = loadFixture('scene-1.md');
    const motionJson = loadFixture('scene-1.motion.json');

    const { basePath, project } = scaffoldProject({
      files: {
        'plans/plot.md': plot,
        'plans/chapters/chapter-1.story.md': story,
        'characters/jan.profile.md': character,
        'settings/village.profile.md': setting,
        'plans/scenes/scene-1.md': scene,
        'prompts/videos/scenes/scene-1.motion.json': motionJson,
      },
      currentPhase: WorkflowPhase.VIDEO,
      completedPhases: [
        WorkflowPhase.PLOT,
        WorkflowPhase.STORY,
        WorkflowPhase.CHARACTERS_SETTINGS,
        WorkflowPhase.SCENES,
        WorkflowPhase.CHARACTER_SETTING_IMAGES,
        WorkflowPhase.SCENE_IMAGES,
      ],
      originalInput: input,
      contentOverrides: {
        plot: { status: 'available', file: 'plans/plot.md' },
        story: { status: 'available', file: 'plans/chapters/chapter-1.story.md' },
        characters: { status: 'available', items: ['Jan'], itemFiles: { 'Jan': 'characters/jan.profile.md' } },
        settings: { status: 'available', items: ['Ashenmere Village'], itemFiles: { 'Ashenmere Village': 'settings/village.profile.md' } },
        scenes: { status: 'available', items: ['1'], itemFiles: { '1': 'plans/scenes/scene-1.md' } },
      },
    });

    // Set up scene with video prompt already generated
    project.scenes = [{
      sceneNumber: 1,
      file: 'plans/scenes/scene-1.md',
      title: 'The Forge at Dusk',
      description: 'Jan works at the forge as shadows grow unnaturally long.',
      contentApprovalStatus: 'approved',
      contentApprovedAt: Date.now(),
      imageApprovalStatus: 'approved',
      imageApprovedAt: Date.now(),
      videoPromptPath: 'prompts/videos/scenes/scene-1.motion.json',
      videoPromptApprovalStatus: 'approved',
      videoApprovalStatus: 'pending',
      regenerationCount: 0,
    }];
    project.characters = [{
      name: 'Jan',
      description: 'A 25-year-old blacksmith',
      visualDescription: 'Broad muscular build, short dark brown hair, leather apron',
      approvalStatus: 'approved',
      approvedAt: Date.now(),
      referenceImageApprovalStatus: 'approved',
      regenerationCount: 0,
    }];
    project.settings = [{
      name: 'Ashenmere Village',
      description: 'Remote mountain village',
      visualDescription: 'Stone-and-timber buildings with slate roofs',
      approvalStatus: 'approved',
      approvedAt: Date.now(),
      referenceImageApprovalStatus: 'approved',
      regenerationCount: 0,
    }];

    const { saveProject } = await import('../../src/tasks/video/workflow/ProjectManager.js');
    saveProject(project, basePath);

    const result = await runAgentTransition({
      basePath,
      task: 'Read the project state, then use generate_prompt with prompt_type="shot_image", scene_number=1, shot_number=1 to generate a shot image prompt for scene 1, shot 1 (establishing shot of the forge at dusk).',
    });

    saveDebug('05-shot-image-prompt-debug.json', result);

    expect(result.content, 'Agent should produce shot image prompt content').toBeTruthy();
    expect(result.contentType).toBe('shot_image');

    saveOutput('05-shot-image-prompt.md', result.content!);

    // Structural validation — must be descriptive visual text
    const shotValidation = validateShotImagePrompt(result.content!);
    saveOutput('05-shot-image-prompt-validation.json', JSON.stringify(shotValidation, null, 2));
    expect(shotValidation.errors, `Shot prompt structural errors: ${shotValidation.errors.join('; ')}`).toEqual([]);

    if (judgeAvailable && result.content) {
      const shotData = JSON.parse(motionJson).shots[0];
      const judgeInput = `Scene:\n${scene}\n\nShot spec:\n${JSON.stringify(shotData, null, 2)}\n\nCharacter:\n${character}\n\nSetting:\n${setting}`;
      const score = await judge.score(SHOT_IMAGE_PROMPT_RUBRIC, judgeInput, result.content);
      saveOutput('05-shot-image-prompt-judge.json', JSON.stringify(score, null, 2));
      if (score.raw) {
        expect(score.overallScore, `Shot prompt quality score ${score.overallScore} should be >= 0.5`).toBeGreaterThanOrEqual(0.5);
      }
    }
  }, 120_000);
});
