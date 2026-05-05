/**
 * Skip an empty collection node and cascade the skip to its
 * matching-scope dependent collections.
 *
 * Background: when an extraction stage produces zero items for a
 * collection (e.g. the source story has no plot-critical objects → the
 * `object` collection has nothing to expand into), the collection node
 * stays pending forever. Any dependent matching-scope collection (like
 * `object_image`, which would have rendered ONE image per object) also
 * has nothing to do, but without an explicit skip it sits pending too —
 * and downstream non-collection nodes (e.g. `shot_image` with a
 * type-level ref to `object_image`) hang waiting on a dep that will
 * never be satisfied.
 *
 * The fix: mark the empty source collection AS skipped, then BFS
 * through its dependents. For each dependent that is itself a
 * collection AND declares the source as a `matching`-scope dependency,
 * mark it skipped too and recurse. Non-collection dependents are left
 * pending — `getNextReady` already counts skipped deps as satisfied,
 * so those nodes will become ready on the next tick.
 *
 * This helper is intentionally minimal — it takes a node, a lookup
 * function, and a stripped-down `artifactTypes` index — so it can be
 * unit-tested without booting a full DependencyGraphExecutor.
 */

export interface SkippableNode {
  id: string;
  typeId: string;
  itemId?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'ready';
  isCollection: boolean;
  dependents: string[];
}

/**
 * Stripped-down view of `template.artifactTypes` used by this helper.
 * Only the dep relationships matter for the cascade decision.
 */
export type ArtifactTypesIndex = Record<string, {
  dependencies: Array<{
    artifactTypeId: string;
    scope?: 'matching' | 'all' | 'any';
  }>;
}>;

/**
 * Mark the given collection node as skipped, then cascade the skip to
 * any matching-scope dependent collections. Returns the list of node
 * IDs that were newly marked skipped (does NOT include nodes that were
 * already skipped on entry).
 *
 * - If `startNode.status === 'skipped'`, the start node is not added to
 *   the result, but its dependents are still walked (in case a previous
 *   incomplete cascade left them pending).
 * - Non-collection dependents are NOT skipped — `getNextReady` will
 *   resolve them via the "skipped counts as satisfied" rule.
 * - Dependents whose dep on the source is NOT `matching` scope are also
 *   not skipped — `all`/`any` collections can still resolve trivially
 *   over an empty parent.
 * - Phantom dependent IDs (entries in `dependents[]` whose node is
 *   absent from the lookup) are silently ignored.
 */
export function skipEmptyCollectionAndDependents(
  startNode: SkippableNode,
  getNode: (id: string) => SkippableNode | undefined,
  artifactTypes: ArtifactTypesIndex,
): string[] {
  const skippedIds: string[] = [];
  const visited = new Set<string>();
  const queue: SkippableNode[] = [startNode];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);

    if (node.status !== 'skipped') {
      node.status = 'skipped';
      skippedIds.push(node.id);
    }

    for (const dependentId of node.dependents) {
      const dependent = getNode(dependentId);
      if (!dependent) continue;        // phantom edge — ignore
      if (!dependent.isCollection) continue;  // non-collection: getNextReady handles
      if (dependent.status === 'skipped' || visited.has(dependent.id)) continue;

      const depTypeDef = artifactTypes[dependent.typeId];
      if (!depTypeDef) continue;
      const depRel = depTypeDef.dependencies.find(d => d.artifactTypeId === node.typeId);
      if (depRel?.scope !== 'matching') continue;  // only matching-scope cascades

      queue.push(dependent);
    }
  }

  return skippedIds;
}
