/**
 * Tests for `projectView` — the graph-based read module that replaces
 * legacy lookups against `project.characters[]`, `project.settings[]`,
 * `project.scenes[]`, and `project.content.images.itemFiles`.
 *
 * The single source of truth is now `executorState.nodes`. This module
 * is the canonical read-side wrapper.
 */
import { describe, it, expect } from 'vitest';
import {
  getCollectionItems,
  getReferenceImagePath,
  getNodeByItemId,
} from '../../src/core/planner/projectView.js';
import type { ExecutorState, ExecutionNode } from '../../src/core/planner/types.js';

function mkState(nodes: ExecutionNode[]): ExecutorState {
  const map: Record<string, ExecutionNode> = {};
  for (const n of nodes) map[n.id] = n;
  return {
    nodes: map,
    targetArtifacts: ['final_video'],
    goalDescription: 'test',
    createdAt: 1,
    updatedAt: 1,
  };
}

function mkNode(over: Partial<ExecutionNode> & Pick<ExecutionNode, 'id' | 'typeId'>): ExecutionNode {
  return {
    status: 'pending',
    displayName: over.id,
    isExpensive: false,
    isCollection: false,
    dependencies: [],
    dependents: [],
    ...over,
  };
}

describe('projectView.getCollectionItems', () => {
  it('returns per-item nodes for a typeId, sorted by itemId', () => {
    const state = mkState([
      mkNode({ id: 'character:zod', typeId: 'character', itemId: 'zod', displayName: 'Character: Zod' }),
      mkNode({ id: 'character:alpha', typeId: 'character', itemId: 'alpha', displayName: 'Character: Alpha' }),
      mkNode({ id: 'plot', typeId: 'plot' }),
    ]);
    const items = getCollectionItems(state, 'character');
    expect(items.map(i => i.itemId)).toEqual(['alpha', 'zod']);
  });

  it('skips the type-level placeholder (no itemId)', () => {
    const state = mkState([
      mkNode({ id: 'character', typeId: 'character', isCollection: true }),
      mkNode({ id: 'character:jan', typeId: 'character', itemId: 'jan' }),
    ]);
    const items = getCollectionItems(state, 'character');
    expect(items.map(i => i.itemId)).toEqual(['jan']);
  });

  it('returns an empty array when no per-item nodes exist for the type', () => {
    const state = mkState([mkNode({ id: 'plot', typeId: 'plot' })]);
    expect(getCollectionItems(state, 'character')).toEqual([]);
  });

  it('returns an empty array when state is undefined (project not yet run)', () => {
    expect(getCollectionItems(undefined, 'character')).toEqual([]);
  });
});

describe('projectView.getNodeByItemId', () => {
  it('finds a per-item node by typeId + itemId', () => {
    const state = mkState([
      mkNode({ id: 'character:jan', typeId: 'character', itemId: 'jan' }),
    ]);
    expect(getNodeByItemId(state, 'character', 'jan')!.id).toBe('character:jan');
  });

  it('returns null when no node matches', () => {
    const state = mkState([mkNode({ id: 'plot', typeId: 'plot' })]);
    expect(getNodeByItemId(state, 'character', 'jan')).toBeNull();
  });

  it('matches case-insensitively against the displayName tail when itemId differs', () => {
    // Some legacy projects use proper-case names ("Jan") while the
    // node id is lowercased ("character:jan"). The lookup should
    // tolerate that — useful when a ref names the character as "Jan".
    const state = mkState([
      mkNode({ id: 'character:jan', typeId: 'character', itemId: 'jan', displayName: 'Character: Jan' }),
    ]);
    expect(getNodeByItemId(state, 'character', 'Jan')!.id).toBe('character:jan');
    expect(getNodeByItemId(state, 'character', 'JAN')!.id).toBe('character:jan');
  });
});

describe('projectView.getReferenceImagePath', () => {
  it('returns the outputPath of the matching character_image node', () => {
    const state = mkState([
      mkNode({ id: 'character:jan', typeId: 'character', itemId: 'jan' }),
      mkNode({
        id: 'character_image:jan', typeId: 'character_image', itemId: 'jan',
        status: 'completed', outputPath: 'assets/images/CharRef_jan.png',
      }),
    ]);
    expect(getReferenceImagePath(state, 'character', 'jan')).toBe('assets/images/CharRef_jan.png');
  });

  it('returns the outputPath of the matching setting_image node', () => {
    const state = mkState([
      mkNode({
        id: 'setting_image:village', typeId: 'setting_image', itemId: 'village',
        status: 'completed', outputPath: 'assets/images/SettingRef_village.png',
      }),
    ]);
    expect(getReferenceImagePath(state, 'setting', 'village')).toBe('assets/images/SettingRef_village.png');
  });

  it('returns null when the image node exists but has no outputPath (not yet generated)', () => {
    const state = mkState([
      mkNode({ id: 'character_image:jan', typeId: 'character_image', itemId: 'jan' }),
    ]);
    expect(getReferenceImagePath(state, 'character', 'jan')).toBeNull();
  });

  it('returns null when no image node exists for the item', () => {
    const state = mkState([
      mkNode({ id: 'character:jan', typeId: 'character', itemId: 'jan' }),
    ]);
    expect(getReferenceImagePath(state, 'character', 'jan')).toBeNull();
  });

  it('matches case-insensitively (callers may pass "Jan" instead of "jan")', () => {
    const state = mkState([
      mkNode({
        id: 'character_image:jan', typeId: 'character_image', itemId: 'jan',
        status: 'completed', outputPath: 'assets/images/CharRef_jan.png',
        displayName: 'Character Reference Images: Jan',
      }),
    ]);
    expect(getReferenceImagePath(state, 'character', 'Jan')).toBe('assets/images/CharRef_jan.png');
  });

  it('returns null when state is undefined', () => {
    expect(getReferenceImagePath(undefined, 'character', 'jan')).toBeNull();
  });
});

