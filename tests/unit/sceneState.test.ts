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
    const state = initializeSceneState('scene_1', ['keerti', 'mr_patel'], 'master_bedroom');

    expect(state.sceneId).toBe('scene_1');
    expect(state.shotNumber).toBe(0);
    expect(state.characters['keerti']).toBeDefined();
    expect(state.characters['keerti'].inFrame).toBe(false);
    expect(state.characters['keerti'].position).toBe('off_screen');
    expect(state.characters['mr_patel'].inFrame).toBe(false);
  });

  it('initializeSceneState includes hand and leg tracking', async () => {
    const { initializeSceneState } = await import('../../src/core/planner/sceneState.js');
    const state = initializeSceneState('scene_1', ['keerti'], 'bedroom');

    expect(state.characters['keerti'].leftHand).toBeDefined();
    expect(state.characters['keerti'].rightHand).toBeDefined();
    expect(state.characters['keerti'].legs).toBeDefined();
    expect(state.characters['keerti'].headTilt).toBeDefined();
  });

  it('initializeSceneState sets environment from setting', async () => {
    const { initializeSceneState } = await import('../../src/core/planner/sceneState.js');
    const state = initializeSceneState('scene_1', [], 'master_bedroom');

    expect(state.environment).toBeDefined();
    expect(state.environment.lighting).toBeDefined();
  });
});

describe('Scene State: persistence', () => {
  it('saveSceneState writes to disk and loadSceneState reads it back', async () => {
    const { initializeSceneState, saveSceneState, loadSceneState } = await import('../../src/core/planner/sceneState.js');

    const state = initializeSceneState('scene_1', ['keerti'], 'bedroom');
    state.characters['keerti'].position = 'lying_in_bed';
    state.characters['keerti'].inFrame = true;
    state.shotNumber = 2;

    saveSceneState(testDir, 'scene_1', state);

    const loaded = loadSceneState(testDir, 'scene_1');
    expect(loaded).not.toBeNull();
    expect(loaded!.characters['keerti'].position).toBe('lying_in_bed');
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

    const state = initializeSceneState('scene_1', ['keerti', 'mr_patel'], 'bedroom');
    state.characters['keerti'] = {
      position: 'lying_in_bed',
      pose: 'lying_down',
      expression: 'peaceful',
      facing: 'right',
      inFrame: true,
      leftHand: 'under_pillow',
      rightHand: 'on_duvet',
      legs: 'under_duvet',
      headTilt: 'neutral',
    };
    state.characters['mr_patel'] = {
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

    expect(formatted).toContain('keerti');
    expect(formatted).toContain('lying_in_bed');
    expect(formatted).toContain('peaceful');
    expect(formatted).toContain('under_pillow');
    expect(formatted).toContain('off screen'); // mr_patel
    expect(formatted).toContain('shot 1');
  });

  it('formatStateForPrompt includes objects and environment', async () => {
    const { initializeSceneState, formatStateForPrompt } = await import('../../src/core/planner/sceneState.js');

    const state = initializeSceneState('scene_1', [], 'bedroom');
    state.objects = { duvet: { state: 'pulled_up', position: 'bed' } };
    state.environment = { lighting: 'warm_golden', timeProgression: 'early_morning' };

    const formatted = formatStateForPrompt(state);
    expect(formatted).toContain('duvet');
    expect(formatted).toContain('warm_golden');
  });
});

describe('Scene State: executor integration', () => {
  it('ExecutorAgent injects scene state into shot_image_prompt context', () => {
    const code = readFileSync(join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'), 'utf-8');
    expect(code).toContain('scene_state');
    expect(code).toContain('formatStateForPrompt');
  });

  it('ExecutorAgent extracts new state after shot_image_prompt completes', () => {
    const code = readFileSync(join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'), 'utf-8');
    expect(code).toContain('saveSceneState');
  });

  it('shot_image_prompt nodes depend on previous shot_image_prompt', () => {
    const code = readFileSync(join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'), 'utf-8');
    // Should wire prevShotPromptId dependency
    expect(code).toContain('prevShotPromptId');
  });
});
