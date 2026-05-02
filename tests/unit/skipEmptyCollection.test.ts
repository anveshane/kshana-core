/**
 * Tests for `skipEmptyCollectionAndDependents`.
 *
 * Background: when an upstream collection (e.g. `object`) extracts zero
 * items from the source story, the collection node and any matching-
 * scope dependent collections (e.g. `object_image`) sit pending forever
 * — never expand, never proceed. Downstream non-collection nodes (like
 * `shot_image` with a type-level ref to `object_image`) hang waiting on
 * a dep that will never be satisfied.
 *
 * The fix marks the empty collection AND its matching-scope dependent
 * collections as `skipped`. `getNextReady` treats skipped as satisfied,
 * so downstream nodes can proceed.
 *
 * The helper only needs node lookup + template inspection — these tests
 * use a minimal in-memory map and an artifactTypes stub instead of the
 * full DependencyGraphExecutor (whose constructor is private).
 */
import { describe, it, expect } from 'vitest';
import {
  skipEmptyCollectionAndDependents,
  type SkippableNode,
  type ArtifactTypesIndex,
} from '../../src/core/planner/skipEmptyCollection.js';

function makeNodes(): Map<string, SkippableNode> {
  return new Map<string, SkippableNode>([
    ['object', {
      id: 'object', typeId: 'object',
      status: 'pending', isCollection: true,
      dependents: ['object_image'],
    }],
    ['object_image', {
      id: 'object_image', typeId: 'object_image',
      status: 'pending', isCollection: true,
      dependents: ['shot_image:scene_1_shot_1'],
    }],
    ['shot_image:scene_1_shot_1', {
      id: 'shot_image:scene_1_shot_1', typeId: 'shot_image', itemId: 'scene_1_shot_1',
      status: 'pending', isCollection: false,
      dependents: [],
    }],
  ]);
}

const TEMPLATE: ArtifactTypesIndex = {
  object_image: {
    dependencies: [{ artifactTypeId: 'object', scope: 'matching' }],
  },
  shot_image: {
    // shot_image's dep on object_image is 'all' scope here — should NOT
    // cascade into a skip on shot_image itself (its dep just becomes
    // satisfied via skipped status).
    dependencies: [{ artifactTypeId: 'object_image', scope: 'all' }],
  },
  object: { dependencies: [] },
};

function lookup(nodes: Map<string, SkippableNode>) {
  return (id: string) => nodes.get(id);
}

describe('skipEmptyCollectionAndDependents', () => {
  it('marks the empty collection as skipped', () => {
    const nodes = makeNodes();
    const skipped = skipEmptyCollectionAndDependents(
      nodes.get('object')!, lookup(nodes), TEMPLATE,
    );
    expect(skipped).toContain('object');
    expect(nodes.get('object')!.status).toBe('skipped');
  });

  it('cascades to matching-scope dependent collections', () => {
    const nodes = makeNodes();
    skipEmptyCollectionAndDependents(nodes.get('object')!, lookup(nodes), TEMPLATE);
    expect(nodes.get('object_image')!.status).toBe('skipped');
  });

  it('does NOT cascade to non-collection dependents', () => {
    const nodes = makeNodes();
    skipEmptyCollectionAndDependents(nodes.get('object')!, lookup(nodes), TEMPLATE);
    // shot_image:scene_1_shot_1 is a non-collection — left pending; getNextReady
    // will treat its dep on (now-skipped) object_image as satisfied.
    expect(nodes.get('shot_image:scene_1_shot_1')!.status).toBe('pending');
  });

  it('does NOT cascade through "all" or other non-matching scope deps', () => {
    // Build alt: object_image dependent declares 'all' scope on the
    // empty source — should NOT be skipped (it can still aggregate
    // zero items, which is "all of zero" = trivially satisfied).
    const altTemplate: ArtifactTypesIndex = {
      object_image: { dependencies: [{ artifactTypeId: 'object', scope: 'all' }] },
      object: { dependencies: [] },
    };
    const nodes = makeNodes();
    skipEmptyCollectionAndDependents(nodes.get('object')!, lookup(nodes), altTemplate);
    // object got skipped, but object_image stays pending under 'all' scope.
    expect(nodes.get('object')!.status).toBe('skipped');
    expect(nodes.get('object_image')!.status).toBe('pending');
  });

  it('returns the list of skipped node ids', () => {
    const nodes = makeNodes();
    const skipped = skipEmptyCollectionAndDependents(
      nodes.get('object')!, lookup(nodes), TEMPLATE,
    );
    expect(skipped.sort()).toEqual(['object', 'object_image']);
  });

  it('skips an already-skipped start node only once but still cascades to pending dependents', () => {
    const nodes = makeNodes();
    nodes.get('object')!.status = 'skipped';
    const skipped = skipEmptyCollectionAndDependents(
      nodes.get('object')!, lookup(nodes), TEMPLATE,
    );
    expect(skipped).not.toContain('object');
    expect(skipped).toContain('object_image');
    expect(nodes.get('object_image')!.status).toBe('skipped');
  });

  it('handles dangling dependent ids (node missing from the map) without crashing', () => {
    const nodes = makeNodes();
    nodes.get('object')!.dependents.push('phantom_node_does_not_exist');
    const skipped = skipEmptyCollectionAndDependents(
      nodes.get('object')!, lookup(nodes), TEMPLATE,
    );
    // Doesn't include the phantom; doesn't throw.
    expect(skipped).toContain('object');
    expect(skipped).toContain('object_image');
  });
});
