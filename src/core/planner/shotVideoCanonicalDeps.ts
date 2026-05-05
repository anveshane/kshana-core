/**
 * Canonical-deps helper for `shot_video` per-item nodes.
 *
 * Defensive layer used by `expandSceneBreakdownGraph` in ExecutorAgent
 * to repair `shot_video` nodes whose deps got mangled during graph
 * expansion. Symptoms of the underlying bug (tracked separately in
 * `todos/shot-video-dep-expansion-bug.md`):
 *
 *   - `shot_video:scene_X_shot_Y.dependencies` lists ALL of scene X's
 *     `shot_motion_directive:scene_X_shot_*` entries instead of just
 *     shot Y's.
 *   - `shot_image:scene_X_shot_Y` dep entirely missing — so the executor
 *     fires `shot_video` before the first frame is generated, and
 *     `executeSceneBundle` falls back with "no first_frame yet".
 *
 * The canonical fix at the materialization layer is to rebuild deps
 * from the per-shot triple (shotImage, motion, optional prev-shot
 * serialization edge), and strip any per-item refs of shot_image /
 * shot_motion_directive that don't match this shot. Other deps are
 * preserved — sanitize is targeted at the known bug, not a broad
 * dep-rewrite.
 */

export interface CanonicalShotVideoDepsInput {
  shotImageId: string;     // e.g. 'shot_image:scene_1_shot_1'
  motionId: string;        // e.g. 'shot_motion_directive:scene_1_shot_1'
  prevShotVideoId: string | null;  // e.g. 'shot_video:scene_1_shot_0' or null for the first shot
}

/**
 * Build the canonical dep list for a shot_video per-item node.
 * Used both at initial creation and when sanitizing existing nodes.
 */
export function canonicalShotVideoDeps(opts: CanonicalShotVideoDepsInput): string[] {
  const deps = [opts.shotImageId, opts.motionId];
  if (opts.prevShotVideoId) deps.push(opts.prevShotVideoId);
  return deps;
}

export interface SanitizeShotVideoDepsInput extends CanonicalShotVideoDepsInput {
  existingDeps: string[];
}

/**
 * Rebuild a shot_video node's deps to ensure they are well-formed.
 *
 * - Always includes the canonical triple (shotImageId, motionId, prevShotVideoId?).
 * - Strips any per-item `shot_image:*` or `shot_motion_directive:*` refs
 *   that don't match this shot (the bug the executor's expansion code
 *   sometimes leaves behind).
 * - Preserves all OTHER deps unchanged (we only know how to sanitize the
 *   two known-corrupt patterns; everything else is left intact so we
 *   don't regress some unknown-but-valid edge).
 * - Deduplicates the final list.
 */
export function sanitizeShotVideoDeps(opts: SanitizeShotVideoDepsInput): string[] {
  const canonical = new Set(canonicalShotVideoDeps(opts));

  const isStrayShotImage = (dep: string): boolean =>
    dep.startsWith('shot_image:') && dep !== opts.shotImageId;
  const isStrayMotion = (dep: string): boolean =>
    dep.startsWith('shot_motion_directive:') && dep !== opts.motionId;

  const seen = new Set<string>();
  const result: string[] = [];

  // Start by emitting the canonical deps in order — they are authoritative.
  for (const c of canonicalShotVideoDeps(opts)) {
    if (!seen.has(c)) {
      result.push(c);
      seen.add(c);
    }
  }

  // Then preserve any other existing dep that is neither stray nor a
  // duplicate of a canonical entry.
  for (const dep of opts.existingDeps) {
    if (canonical.has(dep)) continue; // already emitted via canonical
    if (isStrayShotImage(dep)) continue;
    if (isStrayMotion(dep)) continue;
    if (seen.has(dep)) continue;
    result.push(dep);
    seen.add(dep);
  }

  return result;
}
