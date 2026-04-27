/**
 * TDD tests for SceneBundleLockMap.
 *
 * Race we're fixing: in prompt_relay mode, the first shot_video for a
 * scene fires the bundle render. The dependency graph only ties
 * shot_video:s1_shot_1 to shot_image:s1_shot_1 — NOT to
 * shot_image:s1_shot_{2..9}. So the bundle render can start before
 * sibling first_frames exist.
 *
 * The renderer detects "not all first_frames ready" and returns null
 * to bail. If we cached that null in the lock map, every later
 * shot_video would get the cached failure and fall through to
 * per-shot — defeating the prompt_relay default.
 *
 * Behavior we want:
 *  1. First call fires the render; returns its promise.
 *  2. Concurrent calls during the render share the same promise (no
 *     duplicate renders, no race-spawning a second submission).
 *  3. If the render resolves to null (transient failure / not ready),
 *     the lock is cleared so the next caller retries.
 *  4. If the render resolves to a path (success), the lock is kept so
 *     siblings reuse the cached path instead of re-rendering.
 *  5. Throws are also treated as transient — lock cleared.
 */

import { describe, it, expect, vi } from 'vitest';
import { SceneBundleLockMap } from '../../src/core/planner/sceneBundleLockMap.js';

describe('SceneBundleLockMap', () => {
  it('first call invokes the render function and returns its result', async () => {
    const map = new SceneBundleLockMap();
    const render = vi.fn().mockResolvedValue('/path/to/scene.mp4');
    const result = await map.acquire(1, render);
    expect(result).toBe('/path/to/scene.mp4');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('concurrent calls during the render share the same promise', async () => {
    const map = new SceneBundleLockMap();
    let resolveRender!: (v: string) => void;
    const render = vi.fn().mockImplementation(
      () => new Promise<string>(r => { resolveRender = r; }),
    );
    const a = map.acquire(1, render);
    const b = map.acquire(1, render);
    const c = map.acquire(1, render);
    expect(render).toHaveBeenCalledTimes(1);
    resolveRender('/path/to/scene.mp4');
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra).toBe('/path/to/scene.mp4');
    expect(rb).toBe('/path/to/scene.mp4');
    expect(rc).toBe('/path/to/scene.mp4');
  });

  it('subsequent calls after a successful render reuse the cached path (no re-render)', async () => {
    const map = new SceneBundleLockMap();
    const render = vi.fn().mockResolvedValue('/path/to/scene.mp4');
    await map.acquire(1, render);
    await map.acquire(1, render);
    await map.acquire(1, render);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('clears the lock when the render returns null so the next caller retries', async () => {
    const map = new SceneBundleLockMap();
    const render = vi.fn()
      .mockResolvedValueOnce(null)                      // first attempt: not ready
      .mockResolvedValueOnce('/path/to/scene.mp4');     // second attempt: ready
    const r1 = await map.acquire(1, render);
    expect(r1).toBe(null);
    const r2 = await map.acquire(1, render);
    expect(r2).toBe('/path/to/scene.mp4');
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('clears the lock when the render throws so the next caller retries', async () => {
    const map = new SceneBundleLockMap();
    const render = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('/path/to/scene.mp4');
    const r1 = await map.acquire(1, render);
    expect(r1).toBe(null);                               // throws normalize to null
    const r2 = await map.acquire(1, render);
    expect(r2).toBe('/path/to/scene.mp4');
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('different scene numbers run independent renders in parallel', async () => {
    const map = new SceneBundleLockMap();
    const render1 = vi.fn().mockResolvedValue('/scene1.mp4');
    const render2 = vi.fn().mockResolvedValue('/scene2.mp4');
    const [a, b] = await Promise.all([
      map.acquire(1, render1),
      map.acquire(2, render2),
    ]);
    expect(a).toBe('/scene1.mp4');
    expect(b).toBe('/scene2.mp4');
    expect(render1).toHaveBeenCalledTimes(1);
    expect(render2).toHaveBeenCalledTimes(1);
  });

  it('concurrent calls during a failing render all see the same null and the lock clears once', async () => {
    const map = new SceneBundleLockMap();
    let rejectRender!: (e: Error) => void;
    const render = vi.fn().mockImplementation(
      () => new Promise<string>((_, rej) => { rejectRender = rej; }),
    );
    const a = map.acquire(1, render);
    const b = map.acquire(1, render);
    rejectRender(new Error('transient'));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(null);
    expect(rb).toBe(null);
    expect(render).toHaveBeenCalledTimes(1);
    // After clearing, a fresh acquire fires a NEW render
    const render2 = vi.fn().mockResolvedValue('/scene1.mp4');
    const c = await map.acquire(1, render2);
    expect(c).toBe('/scene1.mp4');
    expect(render2).toHaveBeenCalledTimes(1);
  });
});
