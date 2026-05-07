/**
 * Red-Green TDD for shouldForceEditPrevious — the policy decision the
 * executor uses to override the LLM's generationMode choice when chaining
 * is required for visual continuity.
 *
 * The LLM frequently picks `image_text_to_image` even when the prior shot
 * is right there to be chained on (we observed this in The Village's
 * regeneration: every mid-scene shot came back with mode
 * "image_text_to_image" despite the directive). This helper encodes the
 * deterministic policy so the executor can stop trusting the LLM.
 *
 * Policy:
 *   force chain when prior shot is available AND it's not an explicit
 *   transition (continuityRole in entry/exit/bridge) AND not a
 *   show_clue insert. Mid-scene shots default to chain. Scene-1 shot-1
 *   never chains (no prior). Scene N+1 shot 1 chains only when the
 *   scene declares an `entry` string.
 */

import { describe, it, expect } from 'vitest';

describe('shouldForceEditPrevious', () => {
  it('returns false for scene_1 shot 1 (project start, no prior)', async () => {
    const { shouldForceEditPrevious } = await import('../../src/core/planner/shotReferenceMapping.js');
    expect(shouldForceEditPrevious({
      itemId: 'scene_1_shot_1',
      previousShotAvailable: false,
    })).toBe(false);
  });

  it('returns true for mid-scene shot with prior and no role/purpose carve-out', async () => {
    const { shouldForceEditPrevious } = await import('../../src/core/planner/shotReferenceMapping.js');
    expect(shouldForceEditPrevious({
      itemId: 'scene_2_shot_3',
      previousShotAvailable: true,
      purpose: 'show_action',
    })).toBe(true);
  });

  it('returns false when continuityRole is bridge (explicit location transition)', async () => {
    const { shouldForceEditPrevious } = await import('../../src/core/planner/shotReferenceMapping.js');
    expect(shouldForceEditPrevious({
      itemId: 'scene_2_shot_4',
      previousShotAvailable: true,
      continuityRole: 'bridge',
      purpose: 'show_passage',
    })).toBe(false);
  });

  it('returns false when continuityRole is entry (mid-scene location entry)', async () => {
    const { shouldForceEditPrevious } = await import('../../src/core/planner/shotReferenceMapping.js');
    expect(shouldForceEditPrevious({
      itemId: 'scene_2_shot_3',
      previousShotAvailable: true,
      continuityRole: 'entry',
    })).toBe(false);
  });

  it('returns false when continuityRole is exit', async () => {
    const { shouldForceEditPrevious } = await import('../../src/core/planner/shotReferenceMapping.js');
    expect(shouldForceEditPrevious({
      itemId: 'scene_2_shot_3',
      previousShotAvailable: true,
      continuityRole: 'exit',
    })).toBe(false);
  });

  it('returns false when purpose is show_clue (fresh detail insert)', async () => {
    const { shouldForceEditPrevious } = await import('../../src/core/planner/shotReferenceMapping.js');
    expect(shouldForceEditPrevious({
      itemId: 'scene_1_shot_4',
      previousShotAvailable: true,
      purpose: 'show_clue',
    })).toBe(false);
  });

  it('returns false when no prior shot is available (defensive)', async () => {
    const { shouldForceEditPrevious } = await import('../../src/core/planner/shotReferenceMapping.js');
    expect(shouldForceEditPrevious({
      itemId: 'scene_2_shot_3',
      previousShotAvailable: false,
    })).toBe(false);
  });

  it('returns true for scene N+1 shot 1 when the scene declares an entry transition', async () => {
    const { shouldForceEditPrevious } = await import('../../src/core/planner/shotReferenceMapping.js');
    expect(shouldForceEditPrevious({
      itemId: 'scene_2_shot_1',
      previousShotAvailable: true,
      sceneEntry: 'Lena steps off the trapdoor threshold from scene 1 exit',
    })).toBe(true);
  });

  it('returns false for scene N+1 shot 1 when no scene entry is declared (true cut)', async () => {
    const { shouldForceEditPrevious } = await import('../../src/core/planner/shotReferenceMapping.js');
    expect(shouldForceEditPrevious({
      itemId: 'scene_2_shot_1',
      previousShotAvailable: true,
      sceneEntry: undefined,
    })).toBe(false);
  });

  it('returns false for scene N+1 shot 1 when entry is declared but continuityRole is entry/exit/bridge', async () => {
    const { shouldForceEditPrevious } = await import('../../src/core/planner/shotReferenceMapping.js');
    expect(shouldForceEditPrevious({
      itemId: 'scene_2_shot_1',
      previousShotAvailable: true,
      sceneEntry: 'protagonist arrives at the new location',
      continuityRole: 'entry',
    })).toBe(false);
  });

  it('treats empty/whitespace sceneEntry as not declared', async () => {
    const { shouldForceEditPrevious } = await import('../../src/core/planner/shotReferenceMapping.js');
    expect(shouldForceEditPrevious({
      itemId: 'scene_2_shot_1',
      previousShotAvailable: true,
      sceneEntry: '   ',
    })).toBe(false);
  });

  it('handles itemIds that do not match scene_N_shot_M (defensive false)', async () => {
    const { shouldForceEditPrevious } = await import('../../src/core/planner/shotReferenceMapping.js');
    expect(shouldForceEditPrevious({
      itemId: 'unknown_id',
      previousShotAvailable: true,
    })).toBe(false);
  });
});
