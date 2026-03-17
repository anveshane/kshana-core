/**
 * Shot Expander.
 *
 * Reads the approved shot breakdown for a scene and spawns per-shot nodes:
 * image prompt → image generation → video generation → timeline update.
 *
 * Also adds a scene completion gate and (once all scenes are known) assembly nodes.
 */

import type { NodeResult, NodeContext, DAGNodeDefinition } from '../types.js';

// =============================================================================
// SHOT DATA
// =============================================================================

export interface ShotBreakdown {
  shots: Array<{
    shotNumber: number;
    type?: string;
    prompt?: string;
    description?: string;
  }>;
}

// =============================================================================
// SHOT VALIDATION
// =============================================================================

/**
 * Validate a shot breakdown result.
 */
export function validateShotBreakdown(result: NodeResult): { valid: boolean; error?: string; data?: ShotBreakdown } {
  if (!result.content) {
    return { valid: false, error: 'No content in result' };
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(result.content);
  } catch {
    return { valid: false, error: 'Not valid JSON' };
  }

  if (!Array.isArray(data['shots'])) {
    return { valid: false, error: 'Missing shots array' };
  }

  const shots = data['shots'] as Array<Record<string, unknown>>;
  if (shots.length === 0) {
    return { valid: false, error: 'Shots array is empty' };
  }

  for (const shot of shots) {
    if (!shot['shotNumber'] && shot['shotNumber'] !== 0) {
      return { valid: false, error: 'Shot missing shotNumber' };
    }
  }

  return { valid: true, data: data as unknown as ShotBreakdown };
}

// =============================================================================
// SHOT EXPANDER
// =============================================================================

/**
 * Expand shots for a specific scene.
 * Spawns per-shot image/video pipeline + scene completion gate.
 */
export function buildShotNodes(result: NodeResult, context: NodeContext): DAGNodeDefinition[] {
  const sceneNum = context.metadata['sceneNumber'] as number;
  const nodes: DAGNodeDefinition[] = [];

  // Parse shot breakdown — prefer validated data, validate raw content as fallback
  let shots: ShotBreakdown['shots'];
  if (result.data) {
    shots = (result.data as ShotBreakdown).shots;
  } else if (result.content) {
    const validation = validateShotBreakdown(result);
    if (!validation.valid) {
      throw new Error(`buildShotNodes: shot breakdown failed validation for scene ${sceneNum} — ${validation.error}`);
    }
    shots = (validation.data as ShotBreakdown).shots;
  } else {
    // Fallback: create a single shot
    shots = [{ shotNumber: 1, type: 'wide', description: 'Full scene shot' }];
  }

  // Per-shot pipeline
  for (const shot of shots) {
    const shotNum = shot.shotNumber;
    const prefix = `scene_${sceneNum}_shot_${shotNum}`;

    nodes.push(
      {
        id: `${prefix}_img_prompt`,
        type: 'S',
        dependsOn: [`scene_${sceneNum}_approve_shots`],
        description: `Generate image prompt for scene ${sceneNum} shot ${shotNum}`,
        handlerKey: 'shot_img_prompt',
        metadata: { sceneNumber: sceneNum, shotNumber: shotNum, shotType: shot.type, shotDescription: shot.description },
      },
      {
        id: `${prefix}_img`,
        type: 'S',
        dependsOn: [`${prefix}_img_prompt`],
        description: `Generate image for scene ${sceneNum} shot ${shotNum}`,
        handlerKey: 'shot_img_generate',
        metadata: { sceneNumber: sceneNum, shotNumber: shotNum },
        errorPolicy: { maxRetries: 3, retryStrategy: 'same', retryDelayMs: 10000, onExhausted: 'ask_user' },
      },
      {
        id: `${prefix}_video`,
        type: 'S',
        dependsOn: [`${prefix}_img`],
        description: `Generate video for scene ${sceneNum} shot ${shotNum}`,
        handlerKey: 'shot_video_generate',
        metadata: { sceneNumber: sceneNum, shotNumber: shotNum },
        errorPolicy: { maxRetries: 3, retryStrategy: 'same', retryDelayMs: 15000, onExhausted: 'micro_llm' },
      },
      {
        id: `${prefix}_timeline`,
        type: 'D',
        dependsOn: [`${prefix}_video`],
        description: `Update timeline for scene ${sceneNum} shot ${shotNum}`,
        handlerKey: 'shot_timeline_update',
        metadata: { sceneNumber: sceneNum, shotNumber: shotNum },
      },
    );
  }

  // Scene-level completion gate (all shots done)
  const allShotTimelineNodes = shots.map(s => `scene_${sceneNum}_shot_${s.shotNumber}_timeline`);
  nodes.push({
    id: `scene_${sceneNum}_complete`,
    type: 'D',
    dependsOn: allShotTimelineNodes,
    description: `Scene ${sceneNum} completion gate`,
    handlerKey: 'scene_complete',
    metadata: { sceneNumber: sceneNum, shotCount: shots.length },
  });

  return nodes;
}
