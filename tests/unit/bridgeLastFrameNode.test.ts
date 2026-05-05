/**
 * TDD for the Phase 1 bridge handler.
 *
 * Pattern B split the dep graph so a `shot_image_last_frame:X` node
 * sits between `shot_image:X` and `shot_video:X`. But until the bigger
 * Phase 2 refactor extracts last-frame generation out of
 * `executeShotImage`, the new node has nothing to actually DO — both
 * frames are still produced by the existing atomic shot_image step
 * and live on `shot_image:X.outputPaths`.
 *
 * The bridge handler keeps the pipeline working in the meantime: when
 * `shot_image_last_frame:X` becomes ready, it copies the last-frame
 * artifact from the upstream `shot_image:X` over to its own
 * outputPaths so downstream consumers (shot_video) can read it from
 * the canonical source.
 *
 * Cases:
 *   - first_frame node has last_frame on disk → copy it across, ready to mark completed
 *   - first_frame node has NO last_frame (single-frame shot) → still mark completed,
 *     just with no last_frame output
 *   - first_frame node missing entirely (shouldn't happen but defensive) → fail
 */

import { describe, it, expect } from 'vitest';
import type { ExecutionNode } from '../../src/core/planner/types.js';
import {
  bridgeLastFrameFromShotImage,
  type BridgeLastFrameExecutorLike,
} from '../../src/core/planner/bridgeLastFrameNode.js';

function makeNode(over: Partial<ExecutionNode> & Pick<ExecutionNode, 'id' | 'typeId'>): ExecutionNode {
  return {
    status: 'pending',
    displayName: over.id,
    dependencies: [],
    dependents: [],
    isCollection: false,
    ...over,
  } as ExecutionNode;
}

function buildExecutor(seedNodes: ExecutionNode[]): BridgeLastFrameExecutorLike {
  const map = new Map<string, ExecutionNode>();
  for (const n of seedNodes) map.set(n.id, n);
  return {
    getNode: (id) => map.get(id),
  };
}

describe('bridgeLastFrameFromShotImage (Phase 1 stub handler)', () => {
  it('copies last_frame from shot_image:X.outputPaths into the last_frame node', () => {
    const lastFrame = makeNode({
      id: 'shot_image_last_frame:scene_1_shot_1',
      typeId: 'shot_image_last_frame',
      itemId: 'scene_1_shot_1',
      dependencies: ['shot_image:scene_1_shot_1'],
    });
    const exec = buildExecutor([
      makeNode({
        id: 'shot_image:scene_1_shot_1',
        typeId: 'shot_image',
        itemId: 'scene_1_shot_1',
        status: 'completed',
        outputPaths: {
          first_frame: 'assets/images/s1shot1_first.png',
          last_frame: 'assets/images/s1shot1_last.png',
        },
      }),
      lastFrame,
    ]);

    const result = bridgeLastFrameFromShotImage(exec, lastFrame);

    expect(result.action).toBe('complete');
    expect(lastFrame.outputPaths?.['last_frame']).toBe('assets/images/s1shot1_last.png');
    expect(lastFrame.outputPath).toBe('assets/images/s1shot1_last.png');
  });

  it('falls back to outputPath when shot_image used the legacy single-output shape', () => {
    const lastFrame = makeNode({
      id: 'shot_image_last_frame:scene_1_shot_1',
      typeId: 'shot_image_last_frame',
      itemId: 'scene_1_shot_1',
    });
    const exec = buildExecutor([
      makeNode({
        id: 'shot_image:scene_1_shot_1',
        typeId: 'shot_image',
        itemId: 'scene_1_shot_1',
        status: 'completed',
        outputPath: 'assets/images/s1shot1_legacy.png',
      }),
      lastFrame,
    ]);

    const result = bridgeLastFrameFromShotImage(exec, lastFrame);

    // Legacy single-output projects only have first_frame on disk; no
    // last_frame artifact existed. Mark completed with no last_frame —
    // shot_video can still run with first_frame alone in i2v mode.
    expect(result.action).toBe('complete');
    expect(lastFrame.outputPaths?.['last_frame']).toBeUndefined();
  });

  it('marks completed (no last_frame copy) when the shot has no last_frame at all', () => {
    // Single-frame shot: planner generated only first_frame.
    const lastFrame = makeNode({
      id: 'shot_image_last_frame:scene_1_shot_1',
      typeId: 'shot_image_last_frame',
      itemId: 'scene_1_shot_1',
    });
    const exec = buildExecutor([
      makeNode({
        id: 'shot_image:scene_1_shot_1',
        typeId: 'shot_image',
        itemId: 'scene_1_shot_1',
        status: 'completed',
        outputPaths: {
          first_frame: 'assets/images/s1shot1_first.png',
        },
      }),
      lastFrame,
    ]);

    const result = bridgeLastFrameFromShotImage(exec, lastFrame);

    expect(result.action).toBe('complete');
    expect(lastFrame.outputPaths?.['last_frame']).toBeUndefined();
  });

  it('returns fail when the upstream shot_image node is missing', () => {
    // Shouldn't happen (the dep ensures it exists) but defensive.
    const lastFrame = makeNode({
      id: 'shot_image_last_frame:scene_1_shot_1',
      typeId: 'shot_image_last_frame',
      itemId: 'scene_1_shot_1',
    });
    const exec = buildExecutor([lastFrame]);

    const result = bridgeLastFrameFromShotImage(exec, lastFrame);

    expect(result.action).toBe('fail');
    expect(result.error).toMatch(/shot_image:.*not found/);
  });

  it('does not overwrite first_frame on the last_frame node', () => {
    // Defensive: even if someone has been writing to outputPaths.first_frame
    // on the last_frame node, the bridge must NOT clobber it (we only own
    // last_frame).
    const lastFrame = makeNode({
      id: 'shot_image_last_frame:scene_1_shot_1',
      typeId: 'shot_image_last_frame',
      itemId: 'scene_1_shot_1',
      outputPaths: { first_frame: 'should-not-be-touched.png' },
    });
    const exec = buildExecutor([
      makeNode({
        id: 'shot_image:scene_1_shot_1',
        typeId: 'shot_image',
        itemId: 'scene_1_shot_1',
        status: 'completed',
        outputPaths: {
          first_frame: 'assets/images/s1shot1_first.png',
          last_frame: 'assets/images/s1shot1_last.png',
        },
      }),
      lastFrame,
    ]);

    bridgeLastFrameFromShotImage(exec, lastFrame);

    expect(lastFrame.outputPaths?.['first_frame']).toBe('should-not-be-touched.png');
    expect(lastFrame.outputPaths?.['last_frame']).toBe('assets/images/s1shot1_last.png');
  });
});
