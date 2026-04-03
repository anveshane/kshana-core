/**
 * Cross-shot chaining utilities.
 *
 * When the LLM chooses `edit_previous_shot` as generationMode for a shot's
 * first frame, the executor uses the previous shot's last frame as the base
 * image for editing, maintaining visual continuity between consecutive shots.
 */

import type { ExecutionNode } from './types.js';

/**
 * Given a shot itemId like "scene_1_shot_3", return the previous shot's
 * itemId ("scene_1_shot_2"). Returns null for the first shot in a scene.
 */
export function getPreviousShotId(itemId: string): string | null {
  const match = itemId.match(/^(scene_\d+_shot_)(\d+)$/);
  if (!match) return null;

  const shotNum = parseInt(match[2]!, 10);
  if (shotNum <= 1) return null;

  return `${match[1]}${shotNum - 1}`;
}

/**
 * Get the last frame image path from a completed shot_image node.
 * Prefers outputPaths.last_frame, falls back to outputPath (single frame).
 * Returns null if the node isn't completed or has no output.
 */
export function getLastFramePath(node: ExecutionNode): string | null {
  if (node.status !== 'completed') return null;

  // Multi-frame: prefer last_frame
  if (node.outputPaths?.['last_frame']) {
    return node.outputPaths['last_frame'];
  }

  // Single-frame fallback
  if (node.outputPath) {
    return node.outputPath;
  }

  return null;
}
