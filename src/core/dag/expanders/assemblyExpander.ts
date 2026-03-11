/**
 * Assembly Expander.
 *
 * After all scene_N_complete nodes exist, adds the final assembly nodes:
 * validate_timeline → assemble.
 *
 * This is triggered by the DAGBuilder after shot expansion is complete,
 * not by a node's expander function directly. It's called as a post-expansion
 * hook when the executor detects all scene completion nodes exist.
 */

import type { DAGNodeDefinition } from '../types.js';
import type { DAG } from '../DAG.js';

/**
 * Build assembly nodes that depend on all scene completion gates.
 * Call this after the shot expander has run for all scenes.
 */
export function buildAssemblyNodes(dag: DAG): DAGNodeDefinition[] {
  // Find all scene completion nodes
  const sceneCompleteNodes = dag.getAllNodes()
    .filter(n => n.id.match(/^scene_\d+_complete$/))
    .map(n => n.id);

  if (sceneCompleteNodes.length === 0) {
    return [];
  }

  return [
    {
      id: 'validate_timeline',
      type: 'D',
      dependsOn: sceneCompleteNodes,
      description: 'Validate the complete timeline before assembly',
      handlerKey: 'validate_timeline',
    },
    {
      id: 'assemble',
      type: 'D',
      dependsOn: ['validate_timeline'],
      description: 'Assemble final video from timeline',
      handlerKey: 'assemble_video',
    },
  ];
}

/**
 * Check if all scene expansion is complete (all expand_shots nodes are done).
 * Used by the executor to know when to add assembly nodes.
 */
export function isAllScenesExpanded(dag: DAG): boolean {
  const expandShotNodes = dag.getAllNodes()
    .filter(n => n.id.match(/^scene_\d+_expand_shots$/));

  if (expandShotNodes.length === 0) return false;

  return expandShotNodes.every(n => n.status === 'completed');
}
