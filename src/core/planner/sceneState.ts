/**
 * Scene State Tracker
 *
 * Tracks character positions, poses, hands, legs, expressions, and object states
 * across shots within a scene. The state accumulates shot by shot and is injected
 * into each shot's LLM context to maintain visual continuity.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

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

// ── Zod schema for validating LLM state output ─────────────────────────────

export const characterStateSchema = z.object({
  position: z.string(),
  pose: z.string(),
  expression: z.string(),
  facing: z.string(),
  inFrame: z.boolean(),
  leftHand: z.string(),
  rightHand: z.string(),
  legs: z.string(),
  headTilt: z.string(),
});

export const sceneStateSchema = z.object({
  characters: z.record(z.string(), characterStateSchema),
  objects: z.record(z.string(), z.object({
    state: z.string(),
    position: z.string(),
  })).optional().default({}),
  environment: z.object({
    lighting: z.string(),
    timeProgression: z.string(),
  }).optional().default({ lighting: 'default', timeProgression: 'start' }),
});

/**
 * Extract new scene state from an LLM given previous state + shot prompt content.
 * This is the same function called by both production (ExecutorAgent) and E2E tests.
 */
export async function extractStateFromLLM(
  llm: { generateStream: (opts: any) => AsyncGenerator<{ content?: string; thinking?: string; done?: boolean }, any, any> },
  previousState: SceneState | null,
  shotPromptContent: string,
): Promise<{ state: SceneState | null; raw: string; error?: string }> {
  const stateJson = previousState
    ? JSON.stringify(previousState, null, 2)
    : '{ "characters": {}, "objects": {}, "environment": { "lighting": "default", "timeProgression": "start" } }';

  const systemMsg = `You extract scene state from shot descriptions. Return ONLY valid JSON with the full updated state.

The JSON must have this structure:
{
  "characters": {
    "<character_id>": {
      "position": "string (where in the scene: lying_in_bed, standing_left, seated_at_table, off_screen)",
      "pose": "string (body pose: lying_down, sitting_upright, leaning_forward, standing)",
      "expression": "string (facial expression: peaceful, anxious, confused, smiling)",
      "facing": "string (direction: camera, left, right, away, down)",
      "inFrame": boolean,
      "leftHand": "string (what left hand is doing: at_side, on_lap, holding_cup, gripping_duvet)",
      "rightHand": "string (what right hand is doing: at_side, on_shoulder, touching_face)",
      "legs": "string (leg position: under_duvet, crossed, standing_apart, curled_up)",
      "headTilt": "string (head angle: neutral, tilted_left, looking_down, looking_up)"
    }
  },
  "objects": {
    "<object_id>": { "state": "string", "position": "string" }
  },
  "environment": {
    "lighting": "string (warm_golden, dim_evening, harsh_overhead)",
    "timeProgression": "string (early_morning, midday, evening)"
  }
}

Include ALL characters from previous state (even off-screen ones).
Return ONLY the JSON — no markdown, no explanation.`;

  const userMsg = `Previous scene state:\n${stateJson}\n\nShot prompt content:\n${shotPromptContent}\n\nReturn the NEW complete state after this shot.`;

  let rawContent = '';
  try {
    for await (const chunk of llm.generateStream({
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.1,
    })) {
      if (chunk.content) rawContent += chunk.content;
    }
  } catch (err) {
    return { state: null, raw: rawContent, error: `LLM call failed: ${(err as Error).message}` };
  }

  // Parse and validate
  try {
    let cleaned = rawContent.trim();
    if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    const parsed = JSON.parse(cleaned);
    const validated = sceneStateSchema.safeParse(parsed);

    if (!validated.success) {
      return { state: null, raw: rawContent, error: `Schema validation failed: ${validated.error.issues.map(i => i.message).join('; ')}` };
    }

    const state: SceneState = {
      sceneId: previousState?.sceneId ?? 'unknown',
      shotNumber: (previousState?.shotNumber ?? 0) + 1,
      characters: validated.data.characters as Record<string, CharacterState>,
      objects: validated.data.objects as Record<string, ObjectState>,
      environment: validated.data.environment,
    };

    return { state, raw: rawContent };
  } catch (err) {
    return { state: null, raw: rawContent, error: `JSON parse failed: ${(err as Error).message}` };
  }
}

/**
 * Compute a human-readable diff between two states.
 * Shows only what changed — empty string if identical.
 */
export function computeStateDiff(
  before: Pick<SceneState, 'characters' | 'objects' | 'environment'>,
  after: Pick<SceneState, 'characters' | 'objects' | 'environment'>,
): string {
  const lines: string[] = [];

  // Character changes
  for (const [id, afterChar] of Object.entries(after.characters ?? {})) {
    const beforeChar = before.characters?.[id];

    if (!beforeChar || (!beforeChar.inFrame && afterChar.inFrame)) {
      // Character entered frame
      const parts: string[] = [];
      if (afterChar.position !== 'unknown') parts.push(`position: ${afterChar.position}`);
      if (afterChar.pose !== 'unknown') parts.push(`pose: ${afterChar.pose}`);
      if (afterChar.expression !== 'unknown') parts.push(`expression: ${afterChar.expression}`);
      lines.push(`▶ ${id}: ENTERED frame — ${parts.join(', ')}`);
      continue;
    }

    if (beforeChar.inFrame && !afterChar.inFrame) {
      lines.push(`◀ ${id}: LEFT frame`);
      continue;
    }

    // Field-by-field diff
    const fields: Array<keyof CharacterState> = [
      'position', 'pose', 'expression', 'facing', 'leftHand', 'rightHand', 'legs', 'headTilt',
    ];
    const changes: string[] = [];
    for (const field of fields) {
      const bVal = beforeChar[field];
      const aVal = afterChar[field];
      if (bVal !== aVal && aVal !== 'unknown') {
        changes.push(`${field}: ${bVal} → ${aVal}`);
      }
    }
    if (changes.length > 0) {
      lines.push(`△ ${id}: ${changes.join(', ')}`);
    }
  }

  // Object changes
  for (const [id, afterObj] of Object.entries(after.objects ?? {})) {
    const beforeObj = before.objects?.[id];
    if (!beforeObj) {
      lines.push(`+ ${id}: ${afterObj.state} (${afterObj.position})`);
    } else if (beforeObj.state !== afterObj.state || beforeObj.position !== afterObj.position) {
      const parts: string[] = [];
      if (beforeObj.state !== afterObj.state) parts.push(`state: ${beforeObj.state} → ${afterObj.state}`);
      if (beforeObj.position !== afterObj.position) parts.push(`position: ${beforeObj.position} → ${afterObj.position}`);
      lines.push(`△ ${id}: ${parts.join(', ')}`);
    }
  }

  // Environment changes
  if (before.environment?.lighting !== after.environment?.lighting) {
    lines.push(`☀ lighting: ${before.environment?.lighting ?? 'default'} → ${after.environment?.lighting ?? 'default'}`);
  }
  if (before.environment?.timeProgression !== after.environment?.timeProgression) {
    lines.push(`⏱ time: ${before.environment?.timeProgression ?? 'start'} → ${after.environment?.timeProgression ?? 'start'}`);
  }

  return lines.join('\n');
}
