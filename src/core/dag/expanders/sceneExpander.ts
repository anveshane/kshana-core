/**
 * Scene Expander.
 *
 * Reads the approved scenes and spawns per-scene pipelines:
 * shot breakdown → approve shots → per-shot expansion.
 */

import type { NodeResult, NodeContext, DAGNodeDefinition } from '../types.js';
import { slugify, type ExtractedEntities } from './entityExpander.js';

// =============================================================================
// SCENE EXPANDER
// =============================================================================

/**
 * Expand scenes into per-scene shot pipelines.
 * Called after scenes are approved.
 */
export function buildSceneNodes(_result: NodeResult, context: NodeContext): DAGNodeDefinition[] {
  const nodes: DAGNodeDefinition[] = [];

  // Get entity data to know which characters/settings exist
  const entityResult = context.getResult('extract_entities');
  const entities = (entityResult.data ?? JSON.parse(entityResult.content!)) as ExtractedEntities;

  // Get scene data from the approved scenes or the generation result
  let sceneCount: number;
  try {
    const scenesResult = context.getResult('generate_scenes');
    const scenesData = scenesResult.data as { scenes?: Array<{ number: number }> } | undefined;
    sceneCount = scenesData?.scenes?.length ?? entities.scenes.length;
  } catch {
    sceneCount = entities.scenes.length;
  }

  // Collect all character and setting image node IDs
  const allCharImgNodes = entities.characters.map(c => `char_${slugify(c.name)}_img`);
  const allSettingImgNodes = entities.settings.map(s => `setting_${slugify(s.name)}_img`);
  const allRefImageNodes = [...allCharImgNodes, ...allSettingImgNodes];

  for (let sceneNum = 1; sceneNum <= sceneCount; sceneNum++) {
    // Shot breakdown (depends on approved scenes + all reference images)
    nodes.push(
      {
        id: `scene_${sceneNum}_shot_breakdown`,
        type: 'S',
        dependsOn: ['approve_scenes', ...allRefImageNodes],
        description: `Break scene ${sceneNum} into shots`,
        metadata: { sceneNumber: sceneNum },
        handlerKey: 'shot_breakdown',
        outputFormat: 'json',
      },
      {
        id: `scene_${sceneNum}_approve_shots`,
        type: 'U',
        dependsOn: [`scene_${sceneNum}_shot_breakdown`],
        description: `Approve shot breakdown for scene ${sceneNum}`,
        handlerKey: 'shots_approve',
        metadata: { sceneNumber: sceneNum },
      },
      {
        id: `scene_${sceneNum}_split_timeline`,
        type: 'D',
        dependsOn: [`scene_${sceneNum}_approve_shots`],
        description: `Split timeline for scene ${sceneNum}`,
        handlerKey: 'split_timeline',
        metadata: { sceneNumber: sceneNum },
      },
      {
        id: `scene_${sceneNum}_expand_shots`,
        type: 'D',
        dependsOn: [`scene_${sceneNum}_approve_shots`],
        description: `Expand shots for scene ${sceneNum}`,
        handlerKey: 'expand_shots_handler',
        expanderKey: 'shot_expander',
        metadata: { sceneNumber: sceneNum },
      },
    );
  }

  return nodes;
}
