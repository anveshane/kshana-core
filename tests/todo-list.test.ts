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
      // Hide type-level collection nodes that have per-item children
      if (node.isCollection && !node.itemId && expandedTypes.has(node.typeId)) {
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
});
