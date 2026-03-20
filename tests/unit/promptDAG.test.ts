/**
 * Tests for the DAG-driven prompt generation executor.
 *
 * Uses a mock project directory with character/setting profiles to verify
 * that context is resolved correctly and the LLM is called with the right prompt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PromptDAGExecutor } from '../../src/core/tools/builtin/promptDAG.js';
import type { LLMClient } from '../../src/core/llm/index.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_PROJECT_DIR = '/tmp/promptDAG-test-project';

const MOCK_PROJECT = {
  version: '2.0',
  id: 'test-project',
  title: 'Test Project',
  originalInputFile: 'original_input.md',
  style: 'cinematic_realism',
  inputType: 'idea',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  currentPhase: 'IMAGE_PROMPTS',
  phases: {},
  content: {
    characters: { itemFiles: { 'Isha': 'characters/isha.profile.md' } },
    settings: { itemFiles: { 'Ancient Library': 'settings/ancient_library.profile.md' } },
  },
  characters: [
    {
      name: 'Isha',
      status: 'approved',
      referenceImagePath: 'assets/images/isha_ref.png',
    },
  ],
  settings: [
    {
      name: 'Ancient Library',
      status: 'approved',
      referenceImagePath: 'assets/images/library_ref.png',
    },
  ],
  scenes: [
    { sceneNumber: 1, file: 'plans/scenes/scene-1.md' },
  ],
  assets: [],
};

const MOCK_CHARACTER_PROFILE = `# Isha

## Physical Appearance
- Age: 28
- Height: 5'7"
- Dark brown eyes, angular features
- Usually wears earth-tone saris

## Personality
Determined, scholarly, quiet intensity.
`;

const MOCK_SETTING_PROFILE = `# Ancient Library

## Description
A vast underground library carved into sandstone. Towering shelves of palm-leaf manuscripts.
Oil lamps cast warm amber light. Dust motes drift in shafts of light from narrow windows.
`;

const MOCK_SCENE_DESC = `# Scene 1: The Discovery

Isha enters the Ancient Library for the first time, overwhelmed by its scale.
She traces her fingers along the spines of manuscripts, searching for the lost text.
A shaft of golden light illuminates a particular shelf, drawing her attention.
`;

const MOCK_MOTION_JSON = JSON.stringify({
  shots: [
    {
      shot_number: 1,
      description: 'Wide establishing shot of Isha entering the library',
      motion_description: 'Slow push-in as Isha walks forward',
      camera_movement: 'dolly_in',
      duration_seconds: 6,
    },
    {
      shot_number: 2,
      description: 'Close-up of Isha\'s hand on the manuscript shelf',
      motion_description: 'Static camera, subtle hand movement',
      camera_movement: 'static',
      duration_seconds: 4,
    },
  ],
}, null, 2);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLLM(responseContent: string): LLMClient {
  return {
    generate: vi.fn().mockResolvedValue({ content: responseContent }),
    getModel: vi.fn().mockReturnValue('test-model'),
  } as unknown as LLMClient;
}

function setupTestProject(): void {
  // Create directory structure
  const dirs = [
    'characters',
    'settings',
    'plans/scenes',
    'prompts/images/characters',
    'prompts/images/settings',
    'prompts/images/scenes',
    'prompts/images/shots',
    'prompts/videos/scenes',
    'assets/images',
  ];
  for (const dir of dirs) {
    fs.mkdirSync(path.join(TEST_PROJECT_DIR, dir), { recursive: true });
  }

  // Write files
  fs.writeFileSync(
    path.join(TEST_PROJECT_DIR, 'characters/isha.profile.md'),
    MOCK_CHARACTER_PROFILE,
  );
  fs.writeFileSync(
    path.join(TEST_PROJECT_DIR, 'settings/ancient_library.profile.md'),
    MOCK_SETTING_PROFILE,
  );
  fs.writeFileSync(
    path.join(TEST_PROJECT_DIR, 'plans/scenes/scene-1.md'),
    MOCK_SCENE_DESC,
  );
  // Create reference images (empty files)
  fs.writeFileSync(path.join(TEST_PROJECT_DIR, 'assets/images/isha_ref.png'), '');
  fs.writeFileSync(path.join(TEST_PROJECT_DIR, 'assets/images/library_ref.png'), '');
}

function cleanupTestProject(): void {
  if (fs.existsSync(TEST_PROJECT_DIR)) {
    fs.rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock('../../src/tasks/video/workflow/ProjectManager.js', () => ({
  loadProject: () => MOCK_PROJECT,
  getProjectDir: () => TEST_PROJECT_DIR,
}));

vi.mock('../../src/core/prompts/loader.js', () => ({
  resolveGuide: () => ({
    content: 'You are an expert image prompt writer. Follow the output format.',
    source: 'default:scene_image_guide.md',
  }),
}));

vi.mock('../../src/services/providers/index.js', () => ({
  getProviderRegistry: () => ({
    getConfig: () => ({
      imageGeneration: 'comfyui',
      imageEditing: 'comfyui',
      videoGeneration: 'comfyui',
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PromptDAGExecutor', () => {
  beforeEach(() => {
    setupTestProject();
  });

  afterEach(() => {
    cleanupTestProject();
  });

  describe('parameter validation', () => {
    it('should reject character_image without name', async () => {
      const llm = createMockLLM('');
      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);
      const result = await executor.execute({ prompt_type: 'character_image' });
      expect(result.status).toBe('error');
      expect(result.error).toContain('name');
    });

    it('should reject scene_image without scene_number', async () => {
      const llm = createMockLLM('');
      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);
      const result = await executor.execute({ prompt_type: 'scene_image' });
      expect(result.status).toBe('error');
      expect(result.error).toContain('scene_number');
    });

    it('should reject shot_image without shot_number', async () => {
      const llm = createMockLLM('');
      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);
      const result = await executor.execute({ prompt_type: 'shot_image', scene_number: 1 });
      expect(result.status).toBe('error');
      expect(result.error).toContain('shot_number');
    });
  });

  describe('character_image', () => {
    it('should generate a character image prompt', async () => {
      const mockOutput = `**Image Prompt:**
A portrait of the woman from image 1, standing in soft directional light from the left. Warm earth-tone sari draped over one shoulder. Shallow depth of field, cinematic color grading.

**Negative Prompt:**
blurry, low quality, cartoon

**Aspect Ratio:**
1:1

**Generation Mode:**
image_text_to_image`;

      const llm = createMockLLM(mockOutput);
      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);

      const result = await executor.execute({
        prompt_type: 'character_image',
        name: 'Isha',
      });

      expect(result.status).toBe('success');
      expect(result.output_file).toBe('prompts/images/characters/isha.prompt.md');

      // Verify file was written
      const outputPath = path.join(TEST_PROJECT_DIR, result.output_file);
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.readFileSync(outputPath, 'utf-8')).toBe(mockOutput);

      // Verify LLM was called with profile context
      const generateCall = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const userPrompt = generateCall.messages[1].content;
      expect(userPrompt).toContain('Character Profile');
      expect(userPrompt).toContain('Isha');
    });

    it('should return already_exists when file exists and overwrite is false', async () => {
      // Pre-create the output file
      const outputPath = path.join(TEST_PROJECT_DIR, 'prompts/images/characters/isha.prompt.md');
      fs.writeFileSync(outputPath, 'existing prompt content');

      const llm = createMockLLM('');
      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);

      const result = await executor.execute({
        prompt_type: 'character_image',
        name: 'Isha',
      });

      expect(result.status).toBe('already_exists');
      expect(result.content).toBe('existing prompt content');
      // LLM should NOT have been called
      expect(llm.generate).not.toHaveBeenCalled();
    });

    it('should regenerate when overwrite is true', async () => {
      // Pre-create the output file
      const outputPath = path.join(TEST_PROJECT_DIR, 'prompts/images/characters/isha.prompt.md');
      fs.writeFileSync(outputPath, 'old content');

      const mockOutput = `**Image Prompt:**
New prompt content.

**Negative Prompt:**
none

**Aspect Ratio:**
1:1

**Generation Mode:**
text_to_image`;

      const llm = createMockLLM(mockOutput);
      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);

      const result = await executor.execute({
        prompt_type: 'character_image',
        name: 'Isha',
        overwrite: true,
      });

      expect(result.status).toBe('success');
      expect(llm.generate).toHaveBeenCalled();
    });
  });

  describe('scene_image', () => {
    it('should resolve scene description and reference images', async () => {
      const mockOutput = `**Image Prompt:**
A wide shot of the woman from image 1 entering the vast underground library from image 2. Golden light from narrow windows above illuminates dust motes. Oil lamps cast warm amber pools on sandstone walls. Cinematic framing.

**Reference Images:**
- Character: Isha
- Setting: Ancient Library

**Negative Prompt:**
blurry, cartoon, text

**Aspect Ratio:**
16:9

**Generation Mode:**
image_text_to_image`;

      const llm = createMockLLM(mockOutput);
      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);

      const result = await executor.execute({
        prompt_type: 'scene_image',
        scene_number: 1,
      });

      expect(result.status).toBe('success');
      expect(result.output_file).toBe('prompts/images/scenes/scene-1.prompt.md');

      // Verify scene description was included in context
      const generateCall = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const userPrompt = generateCall.messages[1].content;
      expect(userPrompt).toContain('Scene Description');
      expect(userPrompt).toContain('Discovery');
      // Verify reference images section
      expect(userPrompt).toContain('Reference Images');
      expect(userPrompt).toContain('image 1');
      expect(userPrompt).toContain('image 2');
      // Verify generation mode
      expect(userPrompt).toContain('image_text_to_image');
    });
  });

  describe('shot_image', () => {
    it('should fail if motion JSON does not exist', async () => {
      const llm = createMockLLM('');
      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);

      const result = await executor.execute({
        prompt_type: 'shot_image',
        scene_number: 1,
        shot_number: 1,
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('scene_video');
    });

    it('should resolve shot from motion JSON', async () => {
      // Create motion JSON
      const motionPath = path.join(TEST_PROJECT_DIR, 'prompts/videos/scenes/scene-1.motion.json');
      fs.writeFileSync(motionPath, MOCK_MOTION_JSON);

      const mockOutput = `**Image Prompt:**
A wide establishing shot of the woman from image 1 walking into the vast library from image 2. Warm amber light from oil lamps. Towering sandstone shelves recede into shadow. Cinematic wide angle.

**Negative Prompt:**
blurry, text

**Aspect Ratio:**
16:9

**Generation Mode:**
image_text_to_image`;

      const llm = createMockLLM(mockOutput);
      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);

      const result = await executor.execute({
        prompt_type: 'shot_image',
        scene_number: 1,
        shot_number: 1,
      });

      expect(result.status).toBe('success');
      expect(result.output_file).toBe('prompts/images/shots/scene-1-shot-1.prompt.md');

      // Verify shot details were included
      const generateCall = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const userPrompt = generateCall.messages[1].content;
      expect(userPrompt).toContain('Shot Details');
      expect(userPrompt).toContain('establishing shot');
    });
  });

  describe('scene_video', () => {
    it('should generate valid motion JSON', async () => {
      const mockMotionOutput = '```json\n' + MOCK_MOTION_JSON + '\n```';

      const llm = createMockLLM(mockMotionOutput);
      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);

      const result = await executor.execute({
        prompt_type: 'scene_video',
        scene_number: 1,
      });

      expect(result.status).toBe('success');
      expect(result.output_file).toBe('prompts/videos/scenes/scene-1.motion.json');

      // Verify the output is clean JSON (not markdown wrapped)
      const outputPath = path.join(TEST_PROJECT_DIR, result.output_file);
      const written = fs.readFileSync(outputPath, 'utf-8');
      const parsed = JSON.parse(written);
      expect(parsed.shots).toHaveLength(2);
      expect(parsed.shots[0].shot_number).toBe(1);
    });
  });

  describe('style_hints', () => {
    it('should include style hints in the user prompt', async () => {
      const mockOutput = `**Image Prompt:**
A portrait with dramatic lighting.

**Negative Prompt:**
none

**Aspect Ratio:**
1:1

**Generation Mode:**
text_to_image`;

      const llm = createMockLLM(mockOutput);
      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);

      const result = await executor.execute({
        prompt_type: 'character_image',
        name: 'Isha',
        style_hints: 'Use dramatic chiaroscuro lighting',
      });

      expect(result.status).toBe('success');
      const generateCall = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      const userPrompt = generateCall.messages[1].content;
      expect(userPrompt).toContain('Orchestrator Guidance');
      expect(userPrompt).toContain('chiaroscuro');
    });
  });

  describe('hard constraints', () => {
    it('should inject length constraints for image prompts', async () => {
      const mockOutput = `**Image Prompt:**
A portrait.

**Negative Prompt:**
none

**Aspect Ratio:**
1:1

**Generation Mode:**
text_to_image`;

      const llm = createMockLLM(mockOutput);
      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);

      await executor.execute({
        prompt_type: 'character_image',
        name: 'Isha',
      });

      const generateCall = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const userPrompt = generateCall.messages[1].content;
      expect(userPrompt).toContain('HARD CONSTRAINTS');
      expect(userPrompt).toContain('flowing prose');
      expect(userPrompt).toContain('Lighting is mandatory');
    });

    it('should inject video-specific constraints for scene_video', async () => {
      const mockMotionOutput = '```json\n' + MOCK_MOTION_JSON + '\n```';

      const llm = createMockLLM(mockMotionOutput);
      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);

      await executor.execute({
        prompt_type: 'scene_video',
        scene_number: 1,
      });

      const generateCall = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const userPrompt = generateCall.messages[1].content;
      expect(userPrompt).toContain('valid JSON');
      expect(userPrompt).toContain('Minimum shot duration is 4 seconds');
    });
  });

  describe('validation and retry', () => {
    it('should retry once when output is missing Image Prompt section', async () => {
      const badOutput = 'This is not a valid image prompt format.';
      const goodOutput = `**Image Prompt:**
A portrait of the woman from image 1.

**Negative Prompt:**
none

**Aspect Ratio:**
1:1

**Generation Mode:**
image_text_to_image`;

      const llm = {
        generate: vi.fn()
          .mockResolvedValueOnce({ content: badOutput })
          .mockResolvedValueOnce({ content: goodOutput }),
        getModel: vi.fn().mockReturnValue('test-model'),
      } as unknown as LLMClient;

      const executor = new PromptDAGExecutor(llm, TEST_PROJECT_DIR);

      const result = await executor.execute({
        prompt_type: 'character_image',
        name: 'Isha',
      });

      expect(result.status).toBe('success');
      // LLM should have been called twice (initial + retry)
      expect(llm.generate).toHaveBeenCalledTimes(2);
      // The retry call should include the validation feedback
      const retryCall = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(retryCall.messages).toHaveLength(4); // system + user + assistant (bad) + user (feedback)
    });
  });
});
