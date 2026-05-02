/**
 * Tests for `syncSceneArtifacts`.
 *
 * Background: ExecutorAgent kept two Maps (`sceneSummaries`,
 * `sceneEstimatedDurations`) and persisted them to
 * `prompts/scene_summaries.json` / `prompts/scene_durations.json` after
 * each extraction. The persistence loop only called `.set()`, never
 * `.clear()` or `.delete()`. When a re-run produced fewer scenes than
 * a prior run, the stale keys lingered in the Maps (loaded from disk at
 * startup) and were written back to disk. Result: re-running the Parvati
 * project at 60s with the new scene-count cap produced 2 scenes
 * (scene_1=44s, scene_2=30.5s) but disk still showed scene_3=88.5,
 * scene_4=59 from the prior 4-scene run.
 *
 * `syncSceneArtifacts` rebuilds both maps from the new extraction's
 * scene list, dropping any stale keys. It is a no-op when the input is
 * empty so per-collection re-extractions (character/setting/object
 * collections that don't carry scene data) don't accidentally wipe
 * already-populated maps.
 */
import { describe, it, expect } from 'vitest';
import { syncSceneArtifacts } from '../../src/core/planner/syncSceneArtifacts.js';

describe('syncSceneArtifacts', () => {
  it('drops stale keys when the new extraction returns fewer scenes', () => {
    const summaries = new Map<string, string>([
      ['scene_1', 'old1'],
      ['scene_2', 'old2'],
      ['scene_3', 'old3'],
      ['scene_4', 'old4'],
    ]);
    const durations = new Map<string, number>([
      ['scene_1', 61.5],
      ['scene_2', 79],
      ['scene_3', 88.5],
      ['scene_4', 59],
    ]);
    syncSceneArtifacts(
      [
        { sceneNumber: 1, summary: 'new1', estimatedDuration: 44 },
        { sceneNumber: 2, summary: 'new2', estimatedDuration: 30.5 },
      ],
      summaries,
      durations,
    );
    expect([...summaries.keys()].sort()).toEqual(['scene_1', 'scene_2']);
    expect(summaries.get('scene_1')).toBe('new1');
    expect(summaries.get('scene_2')).toBe('new2');
    expect(durations.size).toBe(2);
    expect(durations.get('scene_3')).toBeUndefined();
    expect(durations.get('scene_4')).toBeUndefined();
  });

  it('overwrites updated values for keys that exist in both old and new', () => {
    const summaries = new Map([['scene_1', 'old']]);
    const durations = new Map([['scene_1', 100]]);
    syncSceneArtifacts(
      [{ sceneNumber: 1, summary: 'fresh', estimatedDuration: 30 }],
      summaries,
      durations,
    );
    expect(summaries.get('scene_1')).toBe('fresh');
    expect(durations.get('scene_1')).toBe(30);
  });

  it('skips entries with no summary string but still writes the key when duration is present', () => {
    const summaries = new Map<string, string>();
    const durations = new Map<string, number>();
    syncSceneArtifacts(
      [{ sceneNumber: 1, estimatedDuration: 30 }],
      summaries,
      durations,
    );
    expect(summaries.has('scene_1')).toBe(false);
    expect(durations.get('scene_1')).toBe(30);
  });

  it('skips entries with zero/undefined estimatedDuration', () => {
    const summaries = new Map<string, string>();
    const durations = new Map<string, number>([['scene_5', 100]]); // stale
    syncSceneArtifacts(
      [
        { sceneNumber: 1, summary: 'one', estimatedDuration: 0 },
        { sceneNumber: 2, summary: 'two' },
      ],
      summaries,
      durations,
    );
    expect(summaries.get('scene_1')).toBe('one');
    expect(summaries.get('scene_2')).toBe('two');
    // Both stale and the zero-duration scenes are dropped from durations
    expect(durations.size).toBe(0);
  });

  it('is a no-op when the input scenes array is empty', () => {
    // Important: per-collection extractions for character/setting/object
    // pass through this code path with no scene data; they must not wipe
    // a previously-populated set of scene maps.
    const summaries = new Map([['scene_1', 'preserved']]);
    const durations = new Map([['scene_1', 30]]);
    syncSceneArtifacts([], summaries, durations);
    expect(summaries.get('scene_1')).toBe('preserved');
    expect(durations.get('scene_1')).toBe(30);
  });

  it('handles an empty starting state correctly', () => {
    const summaries = new Map<string, string>();
    const durations = new Map<string, number>();
    syncSceneArtifacts(
      [
        { sceneNumber: 1, summary: 'a', estimatedDuration: 20 },
        { sceneNumber: 2, summary: 'b', estimatedDuration: 30 },
      ],
      summaries,
      durations,
    );
    expect(summaries.size).toBe(2);
    expect(durations.size).toBe(2);
  });

  it('preserves order of insertion in the Map', () => {
    const summaries = new Map<string, string>();
    const durations = new Map<string, number>();
    syncSceneArtifacts(
      [
        { sceneNumber: 2, summary: 'b', estimatedDuration: 30 },
        { sceneNumber: 1, summary: 'a', estimatedDuration: 20 },
      ],
      summaries,
      durations,
    );
    // Keys should appear in the order they were processed.
    expect([...summaries.keys()]).toEqual(['scene_2', 'scene_1']);
  });
});
