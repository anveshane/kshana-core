/**
 * TDD Tests for Scene State Tracker.
 *
 * Tracks character positions, poses, hands, legs, expressions, and object states
 * across shots within a scene. Injects state context into LLM prompts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `scene-state-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true });
});

describe('Scene State: initialization', () => {
  it('initializeSceneState creates state with all characters off-screen', async () => {
    const { initializeSceneState } = await import('../../src/core/planner/sceneState.js');
    const state = initializeSceneState('scene_1', ['elena', 'marcus'], 'warehouse');

    expect(state.sceneId).toBe('scene_1');
    expect(state.shotNumber).toBe(0);
    expect(state.characters['elena']).toBeDefined();
    expect(state.characters['elena'].inFrame).toBe(false);
    expect(state.characters['elena'].position).toBe('off_screen');
    expect(state.characters['marcus'].inFrame).toBe(false);
  });

  it('initializeSceneState includes hand and leg tracking', async () => {
    const { initializeSceneState } = await import('../../src/core/planner/sceneState.js');
    const state = initializeSceneState('scene_1', ['elena'], 'warehouse');

    expect(state.characters['elena'].leftHand).toBeDefined();
    expect(state.characters['elena'].rightHand).toBeDefined();
    expect(state.characters['elena'].legs).toBeDefined();
    expect(state.characters['elena'].headTilt).toBeDefined();
  });

  it('initializeSceneState sets environment from setting', async () => {
    const { initializeSceneState } = await import('../../src/core/planner/sceneState.js');
    const state = initializeSceneState('scene_1', [], 'warehouse');

    expect(state.environment).toBeDefined();
    expect(state.environment.lighting).toBeDefined();
  });
});

describe('Scene State: persistence', () => {
  it('saveSceneState writes to disk and loadSceneState reads it back', async () => {
    const { initializeSceneState, saveSceneState, loadSceneState } = await import('../../src/core/planner/sceneState.js');

    const state = initializeSceneState('scene_1', ['elena'], 'warehouse');
    state.characters['elena'].position = 'crouching_behind_crates';
    state.characters['elena'].inFrame = true;
    state.shotNumber = 2;

    saveSceneState(testDir, 'scene_1', state);

    const loaded = loadSceneState(testDir, 'scene_1');
    expect(loaded).not.toBeNull();
    expect(loaded!.characters['elena'].position).toBe('crouching_behind_crates');
    expect(loaded!.shotNumber).toBe(2);
  });

  it('loadSceneState returns null for non-existent state', async () => {
    const { loadSceneState } = await import('../../src/core/planner/sceneState.js');
    const loaded = loadSceneState(testDir, 'scene_99');
    expect(loaded).toBeNull();
  });
});

describe('Scene State: formatting for LLM prompt', () => {
  it('formatStateForPrompt produces readable text', async () => {
    const { initializeSceneState, formatStateForPrompt } = await import('../../src/core/planner/sceneState.js');

    const state = initializeSceneState('scene_1', ['elena', 'marcus'], 'warehouse');
    state.characters['elena'] = {
      position: 'crouching_behind_crates',
      pose: 'crouching',
      expression: 'alert',
      facing: 'right',
      inFrame: true,
      leftHand: 'gripping_pistol',
      rightHand: 'steadied_against_crate',
      legs: 'bent_crouching',
      headTilt: 'neutral',
    };
    state.characters['marcus'] = {
      position: 'off_screen',
      pose: 'unknown',
      expression: 'unknown',
      facing: 'unknown',
      inFrame: false,
      leftHand: 'unknown',
      rightHand: 'unknown',
      legs: 'unknown',
      headTilt: 'unknown',
    };
    state.shotNumber = 1;

    const formatted = formatStateForPrompt(state);

    expect(formatted).toContain('elena');
    expect(formatted).toContain('crouching_behind_crates');
    expect(formatted).toContain('alert');
    expect(formatted).toContain('gripping_pistol');
    expect(formatted).toContain('off screen'); // marcus
    expect(formatted).toContain('shot 1');
  });

  it('formatStateForPrompt includes objects and environment', async () => {
    const { initializeSceneState, formatStateForPrompt } = await import('../../src/core/planner/sceneState.js');

    const state = initializeSceneState('scene_1', [], 'warehouse');
    state.objects = { crate: { state: 'stacked', position: 'warehouse_floor' } };
    state.environment = { lighting: 'harsh_overhead', timeProgression: 'late_night' };

    const formatted = formatStateForPrompt(state);
    expect(formatted).toContain('crate');
    expect(formatted).toContain('harsh_overhead');
  });
});

describe('Scene State: buildStateContext (compute state before prompt)', () => {
  it('buildStateContext returns previous + target state context for prompt injection', async () => {
    const { buildStateContext } = await import('../../src/core/planner/sceneState.js');
    const { initializeSceneState } = await import('../../src/core/planner/sceneState.js');

    const prevState = initializeSceneState('scene_1', ['elena', 'marcus'], 'alley');
    // Simulate elena already in frame from previous shot
    prevState.characters['elena'] = {
      ...prevState.characters['elena'],
      position: 'center_frame',
      inFrame: true,
      expression: 'neutral',
      facing: 'camera',
    };
    prevState.shotNumber = 1;

    const shotDescription = 'Shot 2: Marcus enters from the left, approaching Elena. Purpose: meet_character.';

    // Mock LLM that returns a valid target state
    const mockLlm = {
      async *generateStream() {
        yield {
          content: JSON.stringify({
            characters: {
              elena: { position: 'center_frame', pose: 'standing', expression: 'alert', facing: 'left', inFrame: true, leftHand: 'at_side', rightHand: 'at_side', legs: 'standing_apart', headTilt: 'neutral' },
              marcus: { position: 'entering_from_left', pose: 'walking', expression: 'determined', facing: 'right', inFrame: true, leftHand: 'at_side', rightHand: 'at_side', legs: 'mid_stride', headTilt: 'neutral' },
            },
            objects: {},
            environment: { lighting: 'neon_glow', timeProgression: 'night' },
          }),
          done: true,
        };
      },
    };

    const result = await buildStateContext(mockLlm as any, prevState, shotDescription);

    expect(result.targetState).not.toBeNull();
    expect(result.targetState!.characters['marcus'].inFrame).toBe(true);
    expect(result.targetState!.characters['marcus'].position).toContain('enter');
    expect(result.promptContext).toContain('PREVIOUS STATE');
    expect(result.promptContext).toContain('TARGET STATE');
    expect(result.promptContext).toContain('TARGET STATE');
  });

  it('buildStateContext returns previous-only context when LLM fails', async () => {
    const { buildStateContext, initializeSceneState } = await import('../../src/core/planner/sceneState.js');

    const prevState = initializeSceneState('scene_1', ['elena'], 'alley');
    prevState.shotNumber = 1;
    prevState.characters['elena'].inFrame = true;

    // Mock LLM that returns garbage
    const mockLlm = {
      async *generateStream() {
        yield { content: 'not valid json at all', done: true };
      },
    };

    const result = await buildStateContext(mockLlm as any, prevState, 'Shot 2: Elena looks around.');

    expect(result.targetState).toBeNull();
    expect(result.promptContext).toContain('PREVIOUS STATE');
    expect(result.promptContext).not.toContain('TARGET STATE');
  });

  it('buildStateContext with null previous state (first shot) still computes target', async () => {
    const { buildStateContext } = await import('../../src/core/planner/sceneState.js');

    const mockLlm = {
      async *generateStream() {
        yield {
          content: JSON.stringify({
            characters: {
              elena: { position: 'center_frame', pose: 'standing', expression: 'wary', facing: 'camera', inFrame: true, leftHand: 'at_side', rightHand: 'holding_flashlight', legs: 'standing_apart', headTilt: 'neutral' },
            },
            objects: {},
            environment: { lighting: 'dim_streetlight', timeProgression: 'night' },
          }),
          done: true,
        };
      },
    };

    const result = await buildStateContext(mockLlm as any, null, 'Shot 1: Elena stands under a streetlight. Purpose: meet_character.');

    expect(result.targetState).not.toBeNull();
    expect(result.targetState!.characters['elena'].inFrame).toBe(true);
    expect(result.promptContext).toContain('TARGET STATE');
  });
});
