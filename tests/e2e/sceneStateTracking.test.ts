/**
 * E2E Tests for Scene State Tracking with Real LLM.
 *
 * Tests the same extractStateFromLLM() function used in production.
 * Requires OPENAI_BASE_URL and OPENAI_MODEL env vars.
 *
 * Run: npx vitest run tests/e2e/sceneStateTracking.test.ts
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '../../src/core/llm/index.js';
import {
  extractStateFromLLM,
  initializeSceneState,
  sceneStateSchema,
  type SceneState,
} from '../../src/core/planner/sceneState.js';

let llm: LLMClient;
let LLM_AVAILABLE = false;

async function isLLMReachable(): Promise<boolean> {
  try {
    const url = process.env['OPENAI_BASE_URL'];
    if (!url) return false;
    const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  LLM_AVAILABLE = await isLLMReachable();
  if (!LLM_AVAILABLE) {
    console.log('LLM not reachable — skipping scene state E2E tests');
    return;
  }
  llm = new LLMClient({
    baseUrl: process.env['OPENAI_BASE_URL'],
    apiKey: process.env['OPENAI_API_KEY'] ?? 'not-needed',
    model: process.env['OPENAI_MODEL'],
  });
}, 15000);

describe('Scene State E2E: Scenario 1 — No previous state (first shot)', () => {
  it('extracts valid state from first shot description', { timeout: 200000 }, async () => {
    if (!LLM_AVAILABLE) return;

    const initialState = initializeSceneState('scene_1', ['elena', 'marcus'], 'warehouse');

    const shotPrompt = `Elena crouches behind shipping crates, peering through shadows. A single overhead lamp casts harsh light. Her left hand grips a pistol, right hand steadies against the crate. Marcus is not visible in this shot.`;

    const result = await extractStateFromLLM(llm, initialState, shotPrompt);

    console.log('Scenario 1 raw:', result.raw.substring(0, 300));
    expect(result.error).toBeUndefined();
    expect(result.state).not.toBeNull();

    // Validate against schema
    const validated = sceneStateSchema.safeParse(result.state);
    expect(validated.success).toBe(true);

    // Elena should be in frame
    const elena = result.state!.characters['elena'];
    expect(elena).toBeDefined();
    expect(elena.inFrame).toBe(true);
    expect(elena.position).toMatch(/crouch|crate|behind/i);
    expect(elena.expression).toMatch(/alert|focused|tense|determined/i);

    // Marcus should be off screen
    const marcus = result.state!.characters['marcus'];
    expect(marcus).toBeDefined();
    expect(marcus.inFrame).toBe(false);

    // Environment should have lighting
    expect(result.state!.environment.lighting).not.toBe('default');
  });
});

describe('Scene State E2E: Scenario 2 — Previous state → new shot', () => {
  it('correctly updates state when new character enters', { timeout: 200000 }, async () => {
    if (!LLM_AVAILABLE) return;

    const previousState: SceneState = {
      sceneId: 'scene_1',
      shotNumber: 1,
      characters: {
        elena: {
          position: 'crouching_behind_crates',
          pose: 'crouching',
          expression: 'alert',
          facing: 'right',
          inFrame: true,
          leftHand: 'gripping_pistol',
          rightHand: 'steadied_against_crate',
          legs: 'bent_crouching',
          headTilt: 'neutral',
        },
        marcus: {
          position: 'off_screen',
          pose: 'unknown',
          expression: 'unknown',
          facing: 'unknown',
          inFrame: false,
          leftHand: 'unknown',
          rightHand: 'unknown',
          legs: 'unknown',
          headTilt: 'unknown',
        },
      },
      objects: {
        crate: { state: 'stacked', position: 'warehouse_floor' },
      },
      environment: { lighting: 'harsh_overhead_lamp', timeProgression: 'late_night' },
    };

    const shotPrompt = `Marcus enters from the shadows on the right. He approaches slowly, hands raised, and leans against the wall opposite Elena.`;

    const result = await extractStateFromLLM(llm, previousState, shotPrompt);

    console.log('Scenario 2 raw:', result.raw.substring(0, 300));
    expect(result.error).toBeUndefined();
    expect(result.state).not.toBeNull();

    // Marcus should now be in frame
    const marcus = result.state!.characters['marcus'];
    expect(marcus).toBeDefined();
    expect(marcus.inFrame).toBe(true);
    expect(marcus.position).toMatch(/wall|lean|opposite|standing/i);

    // Elena should be largely unchanged
    const elena = result.state!.characters['elena'];
    expect(elena).toBeDefined();
    expect(elena.inFrame).toBe(true);
    expect(elena.position).toMatch(/crouch|crate|behind/i);
  });
});

describe('Scene State E2E: Scenario 3 — Corrupted previous state', () => {
  it('handles corrupted state without crashing', { timeout: 200000 }, async () => {
    if (!LLM_AVAILABLE) return;

    // Provide garbage as previous state
    const corruptedState = {
      sceneId: 'scene_1',
      shotNumber: 0,
      characters: {} as any,
      objects: {} as any,
      environment: { lighting: 'default', timeProgression: 'start' },
    } as SceneState;

    // Overwrite with garbage
    (corruptedState as any).characters = 'not_an_object';
    (corruptedState as any).garbage = true;

    const shotPrompt = `A wide establishing shot of the warehouse. A single overhead lamp casts harsh light across stacked shipping crates. Shadows pool in the corners. A metal door hangs ajar on the far wall.`;

    const result = await extractStateFromLLM(llm, corruptedState, shotPrompt);

    console.log('Scenario 3 raw:', result.raw.substring(0, 300));

    // Should not crash — either returns valid state or an error
    if (result.state) {
      const validated = sceneStateSchema.safeParse(result.state);
      expect(validated.success).toBe(true);
    }
    // If it failed, it should have a clear error, not an unhandled exception
    if (result.error) {
      expect(typeof result.error).toBe('string');
    }
  });
});

describe('Scene State E2E: Scenario 4 — Subtle body part changes', () => {
  it('tracks hand and expression changes without moving the character', { timeout: 200000 }, async () => {
    if (!LLM_AVAILABLE) return;

    const previousState: SceneState = {
      sceneId: 'scene_1',
      shotNumber: 3,
      characters: {
        elena: {
          position: 'crouching_behind_crates',
          pose: 'crouching',
          expression: 'alert',
          facing: 'camera',
          inFrame: true,
          leftHand: 'gripping_pistol',
          rightHand: 'steadied_against_crate',
          legs: 'bent_crouching',
          headTilt: 'neutral',
        },
      },
      objects: {
        crate: { state: 'stacked', position: 'warehouse_floor' },
      },
      environment: { lighting: 'harsh_overhead_lamp', timeProgression: 'late_night' },
    };

    const shotPrompt = `Elena's eyes narrow, her right hand moves from the crate to reach inside her jacket pocket. Her expression shifts from alert to suspicious. Head tilts slightly to listen.`;

    const result = await extractStateFromLLM(llm, previousState, shotPrompt);

    console.log('Scenario 4 raw:', result.raw.substring(0, 300));
    expect(result.error).toBeUndefined();
    expect(result.state).not.toBeNull();

    const elena = result.state!.characters['elena'];
    expect(elena).toBeDefined();

    // Position should NOT change — she's still crouching
    expect(elena.position).toMatch(/crouch|crate|behind/i);

    // Expression should change
    expect(elena.expression).not.toBe('alert');
    expect(elena.expression).toMatch(/suspicious|narrow|wary|distrust/i);

    // Right hand should change
    expect(elena.rightHand).not.toBe('steadied_against_crate');
    expect(elena.rightHand).toMatch(/jacket|pocket|reach/i);

    // Left hand should stay gripping pistol
    expect(elena.leftHand).toMatch(/pistol|grip/i);

    // Head tilt should change
    expect(elena.headTilt).toMatch(/tilt|listen|side/i);
  });
});
