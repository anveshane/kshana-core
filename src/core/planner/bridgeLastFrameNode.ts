/**
 * Phase 1 stub handler for the new `shot_image_last_frame:X` node
 * introduced by addShotImageNodes.ts (Pattern B graph split).
 *
 * Today, last-frame generation still happens inside the atomic
 * `executeShotImage` step — its product lands on
 * `shot_image:X.outputPaths.last_frame`. The bridge handler simply
 * mirrors that path onto the new last_frame node so downstream
 * consumers (`shot_video:X`) can read it from the canonical source
 * (`shot_image_last_frame:X`) once Phase 2 lands.
 *
 * The handler is a pure mutation: it inspects the upstream
 * `shot_image:X` node and copies the relevant output(s) onto the
 * `shot_image_last_frame:X` node. The caller decides whether to
 * mark the node `completed` or `failed` based on the returned
 * action.
 *
 * Phase 2 will replace this stub with the real edit_first_frame call
 * that produces last_frame INDEPENDENTLY of first_frame, so a cloud
 * failure on last_frame no longer pollutes the first-frame node.
 * Until then, the failure-isolation benefit is dormant — but the
 * graph topology is correct and downstream code is wired the right
 * way around.
 */

import type { ExecutionNode } from './types.js';

export interface BridgeLastFrameExecutorLike {
  getNode(id: string): ExecutionNode | undefined;
}

export type BridgeAction =
  | { action: 'complete' }
  | { action: 'fail'; error: string };

/**
 * Mirror the upstream shot_image's last_frame artifact onto the
 * passed-in last_frame node. Mutates `lastFrameNode` in place.
 *
 * Returns:
 *   { action: 'complete' } — caller should `markCompleted(node.id, ...)`
 *   { action: 'fail', error } — caller should `markFailed(node.id, error)`
 */
export function bridgeLastFrameFromShotImage(
  executor: BridgeLastFrameExecutorLike,
  lastFrameNode: ExecutionNode,
): BridgeAction {
  if (!lastFrameNode.itemId) {
    return { action: 'fail', error: 'shot_image_last_frame node has no itemId' };
  }

  const sourceId = `shot_image:${lastFrameNode.itemId}`;
  const source = executor.getNode(sourceId);
  if (!source) {
    return { action: 'fail', error: `${sourceId} not found upstream` };
  }

  // Pull last_frame from outputPaths (multi-frame format) if present.
  // Legacy projects may have only outputPath (single-output format) —
  // those carry first_frame; no last_frame artifact existed. We still
  // mark `complete` because shot_video can run i2v with first_frame
  // alone; the missing last_frame just shrinks the available video
  // strategies.
  const sourceLast = source.outputPaths?.['last_frame'];
  if (sourceLast) {
    if (!lastFrameNode.outputPaths) lastFrameNode.outputPaths = {};
    lastFrameNode.outputPaths['last_frame'] = sourceLast;
    lastFrameNode.outputPath = sourceLast;
  }

  return { action: 'complete' };
}
