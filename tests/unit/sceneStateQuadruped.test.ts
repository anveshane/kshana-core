/**
 * Tests for the scene-state quadruped schema + scene-scoped init.
 *
 * Two bugs these tests lock down:
 *
 * 1. Glitch (a tortoiseshell cat, character:glitch) was being rendered as
 *    a humanoid figure "standing left, right hand touching face, legs
 *    standing apart" in Andy's Bar (scene 1). Two causes working together:
 *    (a) initializeSceneState seeded EVERY character in the graph into
 *        every scene's state — the apartment cat showed up in the bar.
 *    (b) The state schema had REQUIRED leftHand/rightHand/legs/headTilt
 *        fields for all characters — no way to express "this is a cat."
 *        The LLM dutifully filled them in.
 *
 *    Fixed by:
 *    - `kind: 'human' | 'animal' | 'unknown'` on CharacterState
 *    - Humanoid fields made optional; animal fields (bodyPose, tail) added
 *    - formatStateForPrompt / computeStateDiff pick fields by kind
 *    - initializeSceneState accepts SceneCharacterInit[] with kind
 *    - ExecutorAgent scopes the character list to scene participants
 *      (parsed from scene_video_prompt JSON) at init time.
 */

import { describe, it, expect } from 'vitest';
import {
  initializeSceneState,
  formatStateForPrompt,
  computeStateDiff,
  characterStateSchema,
  type SceneState,
  type CharacterState,
} from '../../src/core/planner/sceneState.js';

describe('initializeSceneState respects character kind', () => {
  it('animal characters get bodyPose slots, NOT leftHand/rightHand/legs/headTilt', () => {
    const state = initializeSceneState('scene_3', [
      { refId: 'glitch', kind: 'animal' },
    ], 'apartment');

    const glitch = state.characters.glitch!;
    expect(glitch.kind).toBe('animal');
    expect(glitch.bodyPose).toBe('unknown');
    // Humanoid fields must NOT be populated for animals — these were the
    // fields that let the LLM invent "right hand touching face" for a cat.
    expect(glitch.leftHand).toBeUndefined();
    expect(glitch.rightHand).toBeUndefined();
    expect(glitch.legs).toBeUndefined();
    expect(glitch.headTilt).toBeUndefined();
  });

  it('human characters get humanoid fields, no bodyPose/tail', () => {
    const state = initializeSceneState('scene_1', [
      { refId: "johnathan_o'hare", kind: 'human' },
    ], 'bar');

    const j = state.characters["johnathan_o'hare"]!;
    expect(j.kind).toBe('human');
    expect(j.leftHand).toBe('unknown');
    expect(j.rightHand).toBe('unknown');
    expect(j.legs).toBe('unknown');
    expect(j.headTilt).toBe('unknown');
    expect(j.bodyPose).toBeUndefined();
    expect(j.tail).toBeUndefined();
  });

  it('mixed cast initializes each character with its correct schema', () => {
    const state = initializeSceneState('scene_3', [
      { refId: "johnathan_o'hare", kind: 'human' },
      { refId: 'glitch', kind: 'animal' },
    ], 'apartment');

    expect(state.characters["johnathan_o'hare"]!.leftHand).toBe('unknown');
    expect(state.characters["johnathan_o'hare"]!.bodyPose).toBeUndefined();

    expect(state.characters.glitch!.bodyPose).toBe('unknown');
    expect(state.characters.glitch!.leftHand).toBeUndefined();
  });

  it('legacy string[] input (no kind) defaults to `unknown` and keeps humanoid fields', () => {
    // Backward-compat — older callers pass plain refId strings.
    const state = initializeSceneState('scene_1', ['alice', 'bob'], 'park');
    expect(state.characters.alice!.kind).toBe('unknown');
    expect(state.characters.alice!.leftHand).toBe('unknown');
    expect(state.characters.bob!.kind).toBe('unknown');
  });

  it('only includes characters passed in — does NOT seed other graph characters', () => {
    // Core of the Glitch-in-bar bug: previously every character in the
    // project was seeded into every scene. Now only the passed list is.
    const state = initializeSceneState('scene_1', [
      { refId: "johnathan_o'hare", kind: 'human' },
      { refId: 'andy', kind: 'human' },
    ], 'bar');

    expect(Object.keys(state.characters).sort()).toEqual(['andy', "johnathan_o'hare"]);
    expect(state.characters.glitch).toBeUndefined();
  });
});

describe('formatStateForPrompt renders by kind', () => {
  it('animal characters get body/tail — never hand/leg/head lines', () => {
    const state: SceneState = {
      sceneId: 'scene_3',
      shotNumber: 1,
      characters: {
        glitch: {
          kind: 'animal',
          position: 'on_lap',
          pose: 'sitting',
          expression: 'content',
          facing: 'camera',
          inFrame: true,
          bodyPose: 'curled_up',
          tail: 'curled_around_body',
        } as CharacterState,
      },
      objects: {},
      environment: { lighting: 'default', timeProgression: 'start' },
    };

    const text = formatStateForPrompt(state);
    expect(text).toContain('glitch');
    expect(text).toContain('body: curled_up');
    expect(text).toContain('tail: curled_around_body');
    // Must NOT leak humanoid fields for a cat
    expect(text).not.toContain('left hand');
    expect(text).not.toContain('right hand');
    expect(text).not.toContain('head:');
    expect(text.toLowerCase()).not.toContain('legs:');
  });

  it("human characters get hand/leg/head lines — never body/tail", () => {
    const state: SceneState = {
      sceneId: 'scene_1',
      shotNumber: 1,
      characters: {
        johnathan: {
          kind: 'human',
          position: 'seated_at_table',
          pose: 'sitting_upright',
          expression: 'brooding',
          facing: 'camera',
          inFrame: true,
          leftHand: 'at_side',
          rightHand: 'holding_glass',
          legs: 'crossed',
          headTilt: 'looking_down',
        },
      },
      objects: {},
      environment: { lighting: 'default', timeProgression: 'start' },
    };

    const text = formatStateForPrompt(state);
    expect(text).toContain('left hand: at_side');
    expect(text).toContain('right hand: holding_glass');
    expect(text).toContain('legs: crossed');
    expect(text).toContain('head: looking_down');
    expect(text).not.toContain('body:');
    expect(text).not.toContain('tail:');
  });

  it('off-screen animals mark their kind in the output line', () => {
    const state: SceneState = {
      sceneId: 'scene_3',
      shotNumber: 0,
      characters: {
        glitch: { kind: 'animal', position: 'off_screen', pose: 'unknown', expression: 'unknown', facing: 'unknown', inFrame: false },
      },
      objects: {},
      environment: { lighting: 'default', timeProgression: 'start' },
    };

    const text = formatStateForPrompt(state);
    expect(text).toContain('glitch (animal): off screen');
  });
});

describe('computeStateDiff picks fields by kind', () => {
  it('animal diff excludes hand/leg/head noise', () => {
    const before: SceneState = {
      sceneId: 'scene_3',
      shotNumber: 1,
      characters: {
        glitch: { kind: 'animal', position: 'at_window', pose: 'sitting', expression: 'alert', facing: 'camera', inFrame: true, bodyPose: 'sitting_on_haunches' },
      },
      objects: {},
      environment: { lighting: 'default', timeProgression: 'start' },
    };
    const after: SceneState = {
      sceneId: 'scene_3',
      shotNumber: 2,
      characters: {
        glitch: { kind: 'animal', position: 'on_lap', pose: 'sitting', expression: 'content', facing: 'camera', inFrame: true, bodyPose: 'curled_up', tail: 'curled_around_body' },
      },
      objects: {},
      environment: { lighting: 'default', timeProgression: 'start' },
    };

    const diff = computeStateDiff(before, after);
    expect(diff).toContain('position:');
    expect(diff).toContain('bodyPose:');
    expect(diff).not.toContain('leftHand');
    expect(diff).not.toContain('rightHand');
    expect(diff).not.toContain('legs');
    expect(diff).not.toContain('headTilt');
  });

  it('human diff includes hand/leg/head changes', () => {
    const before: SceneState = {
      sceneId: 'scene_1', shotNumber: 1,
      characters: {
        j: { kind: 'human', position: 'seated_at_table', pose: 'sitting_upright', expression: 'calm', facing: 'camera', inFrame: true, leftHand: 'at_side', rightHand: 'at_side', legs: 'crossed', headTilt: 'neutral' },
      },
      objects: {}, environment: { lighting: 'default', timeProgression: 'start' },
    };
    const after: SceneState = {
      sceneId: 'scene_1', shotNumber: 2,
      characters: {
        j: { kind: 'human', position: 'seated_at_table', pose: 'sitting_upright', expression: 'brooding', facing: 'down', inFrame: true, leftHand: 'at_side', rightHand: 'holding_glass', legs: 'crossed', headTilt: 'looking_down' },
      },
      objects: {}, environment: { lighting: 'default', timeProgression: 'start' },
    };

    const diff = computeStateDiff(before, after);
    expect(diff).toContain('rightHand: at_side → holding_glass');
    expect(diff).toContain('headTilt: neutral → looking_down');
    expect(diff).toContain('expression: calm → brooding');
    expect(diff).not.toContain('bodyPose');
  });
});

describe('characterStateSchema accepts both human and animal shapes', () => {
  it('validates an animal entry without hand/leg/head fields', () => {
    const parsed = characterStateSchema.safeParse({
      kind: 'animal',
      position: 'on_lap',
      pose: 'curled_up',
      expression: 'content',
      facing: 'camera',
      inFrame: true,
      bodyPose: 'curled_up',
    });
    expect(parsed.success).toBe(true);
  });

  it('validates a human entry with hand/leg/head fields', () => {
    const parsed = characterStateSchema.safeParse({
      kind: 'human',
      position: 'seated_at_table',
      pose: 'sitting_upright',
      expression: 'brooding',
      facing: 'camera',
      inFrame: true,
      leftHand: 'at_side',
      rightHand: 'holding_glass',
      legs: 'crossed',
      headTilt: 'looking_down',
    });
    expect(parsed.success).toBe(true);
  });

  it('defaults kind to `unknown` when omitted (backward compat)', () => {
    const parsed = characterStateSchema.safeParse({
      position: 'off_screen',
      pose: 'unknown',
      expression: 'unknown',
      facing: 'unknown',
      inFrame: false,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.kind).toBe('unknown');
  });
});
