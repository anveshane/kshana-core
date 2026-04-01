/**
 * Executor integration tests.
 *
 * Tests the interaction between getNextReady(), expandPendingCollections(),
 * and the collection expansion flow. These tests catch integration-level
 * bugs that unit tests miss — specifically the post-reset state where
 * type-level collections must be expanded before execution.
 */
import { describe, it, expect } from 'vitest';
import { DependencyGraphExecutor } from '../src/core/planner/DependencyGraphExecutor.js';
import type { ExecutionNode, ExecutorState } from '../src/core/planner/types.js';

// Minimal template matching the narrative pipeline structure
const narrativeTemplate = {
  id: 'narrative',
  name: 'Narrative Video',
  version: '1.0',
  description: 'Test',
  artifactTypes: {
    plot: {
      id: 'plot', displayName: 'Plot', category: 'concept',
      isCollection: false, isExpensive: false, dependencies: [],
    },
    story: {
      id: 'story', displayName: 'Story', category: 'structure',
      isCollection: false, isExpensive: false,
      dependencies: [{ artifactTypeId: 'plot', required: true, usage: 'context' }],
    },
    character: {
      id: 'character', displayName: 'Characters', category: 'entity',
      isCollection: true, isExpensive: false,
      dependencies: [{ artifactTypeId: 'story', required: true, usage: 'context' }],
    },
    setting: {
      id: 'setting', displayName: 'Settings', category: 'environment',
      isCollection: true, isExpensive: false,
      dependencies: [{ artifactTypeId: 'story', required: true, usage: 'context' }],
    },
    scene: {
      id: 'scene', displayName: 'Scenes', category: 'segment',
      isCollection: true, isExpensive: false,
      dependencies: [
        { artifactTypeId: 'story', required: true, usage: 'context' },
        { artifactTypeId: 'character', required: true, usage: 'context', scope: 'all' },
        { artifactTypeId: 'setting', required: true, usage: 'context', scope: 'all' },
      ],
    },
    world_style: {
      id: 'world_style', displayName: 'World Style', category: 'concept',
      isCollection: false, isExpensive: false,
      dependencies: [
        { artifactTypeId: 'story', required: true, usage: 'context' },
        { artifactTypeId: 'scene', required: true, usage: 'context', scope: 'all' },
      ],
    },
    scene_video_prompt: {
      id: 'scene_video_prompt', displayName: 'Scene Video Prompt', category: 'structure',
      isCollection: true, isExpensive: false,
      dependencies: [
        { artifactTypeId: 'scene', required: true, usage: 'context', scope: 'matching' },
        { artifactTypeId: 'world_style', required: true, usage: 'context', scope: 'matching' },
      ],
    },
    shot_image_prompt: {
      id: 'shot_image_prompt', displayName: 'Shot Image Prompt', category: 'structure',
      isCollection: true, isExpensive: false,
      dependencies: [
        { artifactTypeId: 'scene_video_prompt', required: true, usage: 'context', scope: 'matching' },
      ],
    },
    shot_motion_directive: {
      id: 'shot_motion_directive', displayName: 'Shot Motion Directive', category: 'structure',
      isCollection: true, isExpensive: false,
      dependencies: [
        { artifactTypeId: 'scene_video_prompt', required: true, usage: 'context', scope: 'matching' },
      ],
    },
    final_video: {
      id: 'final_video', displayName: 'Final Video', category: 'final',
      isCollection: false, isExpensive: true,
      dependencies: [{ artifactTypeId: 'shot_image_prompt', required: true, usage: 'context', scope: 'all' }],
    },
  },
  phases: [],
  constraints: {},
  contextVariables: {},
} as any;

function makeState(nodes: Record<string, Partial<ExecutionNode>>): ExecutorState {
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
  return {
    nodes: fullNodes,
    targetArtifacts: ['final_video'],
    goalDescription: 'test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as ExecutorState;
}

function createExecutor(nodes: Record<string, Partial<ExecutionNode>>): DependencyGraphExecutor {
  return DependencyGraphExecutor.fromState(makeState(nodes), narrativeTemplate);
}

// ──────────────────────────────────────────────────────────────────────────────

describe('getNextReady — type-level collection blocking', () => {
  it('blocks type-level collection nodes from being ready', () => {
    const executor = createExecutor({
      'scene_video_prompt': {
        typeId: 'scene_video_prompt',
        isCollection: true,
        status: 'pending',
        dependencies: ['scene', 'world_style'],
        dependents: [],
      },
      'scene': {
        typeId: 'scene',
        isCollection: true,
        status: 'completed',
        dependencies: [],
        dependents: ['scene_video_prompt'],
      },
      'world_style': {
        typeId: 'world_style',
        status: 'completed',
        dependencies: [],
        dependents: ['scene_video_prompt'],
      },
    });

    const ready = executor.getNextReady();
    const readyIds = ready.map(n => n.id);

    // Type-level collection should NOT be returned as ready
    expect(readyIds).not.toContain('scene_video_prompt');
  });

  it('allows per-item collection nodes to be ready', () => {
    const executor = createExecutor({
      'scene_video_prompt:scene_1': {
        typeId: 'scene_video_prompt',
        itemId: 'scene_1',
        isCollection: false,
        status: 'pending',
        dependencies: ['scene:scene_1', 'world_style'],
        dependents: [],
      },
      'scene:scene_1': {
        typeId: 'scene',
        itemId: 'scene_1',
        status: 'completed',
        dependencies: [],
        dependents: ['scene_video_prompt:scene_1'],
      },
      'world_style': {
        typeId: 'world_style',
        status: 'completed',
        dependencies: [],
        dependents: ['scene_video_prompt:scene_1'],
      },
    });

    const ready = executor.getNextReady();
    const readyIds = ready.map(n => n.id);

    // Per-item node with itemId SHOULD be returned as ready
    expect(readyIds).toContain('scene_video_prompt:scene_1');
  });

  it('allows non-collection pending nodes to be ready', () => {
    const executor = createExecutor({
      'plot': {
        typeId: 'plot',
        isCollection: false,
        status: 'pending',
        dependencies: [],
        dependents: [],
      },
    });

    const ready = executor.getNextReady();
    expect(ready.map(n => n.id)).toContain('plot');
  });

  it('does not block completed type-level collections', () => {
    const executor = createExecutor({
      'story': {
        typeId: 'story',
        status: 'pending',
        dependencies: ['plot'],
        dependents: [],
      },
      'plot': {
        typeId: 'plot',
        status: 'completed',
        dependencies: [],
        dependents: ['story'],
      },
      'character': {
        typeId: 'character',
        isCollection: true,
        status: 'completed', // Already completed — should not affect story readiness
        dependencies: ['story'],
        dependents: [],
      },
    });

    const ready = executor.getNextReady();
    // story should be ready (plot is completed)
    expect(ready.map(n => n.id)).toContain('story');
  });
});

describe('Post-reset expansion flow', () => {
  it('scene_video_prompt with per-scene upstream nodes expands correctly', () => {
    const executor = createExecutor({
      'scene_video_prompt': {
        typeId: 'scene_video_prompt',
        isCollection: true,
        status: 'pending',
        dependencies: ['scene', 'world_style'],
        dependents: ['shot_image_prompt'],
      },
      'scene': {
        typeId: 'scene',
        isCollection: true,
        status: 'completed',
        dependencies: [],
        dependents: ['scene_video_prompt'],
      },
      'scene:scene_1': {
        typeId: 'scene',
        itemId: 'scene_1',
        status: 'completed',
        dependencies: [],
        dependents: [],
      },
      'scene:scene_2': {
        typeId: 'scene',
        itemId: 'scene_2',
        status: 'completed',
        dependencies: [],
        dependents: [],
      },
      'world_style': {
        typeId: 'world_style',
        status: 'completed',
        dependencies: [],
        dependents: ['scene_video_prompt'],
      },
      'shot_image_prompt': {
        typeId: 'shot_image_prompt',
        isCollection: true,
        status: 'pending',
        dependencies: ['scene_video_prompt'],
        dependents: [],
      },
    });

    // Expand scene_video_prompt from per-scene nodes
    executor.expandCollection('scene_video_prompt', [
      { itemId: 'scene_1', name: 'Scene 1' },
      { itemId: 'scene_2', name: 'Scene 2' },
    ]);

    // Per-scene SVP nodes should exist
    expect(executor.getNode('scene_video_prompt:scene_1')).toBeDefined();
    expect(executor.getNode('scene_video_prompt:scene_2')).toBeDefined();

    // Per-scene nodes should be ready (scene deps completed)
    const ready = executor.getNextReady();
    const readyIds = ready.map(n => n.id);
    expect(readyIds).toContain('scene_video_prompt:scene_1');
    expect(readyIds).toContain('scene_video_prompt:scene_2');

    // Type-level shot_image_prompt should NOT be ready (still needs expansion)
    expect(readyIds).not.toContain('shot_image_prompt');
  });

  it('cascading expansion: SVP → shot_image_prompt per scene', () => {
    const executor = createExecutor({
      'scene_video_prompt:scene_1': {
        typeId: 'scene_video_prompt',
        itemId: 'scene_1',
        status: 'completed',
        dependencies: [],
        dependents: ['shot_image_prompt'],
      },
      'shot_image_prompt': {
        typeId: 'shot_image_prompt',
        isCollection: true,
        status: 'pending',
        dependencies: ['scene_video_prompt'],
        dependents: [],
      },
    });

    // First expand: type-level → per-scene
    executor.expandCollection('shot_image_prompt', [
      { itemId: 'scene_1', name: 'Scene 1' },
    ]);

    const perScene = executor.getNode('shot_image_prompt:scene_1');
    expect(perScene).toBeDefined();

    // Mark as collection for second expansion
    (perScene as any).isCollection = true;

    // Second expand: per-scene → per-shot
    executor.expandCollection('shot_image_prompt:scene_1', [
      { itemId: 'scene_1_shot_1', name: 'Shot 1' },
      { itemId: 'scene_1_shot_2', name: 'Shot 2' },
      { itemId: 'scene_1_shot_3', name: 'Shot 3' },
    ]);

    expect(executor.getNode('shot_image_prompt:scene_1_shot_1')).toBeDefined();
    expect(executor.getNode('shot_image_prompt:scene_1_shot_2')).toBeDefined();
    expect(executor.getNode('shot_image_prompt:scene_1_shot_3')).toBeDefined();

    // Per-shot nodes exist and have correct type
    const shotNode = executor.getNode('shot_image_prompt:scene_1_shot_1')!;
    expect(shotNode.typeId).toBe('shot_image_prompt');
    expect(shotNode.itemId).toBe('scene_1_shot_1');
    expect(shotNode.status).toBe('pending');
  });
});

describe('Monolithic call prevention', () => {
  it('type-level scene_video_prompt never appears in ready list even with all deps complete', () => {
    const executor = createExecutor({
      'plot': { typeId: 'plot', status: 'completed', dependencies: [], dependents: ['story'] },
      'story': { typeId: 'story', status: 'completed', dependencies: ['plot'], dependents: ['scene', 'character', 'setting'] },
      'character': { typeId: 'character', isCollection: true, status: 'completed', dependencies: ['story'], dependents: ['scene_video_prompt'] },
      'setting': { typeId: 'setting', isCollection: true, status: 'completed', dependencies: ['story'], dependents: ['scene_video_prompt'] },
      'scene': { typeId: 'scene', isCollection: true, status: 'completed', dependencies: ['story', 'character', 'setting'], dependents: ['scene_video_prompt', 'world_style'] },
      'world_style': { typeId: 'world_style', status: 'completed', dependencies: ['story', 'scene'], dependents: ['scene_video_prompt'] },
      'scene_video_prompt': {
        typeId: 'scene_video_prompt',
        isCollection: true,
        status: 'pending',
        dependencies: ['scene', 'world_style'],
        dependents: [],
      },
    });

    const ready = executor.getNextReady();

    // scene_video_prompt is pending with ALL deps completed — but it's a type-level collection
    // It should NOT be ready — must be expanded into per-scene nodes first
    expect(ready.map(n => n.id)).not.toContain('scene_video_prompt');
    expect(ready).toHaveLength(0); // Nothing should be ready — all need expansion
  });

  it('per-scene scene_video_prompt IS ready when deps are complete', () => {
    const executor = createExecutor({
      'scene:scene_1': { typeId: 'scene', itemId: 'scene_1', status: 'completed', dependencies: [], dependents: ['scene_video_prompt:scene_1'] },
      'world_style': { typeId: 'world_style', status: 'completed', dependencies: [], dependents: ['scene_video_prompt:scene_1'] },
      'scene_video_prompt:scene_1': {
        typeId: 'scene_video_prompt',
        itemId: 'scene_1',
        isCollection: false,
        status: 'pending',
        dependencies: ['scene:scene_1', 'world_style'],
        dependents: [],
      },
    });

    const ready = executor.getNextReady();
    expect(ready.map(n => n.id)).toContain('scene_video_prompt:scene_1');
  });
});
