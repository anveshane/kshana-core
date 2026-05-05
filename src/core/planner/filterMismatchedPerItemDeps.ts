/**
 * Filter a dependency list to remove per-item refs of matching-scope
 * types whose itemId doesn't match the item being created.
 *
 * Used by `DependencyGraphExecutor.expandMatchingDependent` to clean up
 * the `preRewire` snapshot before creating per-item clones.
 *
 * The bug this fixes: when a collection-level dependent (e.g.
 * `shot_video:scene_1`) has already accumulated per-item refs from
 * sibling expansions (e.g. all 15 of scene_1's
 * `shot_motion_directive:scene_1_shot_*`), every per-item clone built
 * from the same dependent.dependencies snapshot inherits the full set
 * of sibling refs. Without filtering, `shot_video:scene_1_shot_1` ends
 * up depending on shot_2..shot_15's motion directives.
 *
 * The filter is conservative — it only strips per-item refs whose:
 *   1. type (the part before `:`) is in `matchingScopeTypes`, AND
 *   2. itemId (the part after `:`) does NOT equal the current `itemId`
 *
 * Anything else stays unchanged: type-level refs (no `:`), per-item
 * refs of non-matching scope (e.g. an "all" or "any" scope target's
 * sibling refs), and per-item refs that happen to match the current
 * item.
 */
export function filterMismatchedPerItemDeps(
  deps: readonly string[],
  itemId: string,
  matchingScopeTypes: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const dep of deps) {
    const colonIdx = dep.indexOf(':');
    if (colonIdx < 0) {
      // Bare type-level ref — keep.
      out.push(dep);
      continue;
    }
    const depType = dep.slice(0, colonIdx);
    const depItemId = dep.slice(colonIdx + 1);
    if (!matchingScopeTypes.has(depType)) {
      // Per-item ref of a non-matching-scope type — keep.
      out.push(dep);
      continue;
    }
    if (depItemId === itemId) {
      // Matching item — keep.
      out.push(dep);
      continue;
    }
    // Per-item ref of a matching-scope type with mismatched itemId — drop.
  }
  return out;
}
