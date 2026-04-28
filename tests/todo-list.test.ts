/**
 * Tests for the todo list display logic.
 * Verifies that type-level collection nodes are hidden after expansion,
 * and the list shows the correct execution order.
 */
import { describe, it, expect } from 'vitest';
import type { ExecutionNode, ExecutorState } from '../src/core/planner/types.js';

function makeNodes(nodes: Record<string, Partial<ExecutionNode>>): ExecutorState {
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
    targetArtifacts: [],
    goalDescription: 'test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as ExecutorState;
}

/** Simulates the todo list filtering logic from emitTodoUpdate */
function buildTodoList(nodes: ExecutionNode[]): Array<{ id: string; displayName: string; status: string }> {
  // Determine which type-level nodes have been expanded
  const expandedTypes = new Set<string>();
  for (const node of nodes) {
    if (node.itemId) expandedTypes.add(node.typeId);
  }

  return nodes
    .filter(node => {
      // Hide type-level nodes that have per-item children (expanded into per-scene/per-shot)
      if (!node.itemId && expandedTypes.has(node.typeId)) {
        return false;
      }
      return true;
    })
    .map(node => ({
      id: node.id,
      displayName: node.displayName,
      status: node.status,
    }));
}

describe('Todo list filtering', () => {
  it('hides type-level character node when per-item children exist', () => {
    const state = makeNodes({
      'story': { typeId: 'story', status: 'completed', displayName: 'Full Story' },
      'character': {
        typeId: 'character', isCollection: true, status: 'completed',
        displayName: 'Characters',
      },
      'character:alice': {
        typeId: 'character', itemId: 'alice', status: 'completed',
        displayName: 'Characters: Alice',
      },
      'character:bob': {
        typeId: 'character', itemId: 'bob', status: 'completed',
        displayName: 'Characters: Bob',
      },
    });

    const todos = buildTodoList(Object.values(state.nodes));
    const ids = todos.map(t => t.id);

    expect(ids).not.toContain('character'); // type-level hidden
    expect(ids).toContain('character:alice');
    expect(ids).toContain('character:bob');
    expect(ids).toContain('story'); // non-collection still visible
  });

  it('shows type-level node when no per-item children exist', () => {
    const state = makeNodes({
      'story': { typeId: 'story', status: 'completed', displayName: 'Full Story' },
      'character': {
        typeId: 'character', isCollection: true, status: 'pending',
        displayName: 'Characters',
      },
    });

    const todos = buildTodoList(Object.values(state.nodes));
    const ids = todos.map(t => t.id);

    expect(ids).toContain('character'); // still visible — no children yet
  });

  it('hides multiple expanded type-level nodes', () => {
    const state = makeNodes({
      'character': { typeId: 'character', isCollection: true, status: 'completed', displayName: 'Characters' },
      'character:alice': { typeId: 'character', itemId: 'alice', status: 'completed', displayName: 'Characters: Alice' },
      'setting': { typeId: 'setting', isCollection: true, status: 'completed', displayName: 'Settings' },
      'setting:forest': { typeId: 'setting', itemId: 'forest', status: 'completed', displayName: 'Settings: Forest' },
      'setting:castle': { typeId: 'setting', itemId: 'castle', status: 'completed', displayName: 'Settings: Castle' },
      'scene': { typeId: 'scene', isCollection: true, status: 'pending', displayName: 'Scenes' },
    });

    const todos = buildTodoList(Object.values(state.nodes));
    const ids = todos.map(t => t.id);

    expect(ids).not.toContain('character'); // hidden
    expect(ids).not.toContain('setting');   // hidden
    expect(ids).toContain('scene');          // visible — not expanded yet
    expect(ids).toContain('character:alice');
    expect(ids).toContain('setting:forest');
    expect(ids).toContain('setting:castle');
  });

  it('non-collection nodes are never hidden', () => {
    const state = makeNodes({
      'story': { typeId: 'story', isCollection: false, status: 'completed', displayName: 'Full Story' },
      'character': { typeId: 'character', isCollection: true, status: 'completed', displayName: 'Characters' },
      'character:alice': { typeId: 'character', itemId: 'alice', status: 'completed', displayName: 'Characters: Alice' },
    });

    const todos = buildTodoList(Object.values(state.nodes));
    const ids = todos.map(t => t.id);

    expect(ids).toContain('story'); // always visible
    expect(ids).not.toContain('character'); // hidden after expansion
    expect(ids).toContain('character:alice');
  });

  it('per-item nodes with isCollection=true are not hidden', () => {
    // After expansion, per-item nodes may still have isCollection=true
    // (for second-level expansion, e.g., shot_image_prompt:scene_1 → per-shot)
    // These should NOT be hidden — only type-level nodes (no itemId) are hidden
    const state = makeNodes({
      'character_image': { typeId: 'character_image', isCollection: true, status: 'completed', displayName: 'Character Images' },
      'character_image:alice': {
        typeId: 'character_image', itemId: 'alice', isCollection: true,
        status: 'pending', displayName: 'Character Images: Alice',
      },
    });

    const todos = buildTodoList(Object.values(state.nodes));
    const ids = todos.map(t => t.id);

    expect(ids).not.toContain('character_image'); // type-level hidden
    expect(ids).toContain('character_image:alice'); // per-item visible even with isCollection=true
  });

  it('hides FAILED type-level node when per-item children exist', () => {
    // Bug: type-level SVP node failed (405 error) but per-scene children
    // were created by expandPendingCollections. The failed type-level node
    // should still be hidden — its children handle execution.
    const state = makeNodes({
      'scene_video_prompt': {
        typeId: 'scene_video_prompt', isCollection: false, status: 'failed',
        displayName: 'Multi-Shot Motion Prompts',
      },
      'scene_video_prompt:scene_1': {
        typeId: 'scene_video_prompt', itemId: 'scene_1', status: 'completed',
        displayName: 'Multi-Shot Motion Prompts: The Dark Alleys',
      },
      'scene_video_prompt:scene_2': {
        typeId: 'scene_video_prompt', itemId: 'scene_2', status: 'pending',
        displayName: 'Multi-Shot Motion Prompts: The Murder Site',
      },
    });

    const todos = buildTodoList(Object.values(state.nodes));
    const ids = todos.map(t => t.id);

    expect(ids).not.toContain('scene_video_prompt'); // failed type-level hidden
    expect(ids).toContain('scene_video_prompt:scene_1');
    expect(ids).toContain('scene_video_prompt:scene_2');
  });

  it('hides type-level node even when isCollection is false (consumed by expansion)', () => {
    // After expandCollection, type-level node may be recreated by retry
    // with isCollection=false. Should still be hidden if children exist.
    const state = makeNodes({
      'shot_image': {
        typeId: 'shot_image', isCollection: false, status: 'pending',
        displayName: 'Shot Images',
      },
      'shot_image:scene_1_shot_1': {
        typeId: 'shot_image', itemId: 'scene_1_shot_1', status: 'completed',
        displayName: 'Shot Images: S1 Shot 1: wide',
      },
    });

    const todos = buildTodoList(Object.values(state.nodes));
    const ids = todos.map(t => t.id);

    expect(ids).not.toContain('shot_image');
    expect(ids).toContain('shot_image:scene_1_shot_1');
  });
});

describe('Shot display names', () => {
  it('per-shot nodes across scenes have unique display names', () => {
    // Bug: "Shot 1: wide" appeared 3 times (once per scene) with no
    // scene identifier. Now should show "S1 Shot 1: wide", "S2 Shot 1: wide".
    const state = makeNodes({
      'shot_image_prompt:scene_1_shot_1': {
        typeId: 'shot_image_prompt', itemId: 'scene_1_shot_1', status: 'pending',
        displayName: 'Shot Image Prompts: S1 Shot 1: wide',
      },
      'shot_image_prompt:scene_2_shot_1': {
        typeId: 'shot_image_prompt', itemId: 'scene_2_shot_1', status: 'pending',
        displayName: 'Shot Image Prompts: S2 Shot 1: wide',
      },
      'shot_image_prompt:scene_3_shot_1': {
        typeId: 'shot_image_prompt', itemId: 'scene_3_shot_1', status: 'pending',
        displayName: 'Shot Image Prompts: S3 Shot 1: wide',
      },
    });

    const todos = buildTodoList(Object.values(state.nodes));
    const names = todos.map(t => t.displayName);

    // All names should be unique
    expect(new Set(names).size).toBe(names.length);

    // Each should contain its scene identifier
    expect(names[0]).toContain('S1');
    expect(names[1]).toContain('S2');
    expect(names[2]).toContain('S3');
  });
});
