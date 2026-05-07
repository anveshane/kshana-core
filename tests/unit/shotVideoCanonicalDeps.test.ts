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

  it('appends prevShotVideoId when V2V is on, for serialization across shots', () => {
    const deps = canonicalShotVideoDeps({
      shotImageId: 'shot_image:scene_1_shot_2',
      motionId: 'shot_motion_directive:scene_1_shot_2',
      prevShotVideoId: 'shot_video:scene_1_shot_1',
      useV2V: true,
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

  it('preserves prevShotVideoId for serialization edge when V2V is on', () => {
    const cleaned = sanitizeShotVideoDeps({
      existingDeps: [
        'shot_motion_directive:scene_1_shot_2',  // missing shot_image, wrong otherwise
      ],
      shotImageId: 'shot_image:scene_1_shot_2',
      motionId: 'shot_motion_directive:scene_1_shot_2',
      prevShotVideoId: 'shot_video:scene_1_shot_1',
      useV2V: true,
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

// ─────────────────────────────────────────────────────────────────────
// V2V-aware behavior. The previous-shot edge models the V2V chain (each
// shot's video continues from the previous shot's video). When V2V is
// disabled (the default — flfv mode generates each shot independently
// from its own first/last frame images), the edge is a phantom: it has
// no data semantics but DependencyGraphExecutor.invalidateNode walks it
// as a real dep, so invalidating one shot cascades to every following
// shot AND final_video. Symptom in production: user redoes shot 1, all
// nine shots regenerate. Final video correctness still holds because
// final_video → shot_video edges live in the template (stages.ts), not
// here — invalidation reaches final_video through those.
// ─────────────────────────────────────────────────────────────────────

describe('canonicalShotVideoDeps with useV2V flag', () => {
  it('omits prevShotVideoId when useV2V=false even if a prev shot exists', () => {
    const deps = canonicalShotVideoDeps({
      shotImageId: 'shot_image:scene_1_shot_2',
      motionId: 'shot_motion_directive:scene_1_shot_2',
      prevShotVideoId: 'shot_video:scene_1_shot_1',
      useV2V: false,
    });
    expect(deps).toEqual([
      'shot_image:scene_1_shot_2',
      'shot_motion_directive:scene_1_shot_2',
    ]);
  });

  it('still includes prevShotVideoId when useV2V=true', () => {
    const deps = canonicalShotVideoDeps({
      shotImageId: 'shot_image:scene_1_shot_2',
      motionId: 'shot_motion_directive:scene_1_shot_2',
      prevShotVideoId: 'shot_video:scene_1_shot_1',
      useV2V: true,
    });
    expect(deps).toContain('shot_video:scene_1_shot_1');
  });

  it('treats undefined useV2V as false (current default in project.json)', () => {
    // project.useV2V is opt-in; legacy/un-flagged projects should get
    // the safer no-cascade behavior.
    const deps = canonicalShotVideoDeps({
      shotImageId: 'shot_image:scene_1_shot_2',
      motionId: 'shot_motion_directive:scene_1_shot_2',
      prevShotVideoId: 'shot_video:scene_1_shot_1',
    });
    expect(deps).not.toContain('shot_video:scene_1_shot_1');
  });
});

describe('sanitizeShotVideoDeps with useV2V flag', () => {
  it('strips a stale shot_video previous-shot dep when useV2V=false', () => {
    // Existing project on disk has the V2V chain dep persisted from a
    // pre-fix run. With V2V off, sanitize must strip it so the cascade
    // doesn't propagate through the phantom edge.
    const cleaned = sanitizeShotVideoDeps({
      existingDeps: [
        'shot_image:scene_1_shot_2',
        'shot_motion_directive:scene_1_shot_2',
        'shot_video:scene_1_shot_1',
      ],
      shotImageId: 'shot_image:scene_1_shot_2',
      motionId: 'shot_motion_directive:scene_1_shot_2',
      prevShotVideoId: 'shot_video:scene_1_shot_1',
      useV2V: false,
    });
    expect(cleaned).not.toContain('shot_video:scene_1_shot_1');
    expect(cleaned).toContain('shot_image:scene_1_shot_2');
    expect(cleaned).toContain('shot_motion_directive:scene_1_shot_2');
  });

  it('preserves the previous-shot dep when useV2V=true', () => {
    const cleaned = sanitizeShotVideoDeps({
      existingDeps: [
        'shot_image:scene_1_shot_2',
        'shot_motion_directive:scene_1_shot_2',
      ],
      shotImageId: 'shot_image:scene_1_shot_2',
      motionId: 'shot_motion_directive:scene_1_shot_2',
      prevShotVideoId: 'shot_video:scene_1_shot_1',
      useV2V: true,
    });
    expect(cleaned).toContain('shot_video:scene_1_shot_1');
  });

  it('only strips the matching previous-shot dep, not unrelated shot_video refs', () => {
    // Defensive: if some other shot_video appears as a dep for a non-V2V
    // reason we don't know about, leave it alone. Strip only the exact
    // prevShotVideoId we were told to drop.
    const cleaned = sanitizeShotVideoDeps({
      existingDeps: [
        'shot_image:scene_1_shot_2',
        'shot_motion_directive:scene_1_shot_2',
        'shot_video:scene_1_shot_1',  // the V2V chain dep we drop
        'shot_video:scene_2_shot_3',  // unrelated, keep
      ],
      shotImageId: 'shot_image:scene_1_shot_2',
      motionId: 'shot_motion_directive:scene_1_shot_2',
      prevShotVideoId: 'shot_video:scene_1_shot_1',
      useV2V: false,
    });
    expect(cleaned).not.toContain('shot_video:scene_1_shot_1');
    expect(cleaned).toContain('shot_video:scene_2_shot_3');
  });
});
