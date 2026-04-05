/**
 * Scene State Tracker
 *
 * Tracks character positions, poses, hands, legs, expressions, and object states
 * across shots within a scene. The state accumulates shot by shot and is injected
 * into each shot's LLM context to maintain visual continuity.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface CharacterState {
  position: string;      // "lying_in_bed", "standing_left", "seated_at_table", "off_screen"
  pose: string;          // "lying_down", "sitting_upright", "leaning_forward"
  expression: string;    // "peaceful", "anxious", "smiling"
  facing: string;        // "camera", "left", "right", "away"
  inFrame: boolean;
  leftHand: string;      // "resting_on_lap", "holding_ring", "gripping_duvet", "at_side"
  rightHand: string;     // "on_table", "touching_face", "holding_cup", "at_side"
  legs: string;          // "under_duvet", "crossed", "standing_apart", "curled_up"
  headTilt: string;      // "neutral", "tilted_left", "looking_down", "looking_up"
}

export interface ObjectState {
  state: string;         // "on_table", "held_by_keerti", "broken", "lit", "off"
  position: string;      // "bedside_table", "floor", "off_screen"
}

export interface SceneState {
  sceneId: string;
  shotNumber: number;    // Last shot that updated this state
  characters: Record<string, CharacterState>;
  objects: Record<string, ObjectState>;
  environment: {
    lighting: string;
    timeProgression: string;
  };
}

/**
 * Create initial scene state with all characters off-screen.
 */
export function initializeSceneState(
  sceneId: string,
  characterIds: string[],
  settingId: string,
): SceneState {
  const characters: Record<string, CharacterState> = {};
  for (const id of characterIds) {
    characters[id] = {
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
  }

  return {
    sceneId,
    shotNumber: 0,
    characters,
    objects: {},
    environment: {
      lighting: 'default',
      timeProgression: 'start',
    },
  };
}

/**
 * Save scene state to disk.
 */
export function saveSceneState(projectDir: string, sceneId: string, state: SceneState): void {
  const stateDir = join(projectDir, 'prompts', 'videos', 'scenes');
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  const statePath = join(stateDir, `${sceneId}.state.json`);
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Load scene state from disk. Returns null if not found.
 */
export function loadSceneState(projectDir: string, sceneId: string): SceneState | null {
  const statePath = join(projectDir, 'prompts', 'videos', 'scenes', `${sceneId}.state.json`);
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Format scene state as a human-readable text block for LLM injection.
 */
export function formatStateForPrompt(state: SceneState): string {
  const lines: string[] = [];
  lines.push(`CURRENT SCENE STATE (after shot ${state.shotNumber}):`);
  lines.push('');

  // Characters
  for (const [id, char] of Object.entries(state.characters)) {
    if (!char.inFrame) {
      lines.push(`- ${id}: off screen`);
      continue;
    }
    const parts: string[] = [];
    if (char.position !== 'unknown') parts.push(`position: ${char.position}`);
    if (char.pose !== 'unknown') parts.push(`pose: ${char.pose}`);
    if (char.expression !== 'unknown') parts.push(`expression: ${char.expression}`);
    if (char.facing !== 'unknown') parts.push(`facing: ${char.facing}`);
    if (char.leftHand !== 'unknown') parts.push(`left hand: ${char.leftHand}`);
    if (char.rightHand !== 'unknown') parts.push(`right hand: ${char.rightHand}`);
    if (char.legs !== 'unknown') parts.push(`legs: ${char.legs}`);
    if (char.headTilt !== 'unknown') parts.push(`head: ${char.headTilt}`);
    lines.push(`- ${id}: ${parts.join(', ')}`);
  }

  // Objects
  if (Object.keys(state.objects).length > 0) {
    lines.push('');
    for (const [id, obj] of Object.entries(state.objects)) {
      lines.push(`- ${id}: ${obj.state} (${obj.position})`);
    }
  }

  // Environment
  if (state.environment.lighting !== 'default') {
    lines.push('');
    lines.push(`- Lighting: ${state.environment.lighting}`);
    if (state.environment.timeProgression !== 'start') {
      lines.push(`- Time: ${state.environment.timeProgression}`);
    }
  }

  return lines.join('\n');
}
