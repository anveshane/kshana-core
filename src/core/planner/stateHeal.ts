/**
 * State Heal: fix per-item nodes whose matching-scope deps were stripped by
 * a buggy earlier version of the dangling-dep cleanup.
 *
 * Context: before the propagation fix, the post-expansion dangling-dep
 * cleanup in ExecutorAgent aggressively removed any dep pointing at a
 * deleted type-level node — even from type-level collections that hadn't
 * been expanded yet. When those collections eventually expanded, the
 * per-item nodes inherited the stripped deps, meaning every
 * `character_image:X`, `setting_image:X`, `object_image:X`, and
 * `scene_video_prompt:scene_N` ended up with only `['world_style']` and
 * could never see its parent's content.
 *
 * That broken shape gets persisted to `project.json` → every session
 * resume reloads the broken deps → any reset/regen keeps running with
 * blind context. `repairMissingNodes` only fixes deps that POINT at
 * missing nodes, not deps that were silently dropped.
 *
 * This pass scans every per-item node, consults the template for its
 * matching-scope deps, and restores any that are missing (when the
 * matching parent exists). It's safe to run multiple times — fully
 * idempotent.
 */

import type { VideoTemplate } from '../templates/types.js';
import type { DependencyGraphExecutor } from './DependencyGraphExecutor.js';

export interface HealReport {
  /** Total matching-scope deps added back across all nodes. */
  added: number;
  /** Human-readable details of what was restored. */
  details: Array<{ nodeId: string; restoredDep: string }>;
}

/**
 * For every per-item node (one with `itemId`), ensure all matching-scope
 * deps declared by its template type are present as `parentType:itemId`.
 * Restore any missing ones and fix the reverse `dependents` edge on the
 * parent.
 */
export function healStaleMatchingDeps(
  executor: DependencyGraphExecutor,
  template: VideoTemplate,
): HealReport {
  const report: HealReport = { added: 0, details: [] };

  for (const node of executor.getAllNodes()) {
    if (!node.itemId) continue; // only per-item nodes can have matching-scope deps
    const typeDef = template.artifactTypes[node.typeId];
    if (!typeDef) continue;

    for (const dep of typeDef.dependencies) {
      if (dep.scope !== 'matching') continue;
      const expectedDepId = `${dep.artifactTypeId}:${node.itemId}`;
      if (node.dependencies.includes(expectedDepId)) continue; // already fine

      const parent = executor.getNode(expectedDepId);
      if (!parent) continue; // parent doesn't exist — nothing to restore

      node.dependencies.push(expectedDepId);
      if (!parent.dependents.includes(node.id)) {
        parent.dependents.push(node.id);
      }
      report.added++;
      report.details.push({ nodeId: node.id, restoredDep: expectedDepId });
    }
  }

  return report;
}
