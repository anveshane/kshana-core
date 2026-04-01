/**
 * Tests for collection node expansion — verifies that type-level
 * collection nodes correctly expand into per-scene and per-shot nodes.
 *
 * This is critical for the post-reset flow where only type-level nodes
 * exist and need to be expanded in two stages:
 *   shot_image_prompt (type-level)
 *   → shot_image_prompt:scene_1 (per-scene)
 *   → shot_image_prompt:scene_1_shot_1 (per-shot)
 */
import { describe, it, expect } from 'vitest';
import { DependencyGraphExecutor } from '../src/core/planner/DependencyGraphExecutor.js';
import type { ExecutionNode } from '../src/core/planner/types.js';

// Minimal template for testing expansion
const minimalTemplate = {
  id: 'test',
  name: 'Test Template',
  version: '1.0',
  description: 'Test',
  artifactTypes: {
    scene_video_prompt: {
      id: 'scene_video_prompt',
      displayName: 'Scene Video Prompt',
      category: 'structure',
      isCollection: true,
      isExpensive: false,
      dependencies: [],
    },
    shot_image_prompt: {
      id: 'shot_image_prompt',
      displayName: 'Shot Image Prompt',
      category: 'structure',
      isCollection: true,
      isExpensive: false,
      dependencies: [
        { artifactTypeId: 'scene_video_prompt', required: true, usage: 'context', scope: 'matching' },
      ],
    },
    shot_motion_directive: {
      id: 'shot_motion_directive',
      displayName: 'Shot Motion Directives',
      category: 'structure',
      isCollection: true,
      isExpensive: false,
      dependencies: [
        { artifactTypeId: 'scene_video_prompt', required: true, usage: 'context', scope: 'matching' },
      ],
    },
  },
  phases: [],
  constraints: {},
  contextVariables: {},
} as any;

function createExecutor(nodes: Record<string, Partial<ExecutionNode>>): DependencyGraphExecutor {
  const fullNodes: Record<string, ExecutionNode> = {};
  for (const [id, partial] of Object.entries(nodes)) {
    fullNodes[id] = {
      id,
      typeId: partial.typeId ?? id.split(':')[0]!,
      status: partial.status ?? 'pending',
      displayName: partial.displayName ?? id,
      isExpensive: false,
      isCollection: partial.isCollection ?? false,
      dependencies: partial.dependencies ?? [],
      dependents: partial.dependents ?? [],
      itemId: partial.itemId,
      ...partial,
    } as ExecutionNode;
  }
  return DependencyGraphExecutor.fromState(
    {
      nodes: fullNodes,
      targetArtifacts: [],
      goalDescription: 'test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    minimalTemplate,
  );
}

describe('Collection Expansion', () => {
  it('expands type-level collection into per-scene nodes', () => {
    const executor = createExecutor({
      'shot_image_prompt': {
        typeId: 'shot_image_prompt',
        isCollection: true,
        status: 'pending',
        dependencies: ['scene_video_prompt'],
        dependents: [],
      },
      'scene_video_prompt': {
        typeId: 'scene_video_prompt',
        isCollection: true,
        status: 'completed',
        dependencies: [],
        dependents: ['shot_image_prompt'],
      },
    });

    // Expand type-level into per-scene
    const expanded = executor.expandCollection('shot_image_prompt', [
      { itemId: 'scene_1', name: 'Scene 1' },
      { itemId: 'scene_2', name: 'Scene 2' },
    ]);

    expect(expanded).toHaveLength(2);
    expect(executor.getNode('shot_image_prompt:scene_1')).toBeDefined();
    expect(executor.getNode('shot_image_prompt:scene_2')).toBeDefined();
    expect(executor.getNode('shot_image_prompt:scene_1')!.status).toBe('pending');
    expect(executor.getNode('shot_image_prompt:scene_1')!.isCollection).toBe(false);
  });

  it('expands per-scene node into per-shot nodes', () => {
    const executor = createExecutor({
      'shot_image_prompt:scene_1': {
        typeId: 'shot_image_prompt',
        itemId: 'scene_1',
        isCollection: true, // mark as collection so it can be expanded
        status: 'pending',
        dependencies: [],
        dependents: [],
      },
    });

    const expanded = executor.expandCollection('shot_image_prompt:scene_1', [
      { itemId: 'scene_1_shot_1', name: 'Shot 1: wide' },
      { itemId: 'scene_1_shot_2', name: 'Shot 2: tracking' },
      { itemId: 'scene_1_shot_3', name: 'Shot 3: close_up' },
    ]);

    expect(expanded).toHaveLength(3);
    expect(executor.getNode('shot_image_prompt:scene_1_shot_1')).toBeDefined();
    expect(executor.getNode('shot_image_prompt:scene_1_shot_2')).toBeDefined();
    expect(executor.getNode('shot_image_prompt:scene_1_shot_3')).toBeDefined();
  });

  it('two-level expansion: type-level → per-scene → per-shot', () => {
    const executor = createExecutor({
      'shot_image_prompt': {
        typeId: 'shot_image_prompt',
        isCollection: true,
        status: 'pending',
        dependencies: ['scene_video_prompt'],
        dependents: [],
      },
      'scene_video_prompt': {
        typeId: 'scene_video_prompt',
        isCollection: true,
        status: 'completed',
        dependencies: [],
        dependents: ['shot_image_prompt'],
      },
    });

    // Step 1: Expand type-level into per-scene
    executor.expandCollection('shot_image_prompt', [
      { itemId: 'scene_1', name: 'Scene 1' },
    ]);

    const perScene = executor.getNode('shot_image_prompt:scene_1');
    expect(perScene).toBeDefined();

    // Mark per-scene as collection so it can expand further
    // (in real code, the executor does this)
    (perScene as any).isCollection = true;

    // Step 2: Expand per-scene into per-shot
    executor.expandCollection('shot_image_prompt:scene_1', [
      { itemId: 'scene_1_shot_1', name: 'Shot 1' },
      { itemId: 'scene_1_shot_2', name: 'Shot 2' },
    ]);

    expect(executor.getNode('shot_image_prompt:scene_1_shot_1')).toBeDefined();
    expect(executor.getNode('shot_image_prompt:scene_1_shot_2')).toBeDefined();

    // Type-level node may be replaced by expansion — per-item nodes are what matter
    // (expandCollection may or may not keep the parent depending on implementation)
  });

  it('per-shot nodes inherit dependencies from per-scene node', () => {
    const executor = createExecutor({
      'shot_image_prompt:scene_1': {
        typeId: 'shot_image_prompt',
        itemId: 'scene_1',
        isCollection: true,
        status: 'pending',
        dependencies: ['scene_video_prompt:scene_1'],
        dependents: [],
      },
      'scene_video_prompt:scene_1': {
        typeId: 'scene_video_prompt',
        itemId: 'scene_1',
        status: 'completed',
        dependencies: [],
        dependents: ['shot_image_prompt:scene_1'],
      },
    });

    executor.expandCollection('shot_image_prompt:scene_1', [
      { itemId: 'scene_1_shot_1', name: 'Shot 1' },
    ]);

    const shotNode = executor.getNode('shot_image_prompt:scene_1_shot_1');
    expect(shotNode).toBeDefined();
    expect(shotNode!.dependencies).toContain('scene_video_prompt:scene_1');
  });
});
