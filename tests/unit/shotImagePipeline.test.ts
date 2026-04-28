/**
 * TDD Tests for the 3-call shot_image_prompt pipeline.
 *
 * The pipeline splits shot_image_prompt generation into:
 *   Call 1: Mode decision (classification) → { mode, refs }
 *   Call 2: First frame prompt (creative) → imagePrompt string
 *   Call 3: Last frame prompt (creative) → imagePrompt string
 *   Assembly: deterministic JSON construction
 */

import { describe, it, expect } from 'vitest';
import {
  validateWithSchema,
} from '../../src/core/planner/schemas.js';

// ──────────────────────────────────────────────────────────────────────────────
// assembleShotImagePrompt: deterministic JSON construction
// ──────────────────────────────────────────────────────────────────────────────

describe('shotImagePipeline: assembleShotImagePrompt', () => {
  it('produces valid flfv JSON with first_frame + last_frame', async () => {
    const { assembleShotImagePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const result = assembleShotImagePrompt({
      shotNumber: 1,
      generationStrategy: 'flfv',
      firstFrameMode: 'image_text_to_image',
      firstFramePrompt: 'A wide shot of the city from image 1, deep focus...',
      firstFrameRefs: [{ imageNumber: 1, type: 'setting' as const, refId: 'setting_image:city' }],
      lastFramePrompt: 'The city now engulfed in flames, smoke filling the upper third...',
      negativePrompt: 'blurry, cartoon, text',
    });

    expect(result.shotNumber).toBe(1);
    expect(result.generationStrategy).toBe('flfv');
    expect(result.frames.first_frame.imagePrompt).toContain('wide shot');
    expect(result.frames.first_frame.generationMode).toBe('image_text_to_image');
    expect(result.frames.first_frame.references).toHaveLength(1);
    expect(result.frames.last_frame).toBeDefined();
    expect(result.frames.last_frame!.generationMode).toBe('edit_first_frame');
    expect(result.frames.last_frame!.references).toEqual([]);
    expect(result.negativePrompt).toBe('blurry, cartoon, text');
    expect(result.aspectRatio).toBe('16:9');

    // Must pass the existing Zod schema
    const validation = validateWithSchema('shot_image_prompt', result);
    expect(validation.valid).toBe(true);
  });

  it('coerces fmlfv strategy to flfv (FML2V disabled) and omits mid_frame', async () => {
    const { assembleShotImagePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const result = assembleShotImagePrompt({
      shotNumber: 4,
      generationStrategy: 'fmlfv',
      firstFrameMode: 'image_text_to_image',
      firstFramePrompt: 'A medium shot of the warrior...',
      firstFrameRefs: [{ imageNumber: 1, type: 'character' as const, refId: 'character_image:kai' }],
      lastFramePrompt: 'The altar split in two, energy pouring upward...',
      negativePrompt: 'blurry, cartoon',
    });

    // fmlfv requests are silently downgraded to flfv; no mid_frame produced.
    expect(result.generationStrategy).toBe('flfv');
    expect(result.frames.mid_frame).toBeUndefined();
    expect(result.frames.last_frame).toBeDefined();

    const validation = validateWithSchema('shot_image_prompt', result);
    expect(validation.valid).toBe(true);
  });

  it('sets edit_previous_shot mode with only new character refs', async () => {
    const { assembleShotImagePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const result = assembleShotImagePrompt({
      shotNumber: 3,
      generationStrategy: 'flfv',
      firstFrameMode: 'edit_previous_shot',
      firstFramePrompt: 'The phantom from image 1 now visible beside the girl...',
      firstFrameRefs: [{ imageNumber: 1, type: 'character' as const, refId: 'character_image:monster' }],
      lastFramePrompt: 'The phantom has advanced to center frame...',
      negativePrompt: 'blurry, cartoon',
    });

    expect(result.frames.first_frame.generationMode).toBe('edit_previous_shot');
    expect(result.frames.first_frame.references).toEqual([
      { imageNumber: 1, type: 'character', refId: 'character_image:monster' },
    ]);
  });

  it('always sets last_frame to edit_first_frame with empty refs', async () => {
    const { assembleShotImagePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const result = assembleShotImagePrompt({
      shotNumber: 2,
      generationStrategy: 'flfv',
      firstFrameMode: 'edit_previous_shot',
      firstFramePrompt: 'Camera pushed in to close-up...',
      firstFrameRefs: [],
      lastFramePrompt: 'Expression shifted to resolve...',
      negativePrompt: 'blurry',
    });

    expect(result.frames.last_frame!.generationMode).toBe('edit_first_frame');
    expect(result.frames.last_frame!.references).toEqual([]);
    // last_frame should NOT contain 'from image' even if first_frame does
    expect(result.frames.last_frame!.imagePrompt).not.toContain('from image');
  });

  it('passes flfv strategy through unchanged', async () => {
    const { assembleShotImagePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const result = assembleShotImagePrompt({
      shotNumber: 1,
      generationStrategy: 'flfv',
      firstFrameMode: 'image_text_to_image',
      firstFramePrompt: 'test',
      firstFrameRefs: [],
      lastFramePrompt: 'test delta',
      negativePrompt: 'blurry',
    });

    expect(result.generationStrategy).toBe('flfv');
  });

  it('passes v2v_extend strategy through unchanged', async () => {
    const { assembleShotImagePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const result = assembleShotImagePrompt({
      shotNumber: 2,
      generationStrategy: 'v2v_extend',
      firstFrameMode: 'edit_previous_shot',
      firstFramePrompt: 'test',
      firstFrameRefs: [],
      lastFramePrompt: 'test delta',
      negativePrompt: 'blurry',
    });

    expect(result.generationStrategy).toBe('v2v_extend');
  });

  it('defaults aspectRatio to 16:9', async () => {
    const { assembleShotImagePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const result = assembleShotImagePrompt({
      shotNumber: 1,
      generationStrategy: 'flfv',
      firstFrameMode: 'image_text_to_image',
      firstFramePrompt: 'test',
      firstFrameRefs: [],
      lastFramePrompt: 'test delta',
      negativePrompt: 'blurry',
    });

    expect(result.aspectRatio).toBe('16:9');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// buildNegativePrompt: template-based negative prompt
// ──────────────────────────────────────────────────────────────────────────────

describe('shotImagePipeline: buildNegativePrompt', () => {
  it('returns base negatives for any mode', async () => {
    const { buildNegativePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const neg = buildNegativePrompt('image_text_to_image');
    expect(neg).toContain('blurry');
    expect(neg).toContain('cartoon');
    expect(neg).toContain('text');
    expect(neg).toContain('watermark');
  });

  it('returns negatives for all modes without error', async () => {
    const { buildNegativePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    expect(buildNegativePrompt('image_text_to_image')).toBeTruthy();
    expect(buildNegativePrompt('edit_previous_shot')).toBeTruthy();
    expect(buildNegativePrompt('text_to_image')).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// parseModeDecision: parse call 1 output with fallback
// ──────────────────────────────────────────────────────────────────────────────

describe('shotImagePipeline: parseModeDecision', () => {
  const allRefs = [
    { imageNumber: 1, type: 'character' as const, refId: 'character_image:monster', label: 'monster' },
    { imageNumber: 2, type: 'character' as const, refId: 'character_image:the_girl', label: 'the_girl' },
    { imageNumber: 3, type: 'setting' as const, refId: 'setting_image:city', label: 'city' },
  ];

  it('parses valid mode decision JSON', async () => {
    const { parseModeDecision } = await import('../../src/core/planner/shotImagePipeline.js');
    const raw = JSON.stringify({
      mode: 'edit_previous_shot',
      newCharacterRefs: [{ imageNumber: 1, type: 'character', refId: 'character_image:monster' }],
      existingSubjects: ['the_girl'],
    });

    const result = parseModeDecision(raw, allRefs);
    expect(result.mode).toBe('edit_previous_shot');
    expect(result.references).toHaveLength(1);
    expect(result.references[0].refId).toBe('character_image:monster');
  });

  it('falls back to image_text_to_image with all refs on garbage input', async () => {
    const { parseModeDecision } = await import('../../src/core/planner/shotImagePipeline.js');
    const result = parseModeDecision('not json at all!!!', allRefs);
    expect(result.mode).toBe('image_text_to_image');
    expect(result.references).toHaveLength(3); // all refs as fallback
  });

  it('falls back on missing mode field', async () => {
    const { parseModeDecision } = await import('../../src/core/planner/shotImagePipeline.js');
    const result = parseModeDecision(JSON.stringify({ foo: 'bar' }), allRefs);
    expect(result.mode).toBe('image_text_to_image');
    expect(result.references).toHaveLength(3);
  });

  it('falls back on invalid mode value', async () => {
    const { parseModeDecision } = await import('../../src/core/planner/shotImagePipeline.js');
    const result = parseModeDecision(JSON.stringify({ mode: 'invalid_mode' }), allRefs);
    expect(result.mode).toBe('image_text_to_image');
  });

  it('handles edit_previous_shot with no new refs (continuation only)', async () => {
    const { parseModeDecision } = await import('../../src/core/planner/shotImagePipeline.js');
    const raw = JSON.stringify({
      mode: 'edit_previous_shot',
      newCharacterRefs: [],
      existingSubjects: ['the_girl', 'monster'],
    });

    const result = parseModeDecision(raw, allRefs);
    expect(result.mode).toBe('edit_previous_shot');
    expect(result.references).toHaveLength(0);
  });

  it('strips markdown code fences from response', async () => {
    const { parseModeDecision } = await import('../../src/core/planner/shotImagePipeline.js');
    const raw = '```json\n{"mode": "text_to_image", "newCharacterRefs": [], "existingSubjects": []}\n```';
    const result = parseModeDecision(raw, allRefs);
    expect(result.mode).toBe('text_to_image');
    expect(result.references).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Prompt builders: build system+user prompts for each call
// ──────────────────────────────────────────────────────────────────────────────

describe('shotImagePipeline: buildModeDecisionPrompt', () => {
  it('includes available references in the user prompt', async () => {
    const { buildModeDecisionPrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const { system, user } = buildModeDecisionPrompt({
      shotDescription: 'The girl enters the apocalyptic street',
      shotNumber: 3,
      availableRefs: [
        { imageNumber: 1, type: 'character' as const, refId: 'character_image:the_girl', label: 'the_girl' },
        { imageNumber: 2, type: 'setting' as const, refId: 'setting_image:city', label: 'city' },
      ],
      previousShotAvailable: true,
      previousShotCharacters: ['monster'],
    });
    expect(user).toContain('character_image:the_girl');
    expect(user).toContain('setting_image:city');
    expect(user).toContain('Shot 3');
    expect(user).toContain('previous shot');
  });

  it('includes previous shot characters when available', async () => {
    const { buildModeDecisionPrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const { user } = buildModeDecisionPrompt({
      shotDescription: 'A phantom appears beside the girl',
      shotNumber: 4,
      availableRefs: [],
      previousShotAvailable: true,
      previousShotCharacters: ['the_girl'],
    });
    expect(user).toContain('the_girl');
    expect(user).toContain('previous shot');
  });

  it('loads mode decision guide into system prompt', async () => {
    const { buildModeDecisionPrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const { system } = buildModeDecisionPrompt({
      shotDescription: 'test',
      shotNumber: 1,
      availableRefs: [],
      previousShotAvailable: false,
      previousShotCharacters: [],
    });
    expect(system).toContain('mode');
    expect(system).toContain('JSON');
  });
});

describe('shotImagePipeline: buildFirstFramePrompt', () => {
  it('includes shot description and mode in user prompt', async () => {
    const { buildFirstFramePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const { user } = buildFirstFramePrompt({
      shotDescription: 'A wide shot of the girl sprinting through ruins',
      cameraWork: 'wide, tracking',
      mode: 'image_text_to_image',
      references: [{ imageNumber: 1, type: 'character' as const, refId: 'character_image:the_girl' }],
      sceneStateContext: '',
    });
    expect(user).toContain('wide shot');
    expect(user).toContain('character_image:the_girl');
  });

  it('injects edit_previous_shot mode instructions for edit mode', async () => {
    const { buildFirstFramePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const { system } = buildFirstFramePrompt({
      shotDescription: 'Camera pushes in to close-up',
      cameraWork: 'close-up',
      mode: 'edit_previous_shot',
      references: [],
      sceneStateContext: '',
    });
    expect(system).toContain('DELTA');
  });

  it('injects image_text_to_image mode instructions for fresh mode', async () => {
    const { buildFirstFramePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const { system } = buildFirstFramePrompt({
      shotDescription: 'A wide establishing shot',
      cameraWork: 'wide',
      mode: 'image_text_to_image',
      references: [{ imageNumber: 1, type: 'setting' as const, refId: 'setting_image:city' }],
      sceneStateContext: '',
    });
    expect(system).toContain('from image N');
  });
});

describe('shotImagePipeline: buildLastFramePrompt', () => {
  it('includes first frame prompt as context', async () => {
    const { buildLastFramePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const { user } = buildLastFramePrompt({
      firstFramePrompt: 'A wide shot of the girl mid-stride in the city...',
      lastFrameChanges: 'Girl moved to far right. Wall collapsed.',
      shotDescription: 'The girl dodges falling debris',
    });
    expect(user).toContain('mid-stride');
    expect(user).toContain('far right');
    expect(user).toContain('Wall collapsed');
  });

  it('loads last frame guide into system prompt', async () => {
    const { buildLastFramePrompt } = await import('../../src/core/planner/shotImagePipeline.js');
    const { system } = buildLastFramePrompt({
      firstFramePrompt: 'test first frame',
      lastFrameChanges: '',
      shotDescription: 'test shot',
    });
    expect(system).toContain('END STATE');
  });
});
