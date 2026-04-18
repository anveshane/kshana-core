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

/**
 * Filter out shots whose content is already included in a v2v_extend successor.
 *
 * When shot N+1 is v2v_extend, its output video already contains shot N's frames.
 * Including both in assembly would duplicate content. This function walks the
 * segment list and marks predecessors of v2v_extend shots as "subsumed."
 *
 * For chains (S1→S2:v2v→S3:v2v), only S3 survives — it contains all prior frames.
 */
export function filterSubsumedShots<T extends { segmentId: string; strategy?: string }>(
  segments: T[],
): T[] {
  if (segments.length === 0) return [];

  // Walk backwards: if segment[i] is v2v_extend, mark segment[i-1] as subsumed
  const subsumed = new Set<number>();
  for (let i = segments.length - 1; i > 0; i--) {
    if (segments[i]!.strategy === 'v2v_extend') {
      subsumed.add(i - 1);
    }
  }

  return segments.filter((_, i) => !subsumed.has(i));
}

/**
 * Purposes that need completely fresh generation (no source video to extend from).
 *
 * In practice, extending too aggressively produces visual drift and clumsy
 * transitions when a shot introduces a brand-new subject or mood. These
 * purposes signal that the composition is meant to be distinct from what
 * came before, so we start fresh:
 *
 * - set_the_world: establishing shot of a new location
 * - show_change:   dramatic visual transformation (time skip, flashback)
 * - meet_character: introduces a character — the composition is built around
 *                   the new subject, not the prior shot's tail frame
 * - set_the_mood:  mood-setting compositions benefit from a clean slate
 *                  rather than extending from the previous action
 */
const FRESH_PURPOSES = new Set([
  'set_the_world',
  'show_change',
  'meet_character',
  'set_the_mood',
]);

/**
 * Determine video generation strategy for a shot.
 *
 * - Shot 1 of ANY scene → 'flfv' (scene boundary — fresh framing)
 * - FRESH_PURPOSES      → 'flfv'
 * - Everything else     → 'v2v_extend' (continue from previous shot's video)
 */
export function getVideoStrategy(itemId: string, purpose: string): 'flfv' | 'v2v_extend' {
  // First shot of any scene → scene boundary, start fresh
  const shotMatch = itemId.match(/^scene_(\d+)_shot_(\d+)$/);
  if (shotMatch && shotMatch[2] === '1') return 'flfv';

  // Purposes that require fresh generation
  if (FRESH_PURPOSES.has(purpose)) return 'flfv';

  // Everything else: extend from previous video
  return 'v2v_extend';
}

/**
 * Find the previous shot's video output path.
 * Looks within the same scene first, then crosses to the previous scene's last shot.
 * Returns null for shot 1 of scene 1.
 */
export function getPreviousVideoPath(
  itemId: string,
  executor: { getNode: (id: string) => ExecutionNode | undefined; getAllNodes: () => ExecutionNode[] },
): string | null {
  // Try previous shot within same scene
  const prevShotId = getPreviousShotId(itemId);
  if (prevShotId) {
    const prevVideoNode = executor.getNode(`shot_video:${prevShotId}`);
    if (prevVideoNode?.status === 'completed' && prevVideoNode.outputPath) {
      return prevVideoNode.outputPath;
    }
    return null;
  }

  // First shot in scene → look at previous scene's last shot
  const sceneMatch = itemId.match(/^scene_(\d+)_shot_1$/);
  if (!sceneMatch) return null;

  const sceneNum = parseInt(sceneMatch[1]!, 10);
  if (sceneNum <= 1) return null; // Scene 1 shot 1 — no previous

  const prevSceneId = `scene_${sceneNum - 1}`;

  // Find all shot_video nodes for the previous scene, get the highest shot number
  const prevSceneVideos = executor.getAllNodes()
    .filter(n => n.typeId === 'shot_video' && n.itemId?.startsWith(`${prevSceneId}_shot_`) && n.status === 'completed')
    .sort((a, b) => {
      const aNum = parseInt(a.itemId?.match(/shot_(\d+)/)?.[1] ?? '0', 10);
      const bNum = parseInt(b.itemId?.match(/shot_(\d+)/)?.[1] ?? '0', 10);
      return bNum - aNum; // Descending — highest first
    });

  if (prevSceneVideos.length > 0) {
    const lastVideo = prevSceneVideos[0]!;
    const videoNode = executor.getNode(lastVideo.id);
    if (videoNode?.outputPath) return videoNode.outputPath;
  }

  return null;
}
