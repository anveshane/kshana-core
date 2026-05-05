/**
 * Pure invalidation op for `kshana_invalidate`.
 *
 * Walks the supplied id list, marks each existing node `pending` and
 * clears its execution metadata (outputPath, promptPath, completedAt,
 * startedAt, artifactId, error). Records the resulting set on
 * `executorState.lastInvalidatedIds` so a later
 * `kshana_run_to scope='last_invalidated'` can read it.
 *
 * Mark-pending (not remove-and-rebuild) is the contract: invalidate
 * regenerates EXISTING nodes; the graph topology stays intact. The
 * remove-and-rebuild flavor of the old `kshana_reset` is reachable
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
  /** Ids that existed in the graph and were actually invalidated. */
  invalidated: string[];
  /** Ids that didn't exist — left here as a soft signal (no throw). */
  notFound: string[];
}

export function applyInvalidation(
  project: ProjectLike,
  ids: string[],
): ApplyInvalidationResult {
  const nodes = project.executorState.nodes;
  const invalidated: string[] = [];
  const notFound: string[] = [];

  for (const id of ids) {
    const node = nodes[id] as
      | (ExecutorState["nodes"][string] & {
          promptPath?: string;
          artifactId?: string;
        })
      | undefined;
    if (!node) {
      notFound.push(id);
      continue;
    }
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
    invalidated.push(id);
  }

  // Whitelist for `kshana_run_to scope='last_invalidated'`. Always
  // overwrite — most-recent-invalidate wins. Empty list when nothing
  // matched (rather than leaving a stale older list around).
  project.executorState.lastInvalidatedIds = invalidated;

  return { invalidated, notFound };
}
