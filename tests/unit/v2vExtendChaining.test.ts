/**
 * TDD Tests for V2V Extend cross-shot chaining.
 *
 * Shot 2+ uses V2V Extend (extends previous shot's video) by default.
 * Fresh FL2V generation only for: shot 1, set_the_world, show_change.
 */

import { describe, it, expect } from 'vitest';

describe('V2V Extend: strategy selection', () => {
  it('shot 1 of scene 1 gets flfv strategy', async () => {
    const { getVideoStrategy } = await import('../../src/core/planner/crossShotChaining.js');
    expect(getVideoStrategy('scene_1_shot_1', 'meet_character')).toBe('flfv');
  });

  it('shot 2+ gets v2v_extend strategy by default', async () => {
    const { getVideoStrategy } = await import('../../src/core/planner/crossShotChaining.js');
    expect(getVideoStrategy('scene_1_shot_2', 'show_action')).toBe('v2v_extend');
    expect(getVideoStrategy('scene_1_shot_3', 'show_dialogue')).toBe('v2v_extend');
  });

  it('set_the_world purpose gets flfv even for shot 2+', async () => {
    const { getVideoStrategy } = await import('../../src/core/planner/crossShotChaining.js');
    expect(getVideoStrategy('scene_2_shot_1', 'set_the_world')).toBe('flfv');
  });

  it('show_change purpose gets flfv even for shot 2+', async () => {
    const { getVideoStrategy } = await import('../../src/core/planner/crossShotChaining.js');
    expect(getVideoStrategy('scene_3_shot_2', 'show_change')).toBe('flfv');
  });

  it('first shot of scene 2+ gets v2v_extend (cross-scene)', async () => {
    const { getVideoStrategy } = await import('../../src/core/planner/crossShotChaining.js');
    expect(getVideoStrategy('scene_2_shot_1', 'show_action')).toBe('v2v_extend');
    expect(getVideoStrategy('scene_3_shot_1', 'meet_character')).toBe('v2v_extend');
  });
});

describe('V2V Extend: strategy in schemas', () => {
  it('v2v_extend is a valid video generation strategy', async () => {
    const { getPromptSchema } = await import('../../src/core/planner/schemas.js');
    const schema = getPromptSchema('shot_image_prompt');
    // The schema should mention flfv and fmlfv — v2v_extend is code-level, not LLM-chosen
    expect(schema).toContain('flfv');
  });
});

describe('V2V Extend: previous video lookup', () => {
  it('getPreviousVideoPath returns previous shot video within scene', async () => {
    const { getPreviousVideoPath } = await import('../../src/core/planner/crossShotChaining.js');

    const mockExecutor = {
      getNode: (id: string) => {
        if (id === 'shot_video:scene_1_shot_1') return { status: 'completed', outputPath: 'assets/videos/shots/scene_1_shot_1.mp4' };
        return undefined;
      },
      getAllNodes: () => [],
    };

    const result = getPreviousVideoPath('scene_1_shot_2', mockExecutor as any);
    expect(result).toBe('assets/videos/shots/scene_1_shot_1.mp4');
  });

  it('getPreviousVideoPath returns last shot video across scenes', async () => {
    const { getPreviousVideoPath } = await import('../../src/core/planner/crossShotChaining.js');

    const mockExecutor = {
      getNode: (id: string) => {
        if (id === 'shot_video:scene_1_shot_4') return { status: 'completed', outputPath: 'assets/videos/shots/scene_1_shot_4.mp4' };
        return undefined;
      },
      getAllNodes: () => [
        { id: 'shot_video:scene_1_shot_1', typeId: 'shot_video', itemId: 'scene_1_shot_1', status: 'completed' },
        { id: 'shot_video:scene_1_shot_2', typeId: 'shot_video', itemId: 'scene_1_shot_2', status: 'completed' },
        { id: 'shot_video:scene_1_shot_3', typeId: 'shot_video', itemId: 'scene_1_shot_3', status: 'completed' },
        { id: 'shot_video:scene_1_shot_4', typeId: 'shot_video', itemId: 'scene_1_shot_4', status: 'completed' },
      ],
    };

    const result = getPreviousVideoPath('scene_2_shot_1', mockExecutor as any);
    expect(result).toBe('assets/videos/shots/scene_1_shot_4.mp4');
  });

  it('getPreviousVideoPath returns null for shot 1 of scene 1', async () => {
    const { getPreviousVideoPath } = await import('../../src/core/planner/crossShotChaining.js');
    const mockExecutor = { getNode: () => undefined, getAllNodes: () => [] };
    expect(getPreviousVideoPath('scene_1_shot_1', mockExecutor as any)).toBeNull();
  });
});
