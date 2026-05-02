/**
 * Rebuild the in-memory scene-summary and scene-duration maps from a
 * fresh extraction's scene list. Drops any stale keys from prior runs
 * so re-extractions that produce fewer scenes don't leave orphan
 * entries lingering in the persisted JSON.
 *
 * No-op when `scenes` is empty — per-collection re-extractions
 * (character/setting/object collections) pass through the same code
 * path with no scene data and must not wipe already-populated maps.
 */
export interface SceneArtifactInput {
  sceneNumber: number;
  summary?: string;
  estimatedDuration?: number;
}

export function syncSceneArtifacts(
  scenes: readonly SceneArtifactInput[],
  sceneSummaries: Map<string, string>,
  sceneEstimatedDurations: Map<string, number>,
): void {
  if (scenes.length === 0) return;
  sceneSummaries.clear();
  sceneEstimatedDurations.clear();
  for (const s of scenes) {
    const key = `scene_${s.sceneNumber}`;
    if (typeof s.summary === 'string' && s.summary.length > 0) {
      sceneSummaries.set(key, s.summary);
    }
    if (typeof s.estimatedDuration === 'number' && s.estimatedDuration > 0) {
      sceneEstimatedDurations.set(key, s.estimatedDuration);
    }
  }
}
