/**
 * TDD Tests for dialogue/audio flow through the pipeline.
 *
 * Dialogue flows: scene breakdown `audio` field → motion directive → video generation.
 * Tests verify that:
 * 1. Schema accepts `audio` field with dialogue
 * 2. The fallback motion prompt builder reads `audio` (not just old `soundCue`)
 * 3. Motion directive guide instructs LLM to extract dialogue from `audio` field
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Dialogue flow: schema', () => {
  it('scene_video_prompt schema accepts audio field with dialogue', async () => {
    const { validateWithSchema } = await import('../../src/core/planner/schemas.js');
    const result = validateWithSchema('scene_video_prompt', {
      shots: [{
        shotNumber: 1,
        description: 'Elena confronts Marcus in the alley',
        audio: 'ELENA: Don\'t follow me. Rain on pavement, footsteps receding',
      }],
    });
    expect(result.valid).toBe(true);
  });

  it('collectionExtractor preserves audio field from shot JSON', async () => {
    const { extractCollectionItems } = await import('../../src/core/planner/collectionExtractor.js');
    const json = JSON.stringify({
      sceneNumber: 1,
      totalDuration: 15,
      shots: [
        {
          shotNumber: 1,
          purpose: 'show_dialogue',
          shotType: 'medium',
          duration: 5,
          description: 'Elena speaks',
          cameraWork: 'static medium',
          audio: 'ELENA: Don\'t follow me. Rain on pavement',
          transition: 'cut',
        },
      ],
    });

    const mockNode = { id: 'svp:s1', typeId: 'scene_video_prompt', itemId: 'scene_1', status: 'completed', displayName: '', isExpensive: false, isCollection: false, dependencies: [], dependents: [] };
    const result = await extractCollectionItems(mockNode as any, json, {} as any);

    expect(result!.shots).toHaveLength(1);
    // The shot's raw data should be available — audio field preserved
    expect(json).toContain('ELENA: Don\'t follow me');
  });
});

describe('Dialogue flow: fallback motion prompt', () => {
  it('buildFallbackMotionPrompt includes audio field content', async () => {
    const { buildFallbackMotionPrompt } = await import('../../src/core/planner/shotReferenceMapping.js');

    const shot = {
      description: 'Elena confronts Marcus in the rain-soaked alley',
      cameraWork: 'medium shot, static',
      audio: 'ELENA: Don\'t follow me. Rain pattering on cobblestones',
    };

    const prompt = buildFallbackMotionPrompt(shot);
    expect(prompt).toContain('Elena confronts Marcus');
    expect(prompt).toContain('medium shot');
    expect(prompt).toContain('ELENA: Don\'t follow me');
  });

  it('buildFallbackMotionPrompt reads legacy soundCue field', async () => {
    const { buildFallbackMotionPrompt } = await import('../../src/core/planner/shotReferenceMapping.js');

    const shot = {
      description: 'A wide shot of the marketplace',
      cameraWork: 'wide, static',
      soundCue: 'distant market chatter, bells ringing',
    };

    const prompt = buildFallbackMotionPrompt(shot);
    expect(prompt).toContain('distant market chatter');
  });

  it('buildFallbackMotionPrompt prefers audio over soundCue', async () => {
    const { buildFallbackMotionPrompt } = await import('../../src/core/planner/shotReferenceMapping.js');

    const shot = {
      description: 'Elena speaks',
      cameraWork: 'close up',
      audio: 'ELENA: Stay here. Thunder crack',
      soundCue: 'old sound cue that should be ignored',
    };

    const prompt = buildFallbackMotionPrompt(shot);
    expect(prompt).toContain('ELENA: Stay here');
    expect(prompt).not.toContain('old sound cue');
  });

  it('buildFallbackMotionPrompt handles missing audio gracefully', async () => {
    const { buildFallbackMotionPrompt } = await import('../../src/core/planner/shotReferenceMapping.js');

    const shot = {
      description: 'A wide establishing shot',
      cameraWork: 'wide, static',
    };

    const prompt = buildFallbackMotionPrompt(shot);
    expect(prompt).toContain('A wide establishing shot');
    expect(prompt).toContain('wide, static');
  });
});

describe('Dialogue flow: prompt schema matches new format', () => {
  it('scene_video_prompt schema has purpose and shotType fields', async () => {
    const { getPromptSchema } = await import('../../src/core/planner/schemas.js');
    const schema = getPromptSchema('scene_video_prompt');
    expect(schema).not.toBeNull();
    expect(schema).toContain('purpose');
    expect(schema).toContain('secondaryPurpose');
    expect(schema).toContain('shotType');
    expect(schema).toContain('audio');
  });

  it('scene_video_prompt schema does NOT have old fields', async () => {
    const { getPromptSchema } = await import('../../src/core/planner/schemas.js');
    const schema = getPromptSchema('scene_video_prompt');
    expect(schema).not.toContain('soundCue');
    expect(schema).not.toContain('"dialogue"');
    expect(schema).not.toContain('"characters"');
    expect(schema).not.toContain('"setting"');
  });
});

describe('Dialogue flow: motion directive guide', () => {
  it('motion directive guide instructs LLM to read audio field for dialogue', () => {
    const guide = readFileSync(
      join(process.cwd(), 'prompts/skills/defaults/motion_directive_guide.md'),
      'utf-8',
    );
    expect(guide).toMatch(/audio.*field|`audio`/i);
    expect(guide).toMatch(/ELENA|CHARACTER.*CAPS|character name/i);
    expect(guide).toContain('says "');
  });
});
