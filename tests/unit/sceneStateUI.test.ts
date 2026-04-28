/**
 * TDD Tests for Scene State UI visibility.
 *
 * Before each shot_image_prompt: show BEFORE state card
 * After state extraction: show AFTER state card with diff highlighting
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Scene State UI: buildStateContext formats for prompt injection', () => {
  it('buildStateContext includes PREVIOUS and TARGET state in prompt context', async () => {
    const { buildStateContext, initializeSceneState } = await import('../../src/core/planner/sceneState.js');

    const prevState = initializeSceneState('scene_1', ['elena'], 'alley');
    prevState.shotNumber = 1;
    prevState.characters['elena'].inFrame = true;
    prevState.characters['elena'].position = 'center_frame';

    const mockLlm = {
      async *generateStream() {
        yield {
          content: JSON.stringify({
            characters: { elena: { position: 'left_frame', pose: 'walking', expression: 'alert', facing: 'right', inFrame: true, leftHand: 'at_side', rightHand: 'at_side', legs: 'mid_stride', headTilt: 'neutral' } },
            objects: {},
            environment: { lighting: 'dim', timeProgression: 'night' },
          }),
          done: true,
        };
      },
    };

    const result = await buildStateContext(mockLlm as any, prevState, 'Elena moves to the left.');
    expect(result.promptContext).toContain('PREVIOUS STATE');
    expect(result.promptContext).toContain('TARGET STATE');
    expect(result.promptContext).toContain('CHANGES');
    expect(result.diff).toContain('center_frame → left_frame');
  });

  it('buildStateContext diff shows character entering frame', async () => {
    const { buildStateContext, initializeSceneState } = await import('../../src/core/planner/sceneState.js');

    const prevState = initializeSceneState('scene_1', ['marcus'], 'alley');
    prevState.shotNumber = 1;

    const mockLlm = {
      async *generateStream() {
        yield {
          content: JSON.stringify({
            characters: { marcus: { position: 'entering_left', pose: 'walking', expression: 'determined', facing: 'right', inFrame: true, leftHand: 'at_side', rightHand: 'at_side', legs: 'mid_stride', headTilt: 'neutral' } },
            objects: {},
            environment: { lighting: 'neon', timeProgression: 'night' },
          }),
          done: true,
        };
      },
    };

    const result = await buildStateContext(mockLlm as any, prevState, 'Marcus enters from the left.');
    expect(result.diff).toContain('ENTERED');
  });
});

describe('Scene State: diff computation', () => {
  it('computeStateDiff identifies changed character fields', async () => {
    const { computeStateDiff } = await import('../../src/core/planner/sceneState.js');

    const before = {
      characters: {
        elena: { position: 'crouching_behind_crates', pose: 'crouching', expression: 'alert', facing: 'right', inFrame: true, leftHand: 'gripping_pistol', rightHand: 'steadied_against_crate', legs: 'bent_crouching', headTilt: 'neutral' },
      },
      objects: {},
      environment: { lighting: 'harsh_overhead', timeProgression: 'late_night' },
    };

    const after = {
      characters: {
        elena: { position: 'standing_behind_crates', pose: 'upright', expression: 'suspicious', facing: 'camera', inFrame: true, leftHand: 'gripping_pistol', rightHand: 'reaching_into_jacket', legs: 'standing', headTilt: 'tilted_left' },
      },
      objects: {},
      environment: { lighting: 'harsh_overhead', timeProgression: 'late_night' },
    };

    const diff = computeStateDiff(before, after);

    // Should identify what changed
    expect(diff).toContain('elena');
    expect(diff).toContain('crouching_behind_crates → standing_behind_crates');
    expect(diff).toContain('crouching → upright');
    expect(diff).toContain('alert → suspicious');
    // Unchanged fields should NOT appear in diff
    expect(diff).not.toContain('gripping_pistol →');
  });

  it('computeStateDiff shows new characters entering frame', async () => {
    const { computeStateDiff } = await import('../../src/core/planner/sceneState.js');

    const before = {
      characters: {
        elena: { position: 'off_screen', inFrame: false, pose: 'unknown', expression: 'unknown', facing: 'unknown', leftHand: 'unknown', rightHand: 'unknown', legs: 'unknown', headTilt: 'unknown' },
      },
      objects: {},
      environment: { lighting: 'default', timeProgression: 'start' },
    };

    const after = {
      characters: {
        elena: { position: 'crouching_behind_crates', inFrame: true, pose: 'crouching', expression: 'alert', facing: 'right', leftHand: 'gripping_pistol', rightHand: 'steadied_against_crate', legs: 'bent_crouching', headTilt: 'neutral' },
      },
      objects: {},
      environment: { lighting: 'harsh_overhead', timeProgression: 'late_night' },
    };

    const diff = computeStateDiff(before, after);
    expect(diff).toContain('ENTERED');
  });

  it('computeStateDiff returns empty string when nothing changed', async () => {
    const { computeStateDiff } = await import('../../src/core/planner/sceneState.js');

    const state = {
      characters: { elena: { position: 'crate', inFrame: true, pose: 'crouching', expression: 'alert', facing: 'right', leftHand: 'side', rightHand: 'side', legs: 'bent', headTilt: 'neutral' } },
      objects: {},
      environment: { lighting: 'harsh', timeProgression: 'night' },
    };

    const diff = computeStateDiff(state, state);
    expect(diff).toBe('');
  });
});
