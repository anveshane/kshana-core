/**
 * Tests for `isNodeGateSatisfied` — the single-node sister of
 * `isStageGateSatisfied`. Used by `pnpm run-to <project> <node-id>`
 * to pause the executor right after a specific node terminates,
 * without waiting for the rest of its stage.
 *
 * Drives the per-shot interactive flow for the pi agent:
 *   run-to shot_image:scene_1_shot_1   # generate just this image
 *   review / edit
 *   run-to shot_video:scene_1_shot_1   # then just this video
 *   approve, move to shot 2
 *
 * Pure predicate — no LLM, no filesystem. Same shape as
 * isStageGateSatisfied so the executor can call both side-by-side.
 */

import { describe, it, expect } from 'vitest';
import { isNodeGateSatisfied, type GateNode } from '../../src/core/planner/stages.js';

const TERMINAL_STATUSES = ['completed', 'skipped', 'failed'] as const;

function nodes(spec: Record<string, GateNode['status']>): GateNode[] {
  return Object.entries(spec).map(([id, status]) => ({ typeId: id.split(':')[0]!, status, id }));
}

describe('isNodeGateSatisfied', () => {
  it('returns false when the gate is not set', () => {
    const ns = nodes({ 'shot_image:scene_1_shot_1': 'completed' });
    expect(isNodeGateSatisfied(ns, null, false)).toBe(false);
  });

  it('returns false when the target node is not yet terminal', () => {
    const ns = nodes({ 'shot_image:scene_1_shot_1': 'in_progress' });
    expect(isNodeGateSatisfied(ns, 'shot_image:scene_1_shot_1', false)).toBe(false);
  });

  it('returns false when the target node is still pending', () => {
    const ns = nodes({ 'shot_image:scene_1_shot_1': 'pending' });
    expect(isNodeGateSatisfied(ns, 'shot_image:scene_1_shot_1', false)).toBe(false);
  });

  it.each(TERMINAL_STATUSES)('returns true when the target is %s (any terminal status)', (status) => {
    const ns = nodes({ 'shot_image:scene_1_shot_1': status });
    expect(isNodeGateSatisfied(ns, 'shot_image:scene_1_shot_1', false)).toBe(true);
  });

  it('does NOT fire when other nodes have terminated but the target is still in progress', () => {
    const ns = nodes({
      'shot_image_prompt:scene_1_shot_1': 'completed',
      'shot_image:scene_1_shot_1': 'in_progress',
      'shot_image:scene_1_shot_2': 'completed',
    });
    expect(isNodeGateSatisfied(ns, 'shot_image:scene_1_shot_1', false)).toBe(false);
  });

  it('returns false when the target node id is not present in the graph (pre-expansion)', () => {
    // Per-shot nodes may not exist yet if the parent collection hasn't
    // been expanded. Don't fire the gate in that case — the run-loop
    // should keep running and expand.
    const ns = nodes({ 'scene:scene_1': 'completed' });
    expect(isNodeGateSatisfied(ns, 'shot_image:scene_1_shot_1', false)).toBe(false);
  });

  it('redo isolation wins (matches isStageGateSatisfied)', () => {
    // When a redo is in flight, no gate fires — same contract as
    // isStageGateSatisfied so the per-shot gate doesn't sneak through
    // a redo's surgical re-run.
    const ns = nodes({ 'shot_image:scene_1_shot_1': 'completed' });
    expect(isNodeGateSatisfied(ns, 'shot_image:scene_1_shot_1', true)).toBe(false);
  });

  it('only the named node controls the gate (no typeId match)', () => {
    // Even if every other shot_image is completed, the gate must wait
    // for the SPECIFIC node id.
    const ns = nodes({
      'shot_image:scene_1_shot_1': 'pending',
      'shot_image:scene_1_shot_2': 'completed',
      'shot_image:scene_1_shot_3': 'completed',
    });
    expect(isNodeGateSatisfied(ns, 'shot_image:scene_1_shot_1', false)).toBe(false);
  });
});
