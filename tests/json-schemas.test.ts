/**
 * Tests for JSON schema validation — ensures LLM output validation
 * works correctly for all node types and formats.
 */
import { describe, it, expect } from 'vitest';
import {
  validateWithSchema,
  normalizeSceneVideoPrompt,
  sceneVideoPromptSchema,
  getPromptSchema,
} from '../src/core/planner/schemas.js';

describe('scene_video_prompt schema', () => {
  it('accepts valid scene with shots', () => {
    const result = validateWithSchema('scene_video_prompt', {
      sceneNumber: 1,
      sceneTitle: 'The Dark Alleys',
      totalDuration: 20,
      shots: [
        {
          shotNumber: 1,
          shotType: 'wide',
          duration: 5,
          generationStrategy: 'i2v',
          firstFrame: { description: 'Rain on cobblestones', characters: ['kai'], setting: 'alley' },
          soundCue: 'Rain patter',
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('accepts legacy format with description instead of firstFrame', () => {
    const result = validateWithSchema('scene_video_prompt', {
      shots: [{ shotNumber: 1, description: 'Old format description' }],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects empty shots array', () => {
    const result = validateWithSchema('scene_video_prompt', { shots: [] });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.error).toContain('empty');
  });

  it('rejects missing shots', () => {
    const result = validateWithSchema('scene_video_prompt', { sceneNumber: 1 });
    expect(result.valid).toBe(false);
  });

  it('rejects shot without description or firstFrame', () => {
    const result = validateWithSchema('scene_video_prompt', {
      shots: [{ shotNumber: 1, shotType: 'wide' }],
    });
    expect(result.valid).toBe(false);
  });

  it('accepts shot with lastFrame', () => {
    const result = validateWithSchema('scene_video_prompt', {
      shots: [{
        shotNumber: 2,
        firstFrame: { description: 'Start', characters: ['kai'] },
        lastFrame: { description: 'End', characters: ['kai'] },
        generationStrategy: 'flfv',
      }],
    });
    expect(result.valid).toBe(true);
  });
});

describe('scene_video_prompt normalization', () => {
  it('auto-classifies strategy from character presence', () => {
    const data = sceneVideoPromptSchema.parse({
      shots: [
        { shotNumber: 1, firstFrame: { description: 'With chars', characters: ['kai'] } },
        { shotNumber: 2, firstFrame: { description: 'No chars', characters: [] } },
      ],
    });
    normalizeSceneVideoPrompt(data);
    expect(data.shots[0]!.generationStrategy).toBe('i2v');
    expect(data.shots[1]!.generationStrategy).toBe('i2v'); // was t2v, now always i2v
  });

  it('copies videoGenerationMode to generationStrategy', () => {
    const data = sceneVideoPromptSchema.parse({
      shots: [
        { shotNumber: 1, videoGenerationMode: 'flfv', firstFrame: { description: 'test' } },
      ],
    });
    normalizeSceneVideoPrompt(data);
    expect(data.shots[0]!.generationStrategy).toBe('flfv');
  });
});

describe('shot_image_prompt schema', () => {
  it('accepts single-frame format', () => {
    const result = validateWithSchema('shot_image_prompt', {
      imagePrompt: 'A wide shot of the alley...',
      negativePrompt: 'no daylight',
      aspectRatio: '16:9',
      generationMode: 'image_text_to_image',
      references: [{ imageNumber: 1, type: 'character', refId: 'character_image:kai' }],
    });
    expect(result.valid).toBe(true);
  });

  it('accepts multi-frame FLFV format', () => {
    const result = validateWithSchema('shot_image_prompt', {
      shotNumber: 2,
      frames: {
        first_frame: {
          imagePrompt: 'Opening frame...',
          generationMode: 'image_text_to_image',
          references: [{ imageNumber: 1, type: 'character', refId: 'character_image:kai' }],
        },
        last_frame: {
          imagePrompt: 'Character moved deeper...',
          generationMode: 'edit_first_frame',
          references: [],
        },
      },
      negativePrompt: 'no daylight',
      aspectRatio: '16:9',
    });
    expect(result.valid).toBe(true);
  });

  it('accepts multi-frame FMLFV format with mid_frame', () => {
    const result = validateWithSchema('shot_image_prompt', {
      shotNumber: 4,
      frames: {
        first_frame: {
          imagePrompt: 'Opening...',
          generationMode: 'image_text_to_image',
          references: [],
        },
        mid_frame: {
          imagePrompt: 'Mid-point...',
          generationMode: 'edit_first_frame',
          references: [],
        },
        last_frame: {
          imagePrompt: 'End state...',
          generationMode: 'edit_first_frame',
          references: [],
        },
      },
      negativePrompt: 'no artifacts',
      aspectRatio: '16:9',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects empty imagePrompt in single-frame', () => {
    const result = validateWithSchema('shot_image_prompt', {
      imagePrompt: '',
      generationMode: 'image_text_to_image',
      references: [],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects missing generationMode in single-frame', () => {
    const result = validateWithSchema('shot_image_prompt', {
      imagePrompt: 'A shot...',
      references: [],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects multi-frame without first_frame', () => {
    const result = validateWithSchema('shot_image_prompt', {
      frames: {
        last_frame: { imagePrompt: 'End', generationMode: 'edit_first_frame' },
      },
      negativePrompt: 'test',
    });
    expect(result.valid).toBe(false);
  });
});

describe('character_image / setting_image schema', () => {
  it('accepts valid character image prompt', () => {
    const result = validateWithSchema('character_image', {
      imagePrompt: 'Full-body portrait of a South Asian man...',
      negativePrompt: 'background scene, environment',
      aspectRatio: '1:1',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects missing imagePrompt', () => {
    const result = validateWithSchema('character_image', {
      negativePrompt: 'test',
      aspectRatio: '1:1',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('imagePrompt');
  });

  it('rejects missing negativePrompt', () => {
    const result = validateWithSchema('character_image', {
      imagePrompt: 'A character...',
      aspectRatio: '1:1',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('negativePrompt');
  });

  it('rejects empty aspectRatio', () => {
    const result = validateWithSchema('setting_image', {
      imagePrompt: 'An environment...',
      negativePrompt: 'no people',
      aspectRatio: '',
    });
    expect(result.valid).toBe(false);
  });
});

describe('unknown node types', () => {
  it('accepts anything for unregistered node types', () => {
    const result = validateWithSchema('story', { anything: 'goes' });
    expect(result.valid).toBe(true);
  });
});

describe('Zod error formatting', () => {
  it('formats nested path errors readably', () => {
    const result = validateWithSchema('scene_video_prompt', {
      shots: [{ shotNumber: 'not a number' }],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBeTruthy();
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

describe('getPromptSchema', () => {
  it('returns schema text for known types', () => {
    expect(getPromptSchema('scene_video_prompt')).toContain('json_schema');
    expect(getPromptSchema('shot_image_prompt')).toContain('imagePrompt');
    expect(getPromptSchema('character_image')).toContain('aspectRatio');
    expect(getPromptSchema('setting_image')).toContain('negativePrompt');
  });

  it('returns null for unknown types', () => {
    expect(getPromptSchema('story')).toBeNull();
    expect(getPromptSchema('plot')).toBeNull();
  });
});
