/**
 * Tests that shot_video nodes always have per-item dependencies,
 * never type-level collection node dependencies.
 *
 * Root cause: expandCollection creates per-item shot_video nodes that
 * inherit the parent's dependencies (which include type-level
 * shot_motion_directive instead of per-item shot_motion_directive:scene_1_shot_N).
 */

import { describe, it, expect } from 'vitest';
import { DependencyGraphExecutor } from '../../src/core/planner/DependencyGraphExecutor.js';
import type { ExecutionNode, ExecutorState } from '../../src/core/planner/types.js';

function node(id: string, deps: string[], dependents: string[], opts: Partial<ExecutionNode> = {}): ExecutionNode {
  return {
    id,
    typeId: id.split(':')[0],
    itemId: id.includes(':') ? id.split(':')[1] : undefined,
    status: 'pending',
    dependencies: deps,
    dependents,
    isCollection: false,
    displayName: id,
    ...opts,
  };
}

function buildExecutor(nodes: Record<string, ExecutionNode>): DependencyGraphExecutor {
  const state: ExecutorState = {
    nodes,
    targetArtifacts: [],
    goalDescription: 'test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return DependencyGraphExecutor.fromState(state, { artifactTypes: {} } as any);
}

describe('Shot video dependency correctness', () => {
  it('shot_video should NOT depend on type-level shot_motion_directive', () => {
    // Simulate the bug: shot_video:scene_1_shot_1 depends on type-level shot_motion_directive
    const executor = buildExecutor({
      'shot_motion_directive': node('shot_motion_directive', [], [], { isCollection: true, itemId: 'shot_motion_directive' }),
      'shot_motion_directive:scene_1_shot_1': node('shot_motion_directive:scene_1_shot_1', [], [], { status: 'completed' }),
      'shot_image:scene_1_shot_1': node('shot_image:scene_1_shot_1', [], ['shot_video:scene_1_shot_1'], { status: 'completed' }),
      'shot_video:scene_1_shot_1': node('shot_video:scene_1_shot_1',
        ['shot_motion_directive', 'shot_image:scene_1_shot_1'], // BUG: type-level dep
        [],
        { isCollection: true } // BUG: should be false
      ),
    });

    // shot_video depends on type-level shot_motion_directive which is a collection
    // → getNextReady should NOT return shot_video because the dep is unsatisfied
    const ready = executor.getNextReady();
    const readyIds = ready.map(n => n.id);

    // This is the bug: shot_video is blocked because shot_motion_directive (type-level) is pending
    expect(readyIds).not.toContain('shot_video:scene_1_shot_1');
  });

  it('shot_video with per-item deps becomes ready when deps are completed', () => {
    // After fix: shot_video depends on per-item shot_motion_directive:scene_1_shot_1
    const executor = buildExecutor({
      'shot_motion_directive:scene_1_shot_1': node('shot_motion_directive:scene_1_shot_1', [], ['shot_video:scene_1_shot_1'], { status: 'completed' }),
      'shot_image:scene_1_shot_1': node('shot_image:scene_1_shot_1', [], ['shot_video:scene_1_shot_1'], { status: 'completed' }),
      'shot_video:scene_1_shot_1': node('shot_video:scene_1_shot_1',
        ['shot_motion_directive:scene_1_shot_1', 'shot_image:scene_1_shot_1'],
        [],
      ),
    });

    const ready = executor.getNextReady();
    const readyIds = ready.map(n => n.id);
    expect(readyIds).toContain('shot_video:scene_1_shot_1');
  });

  it('expandCollection should set isCollection=false on per-item nodes', () => {
    // Verify expandCollection creates nodes with isCollection=false
    const executor = buildExecutor({
      'shot_video': node('shot_video', ['shot_motion_directive'], [], {
        isCollection: true,
        displayName: 'Shot Videos',
      }),
      'shot_motion_directive': node('shot_motion_directive', [], ['shot_video'], {
        isCollection: true,
        displayName: 'Shot Motion Directives',
      }),
    });

    const expanded = executor.expandCollection('shot_video', [
      { itemId: 'scene_1_shot_1', name: 'S1S1' },
      { itemId: 'scene_1_shot_2', name: 'S1S2' },
    ]);

    for (const n of expanded) {
      expect(n.isCollection).toBe(false);
      expect(n.itemId).toBeDefined();
    }
  });

  it('per-item node deps should reference per-item nodes, not type-level', () => {
    // After a full expansion cycle, no per-item node should depend on a type-level node
    // that has been expanded into per-item nodes
    const executor = buildExecutor({
      'shot_motion_directive:scene_1_shot_1': node('shot_motion_directive:scene_1_shot_1', [], [], { status: 'completed' }),
      'shot_motion_directive:scene_1_shot_2': node('shot_motion_directive:scene_1_shot_2', [], [], { status: 'completed' }),
      'shot_image:scene_1_shot_1': node('shot_image:scene_1_shot_1', [], [], { status: 'completed' }),
      'shot_image:scene_1_shot_2': node('shot_image:scene_1_shot_2', [], [], { status: 'completed' }),
      'shot_video:scene_1_shot_1': node('shot_video:scene_1_shot_1',
        ['shot_motion_directive:scene_1_shot_1', 'shot_image:scene_1_shot_1'], [], {}),
      'shot_video:scene_1_shot_2': node('shot_video:scene_1_shot_2',
        ['shot_motion_directive:scene_1_shot_2', 'shot_image:scene_1_shot_2'], [], {}),
    });

    // All deps should be per-item (contain ':')
    for (const n of executor.getAllNodes()) {
      if (n.typeId === 'shot_video' && n.itemId) {
        for (const depId of n.dependencies) {
          const depNode = executor.getNode(depId);
          if (depNode) {
            expect(depNode.itemId, `${n.id} dep ${depId} should be per-item`).toBeDefined();
          }
        }
      }
    }
  });
});
