/**
 * Tests for `filterMismatchedPerItemDeps`.
 *
 * Background: when a collection-level dependent (e.g. `shot_video:scene_1`)
 * gets expanded into per-shot clones via `expandMatchingDependent`, each
 * clone's `preRewire` snapshot inherits the parent's deps as-is. If those
 * deps already include per-item refs from sibling expansions
 * (e.g. all 15 of scene_1's `shot_motion_directive:scene_1_shot_*`), the
 * clones for `shot_video:scene_1_shot_1` end up depending on ALL 15 items
 * instead of just shot_1's directive.
 *
 * This filter strips per-item refs of matching-scope dep types whose
 * itemId doesn't match the item being created. Other deps are preserved
 * — including bare type-level refs (no `:`) and per-item refs of NON-
 * matching scope types (e.g. cross-shot serialization refs added later
 * at the materialization layer).
 */
import { describe, it, expect } from 'vitest';
import { filterMismatchedPerItemDeps } from '../../src/core/planner/filterMismatchedPerItemDeps.js';

describe('filterMismatchedPerItemDeps', () => {
  const matchingScopeTypes = new Set(['shot_image', 'shot_motion_directive']);

  it('keeps the matching per-item dep for THIS item', () => {
    const result = filterMismatchedPerItemDeps(
      ['shot_motion_directive:scene_1_shot_1'],
      'scene_1_shot_1',
      matchingScopeTypes,
    );
    expect(result).toEqual(['shot_motion_directive:scene_1_shot_1']);
  });

  it('drops per-item refs of matching-scope types whose itemId does NOT match', () => {
    const result = filterMismatchedPerItemDeps(
      [
        'shot_motion_directive:scene_1_shot_1',
        'shot_motion_directive:scene_1_shot_2',
        'shot_motion_directive:scene_1_shot_3',
      ],
      'scene_1_shot_1',
      matchingScopeTypes,
    );
    expect(result).toEqual(['shot_motion_directive:scene_1_shot_1']);
  });

  it('drops mismatched matching-scope refs across multiple types in one pass', () => {
    const result = filterMismatchedPerItemDeps(
      [
        'shot_image:scene_1_shot_2',           // mismatched matching → drop
        'shot_motion_directive:scene_1_shot_1', // matched → keep
        'shot_motion_directive:scene_1_shot_2', // mismatched → drop
        'shot_image:scene_1_shot_1',            // matched → keep
      ],
      'scene_1_shot_1',
      matchingScopeTypes,
    );
    expect(result.sort()).toEqual([
      'shot_image:scene_1_shot_1',
      'shot_motion_directive:scene_1_shot_1',
    ]);
  });

  it('keeps bare type-level refs (no ":") regardless of itemId', () => {
    const result = filterMismatchedPerItemDeps(
      ['world_style', 'shot_image'],
      'scene_1_shot_1',
      matchingScopeTypes,
    );
    expect(result).toEqual(['world_style', 'shot_image']);
  });

  it('keeps per-item refs of NON-matching-scope types regardless of itemId', () => {
    // e.g. world_style might be at "all" scope, character_image:alice
    // could be referenced regardless of the current item's id.
    const result = filterMismatchedPerItemDeps(
      ['character_image:alice', 'character_image:bob'],
      'scene_1_shot_1',
      matchingScopeTypes,
    );
    // character_image is NOT in matchingScopeTypes — both are kept.
    expect(result.sort()).toEqual(['character_image:alice', 'character_image:bob']);
  });

  it('handles refs with multiple colons (e.g. nested item IDs)', () => {
    // Some itemIds embed scene_X_shot_Y. The split-after-first-colon
    // convention should treat everything after the first colon as the
    // itemId for the comparison.
    const result = filterMismatchedPerItemDeps(
      [
        'shot_motion_directive:scene_1_shot_1',
        'shot_motion_directive:scene_2_shot_1',  // different item
      ],
      'scene_1_shot_1',
      matchingScopeTypes,
    );
    expect(result).toEqual(['shot_motion_directive:scene_1_shot_1']);
  });

  it('returns empty array when input is empty', () => {
    expect(filterMismatchedPerItemDeps([], 'scene_1_shot_1', matchingScopeTypes)).toEqual([]);
  });

  it('preserves order of remaining deps (stable filter, no sort)', () => {
    const result = filterMismatchedPerItemDeps(
      [
        'world_style',
        'shot_motion_directive:scene_1_shot_2',  // drop
        'character_image:alice',
        'shot_image:scene_1_shot_1',             // keep
      ],
      'scene_1_shot_1',
      matchingScopeTypes,
    );
    expect(result).toEqual(['world_style', 'character_image:alice', 'shot_image:scene_1_shot_1']);
  });

  it('does not duplicate refs that are already present', () => {
    // Idempotency: filtering again on already-filtered deps is a no-op.
    const once = filterMismatchedPerItemDeps(
      ['shot_motion_directive:scene_1_shot_1', 'shot_motion_directive:scene_1_shot_2'],
      'scene_1_shot_1',
      matchingScopeTypes,
    );
    const twice = filterMismatchedPerItemDeps(once, 'scene_1_shot_1', matchingScopeTypes);
    expect(twice).toEqual(once);
  });
});
