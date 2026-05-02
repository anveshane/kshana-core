/**
 * Tests for the canonical-deps rebuild helper used by
 * `expandSceneBreakdownGraph` to fix corrupted `shot_video` per-item
 * nodes.
 *
 * Background: the dep-graph expander has a known bug where
 * `shot_video:scene_X_shot_Y` can end up with bogus deps like ALL of
 * scene X's `shot_motion_directive:scene_X_shot_*` entries, AND the
 * `shot_image:scene_X_shot_Y` dep missing entirely. Symptom: the
 * executor fires shot_video before shot_image is generated, and
 * `executeSceneBundle` falls back to "no first_frame yet — bundle waits"
 * → eventually fails.
 *
 * The defensive fix: after expansion, materialization rebuilds each
 * shot_video's deps from a canonical set: [shotImageId, motionId,
 * prevShotVideoId?]. Plus stripping any stray per-item refs that don't
 * match this shot.
 */
import { describe, it, expect } from 'vitest';
import { canonicalShotVideoDeps, sanitizeShotVideoDeps } from '../../src/core/planner/shotVideoCanonicalDeps.js';

describe('canonicalShotVideoDeps', () => {
  it('returns [shotImageId, motionId] for the first shot of a scene', () => {
    const deps = canonicalShotVideoDeps({
      shotImageId: 'shot_image:scene_1_shot_1',
      motionId: 'shot_motion_directive:scene_1_shot_1',
      prevShotVideoId: null,
    });
    expect(deps).toEqual([
      'shot_image:scene_1_shot_1',
      'shot_motion_directive:scene_1_shot_1',
    ]);
  });

  it('appends prevShotVideoId when set, for serialization across shots', () => {
    const deps = canonicalShotVideoDeps({
      shotImageId: 'shot_image:scene_1_shot_2',
      motionId: 'shot_motion_directive:scene_1_shot_2',
      prevShotVideoId: 'shot_video:scene_1_shot_1',
    });
    expect(deps).toEqual([
      'shot_image:scene_1_shot_2',
      'shot_motion_directive:scene_1_shot_2',
      'shot_video:scene_1_shot_1',
    ]);
  });
});

describe('sanitizeShotVideoDeps', () => {
  it('rebuilds from canonical when existing deps are correct (idempotent)', () => {
    const cleaned = sanitizeShotVideoDeps({
      existingDeps: [
        'shot_image:scene_1_shot_1',
        'shot_motion_directive:scene_1_shot_1',
      ],
      shotImageId: 'shot_image:scene_1_shot_1',
      motionId: 'shot_motion_directive:scene_1_shot_1',
      prevShotVideoId: null,
    });
    expect(cleaned).toEqual([
      'shot_image:scene_1_shot_1',
      'shot_motion_directive:scene_1_shot_1',
    ]);
  });

  it('inserts missing shot_image dep — the bug we shipped to fix', () => {
    // Reproduces the corrupted state from the failed Parvati run:
    // shot_video had ALL 15 motion directives but NO shot_image dep.
    const cleaned = sanitizeShotVideoDeps({
      existingDeps: [
        'shot_motion_directive:scene_1_shot_1',
        'shot_motion_directive:scene_1_shot_2',
        'shot_motion_directive:scene_1_shot_3',
      ],
      shotImageId: 'shot_image:scene_1_shot_1',
      motionId: 'shot_motion_directive:scene_1_shot_1',
      prevShotVideoId: null,
    });
    expect(cleaned).toContain('shot_image:scene_1_shot_1');
    expect(cleaned).toContain('shot_motion_directive:scene_1_shot_1');
  });

  it('strips bogus per-item shot_motion_directive refs that don\'t match this shot', () => {
    const cleaned = sanitizeShotVideoDeps({
      existingDeps: [
        'shot_motion_directive:scene_1_shot_1',
        'shot_motion_directive:scene_1_shot_2',  // bogus — wrong shot
        'shot_motion_directive:scene_1_shot_3',  // bogus — wrong shot
      ],
      shotImageId: 'shot_image:scene_1_shot_1',
      motionId: 'shot_motion_directive:scene_1_shot_1',
      prevShotVideoId: null,
    });
    expect(cleaned).not.toContain('shot_motion_directive:scene_1_shot_2');
    expect(cleaned).not.toContain('shot_motion_directive:scene_1_shot_3');
  });

  it('strips bogus per-item shot_image refs that don\'t match this shot', () => {
    const cleaned = sanitizeShotVideoDeps({
      existingDeps: [
        'shot_image:scene_1_shot_1',
        'shot_image:scene_1_shot_2',  // bogus
      ],
      shotImageId: 'shot_image:scene_1_shot_1',
      motionId: 'shot_motion_directive:scene_1_shot_1',
      prevShotVideoId: null,
    });
    expect(cleaned).not.toContain('shot_image:scene_1_shot_2');
    expect(cleaned).toContain('shot_image:scene_1_shot_1');
  });

  it('preserves prevShotVideoId for serialization edge', () => {
    const cleaned = sanitizeShotVideoDeps({
      existingDeps: [
        'shot_motion_directive:scene_1_shot_2',  // missing shot_image, wrong otherwise
      ],
      shotImageId: 'shot_image:scene_1_shot_2',
      motionId: 'shot_motion_directive:scene_1_shot_2',
      prevShotVideoId: 'shot_video:scene_1_shot_1',
    });
    expect(cleaned).toContain('shot_video:scene_1_shot_1');
  });

  it('does not introduce duplicates when canonical deps already present', () => {
    const cleaned = sanitizeShotVideoDeps({
      existingDeps: [
        'shot_image:scene_1_shot_1',
        'shot_motion_directive:scene_1_shot_1',
        'shot_video:scene_1_shot_0',
      ],
      shotImageId: 'shot_image:scene_1_shot_1',
      motionId: 'shot_motion_directive:scene_1_shot_1',
      prevShotVideoId: 'shot_video:scene_1_shot_0',
    });
    // No duplicates
    const counts = cleaned.reduce<Record<string, number>>((acc, d) => {
      acc[d] = (acc[d] ?? 0) + 1;
      return acc;
    }, {});
    for (const [, n] of Object.entries(counts)) {
      expect(n).toBe(1);
    }
  });

  it('preserves unrelated dep refs (e.g. character_image, world_style) so we don\'t lose information', () => {
    // Defensive: if some unknown dep type is on the node (because the
    // expansion code added it for a reason we don't understand), keep it.
    // sanitize only strips KNOWN-corrupt patterns (per-item refs of
    // shot_image / shot_motion_directive that don't match this shot).
    const cleaned = sanitizeShotVideoDeps({
      existingDeps: [
        'shot_motion_directive:scene_1_shot_1',
        'character_image:parvati',
        'world_style',
      ],
      shotImageId: 'shot_image:scene_1_shot_1',
      motionId: 'shot_motion_directive:scene_1_shot_1',
      prevShotVideoId: null,
    });
    expect(cleaned).toContain('character_image:parvati');
    expect(cleaned).toContain('world_style');
  });
});
