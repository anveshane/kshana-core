/**
 * Filter the `assets/manifest.json` list down to only "live" assets —
 * those currently referenced by some node's `outputPath` or `outputPaths`
 * in the executor state.
 *
 * The manifest is append-only and keeps files from previous runs/resets.
 * Without this filter, the storyboard continues to show stale images and
 * videos after a reset. With it, the storyboard mirrors the current
 * executor state: if a node's output was cleared, its asset disappears.
 *
 * Enriches each returned asset with `nodeId` and `frame` inferred from
 * the executor state, used by the storyboard for shot grouping and redo.
 *
 * If the executor state is empty (fresh project, no nodes yet), returns
 * all assets unchanged so the storyboard works during initial generation.
 */
export interface ManifestAsset {
  id: string;
  path: string;
  type: string;
  nodeId?: string;
  frame?: string;
}

export interface ExecutorNode {
  outputPath?: string;
  outputPaths?: Record<string, string>;
}

export function filterLiveAssets(
  allAssets: ManifestAsset[],
  nodes: Record<string, ExecutorNode>,
): ManifestAsset[] {
  const hasAnyNodes = Object.keys(nodes).length > 0;

  // Reverse map: path → { nodeId, frame? }
  const pathToNode = new Map<string, { nodeId: string; frame?: string }>();
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.outputPath) pathToNode.set(node.outputPath, { nodeId });
    if (node.outputPaths) {
      for (const [frameKey, framePath] of Object.entries(node.outputPaths)) {
        pathToNode.set(framePath, { nodeId, frame: frameKey });
      }
    }
  }

  // Fresh project (no nodes yet) — don't filter, just return everything.
  const candidates = hasAnyNodes
    ? allAssets.filter(a => pathToNode.has(a.path))
    : allAssets.slice();

  // Enrich with nodeId + frame, preserving any values already present
  // on the asset (manifest-set values win over inferred).
  return candidates.map(a => {
    const hit = pathToNode.get(a.path);
    if (!hit) return a;
    const enriched: ManifestAsset = { ...a };
    if (!enriched.nodeId) enriched.nodeId = hit.nodeId;
    if (hit.frame && !enriched.frame) enriched.frame = hit.frame;
    return enriched;
  });
}
