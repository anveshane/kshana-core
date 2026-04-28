/**
 * Graph-based read module — the canonical query layer over
 * `executorState.nodes`.
 *
 * Background: prior to the unification refactor, callers reached into
 * parallel flat arrays (`project.characters[]`, `project.settings[]`,
 * `project.scenes[]`) and the content registry
 * (`project.content.images.itemFiles`) to look up names, paths, and
 * approval state. Each was a separate bookkeeping layer that drifted
 * from the disk reality and from the dependency-graph executor.
 *
 * `executorState.nodes` already encodes everything needed:
 *   - node id `character:jan` is the per-item entity
 *   - node.outputPath points to the artifact on disk
 *   - node.metadata carries approval / regeneration state
 *
 * This module is the read-side wrapper. Writers continue to flow
 * through `DependencyGraphExecutor` (and pick up the persistence
 * callback automatically). All read paths in tools.ts,
 * contentContext.ts, and contentCreatorTools.ts will migrate to call
 * here, and once they all do, the legacy flat arrays can be deleted.
 */

import type { ExecutorState, ExecutionNode } from './types.js';

/**
 * One per-item entry returned to callers — minimal, intentionally not
 * exposing the full ExecutionNode shape. If you need more, fetch the
 * node directly via `getNodeByItemId`.
 */
export interface CollectionItem {
  itemId: string;
  /** User-facing name. Prefers `metadata.name`, falls back to the
   *  display-name tail (after the typeDef prefix). */
  name: string;
  /** Output file path if the per-item node has completed; absent
   *  otherwise. */
  outputPath?: string;
}

function tail(displayName: string): string {
  const idx = displayName.indexOf(': ');
  return idx >= 0 ? displayName.slice(idx + 2) : displayName;
}

function nameOf(node: ExecutionNode): string {
  if (node.metadata?.name) return node.metadata.name;
  return tail(node.displayName);
}

/**
 * Return all per-item nodes of a given typeId, sorted by itemId.
 * Excludes the type-level placeholder (`isCollection && !itemId`).
 */
export function getCollectionItems(
  state: ExecutorState | undefined,
  typeId: string,
): CollectionItem[] {
  if (!state?.nodes) return [];
  const items: CollectionItem[] = [];
  for (const node of Object.values(state.nodes)) {
    if (node.typeId !== typeId) continue;
    if (!node.itemId) continue; // skip type-level placeholder
    items.push({
      itemId: node.itemId,
      name: nameOf(node),
      ...(node.outputPath !== undefined ? { outputPath: node.outputPath } : {}),
    });
  }
  items.sort((a, b) => a.itemId.localeCompare(b.itemId));
  return items;
}

/**
 * Look up a per-item node by (typeId, itemId) — case-insensitive on
 * itemId so callers passing user-typed names ("Jan" vs "jan") work.
 */
export function getNodeByItemId(
  state: ExecutorState | undefined,
  typeId: string,
  itemId: string,
): ExecutionNode | null {
  if (!state?.nodes) return null;
  const target = itemId.toLowerCase();
  for (const node of Object.values(state.nodes)) {
    if (node.typeId !== typeId) continue;
    if (!node.itemId) continue;
    if (node.itemId.toLowerCase() === target) return node;
  }
  return null;
}

/**
 * Resolve a reference name (e.g. ref to "Jan" or "Village Square")
 * to the on-disk path of its rendered reference image. Returns the
 * `outputPath` from the relevant `<type>_image:<itemId>` node, or
 * null when no such image has been rendered yet.
 *
 * `type`: `'character'` looks at `character_image:*`;
 *         `'setting'` looks at `setting_image:*`.
 *
 * The path is returned exactly as stored on the node (typically a
 * project-relative path). Callers that need an absolute path should
 * `path.join(projectDir, result)`.
 */
export function getReferenceImagePath(
  state: ExecutorState | undefined,
  type: 'character' | 'setting',
  itemId: string,
): string | null {
  if (!state?.nodes) return null;
  const imageTypeId = type === 'character' ? 'character_image' : 'setting_image';
  const node = getNodeByItemId(state, imageTypeId, itemId);
  if (!node?.outputPath) return null;
  return node.outputPath;
}

