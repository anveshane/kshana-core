/**
 * TDD Tests for self-healing corrupt shot_image_prompt JSON.
 *
 * When a prompt file has invalid JSON, the executor should:
 * 1. Detect the parse error
 * 2. Invalidate the prompt node (reset to pending)
 * 3. On next run, the LLM regenerates the prompt
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateWithSchema } from '../../src/core/planner/schemas.js';

describe('Corrupt prompt self-healing: detection', () => {
  it('executor code detects corrupt JSON and invalidates prompt node', () => {
    const code = readFileSync(join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'), 'utf-8');
    // Must detect JSON parse failure
    expect(code).toContain('Shot image prompt JSON is corrupt');
    // Must invalidate the prompt node
    expect(code).toContain('invalidateNode(promptDep.id)');
    // Must persist state after invalidation
    expect(code).toContain('persistState()');
  });

  it('executor validates structure: rejects prompt without imagePrompt or frames', () => {
    const code = readFileSync(join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'), 'utf-8');
    expect(code).toContain('no frames or imagePrompt');
  });

  it('executor validates structure: rejects frames without first_frame.imagePrompt', () => {
    const code = readFileSync(join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'), 'utf-8');
    expect(code).toContain('frames missing first_frame.imagePrompt');
  });
});

describe('Corrupt prompt self-healing: schema validation', () => {
  it('valid single-frame prompt passes schema', () => {
    const result = validateWithSchema('shot_image_prompt', {
      imagePrompt: 'A wide establishing shot of the village',
      negativePrompt: 'blurry',
      aspectRatio: '16:9',
      generationMode: 'image_text_to_image',
      references: [],
    });
    expect(result.valid).toBe(true);
  });

  it('valid multi-frame prompt passes schema', () => {
    const result = validateWithSchema('shot_image_prompt', {
      shotNumber: 1,
      frames: {
        first_frame: {
          imagePrompt: 'A wide shot',
          generationMode: 'image_text_to_image',
          references: [],
        },
        last_frame: {
          imagePrompt: 'Character moved right',
          generationMode: 'edit_first_frame',
          references: [],
        },
      },
      negativePrompt: 'blurry',
      aspectRatio: '16:9',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects prompt with empty imagePrompt', () => {
    const result = validateWithSchema('shot_image_prompt', {
      imagePrompt: '',
      negativePrompt: 'blurry',
      generationMode: 'text_to_image',
      references: [],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects multi-frame prompt with empty first_frame imagePrompt', () => {
    const result = validateWithSchema('shot_image_prompt', {
      frames: {
        first_frame: {
          imagePrompt: '',
          generationMode: 'image_text_to_image',
          references: [],
        },
      },
      negativePrompt: 'blurry',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects completely empty object', () => {
    const result = validateWithSchema('shot_image_prompt', {});
    expect(result.valid).toBe(false);
  });
});
