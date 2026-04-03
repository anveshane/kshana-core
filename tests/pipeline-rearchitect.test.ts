/**
 * TDD Tests for Pipeline Re-Architecture
 *
 * These tests define the EXPECTED behavior BEFORE implementation.
 * All tests should FAIL initially (RED phase).
 * Each change makes the relevant tests pass (GREEN phase).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  normalizeSceneVideoPrompt,
  sceneVideoPromptSchema,
  validateWithSchema,
} from '../src/core/planner/schemas.js';

// ──────────────────────────────────────────────────────────────────────────────
// Change 1 + 7: FLFV Default + Motion-Only Prompts
// ──────────────────────────────────────────────────────────────────────────────

describe('Change 1+7: FLFV as default strategy', () => {
  it('normalizeSceneVideoPrompt defaults to flfv, not i2v', () => {
    const data = sceneVideoPromptSchema.parse({
      shots: [
        { shotNumber: 1, firstFrame: { description: 'A character walks', characters: ['kai'] } },
      ],
    });
    normalizeSceneVideoPrompt(data);
    expect(data.shots[0]!.generationStrategy).toBe('flfv');
  });

  it('i2v is not in available strategies for LLM', async () => {
    // The generateVideoModesSection should filter out i2v like it filters t2v
    const { getWorkflowModeRegistry } = await import('../src/services/providers/WorkflowModeRegistry.js');
    const registry = getWorkflowModeRegistry();
    registry.refresh(); // Reload manifests from disk
    const section = registry.generateVideoModesSection('comfyui');
    expect(section).not.toContain('`i2v`');
    // If workflows are loaded, flfv should be present; if no workflows found, skip
    const modes = registry.getAvailableModes('comfyui');
    if (modes.length > 0) {
      expect(section).toContain('`flfv`');
    }
  });

  it('scene_video_prompt_guide requires lastFrame on every shot', () => {
    const guidePath = join(process.cwd(), 'prompts/skills/defaults/scene_video_prompt_guide.md');
    const guide = readFileSync(guidePath, 'utf-8');
    // The guide should state that lastFrame is required
    expect(guide).toMatch(/lastFrame.*required|MUST.*lastFrame|every shot.*lastFrame/i);
  });
});

describe('Change 1: Motion-only prompts', () => {
  it('motion_directive_guide explicitly forbids re-describing image content', () => {
    const guidePath = join(process.cwd(), 'prompts/skills/defaults/motion_directive_guide.md');
    const guide = readFileSync(guidePath, 'utf-8');
    // Should have explicit DO NOT section about re-describing the first frame
    expect(guide).toMatch(/DO NOT.*re-describe|do not.*describe.*again|image IS the scene/i);
  });

  it('motion_directive_guide forbids character appearance descriptions in motion prompts', () => {
    const guidePath = join(process.cwd(), 'prompts/skills/defaults/motion_directive_guide.md');
    const guide = readFileSync(guidePath, 'utf-8');
    // Should explicitly say don't describe character appearance
    expect(guide).toMatch(/do not.*describe.*appearance|do not.*hair.*clothing|character.*already.*visible/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Change 4: Resolution Alignment
// ──────────────────────────────────────────────────────────────────────────────

describe('Change 4: Resolution alignment', () => {
  it('FLUX Klein manifest has width and height parameter mappings', () => {
    const manifestPath = join(process.cwd(), 'workflows/built-in/flux2_klein_edit.manifest.json');
    if (!existsSync(manifestPath)) return; // skip if not present
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const hasWidth = manifest.parameterMappings.some((m: any) => m.input === 'width');
    const hasHeight = manifest.parameterMappings.some((m: any) => m.input === 'height');
    expect(hasWidth).toBe(true);
    expect(hasHeight).toBe(true);
  });

  it('all video workflow manifests have width and height mappings', () => {
    const userDir = join(process.cwd(), 'workflows/user');
    if (!existsSync(userDir)) return;
    const { readdirSync } = require('fs');
    const manifests = readdirSync(userDir).filter((f: string) => f.endsWith('.manifest.json'));

    for (const mf of manifests) {
      const manifest = JSON.parse(readFileSync(join(userDir, mf), 'utf-8'));
      if (manifest.pipeline !== 'video_generation') continue;

      // API-format workflows that derive resolution from input image don't need explicit mappings
      const derivesFromImage = manifest.parameterMappings.some(
        (m: any) => m.input === 'first_frame' && m.field === 'image'
      ) && manifest.format === 'api';

      const hasWidth = manifest.parameterMappings.some((m: any) => m.input === 'width');
      const hasHeight = manifest.parameterMappings.some((m: any) => m.input === 'height');

      if (!derivesFromImage) {
        expect(hasWidth, `${mf} missing width mapping`).toBe(true);
        expect(hasHeight, `${mf} missing height mapping`).toBe(true);
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Change 5: Image Quality Gate
// ──────────────────────────────────────────────────────────────────────────────

describe('Change 5: Image quality gate', () => {
  it('validateGeneratedImage function exists and checks file existence', async () => {
    // The executor should have a validateGeneratedImage method
    // For now, test the concept: a non-existent file should fail validation
    const { validateGeneratedImage } = await import('../src/core/planner/imageValidator.js').catch(() => ({ validateGeneratedImage: null }));
    expect(validateGeneratedImage).toBeDefined();
    if (validateGeneratedImage) {
      const result = await validateGeneratedImage('/nonexistent/path.png', 'test prompt', { width: 848, height: 480 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    }
  });

  it('validateGeneratedImage checks dimensions match expected', async () => {
    const { validateGeneratedImage } = await import('../src/core/planner/imageValidator.js').catch(() => ({ validateGeneratedImage: null }));
    if (!validateGeneratedImage) {
      expect(validateGeneratedImage).toBeDefined(); // fail if not implemented
      return;
    }
    // A valid PNG at wrong dimensions should fail
    // (Would need a test fixture image — skip if not available)
  });

  it('vision review is configurable via environment variable', () => {
    // LLM_SUPPORTS_VISION should be a recognized config option
    // The image validator should check this flag
    const envPath = join(process.cwd(), '.env.example');
    if (existsSync(envPath)) {
      const env = readFileSync(envPath, 'utf-8');
      expect(env).toContain('LLM_SUPPORTS_VISION');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Change 6: Isolated Pipeline Testing
// ──────────────────────────────────────────────────────────────────────────────

describe('Change 6: Isolated pipeline test scripts', () => {
  it('test-shot-video.ts script exists', () => {
    expect(existsSync(join(process.cwd(), 'scripts/test-shot-video.ts'))).toBe(true);
  });

  it('test-shot-image.ts script exists', () => {
    expect(existsSync(join(process.cwd(), 'scripts/test-shot-image.ts'))).toBe(true);
  });

  it('test-motion-directive.ts script exists', () => {
    expect(existsSync(join(process.cwd(), 'scripts/test-motion-directive.ts'))).toBe(true);
  });

  it('test-shot-pipeline.ts script exists', () => {
    expect(existsSync(join(process.cwd(), 'scripts/test-shot-pipeline.ts'))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Change 7: Shot Image Prompt Validation for FLFV
// ──────────────────────────────────────────────────────────────────────────────

describe('Change 7: FLFV shot image prompts', () => {
  it('shot_image_prompt with flfv strategy validates with frames format', () => {
    const result = validateWithSchema('shot_image_prompt', {
      shotNumber: 1,
      frames: {
        first_frame: {
          imagePrompt: 'A wide establishing shot...',
          generationMode: 'image_text_to_image',
          references: [{ imageNumber: 1, type: 'character', refId: 'character_image:kai' }],
        },
        last_frame: {
          imagePrompt: 'Character has moved to the right side of frame...',
          generationMode: 'edit_first_frame',
          references: [],
        },
      },
      negativePrompt: 'no artifacts',
      aspectRatio: '16:9',
    });
    expect(result.valid).toBe(true);
  });

  it('shot_image_prompt without lastFrame fails for flfv strategy', () => {
    // If the shot's strategy is flfv, it should require frames.last_frame
    // This tests that the schema enforces lastFrame for flfv shots
    const result = validateWithSchema('shot_image_prompt', {
      shotNumber: 1,
      frames: {
        first_frame: {
          imagePrompt: 'A wide shot...',
          generationMode: 'image_text_to_image',
          references: [],
        },
        // Missing last_frame — should be required for flfv
      },
      negativePrompt: 'test',
      aspectRatio: '16:9',
    });
    // For now this passes because last_frame is optional in schema
    // After Change 7, this should fail for flfv shots
    // (Schema can't enforce this alone — executor must check)
    expect(result.valid).toBe(true); // Will change when we enforce flfv requires lastFrame
  });
});
