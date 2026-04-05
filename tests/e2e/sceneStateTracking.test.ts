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
  it('extracts valid state from first shot description', { timeout: 120000 }, async () => {
    if (!LLM_AVAILABLE) return;

    const initialState = initializeSceneState('scene_1', ['keerti', 'mr_patel'], 'master_bedroom');

    const shotPrompt = `A close-up shot of Keerti lying in bed, eyes closed peacefully. Morning sunlight
filters through sheer curtains, casting warm golden light across her face. Her long dark hair is spread
on the white pillow. Her left hand rests under the pillow, right hand on the duvet. The duvet is pulled
up to her chin. Mr. Patel is not visible in this shot.`;

    const result = await extractStateFromLLM(llm, initialState, shotPrompt);

    console.log('Scenario 1 raw:', result.raw.substring(0, 300));
    expect(result.error).toBeUndefined();
    expect(result.state).not.toBeNull();

    // Validate against schema
    const validated = sceneStateSchema.safeParse(result.state);
    expect(validated.success).toBe(true);

    // Keerti should be in frame
    const keerti = result.state!.characters['keerti'];
    expect(keerti).toBeDefined();
    expect(keerti.inFrame).toBe(true);
    expect(keerti.position).toMatch(/lying|bed/i);
    expect(keerti.expression).toMatch(/peaceful|calm|serene|sleeping/i);

    // Mr. Patel should be off screen
    const mrPatel = result.state!.characters['mr_patel'];
    expect(mrPatel).toBeDefined();
    expect(mrPatel.inFrame).toBe(false);

    // Environment should have lighting
    expect(result.state!.environment.lighting).not.toBe('default');
  });
});

describe('Scene State E2E: Scenario 2 — Previous state → new shot', () => {
  it('correctly updates state when new character enters', { timeout: 120000 }, async () => {
    if (!LLM_AVAILABLE) return;

    const previousState: SceneState = {
      sceneId: 'scene_1',
      shotNumber: 1,
      characters: {
        keerti: {
          position: 'lying_in_bed',
          pose: 'lying_down',
          expression: 'peaceful',
          facing: 'right',
          inFrame: true,
          leftHand: 'under_pillow',
          rightHand: 'on_duvet',
          legs: 'under_duvet',
          headTilt: 'neutral',
        },
        mr_patel: {
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
        duvet: { state: 'pulled_up', position: 'bed' },
      },
      environment: { lighting: 'warm_golden_morning', timeProgression: 'early_morning' },
    };

    const shotPrompt = `A medium shot as Mr. Patel enters from the left side of the frame. He walks slowly
to the bedside and sits down on the edge of the bed. He places his right hand gently on Keerti's shoulder.
Keerti remains lying down with her eyes closed. The warm morning light bathes both figures.`;

    const result = await extractStateFromLLM(llm, previousState, shotPrompt);

    console.log('Scenario 2 raw:', result.raw.substring(0, 300));
    expect(result.error).toBeUndefined();
    expect(result.state).not.toBeNull();

    // Mr. Patel should now be in frame
    const mrPatel = result.state!.characters['mr_patel'];
    expect(mrPatel).toBeDefined();
    expect(mrPatel.inFrame).toBe(true);
    expect(mrPatel.position).toMatch(/bed|beside|sitting/i);
    expect(mrPatel.rightHand).toMatch(/shoulder|keerti/i);

    // Keerti should be largely unchanged
    const keerti = result.state!.characters['keerti'];
    expect(keerti).toBeDefined();
    expect(keerti.inFrame).toBe(true);
    expect(keerti.position).toMatch(/lying|bed/i);
  });
});

describe('Scene State E2E: Scenario 3 — Corrupted previous state', () => {
  it('handles corrupted state without crashing', { timeout: 120000 }, async () => {
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

    const shotPrompt = `A wide establishing shot of the master bedroom. Morning light streams through curtains.
An empty bed with rumpled white sheets. A bedside table with a water glass and a book.`;

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
  it('tracks hand and expression changes without moving the character', { timeout: 120000 }, async () => {
    if (!LLM_AVAILABLE) return;

    const previousState: SceneState = {
      sceneId: 'scene_1',
      shotNumber: 3,
      characters: {
        keerti: {
          position: 'sitting_up_in_bed',
          pose: 'sitting_upright',
          expression: 'neutral',
          facing: 'camera',
          inFrame: true,
          leftHand: 'on_lap',
          rightHand: 'on_lap',
          legs: 'under_duvet',
          headTilt: 'neutral',
        },
      },
      objects: {
        duvet: { state: 'at_waist', position: 'bed' },
      },
      environment: { lighting: 'warm_golden_morning', timeProgression: 'early_morning' },
    };

    const shotPrompt = `A tight close-up of Keerti's face and hands. She slowly closes her eyes, her
expression shifting to one of deep concentration or pain. Her right hand moves from her lap to grip
the edge of the duvet tightly, knuckles whitening. Her left hand remains on her lap. Her head tilts
slightly downward.`;

    const result = await extractStateFromLLM(llm, previousState, shotPrompt);

    console.log('Scenario 4 raw:', result.raw.substring(0, 300));
    expect(result.error).toBeUndefined();
    expect(result.state).not.toBeNull();

    const keerti = result.state!.characters['keerti'];
    expect(keerti).toBeDefined();

    // Position should NOT change — she's still sitting
    expect(keerti.position).toMatch(/sitting/i);

    // Expression should change
    expect(keerti.expression).not.toBe('neutral');
    expect(keerti.expression).toMatch(/concentrat|pain|distress|tense|anguish/i);

    // Right hand should change
    expect(keerti.rightHand).not.toBe('on_lap');
    expect(keerti.rightHand).toMatch(/grip|duvet|clench/i);

    // Left hand should stay on lap
    expect(keerti.leftHand).toMatch(/lap/i);

    // Head tilt should change
    expect(keerti.headTilt).toMatch(/down/i);
  });
});
