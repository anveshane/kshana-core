/**
 * Per-scene render-once-or-await lock map for prompt-relay bundles.
 *
 * In prompt_relay mode, multiple shot_video nodes for the same scene
 * arrive at the executor and all want the SAME bundle mp4. The first
 * to arrive should fire the render; the rest should `await` the same
 * promise so we never submit the same job twice.
 *
 * Failure-vs-success caching matters:
 *
 *   - On success (render returns a non-null path): keep the lock so
 *     later siblings reuse the path instead of re-rendering.
 *   - On null or throw: clear the lock so the NEXT caller retries.
 *     This handles the common race where shot_video for shot 1 fires
 *     before sibling shot_images have completed; the renderer bails
 *     with null, and we want shot_video for shot 5 (whose own
 *     shot_image just finished) to try again.
 *
 * Throws normalize to null so callers don't have to handle two
 * failure shapes.
 */

export type SceneBundleRender = () => Promise<string | null>;

export class SceneBundleLockMap {
  private locks = new Map<number, Promise<string | null>>();

  acquire(sceneNum: number, render: SceneBundleRender): Promise<string | null> {
    const existing = this.locks.get(sceneNum);
    if (existing) return existing;

    const promise = (async () => {
      try {
        return await render();
      } catch {
        return null;
      }
    })().then(result => {
      if (result === null) this.locks.delete(sceneNum);
      return result;
    });

    this.locks.set(sceneNum, promise);
    return promise;
  }

  /** For testing / external invalidation. */
  clear(sceneNum?: number): void {
    if (sceneNum === undefined) this.locks.clear();
    else this.locks.delete(sceneNum);
  }
}
