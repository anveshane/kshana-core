/**
 * TDD Tests for Slim Scene Breakdown.
 *
 * scene_video_prompt outputs only shot structure (no firstFrame/lastFrame).
 * shot_image_prompt handles frame descriptions, strategy, and refs.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Slim scene breakdown: schema', () => {
  it('scene_video_prompt validates slim shot without firstFrame/lastFrame', async () => {
    const { validateWithSchema } = await import('../../src/core/planner/schemas.js');
    const result = validateWithSchema('scene_video_prompt', {
      sceneNumber: 1,
      sceneTitle: 'Test',
      totalDuration: 30,
      shots: [{
        shotNumber: 1,
        shotType: 'wide',
        duration: 5,
        description: 'Amber sunlight through curtains, dust motes drifting',
        characters: [],
        setting: 'bedroom',
        cameraWork: 'static, shallow DOF',
        soundCue: 'distant bird chirp',
        transition: 'fade',
      }],
    });
    expect(result.valid).toBe(true);
  });

  it('scene_video_prompt validates without generationStrategy', async () => {
    const { validateWithSchema } = await import('../../src/core/planner/schemas.js');
    const result = validateWithSchema('scene_video_prompt', {
      shots: [{
        shotNumber: 1,
        description: 'A character walks into frame',
        characters: ['kai'],
        setting: 'bridge',
      }],
    });
    expect(result.valid).toBe(true);
  });

  it('shot_image_prompt with generationStrategy validates', async () => {
    const { validateWithSchema } = await import('../../src/core/planner/schemas.js');
    const result = validateWithSchema('shot_image_prompt', {
      shotNumber: 1,
      generationStrategy: 'flfv',
      frames: {
        first_frame: {
          imagePrompt: 'A wide establishing shot of the village',
          generationMode: 'image_text_to_image',
          references: [{ imageNumber: 1, type: 'setting', refId: 'setting_image:village' }],
        },
        last_frame: {
          imagePrompt: 'Character has entered from the left',
          generationMode: 'edit_first_frame',
          references: [],
        },
      },
      negativePrompt: 'blurry',
      aspectRatio: '16:9',
    });
    expect(result.valid).toBe(true);
  });
});

describe('Slim scene breakdown: 7-field format with purpose', () => {
  it('schema accepts 7-field shot (no shotType, no secondaryPurpose)', async () => {
    const { validateWithSchema } = await import('../../src/core/planner/schemas.js');
    const result = validateWithSchema('scene_video_prompt', {
      shots: [{
        shotNumber: 1,
        purpose: 'set_the_mood',
        duration: 4,
        description: 'Raindrops strike a brass bell',
        cameraWork: 'extreme close-up, macro, static, shallow DOF',
        audio: 'metallic ring of rain on brass',
        transition: 'fade',
      }],
    });
    expect(result.valid).toBe(true);
  });

  it('schema accepts valid purpose enum values', async () => {
    const { purposeValues } = await import('../../src/core/planner/schemas.js');
    expect(purposeValues).toContain('set_the_world');
    expect(purposeValues).toContain('meet_character');
    expect(purposeValues).toContain('show_dialogue');
    expect(purposeValues).toContain('show_change');
    expect(purposeValues).toContain('punctuate');
    expect(purposeValues.length).toBe(12);
  });

  it('shotTypeValues is no longer exported', async () => {
    const mod = await import('../../src/core/planner/schemas.js');
    expect((mod as any).shotTypeValues).toBeUndefined();
  });
});

describe('Slim scene breakdown: system prompts', () => {
  it('scene_video_prompt system prompt has NO firstFrame/lastFrame in JSON schema', () => {
    const code = readFileSync(join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'), 'utf-8');
    // Find the scene_video_prompt system prompt block
    const svpMatch = code.match(/if \(node\.typeId === 'scene_video_prompt'\)[\s\S]*?generationStrategy/);
    // Should NOT have firstFrame/lastFrame in the JSON template
    expect(code).not.toMatch(/scene_video_prompt[\s\S]{0,500}"firstFrame"/);
  });

  it('scene_breakdown_guide defines description as a required field', () => {
    const guide = readFileSync(join(process.cwd(), 'prompts/skills/defaults/scene_breakdown_guide.md'), 'utf-8');
    // The guide must list description as a required field
    expect(guide).toMatch(/description.*string/i);
  });

  it('shot_image_prompt system prompt mentions generationStrategy', () => {
    const code = readFileSync(join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'), 'utf-8');
    const sipBlock = code.match(/shot_image_prompt[\s\S]*?generationStrategy/);
    expect(sipBlock).not.toBeNull();
  });
});

describe('Slim scene breakdown: guides', () => {
  it('scene_video_prompt_guide has NO firstFrame/lastFrame structure', () => {
    const guide = readFileSync(
      join(process.cwd(), 'prompts/skills/defaults/scene_breakdown_guide.md'),
      'utf-8',
    );
    expect(guide).not.toContain('"firstFrame"');
    expect(guide).not.toContain('"lastFrame"');
  });

  it('scene_video_prompt_guide has description field', () => {
    const guide = readFileSync(
      join(process.cwd(), 'prompts/skills/defaults/scene_breakdown_guide.md'),
      'utf-8',
    );
    expect(guide).toMatch(/description.*what happens|description.*brief/i);
  });

  it('shot_image_guide has flfv/fmlfv strategy guidance', () => {
    const guide = readFileSync(
      join(process.cwd(), 'prompts/skills/defaults/shot_composition_guide.md'),
      'utf-8',
    );
    expect(guide).toContain('flfv');
    expect(guide).toContain('fmlfv');
    expect(guide).toMatch(/generationStrategy/);
  });
});
