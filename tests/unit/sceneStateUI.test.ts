/**
 * TDD Tests for Scene State UI visibility.
 *
 * Before each shot_image_prompt: show BEFORE state card
 * After state extraction: show AFTER state card with diff highlighting
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Scene State UI: BEFORE card', () => {
  it('executor emits scene_state tool_call BEFORE shot_image_prompt LLM call', () => {
    const code = readFileSync(join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'), 'utf-8');
    expect(code).toContain("toolName: 'scene_state'");
    expect(code).toContain("phase: 'BEFORE'");
  });

  it('BEFORE card shows formatted state text', () => {
    const code = readFileSync(join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'), 'utf-8');
    // Should emit tool_streaming with the formatted state
    expect(code).toMatch(/scene_state.*formattedState|formattedState.*scene_state/s);
  });
});

describe('Scene State UI: AFTER card with diff', () => {
  it('executor emits scene_state tool_call AFTER state extraction', () => {
    const code = readFileSync(join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'), 'utf-8');
    expect(code).toContain("phase: 'AFTER'");
  });

  it('AFTER card includes diff of what changed', () => {
    const code = readFileSync(join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'), 'utf-8');
    expect(code).toContain('computeStateDiff');
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
