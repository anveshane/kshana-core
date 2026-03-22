/**
 * ContentDAGExecutor Tests
 *
 * Tests the DAG executor directly (no GenericAgent), validating:
 *
 * 1. FORMAT CONTRACTS — each content type must produce output that downstream
 *    consumers can parse. These are the real contracts:
 *    - Character: `# Name` + `## Description` + `## Visual Description` (consumed by formatCharacterMarkdown → PromptDAG)
 *    - Setting: `# Name` + `## Description` + `## Visual Description` (consumed by formatSettingMarkdown → PromptDAG)
 *    - Scene: parseable by parseSceneBreakdown() — `## Scene N: Title` + `**Duration:** N seconds`
 *    - Plot: markdown headings, substantial prose (consumed by story generation)
 *    - Story: prose narrative with headings (consumed by character/setting/scene generation)
 *
 * 2. REGISTRY BUG FIXES — the core bugs this DAG was built to fix:
 *    - Character saved with params.name, not LLM-generated name
 *    - Setting saved with params.name, not LLM-generated name
 *    - Scene pushed to project.scenes[] (not just content.scenes.status)
 *
 * 3. PHASE TRANSITIONS — after content generation, can PromptDAG find the
 *    registered entities and generate image prompts for them?
 *
 * 4. PARAM VALIDATION — rejects missing required params, handles already_exists
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { LLMClient } from '../../src/core/llm/index.js';
import { ContentDAGExecutor, cleanOutput, normalizeHeading } from '../../src/core/tools/builtin/contentDAG.js';
import { PromptDAGExecutor } from '../../src/core/tools/builtin/promptDAG.js';
import { parseSceneBreakdown } from '../../src/core/agent/sceneBreakdownParser.js';
import { setActiveProjectDir } from '../../src/tasks/video/workflow/activeProject.js';
import {
  createProject,
  saveProject,
  getProjectDir,
  loadProject,
} from '../../src/tasks/video/workflow/ProjectManager.js';
import { WorkflowPhase, PlannerStage } from '../../src/tasks/video/workflow/types.js';
import { checkLLMAvailability, createTestLLMClient } from './transition-helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(__dirname, 'fixtures', 'narrative');
const OUTPUT_DIR = join(process.cwd(), 'test-output', 'content-dag');

function loadFixture(filename: string): string {
  return readFileSync(join(FIXTURE_DIR, filename), 'utf-8');
}

function saveOutput(name: string, content: string): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, name), content, 'utf-8');
}

const noopEmit = () => {};

function scaffoldForDAG(opts: {
  files: Record<string, string>;
  currentPhase: WorkflowPhase;
  completedPhases: WorkflowPhase[];
  originalInput: string;
  contentOverrides?: Record<string, unknown>;
  characters?: Array<{ name: string; description: string }>;
  settings?: Array<{ name: string; description: string }>;
}): { projectDir: string; basePath: string } {
  const id = randomBytes(4).toString('hex');
  const basePath = join(tmpdir(), `content-dag-test-${id}`);
  mkdirSync(basePath, { recursive: true });

  const project = createProject(opts.originalInput, 'cinematic_realism', basePath);
  const projectDir = getProjectDir(basePath);

  for (const [relativePath, content] of Object.entries(opts.files)) {
    const fullPath = join(projectDir, relativePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }

  for (const phase of opts.completedPhases) {
    if (project.phases[phase]) {
      project.phases[phase].status = 'completed';
      project.phases[phase].completedAt = Date.now();
      project.phases[phase].plannerStage = PlannerStage.COMPLETE;
    }
  }

  project.currentPhase = opts.currentPhase;
  if (project.phases[opts.currentPhase]) {
    project.phases[opts.currentPhase].status = 'in_progress';
  }

  if (opts.contentOverrides) {
    Object.assign(project.content, opts.contentOverrides);
  }

  if (opts.characters) {
    for (const c of opts.characters) {
      project.characters.push({
        name: c.name, description: c.description, visualDescription: '',
        approvalStatus: 'approved', approvedAt: Date.now(), regenerationCount: 0,
      } as any);
    }
  }
  if (opts.settings) {
    for (const s of opts.settings) {
      project.settings.push({
        name: s.name, description: s.description, visualDescription: '',
        approvalStatus: 'approved', approvedAt: Date.now(), regenerationCount: 0,
      } as any);
    }
  }

  saveProject(project, basePath);
  setActiveProjectDir(projectDir);
  return { projectDir, basePath };
}

// ---------------------------------------------------------------------------
// Format contract validators
// ---------------------------------------------------------------------------

/** Validate character profile matches the contract consumed by PromptDAG + formatCharacterMarkdown */
function validateCharacterFormat(content: string, expectedName: string): string[] {
  const errors: string[] = [];

  // Must start with # Name heading
  if (!content.match(new RegExp(`^#\\s+.*${expectedName}`, 'im'))) {
    errors.push(`Missing "# ${expectedName}" heading (or heading with name)`);
  }

  // Must have ## Description section
  if (!/^##\s+(Description|Background)/im.test(content)) {
    errors.push('Missing "## Description" or "## Background" section');
  }

  // Must have ## Visual Description section (critical for image generation)
  if (!/^##\s+(Visual\s+Description|Physical\s+Appearance|Appearance)/im.test(content)) {
    errors.push('Missing "## Visual Description" or "## Physical Appearance" section');
  }

  // No thinking/reasoning contamination
  if (/^Thinking Process:/m.test(content)) {
    errors.push('Contains unstripped thinking preamble');
  }
  if (/<think>/i.test(content)) {
    errors.push('Contains <think> tag contamination');
  }

  return errors;
}

/** Validate setting profile matches the contract consumed by PromptDAG + formatSettingMarkdown */
function validateSettingFormat(content: string, expectedName: string): string[] {
  const errors: string[] = [];

  if (!content.match(new RegExp(`^#\\s+.*${expectedName.split(' ')[0]}`, 'im'))) {
    errors.push(`Missing heading containing "${expectedName.split(' ')[0]}"`);
  }

  if (!/^##\s+(Description|Overview)/im.test(content)) {
    errors.push('Missing "## Description" section');
  }

  if (!/^##\s+(Visual\s+Description|Physical|Appearance|Layout|Features)/im.test(content)) {
    errors.push('Missing "## Visual Description" or equivalent visual section');
  }

  if (/^Thinking Process:/m.test(content)) {
    errors.push('Contains unstripped thinking preamble');
  }

  return errors;
}

/** Validate scene is parseable by parseSceneBreakdown() */
function validateSceneFormat(content: string, expectedSceneNumber: number): string[] {
  const errors: string[] = [];

  // Must be parseable by the actual parser
  const parsed = parseSceneBreakdown(content);
  if (parsed.length === 0) {
    errors.push('parseSceneBreakdown() returned 0 scenes — format not recognized');
  } else {
    const scene = parsed.find(s => s.label.includes(`Scene ${expectedSceneNumber}`));
    if (!scene) {
      errors.push(`parseSceneBreakdown() did not find Scene ${expectedSceneNumber} (found: ${parsed.map(s => s.label).join(', ')})`);
    }
  }

  // Should reference characters or settings by name
  if (!/jan|maren|blacksmith|elder/i.test(content)) {
    errors.push('Scene does not reference any known characters');
  }

  if (/^Thinking Process:/m.test(content)) {
    errors.push('Contains unstripped thinking preamble');
  }

  return errors;
}

/** Validate plot has structure suitable for story generation */
function validatePlotFormat(content: string): string[] {
  const errors: string[] = [];

  if (!/^#/m.test(content)) {
    errors.push('Missing markdown heading');
  }

  // Should have multiple sections (acts, beginning/middle/end)
  const headingCount = (content.match(/^#{1,3}\s+/gm) || []).length;
  if (headingCount < 3) {
    errors.push(`Only ${headingCount} headings — plot should have 3+ sections (acts/beats)`);
  }

  if (content.trim().length < 500) {
    errors.push(`Plot too short (${content.trim().length} chars) for story generation`);
  }

  if (/^Thinking Process:/m.test(content)) {
    errors.push('Contains unstripped thinking preamble');
  }

  return errors;
}

/** Validate story is substantial prose */
function validateStoryFormat(content: string): string[] {
  const errors: string[] = [];

  if (!/^#/m.test(content)) {
    errors.push('Missing chapter heading');
  }

  if (content.trim().length < 1000) {
    errors.push(`Story too short (${content.trim().length} chars) — should be substantial prose`);
  }

  // Story should read as narrative, not an outline (check for prose indicators)
  const hasDialogue = /"|"|"/.test(content);
  const hasParagraphs = content.split(/\n\n+/).filter(p => p.trim().length > 100).length >= 3;
  if (!hasDialogue && !hasParagraphs) {
    errors.push('Story lacks dialogue or substantial paragraphs — may be outline rather than prose');
  }

  if (/^Thinking Process:/m.test(content)) {
    errors.push('Contains unstripped thinking preamble');
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentDAGExecutor', () => {
  let llm: LLMClient;
  let llmAvailable = false;

  beforeAll(async () => {
    llm = createTestLLMClient();
    llmAvailable = await checkLLMAvailability(llm);
    if (!llmAvailable) {
      console.warn('LLM not available — skipping ContentDAG tests');
    }
  }, 60_000);

  // ==========================================================================
  // FORMAT CONTRACTS
  // ==========================================================================

  describe('Format Contracts', () => {
    it('plot: structured outline parseable by story generation', async () => {
      if (!llmAvailable) return;

      const input = loadFixture('input.txt');
      const { projectDir, basePath } = scaffoldForDAG({
        files: {},
        currentPhase: WorkflowPhase.PLOT,
        completedPhases: [],
        originalInput: input,
      });

      const executor = new ContentDAGExecutor(llm, basePath, noopEmit, 'fmt-plot');
      const result = await executor.execute({
        content_type: 'plot',
        instruction: `Create a plot outline for this narrative concept: "${input.trim()}"`,
      });

      saveOutput('fmt-01-plot.md', result.content ?? '');
      expect(result.status).toBe('success');

      const formatErrors = validatePlotFormat(result.content!);
      saveOutput('fmt-01-plot-validation.json', JSON.stringify({ formatErrors }, null, 2));
      expect(formatErrors, `Plot format errors: ${formatErrors.join('; ')}`).toEqual([]);

      console.log(`Plot format OK: ${result.content!.length} chars`);
    }, 180_000);

    it('story: prose narrative with dialogue and substance', async () => {
      if (!llmAvailable) return;

      const input = loadFixture('input.txt');
      const plot = loadFixture('plot.md');
      const { projectDir, basePath } = scaffoldForDAG({
        files: { 'plans/plot.md': plot },
        currentPhase: WorkflowPhase.STORY,
        completedPhases: [WorkflowPhase.PLOT],
        originalInput: input,
        contentOverrides: { plot: { status: 'available', file: 'plans/plot.md' } },
      });

      const executor = new ContentDAGExecutor(llm, basePath, noopEmit, 'fmt-story');
      const result = await executor.execute({
        content_type: 'story',
        instruction: 'Write a detailed story chapter. Include vivid prose, dialogue, and sensory details.',
        chapter_number: 1,
      });

      saveOutput('fmt-02-story.md', result.content ?? '');
      expect(result.status).toBe('success');

      const formatErrors = validateStoryFormat(result.content!);
      saveOutput('fmt-02-story-validation.json', JSON.stringify({ formatErrors }, null, 2));
      expect(formatErrors, `Story format errors: ${formatErrors.join('; ')}`).toEqual([]);

      console.log(`Story format OK: ${result.content!.length} chars`);
    }, 300_000);

    it('character: has Description + Visual Description sections (PromptDAG contract)', async () => {
      if (!llmAvailable) return;

      const input = loadFixture('input.txt');
      const story = loadFixture('chapter-1.story.md');
      const { projectDir, basePath } = scaffoldForDAG({
        files: { 'plans/chapters/chapter-1.story.md': story },
        currentPhase: WorkflowPhase.CHARACTERS_SETTINGS,
        completedPhases: [WorkflowPhase.PLOT, WorkflowPhase.STORY],
        originalInput: input,
        contentOverrides: { story: { status: 'available', file: 'plans/chapters/chapter-1.story.md' } },
      });

      const executor = new ContentDAGExecutor(llm, basePath, noopEmit, 'fmt-char');
      const result = await executor.execute({
        content_type: 'character',
        name: 'Jan',
        instruction: 'Create a detailed character profile for Jan, the blacksmith protagonist. You MUST include sections titled "## Description" and "## Visual Description" with detailed physical appearance.',
      });

      saveOutput('fmt-03-character.md', result.content ?? '');
      expect(result.status).toBe('success');

      const formatErrors = validateCharacterFormat(result.content!, 'Jan');
      saveOutput('fmt-03-character-validation.json', JSON.stringify({ formatErrors }, null, 2));
      expect(formatErrors, `Character format errors: ${formatErrors.join('; ')}`).toEqual([]);

      console.log(`Character format OK: ${result.content!.length} chars`);
    }, 180_000);

    it('setting: has Description + Visual Description sections (PromptDAG contract)', async () => {
      if (!llmAvailable) return;

      const input = loadFixture('input.txt');
      const story = loadFixture('chapter-1.story.md');
      const { projectDir, basePath } = scaffoldForDAG({
        files: { 'plans/chapters/chapter-1.story.md': story },
        currentPhase: WorkflowPhase.CHARACTERS_SETTINGS,
        completedPhases: [WorkflowPhase.PLOT, WorkflowPhase.STORY],
        originalInput: input,
        contentOverrides: { story: { status: 'available', file: 'plans/chapters/chapter-1.story.md' } },
      });

      const executor = new ContentDAGExecutor(llm, basePath, noopEmit, 'fmt-setting');
      const result = await executor.execute({
        content_type: 'setting',
        name: 'Ashenmere Village',
        instruction: 'Create a detailed setting description for Ashenmere Village. You MUST include sections titled "## Description" and "## Visual Description".',
      });

      saveOutput('fmt-04-setting.md', result.content ?? '');
      expect(result.status).toBe('success');

      const formatErrors = validateSettingFormat(result.content!, 'Ashenmere Village');
      saveOutput('fmt-04-setting-validation.json', JSON.stringify({ formatErrors }, null, 2));
      expect(formatErrors, `Setting format errors: ${formatErrors.join('; ')}`).toEqual([]);

      console.log(`Setting format OK: ${result.content!.length} chars`);
    }, 180_000);

    it('scene: parseable by parseSceneBreakdown()', async () => {
      if (!llmAvailable) return;

      const input = loadFixture('input.txt');
      const story = loadFixture('chapter-1.story.md');
      const character = loadFixture('character-jan.profile.md');
      const setting = loadFixture('setting-village.profile.md');
      const { projectDir, basePath } = scaffoldForDAG({
        files: {
          'plans/chapters/chapter-1.story.md': story,
          'characters/jan.profile.md': character,
          'settings/village.profile.md': setting,
        },
        currentPhase: WorkflowPhase.SCENES,
        completedPhases: [WorkflowPhase.PLOT, WorkflowPhase.STORY, WorkflowPhase.CHARACTERS_SETTINGS],
        originalInput: input,
        contentOverrides: {
          story: { status: 'available', file: 'plans/chapters/chapter-1.story.md' },
          characters: { status: 'available', items: ['Jan'], itemFiles: { 'Jan': 'characters/jan.profile.md' } },
          settings: { status: 'available', items: ['Ashenmere Village'], itemFiles: { 'Ashenmere Village': 'settings/village.profile.md' } },
        },
        characters: [{ name: 'Jan', description: 'A blacksmith' }],
        settings: [{ name: 'Ashenmere Village', description: 'Remote mountain village' }],
      });

      const executor = new ContentDAGExecutor(llm, basePath, noopEmit, 'fmt-scene');
      const result = await executor.execute({
        content_type: 'scene',
        scene_number: 1,
        instruction: 'Create Scene 1: Jan at the forge at dusk. Use the heading format "## Scene 1: [Title]" and include a "**Duration Estimate:** N seconds" line. Describe characters present, setting, action, emotional arc, and key visual moments.',
      });

      saveOutput('fmt-05-scene.md', result.content ?? '');
      expect(result.status).toBe('success');

      const formatErrors = validateSceneFormat(result.content!, 1);
      saveOutput('fmt-05-scene-validation.json', JSON.stringify({ formatErrors }, null, 2));
      expect(formatErrors, `Scene format errors: ${formatErrors.join('; ')}`).toEqual([]);

      console.log(`Scene format OK: ${result.content!.length} chars`);
    }, 300_000);
  });

  // ==========================================================================
  // REGISTRY BUG FIXES
  // ==========================================================================

  describe('Registry Bug Fixes', () => {
    it('character name from params.name, not LLM-generated', async () => {
      if (!llmAvailable) return;

      const story = loadFixture('chapter-1.story.md');
      const { projectDir, basePath } = scaffoldForDAG({
        files: { 'plans/chapters/chapter-1.story.md': story },
        currentPhase: WorkflowPhase.CHARACTERS_SETTINGS,
        completedPhases: [WorkflowPhase.PLOT, WorkflowPhase.STORY],
        originalInput: 'test',
        contentOverrides: { story: { status: 'available', file: 'plans/chapters/chapter-1.story.md' } },
      });

      const executor = new ContentDAGExecutor(llm, basePath, noopEmit, 'reg-char');
      const result = await executor.execute({
        content_type: 'character',
        name: 'Jan',
        instruction: 'Create a character profile for Jan the blacksmith. Include Description and Visual Description sections.',
      });

      expect(result.status).toBe('success');
      expect(result.registry_updated).toBe(true);

      const project = loadProject(basePath)!;
      const char = project.characters.find(c => c.name === 'Jan');
      expect(char, 'Character "Jan" must be in project.characters[]').toBeTruthy();
      expect(char!.name).toBe('Jan');

      // Verify no LLM-generated names like "Profile: Jan" or "Character Profile: Jan"
      const badNames = project.characters.filter(c => c.name !== 'Jan' && /jan/i.test(c.name));
      expect(badNames, `Found bad character names: ${badNames.map(c => c.name)}`).toHaveLength(0);
    }, 180_000);

    it('setting name from params.name, not LLM-generated', async () => {
      if (!llmAvailable) return;

      const story = loadFixture('chapter-1.story.md');
      const { projectDir, basePath } = scaffoldForDAG({
        files: { 'plans/chapters/chapter-1.story.md': story },
        currentPhase: WorkflowPhase.CHARACTERS_SETTINGS,
        completedPhases: [WorkflowPhase.PLOT, WorkflowPhase.STORY],
        originalInput: 'test',
        contentOverrides: { story: { status: 'available', file: 'plans/chapters/chapter-1.story.md' } },
      });

      const executor = new ContentDAGExecutor(llm, basePath, noopEmit, 'reg-setting');
      const result = await executor.execute({
        content_type: 'setting',
        name: 'Ashenmere Village',
        instruction: 'Create a setting description for Ashenmere Village. Include Description and Visual Description sections.',
      });

      expect(result.status).toBe('success');
      expect(result.registry_updated).toBe(true);

      const project = loadProject(basePath)!;
      const setting = project.settings.find(s => s.name === 'Ashenmere Village');
      expect(setting, 'Setting must be in project.settings[]').toBeTruthy();
      expect(setting!.name).toBe('Ashenmere Village');
    }, 300_000);

    it('scene pushed to project.scenes[] with correct fields', async () => {
      if (!llmAvailable) return;

      const story = loadFixture('chapter-1.story.md');
      const character = loadFixture('character-jan.profile.md');
      const setting = loadFixture('setting-village.profile.md');
      const { projectDir, basePath } = scaffoldForDAG({
        files: {
          'plans/chapters/chapter-1.story.md': story,
          'characters/jan.profile.md': character,
          'settings/village.profile.md': setting,
        },
        currentPhase: WorkflowPhase.SCENES,
        completedPhases: [WorkflowPhase.PLOT, WorkflowPhase.STORY, WorkflowPhase.CHARACTERS_SETTINGS],
        originalInput: 'test',
        contentOverrides: {
          story: { status: 'available', file: 'plans/chapters/chapter-1.story.md' },
          characters: { status: 'available', items: ['Jan'], itemFiles: { 'Jan': 'characters/jan.profile.md' } },
          settings: { status: 'available', items: ['Ashenmere Village'], itemFiles: { 'Ashenmere Village': 'settings/village.profile.md' } },
        },
        characters: [{ name: 'Jan', description: 'A blacksmith' }],
        settings: [{ name: 'Ashenmere Village', description: 'Remote mountain village' }],
      });

      const executor = new ContentDAGExecutor(llm, basePath, noopEmit, 'reg-scene');
      const result = await executor.execute({
        content_type: 'scene',
        scene_number: 1,
        instruction: 'Create Scene 1: Jan at the forge. Use "## Scene 1:" heading format.',
      });

      expect(result.status).toBe('success');

      const project = loadProject(basePath)!;
      const scene = project.scenes.find(s => s.sceneNumber === 1);
      expect(scene, 'Scene 1 must be in project.scenes[]').toBeTruthy();
      expect(scene!.file).toBe('plans/scenes/scene-1.md');
      expect(scene!.contentApprovalStatus).toBe('approved');
      expect(scene!.regenerationCount).toBe(0);
      expect(project.content.scenes.status).toBe('available');
    }, 300_000);
  });

  // ==========================================================================
  // PHASE TRANSITION: ContentDAG → PromptDAG chain
  // ==========================================================================

  describe('Phase Transition: ContentDAG → PromptDAG', () => {
    it('PromptDAG can find character registered by ContentDAG and generate image prompt', async () => {
      if (!llmAvailable) return;

      // 1. Scaffold project with story
      const input = loadFixture('input.txt');
      const story = loadFixture('chapter-1.story.md');
      const { projectDir, basePath } = scaffoldForDAG({
        files: { 'plans/chapters/chapter-1.story.md': story },
        currentPhase: WorkflowPhase.CHARACTERS_SETTINGS,
        completedPhases: [WorkflowPhase.PLOT, WorkflowPhase.STORY],
        originalInput: input,
        contentOverrides: { story: { status: 'available', file: 'plans/chapters/chapter-1.story.md' } },
      });

      // 2. Generate character profile via ContentDAG
      const contentDAG = new ContentDAGExecutor(llm, basePath, noopEmit, 'chain-char');
      const charResult = await contentDAG.execute({
        content_type: 'character',
        name: 'Jan',
        instruction: 'Create a character profile for Jan the blacksmith. Include "## Description" and "## Visual Description" sections.',
      });

      saveOutput('chain-01-character.md', charResult.content ?? '');
      saveOutput('chain-01-character-result.json', JSON.stringify(charResult, null, 2));
      expect(charResult.status, `ContentDAG character error: ${charResult.error}`).toBe('success');

      // 3. Verify character is registered and file exists
      const project = loadProject(basePath)!;
      const registeredChar = project.characters.find(c => c.name === 'Jan');
      expect(registeredChar, 'Jan must be in project.characters[]').toBeTruthy();

      // 4. Now run PromptDAG to generate character_image prompt
      //    This is the phase transition: CHARACTERS_SETTINGS → CHARACTER_SETTING_IMAGES
      const promptDAG = new PromptDAGExecutor(llm, projectDir);
      const promptResult = await promptDAG.execute({
        prompt_type: 'character_image',
        name: 'Jan',
        overwrite: true,
      });

      saveOutput('chain-02-character-image-prompt.md', promptResult.content ?? '');
      saveOutput('chain-02-prompt-result.json', JSON.stringify(promptResult, null, 2));

      expect(promptResult.status, `PromptDAG error: ${promptResult.error}`).toBe('success');
      expect(promptResult.content).toBeTruthy();

      console.log(`Chain test OK: character → image prompt (${promptResult.content!.length} chars)`);
    }, 600_000);
  });

  // ==========================================================================
  // PARAM VALIDATION (no LLM needed)
  // ==========================================================================

  describe('Param Validation', () => {
    it('rejects character without name', async () => {
      const { projectDir, basePath } = scaffoldForDAG({
        files: {},
        currentPhase: WorkflowPhase.CHARACTERS_SETTINGS,
        completedPhases: [],
        originalInput: 'test',
      });

      const executor = new ContentDAGExecutor(llm, basePath, noopEmit, 'val-noname');
      const result = await executor.execute({
        content_type: 'character',
        instruction: 'Create a character profile',
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('name');
    });

    it('rejects setting without name', async () => {
      const { projectDir, basePath } = scaffoldForDAG({
        files: {},
        currentPhase: WorkflowPhase.CHARACTERS_SETTINGS,
        completedPhases: [],
        originalInput: 'test',
      });

      const executor = new ContentDAGExecutor(llm, basePath, noopEmit, 'val-noname-s');
      const result = await executor.execute({
        content_type: 'setting',
        instruction: 'Create a setting',
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('name');
    });

    it('rejects scene without scene_number', async () => {
      const { projectDir, basePath } = scaffoldForDAG({
        files: {},
        currentPhase: WorkflowPhase.SCENES,
        completedPhases: [],
        originalInput: 'test',
      });

      const executor = new ContentDAGExecutor(llm, basePath, noopEmit, 'val-noscene');
      const result = await executor.execute({
        content_type: 'scene',
        instruction: 'Create a scene',
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('scene_number');
    });

    it('returns already_exists when file exists and overwrite=false', async () => {
      const plot = loadFixture('plot.md');
      const { projectDir, basePath } = scaffoldForDAG({
        files: { 'plans/plot.md': plot },
        currentPhase: WorkflowPhase.PLOT,
        completedPhases: [],
        originalInput: 'test',
      });

      const executor = new ContentDAGExecutor(llm, basePath, noopEmit, 'val-exists');
      const result = await executor.execute({
        content_type: 'plot',
        instruction: 'Create a plot',
        overwrite: false,
      });

      expect(result.status).toBe('already_exists');
      expect(result.content).toBeTruthy();
    });

    it('rejects missing instruction', async () => {
      const { projectDir, basePath } = scaffoldForDAG({
        files: {},
        currentPhase: WorkflowPhase.PLOT,
        completedPhases: [],
        originalInput: 'test',
      });

      const executor = new ContentDAGExecutor(llm, basePath, noopEmit, 'val-noinstr');
      const result = await executor.execute({
        content_type: 'plot',
        instruction: '',
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('instruction');
    });
  });

  // ==========================================================================
  // OUTPUT CLEANING — verifies cleanOutput handles various LLM contamination
  // patterns. These are pure function tests, no LLM needed.
  // ==========================================================================

  describe('Output Cleaning (multi-model robustness)', () => {
    it('strips DeepSeek <think> tags', () => {
      const raw = `<think>Let me analyze the request...\nI should create a character profile.\n</think>\n# Jan\n\n## Description\nA blacksmith.`;
      const result = cleanOutput(raw);
      expect(result).toBe('# Jan\n\n## Description\nA blacksmith.');
    });

    it('strips <thinking> tags (Anthropic-style)', () => {
      const raw = `<thinking>Planning the character...</thinking>\n# Jan\n\n## Description\nA blacksmith.`;
      const result = cleanOutput(raw);
      expect(result).toBe('# Jan\n\n## Description\nA blacksmith.');
    });

    it('strips <reasoning> and <reflection> tags', () => {
      const raw = `<reasoning>First I need to...</reasoning>\n<reflection>Let me reconsider...</reflection>\n# Jan\n\nContent here.`;
      const result = cleanOutput(raw);
      expect(result).toBe('# Jan\n\nContent here.');
    });

    it('strips pipe-delimited <|think|> tags', () => {
      const raw = `<|think|>Internal reasoning...<|/think|>\n# Jan\n\nContent.`;
      const result = cleanOutput(raw);
      expect(result).toBe('# Jan\n\nContent.');
    });

    it('strips Qwen plain-text thinking preamble (no tags)', () => {
      const raw = `Thinking Process:\n\n1. Analyze the request\n2. Determine scope\n3. Draft content\n\n# Jan\n\n## Description\nA blacksmith.`;
      const result = cleanOutput(raw);
      expect(result).toBe('# Jan\n\n## Description\nA blacksmith.');
    });

    it('strips verbose chain-of-thought before first heading', () => {
      const raw = `I'll create a detailed character profile for Jan. Let me consider the story context provided...\n\nThe chapter mentions Jan is a blacksmith who works at the forge. He has a connection to his grandfather's legacy.\n\nHere's the character profile:\n\n# Jan\n\n## Description\nContent.`;
      const result = cleanOutput(raw);
      expect(result).toBe('# Jan\n\n## Description\nContent.');
    });

    it('unwraps markdown code fences', () => {
      const raw = '```markdown\n# Jan\n\n## Description\nA blacksmith.\n```';
      const result = cleanOutput(raw);
      expect(result).toBe('# Jan\n\n## Description\nA blacksmith.');
    });

    it('strips tool-call XML', () => {
      const raw = `# Jan\n\n## Description\nA blacksmith.\n\n<tool_call>\n{"name": "save_file"}\n</tool_call>`;
      const result = cleanOutput(raw);
      expect(result).toBe('# Jan\n\n## Description\nA blacksmith.');
    });

    it('handles multiple contamination types at once', () => {
      const raw = `<think>Let me think...</think>\n\nOkay, here is the profile:\n\n# Character Profile: Jan the Blacksmith\n\n## Description\nJan is a blacksmith.\n\n## Visual Description\nTall and muscular.`;
      const result = cleanOutput(raw);
      expect(result).toBe('# Character Profile: Jan the Blacksmith\n\n## Description\nJan is a blacksmith.\n\n## Visual Description\nTall and muscular.');
    });

    it('preserves clean content unchanged', () => {
      const clean = '# Jan\n\n## Description\nA blacksmith.\n\n## Visual Description\nTall and muscular.';
      const result = cleanOutput(clean);
      expect(result).toBe(clean);
    });

    it('handles empty and whitespace input', () => {
      expect(cleanOutput('')).toBe('');
      expect(cleanOutput('   \n\n  ')).toBe('');
    });
  });

  // ==========================================================================
  // HEADING NORMALIZATION — verifies normalizeHeading handles various LLM
  // heading styles for character/setting content.
  // ==========================================================================

  describe('Heading Normalization (multi-model robustness)', () => {
    it('replaces "# Character Profile: Jan the Blacksmith" with "# Jan"', () => {
      const content = '# Character Profile: Jan the Blacksmith\n\n## Description\nContent.';
      const result = normalizeHeading(content, 'character', 'Jan');
      expect(result).toBe('# Jan\n\n## Description\nContent.');
    });

    it('replaces "# Profile: Ashenmere Village" with "# Ashenmere Village"', () => {
      const content = '# Profile: Ashenmere Village\n\n## Description\nContent.';
      const result = normalizeHeading(content, 'setting', 'Ashenmere Village');
      expect(result).toBe('# Ashenmere Village\n\n## Description\nContent.');
    });

    it('prepends H1 when content starts with H2 (no H1 present)', () => {
      const content = '## Description\nJan is a blacksmith.\n\n## Visual Description\nTall.';
      const result = normalizeHeading(content, 'character', 'Jan');
      expect(result).toBe('# Jan\n\n## Description\nJan is a blacksmith.\n\n## Visual Description\nTall.');
    });

    it('prepends H1 when content has no headings at all', () => {
      const content = 'Jan is a blacksmith from Ashenmere. He works at the forge.';
      const result = normalizeHeading(content, 'character', 'Jan');
      expect(result).toBe('# Jan\n\nJan is a blacksmith from Ashenmere. He works at the forge.');
    });

    it('does not modify plot content', () => {
      const content = '# Epic Fantasy Plot\n\nAct 1...';
      const result = normalizeHeading(content, 'plot', undefined);
      expect(result).toBe(content);
    });

    it('does not modify scene content', () => {
      const content = '## Scene 1: The Forge\n\nAction...';
      const result = normalizeHeading(content, 'scene', undefined);
      expect(result).toBe(content);
    });

    it('does not modify when name is undefined', () => {
      const content = '# Some Heading\n\nContent.';
      const result = normalizeHeading(content, 'character', undefined);
      expect(result).toBe(content);
    });

    it('handles H1 with extra decoration', () => {
      const content = '# **Jan — The Village Blacksmith**\n\n## Description\nContent.';
      const result = normalizeHeading(content, 'character', 'Jan');
      expect(result).toBe('# Jan\n\n## Description\nContent.');
    });
  });
});
