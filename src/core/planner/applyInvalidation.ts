/**
 * Pure invalidation op for `dhee_invalidate`.
 *
 * Walks the supplied id list, marks each existing node `pending` and
 * clears its execution metadata (outputPath, promptPath, completedAt,
 * startedAt, artifactId, error). Records the resulting set on
 * `executorState.lastInvalidatedIds` so a later
 * `dhee_run_to scope='last_invalidated'` can read it.
 *
 * Cascade: by default, every transitive dependent (via each node's
 * `dependents` edge list) is also marked pending. Without this, a
 * surgical "redo this one shot" leaves the downstream `final_video`
 * (and any other aggregator) stuck in `completed` state — the next
 * run skips them, and the regenerated shot never makes it into the
 * final assembly. Pass `cascade: false` for the rare case where you
 * really do want to re-run only the seed nodes (testing, debugging).
 *
 * Mark-pending (not remove-and-rebuild) is the contract: invalidate
 * regenerates EXISTING nodes; the graph topology stays intact. The
 * remove-and-rebuild flavor of the old `dhee_reset` is reachable
 * via a separate `clean: true` opt-in (TBD) when the user has
 * changed something upstream that might alter which per-items exist.
 *
 * Pure: mutates the passed-in object, no I/O. Caller persists.
 */
import type { ExecutorState } from "../project/projectTypes.js";

interface ProjectLike {
  executorState: ExecutorState & { lastInvalidatedIds?: string[] };
}

export interface ApplyInvalidationResult {
  /** Ids that existed in the graph and were actually invalidated.
   *  Includes both the seed ids the caller passed AND any cascaded
   *  dependents (when `cascade !== false`), in walk order. */
  invalidated: string[];
  /** The subset of `invalidated` the caller explicitly named. Useful
   *  when the cascade includes dozens of downstream nodes and the UI
   *  wants to highlight just the user's selection. */
  seeds: string[];
  /** Ids that the caller named but didn't exist — left here as a soft
   *  signal (no throw). Cascade misses are not reported here, since
   *  by definition every walked id was found in the graph. */
  notFound: string[];
}

export interface ApplyInvalidationOptions {
  /**
   * When true (default), walk each invalidated node's `dependents`
   * transitively and mark them pending too. The semantic is "this
   * node's output is stale, so anything that consumed it is stale
   * by transitivity". When false, only the seed ids are touched —
   * graph topology stays intact but the downstream cone may be left
   * with stale `completed` status.
   */
  cascade?: boolean;
}

type MutableNode = ExecutorState["nodes"][string] & {
  promptPath?: string;
  artifactId?: string;
  outputPaths?: Record<string, string>;
};

function markPending(node: MutableNode): void {
  node.status = "pending";
  node.outputPath = undefined;
  node.startedAt = undefined;
  node.completedAt = undefined;
  node.error = undefined;
  // Optional fields written by the runtime executor and resetProjectStage.
  // Not on the narrow ExecutionNode type but real at runtime — clearing
  // them ensures the next run regenerates the artifact rather than
  // short-circuiting on a stale path.
  delete node.promptPath;
  delete node.artifactId;
  // Per-frame outputs dict (first_frame / last_frame / mid_frame paths).
  // Critical: if we leave this populated, ExecutorAgent's incremental-
  // retry check (ExecutorAgent.ts:5537 + 5579) will reuse the stale
  // frames whenever the on-disk files still exist — invalidation
  // looks like it worked but the next run silently reuses old
  // images. The graph-aware `executor.invalidateNode` does the same
  // clear; this disk-mutating sibling has to match.
  delete node.outputPaths;
}

export function applyInvalidation(
  project: ProjectLike,
  ids: string[],
  opts: ApplyInvalidationOptions = {},
): ApplyInvalidationResult {
  const cascade = opts.cascade !== false;
  const nodes = project.executorState.nodes;
  const invalidated: string[] = [];
  const seeds: string[] = [];
  const notFound: string[] = [];
  const seen = new Set<string>();

  // Phase 1: seed walk — mark each user-named id pending. Track which
  // existed in the graph so the cascade (phase 2) can start from
  // them. Missing ids are reported in `notFound` and skipped.
  const queue: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const node = nodes[id] as MutableNode | undefined;
    if (!node) {
      notFound.push(id);
      continue;
    }
    seen.add(id);
    markPending(node);
    invalidated.push(id);
    seeds.push(id);
    queue.push(id);
  }

  // Phase 2: cascade — BFS along `dependents` edges. The `dependents`
  // list can carry duplicates from older project files (we observed
  // 4× final_video in the wild on Baker-and-the-Bee), so dedupe via
  // the shared `seen` set. Missing dependents (graph drift) are
  // silently skipped — there's no user intent to surface that.
  if (cascade) {
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const curNode = nodes[cur] as MutableNode | undefined;
      const deps = curNode?.dependents ?? [];
      for (const depId of deps) {
        if (seen.has(depId)) continue;
        const depNode = nodes[depId] as MutableNode | undefined;
        if (!depNode) continue;
        seen.add(depId);
        markPending(depNode);
        invalidated.push(depId);
        queue.push(depId);
      }
    }
  }

  // Whitelist for `dhee_run_to scope='last_invalidated'`. Always
  // overwrite — most-recent-invalidate wins. Empty list when nothing
  // matched (rather than leaving a stale older list around). The
  // whitelist intentionally includes cascaded ids so the targeted
  // re-run actually re-renders the final video / aggregator nodes.
  project.executorState.lastInvalidatedIds = invalidated;

  return { invalidated, seeds, notFound };
}
