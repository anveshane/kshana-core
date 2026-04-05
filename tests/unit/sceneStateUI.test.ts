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
        keerti: { position: 'lying_in_bed', pose: 'lying_down', expression: 'peaceful', facing: 'right', inFrame: true, leftHand: 'under_pillow', rightHand: 'on_duvet', legs: 'under_duvet', headTilt: 'neutral' },
      },
      objects: {},
      environment: { lighting: 'warm_golden', timeProgression: 'early_morning' },
    };

    const after = {
      characters: {
        keerti: { position: 'sitting_up_in_bed', pose: 'upright', expression: 'confused', facing: 'camera', inFrame: true, leftHand: 'gripping_duvet', rightHand: 'at_side', legs: 'under_duvet', headTilt: 'tilted_left' },
      },
      objects: {},
      environment: { lighting: 'warm_golden', timeProgression: 'early_morning' },
    };

    const diff = computeStateDiff(before, after);

    // Should identify what changed
    expect(diff).toContain('keerti');
    expect(diff).toContain('lying_in_bed → sitting_up_in_bed');
    expect(diff).toContain('lying_down → upright');
    expect(diff).toContain('peaceful → confused');
    // Unchanged fields should NOT appear in diff
    expect(diff).not.toContain('under_duvet →');
  });

  it('computeStateDiff shows new characters entering frame', async () => {
    const { computeStateDiff } = await import('../../src/core/planner/sceneState.js');

    const before = {
      characters: {
        keerti: { position: 'off_screen', inFrame: false, pose: 'unknown', expression: 'unknown', facing: 'unknown', leftHand: 'unknown', rightHand: 'unknown', legs: 'unknown', headTilt: 'unknown' },
      },
      objects: {},
      environment: { lighting: 'default', timeProgression: 'start' },
    };

    const after = {
      characters: {
        keerti: { position: 'lying_in_bed', inFrame: true, pose: 'lying_down', expression: 'peaceful', facing: 'right', leftHand: 'under_pillow', rightHand: 'on_duvet', legs: 'under_duvet', headTilt: 'neutral' },
      },
      objects: {},
      environment: { lighting: 'warm_golden', timeProgression: 'early_morning' },
    };

    const diff = computeStateDiff(before, after);
    expect(diff).toContain('ENTERED');
  });

  it('computeStateDiff returns empty string when nothing changed', async () => {
    const { computeStateDiff } = await import('../../src/core/planner/sceneState.js');

    const state = {
      characters: { keerti: { position: 'bed', inFrame: true, pose: 'lying', expression: 'calm', facing: 'right', leftHand: 'side', rightHand: 'side', legs: 'straight', headTilt: 'neutral' } },
      objects: {},
      environment: { lighting: 'warm', timeProgression: 'morning' },
    };

    const diff = computeStateDiff(state, state);
    expect(diff).toBe('');
  });
});
