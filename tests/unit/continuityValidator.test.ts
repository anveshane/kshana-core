/**
 * Tests for continuity validators:
 *  1. validateContinuitySequence — sync JSON walk
 *  2. checkPositionContinuity — LLM-based teleport check
 */

import { describe, it, expect } from 'vitest';
import {
  validateContinuitySequence,
  checkPositionContinuity,
  formatWarnings,
  shouldRerollShot,
  type ContinuityShotInput,
  type ContinuityWarning,
} from '../../src/core/planner/continuityValidator.js';
import type { SceneState } from '../../src/core/planner/sceneState.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function shot(n: number, role: string = 'none'): ContinuityShotInput {
  return { shotNumber: n, continuityRole: role };
}

function makeState(
  shotNum: number,
  charId: string,
  position: string,
  inFrame = true,
): SceneState {
  return {
    sceneId: 'scene_1',
    shotNumber: shotNum,
    characters: {
      [charId]: {
        position,
        pose: 'unknown',
        expression: 'unknown',
        facing: 'unknown',
        inFrame,
        leftHand: 'unknown',
        rightHand: 'unknown',
        legs: 'unknown',
        headTilt: 'unknown',
      },
    },
    objects: {},
    environment: { lighting: 'default', timeProgression: 'start' },
  };
}

/** Fake LLM that returns a pre-set JSON response. */
function fakeLLM(response: { teleport: boolean; reason: string }) {
  return {
    generateStream: async function* () {
      yield { content: JSON.stringify(response), done: true };
    },
  };
}

// ── Option 1: Sequence validator ─────────────────────────────────────────────

describe('validateContinuitySequence', () => {
  it('accepts an all-none sequence with no warnings', () => {
    const warnings = validateContinuitySequence({
      shots: [shot(1), shot(2), shot(3)],
    });
    expect(warnings).toHaveLength(0);
  });

  it('accepts exit → bridge → entry sequence', () => {
    const warnings = validateContinuitySequence({
      shots: [shot(1), shot(2, 'exit'), shot(3, 'bridge'), shot(4, 'entry'), shot(5)],
    });
    expect(warnings).toHaveLength(0);
  });

  it('accepts exit → entry sequence (no bridge needed)', () => {
    const warnings = validateContinuitySequence({
      shots: [shot(1), shot(2, 'exit'), shot(3, 'entry')],
    });
    expect(warnings).toHaveLength(0);
  });

  it('flags second exit without entry between them', () => {
    const warnings = validateContinuitySequence({
      shots: [shot(1, 'exit'), shot(2), shot(3, 'exit')],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.scope).toBe('sequence');
    expect(warnings[0]!.shotNumber).toBe(3);
    expect(warnings[0]!.message).toMatch(/Second 'exit'/);
  });

  it('flags entry mid-scene without prior exit', () => {
    const warnings = validateContinuitySequence({
      shots: [shot(1), shot(2), shot(3, 'entry')],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.scope).toBe('sequence');
    expect(warnings[0]!.shotNumber).toBe(3);
    expect(warnings[0]!.message).toMatch(/no matching 'exit'/);
  });

  it('allows entry as the first shot (scene opener)', () => {
    const warnings = validateContinuitySequence({
      shots: [shot(1, 'entry'), shot(2)],
    });
    expect(warnings).toHaveLength(0);
  });

  it('flags bridge without prior exit', () => {
    const warnings = validateContinuitySequence({
      shots: [shot(1), shot(2, 'bridge')],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toMatch(/'bridge'.*no prior 'exit'/);
  });

  it('allows unresolved exit at end of scene (mainSubject leaves)', () => {
    const warnings = validateContinuitySequence({
      shots: [shot(1), shot(2), shot(3, 'exit')],
    });
    expect(warnings).toHaveLength(0);
  });

  it('does not flag continuityRole undefined (default "none")', () => {
    const warnings = validateContinuitySequence({
      shots: [{ shotNumber: 1 }, { shotNumber: 2 }],
    });
    expect(warnings).toHaveLength(0);
  });
});

// ── Option 2: LLM-based position continuity ─────────────────────────────────

describe('checkPositionContinuity', () => {
  const vikram = 'vikram';

  it('returns null when states are absent', async () => {
    const llm = fakeLLM({ teleport: true, reason: 'x' });
    const w = await checkPositionContinuity(null, null, vikram, 'none', 5, llm);
    expect(w).toBeNull();
  });

  it('returns null when mainSubject is missing', async () => {
    const prev = makeState(1, vikram, 'at_table');
    const target = makeState(2, vikram, 'at_door');
    const llm = fakeLLM({ teleport: true, reason: 'x' });
    const w = await checkPositionContinuity(prev, target, null, 'none', 2, llm);
    expect(w).toBeNull();
  });

  it('returns null when positions are identical', async () => {
    const prev = makeState(1, vikram, 'at_table');
    const target = makeState(2, vikram, 'at_table');
    const llm = fakeLLM({ teleport: true, reason: 'should_not_be_asked' });
    const w = await checkPositionContinuity(prev, target, vikram, 'none', 2, llm);
    expect(w).toBeNull();
  });

  it('returns null when continuityRole is "exit" (explicit bridge shot)', async () => {
    const prev = makeState(1, vikram, 'at_table');
    const target = makeState(2, vikram, 'at_door');
    const llm = fakeLLM({ teleport: true, reason: 'should_not_be_asked' });
    const w = await checkPositionContinuity(prev, target, vikram, 'exit', 2, llm);
    expect(w).toBeNull();
  });

  it('returns null when continuityRole is "entry"', async () => {
    const prev = makeState(1, vikram, 'at_dhaba');
    const target = makeState(2, vikram, 'at_temple');
    const llm = fakeLLM({ teleport: true, reason: 'should_not_be_asked' });
    const w = await checkPositionContinuity(prev, target, vikram, 'entry', 2, llm);
    expect(w).toBeNull();
  });

  it('returns null when continuityRole is "bridge"', async () => {
    const prev = makeState(1, vikram, 'at_dhaba');
    const target = makeState(2, vikram, 'in_alley');
    const llm = fakeLLM({ teleport: true, reason: 'should_not_be_asked' });
    const w = await checkPositionContinuity(prev, target, vikram, 'bridge', 2, llm);
    expect(w).toBeNull();
  });

  it('returns null when position is "unknown" in either state', async () => {
    const prev = makeState(1, vikram, 'unknown');
    const target = makeState(2, vikram, 'at_door');
    const llm = fakeLLM({ teleport: true, reason: 'x' });
    const w = await checkPositionContinuity(prev, target, vikram, 'none', 2, llm);
    expect(w).toBeNull();
  });

  it('returns null when character is off-screen in both states', async () => {
    const prev = makeState(1, vikram, 'off_screen', false);
    const target = makeState(2, vikram, 'somewhere_else', false);
    const llm = fakeLLM({ teleport: true, reason: 'should_not_be_asked' });
    const w = await checkPositionContinuity(prev, target, vikram, 'none', 2, llm);
    expect(w).toBeNull();
  });

  it('emits warning when LLM says teleport=true', async () => {
    const prev = makeState(1, vikram, 'seated_at_dhaba_table');
    const target = makeState(2, vikram, 'running_in_alley');
    const llm = fakeLLM({ teleport: true, reason: 'Dhaba → alley with no bridge' });
    const w = await checkPositionContinuity(prev, target, vikram, 'none', 2, llm);
    expect(w).not.toBeNull();
    expect(w!.scope).toBe('position');
    expect(w!.shotNumber).toBe(2);
    expect(w!.message).toContain('vikram');
    expect(w!.message).toContain('Dhaba');
  });

  it('suppresses warning when LLM says teleport=false', async () => {
    const prev = makeState(1, vikram, 'standing_near_door');
    const target = makeState(2, vikram, 'at_doorway');
    const llm = fakeLLM({ teleport: false, reason: 'same physical space' });
    const w = await checkPositionContinuity(prev, target, vikram, 'none', 2, llm);
    expect(w).toBeNull();
  });

  it('handles malformed LLM JSON gracefully (no warning)', async () => {
    const prev = makeState(1, vikram, 'a');
    const target = makeState(2, vikram, 'b');
    const brokenLLM = {
      generateStream: async function* () {
        yield { content: 'not json at all', done: true };
      },
    };
    const w = await checkPositionContinuity(prev, target, vikram, 'none', 2, brokenLLM);
    expect(w).toBeNull();
  });

  it('handles markdown-fenced JSON from LLM', async () => {
    const prev = makeState(1, vikram, 'room_a');
    const target = makeState(2, vikram, 'room_b');
    const llm = {
      generateStream: async function* () {
        yield { content: '```json\n{"teleport": true, "reason": "different rooms"}\n```', done: true };
      },
    };
    const w = await checkPositionContinuity(prev, target, vikram, 'none', 2, llm);
    expect(w).not.toBeNull();
    expect(w!.message).toContain('different rooms');
  });
});

// ── Formatting ──────────────────────────────────────────────────────────────

describe('formatWarnings', () => {
  it('formats empty list as "No continuity warnings"', () => {
    expect(formatWarnings([])).toBe('No continuity warnings');
  });

  it('formats warnings one per line with scope/shot prefix', () => {
    const out = formatWarnings([
      { scope: 'sequence', shotNumber: 3, message: 'bad', suggestion: 'fix it' },
      { scope: 'position', shotNumber: 7, message: 'teleport' },
    ]);
    expect(out).toContain('[sequence:shot3] bad — fix it');
    expect(out).toContain('[position:shot7] teleport');
  });
});

// ── Auto-reroll decision ────────────────────────────────────────────────────

describe('shouldRerollShot — auto-reroll decision for drifting shots', () => {
  it('returns no-reroll for null warning', () => {
    const decision = shouldRerollShot(null);
    expect(decision.reroll).toBe(false);
    expect(decision.hint).toBe('');
  });

  it('does NOT reroll sequence-scope warnings (scene beats need LLM replan)', () => {
    const warning: ContinuityWarning = {
      scope: 'sequence',
      shotNumber: 2,
      message: 'Mismatched exit marker',
      suggestion: 'Add a matching entry',
    };
    const decision = shouldRerollShot(warning);
    expect(decision.reroll).toBe(false);
    expect(decision.hint).toBe('');
  });

  it('rerolls position-scope (teleport) warnings with a bridging hint', () => {
    const warning: ContinuityWarning = {
      scope: 'position',
      shotNumber: 3,
      message: 'Possible teleport: character jumped from bedroom to kitchen',
      suggestion: 'Add a bridge shot',
    };
    const decision = shouldRerollShot(warning);
    expect(decision.reroll).toBe(true);
    expect(decision.hint).toContain('continuity_hint');
    expect(decision.hint).toContain('shot 3');
    expect(decision.hint).toContain('teleport');
    expect(decision.hint).toContain('Add a bridge shot');
  });

  it('includes the validator suggestion verbatim in the hint when present', () => {
    const warning: ContinuityWarning = {
      scope: 'position',
      shotNumber: 5,
      message: 'Main subject moved suspiciously',
      suggestion: 'Add continuityRole="bridge" or insert a motion shot',
    };
    const decision = shouldRerollShot(warning);
    expect(decision.hint).toContain('Fix:');
    expect(decision.hint).toContain('Add continuityRole="bridge"');
  });

  it('still emits a hint when the suggestion is absent', () => {
    const warning: ContinuityWarning = {
      scope: 'position',
      shotNumber: 2,
      message: 'Teleport detected',
    };
    const decision = shouldRerollShot(warning);
    expect(decision.reroll).toBe(true);
    expect(decision.hint).toContain('continuity_hint');
    expect(decision.hint).not.toContain('Fix:');
  });

  it('hint tells the LLM to bridge, not to regenerate fresh', () => {
    const warning: ContinuityWarning = {
      scope: 'position',
      shotNumber: 4,
      message: 'Character jumped across scene',
    };
    const decision = shouldRerollShot(warning);
    expect(decision.hint).toMatch(/bridge/i);
    expect(decision.hint).toMatch(/not.*teleport|teleport/i);
  });
});

// ── One-setting-per-scene validator ──────────────────────────────────────────
//
// Defects motivating this validator:
//
//   - The Village shot 2.3: imagePrompt referenced TWO settings
//     ("forest from image 2" AND "forest edge from image 1") in a single
//     shot. With Flux Klein's 4-slot cap and slot 1 reserved for the base,
//     two settings competing for the canvas mangles the framing.
//
// Rule: a scene's shots may reference at most ONE setting refId via
// focus.primary / focus.background. If multiple settings appear, the
// scene needs a continuityRole='bridge' shot to mark the transition; without
// it, this is the LLM listing redundant aliases for one location.

describe('validateOneSettingPerScene', () => {
  it('passes when every shot uses the same setting', async () => {
    const { validateOneSettingPerScene } = await import('../../src/core/planner/continuityValidator.js');
    const warnings = validateOneSettingPerScene({
      shots: [
        { shotNumber: 1, focus: { primary: 'protagonist', background: ['forest'] } },
        { shotNumber: 2, focus: { primary: 'forest', background: ['protagonist'] } },
        { shotNumber: 3, focus: { primary: 'protagonist', background: ['forest'] } },
      ],
      knownSettingRefIds: ['forest', 'forest_edge', 'underground_tunnel'],
    });
    expect(warnings).toHaveLength(0);
  });

  it('warns when shots reference multiple settings without a bridge', async () => {
    const { validateOneSettingPerScene } = await import('../../src/core/planner/continuityValidator.js');
    const warnings = validateOneSettingPerScene({
      shots: [
        { shotNumber: 1, focus: { primary: 'protagonist', background: ['forest'] } },
        { shotNumber: 2, focus: { primary: 'forest', background: ['protagonist'] } },
        { shotNumber: 3, focus: { primary: 'officer', background: ['forest_edge', 'forest'] } },
      ],
      knownSettingRefIds: ['forest', 'forest_edge'],
    });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.scope).toBe('sequence');
    expect(warnings[0]?.message).toMatch(/setting/i);
  });

  it('does not warn when multi-setting use is justified by a bridge shot', async () => {
    const { validateOneSettingPerScene } = await import('../../src/core/planner/continuityValidator.js');
    const warnings = validateOneSettingPerScene({
      shots: [
        { shotNumber: 1, continuityRole: 'none', focus: { primary: 'protagonist', background: ['forest'] } },
        { shotNumber: 2, continuityRole: 'bridge', focus: { primary: 'forest_edge', background: ['protagonist'] } },
        { shotNumber: 3, continuityRole: 'entry', focus: { primary: 'protagonist', background: ['forest_edge'] } },
      ],
      knownSettingRefIds: ['forest', 'forest_edge'],
    });
    expect(warnings).toHaveLength(0);
  });

  it('only counts setting refIds — character refIds in focus do not trigger the warning', async () => {
    const { validateOneSettingPerScene } = await import('../../src/core/planner/continuityValidator.js');
    const warnings = validateOneSettingPerScene({
      shots: [
        { shotNumber: 1, focus: { primary: 'protagonist', background: ['officer', 'sister'] } },
        { shotNumber: 2, focus: { primary: 'officer', background: ['protagonist'] } },
      ],
      knownSettingRefIds: ['forest'], // none used
    });
    expect(warnings).toHaveLength(0);
  });

  it('handles missing focus / shots without focus blocks gracefully', async () => {
    const { validateOneSettingPerScene } = await import('../../src/core/planner/continuityValidator.js');
    const warnings = validateOneSettingPerScene({
      shots: [
        { shotNumber: 1 },
        { shotNumber: 2, focus: { primary: 'protagonist' } },
      ],
      knownSettingRefIds: ['forest'],
    });
    expect(warnings).toHaveLength(0);
  });

  it('points the warning at the first shot that introduced the second setting', async () => {
    const { validateOneSettingPerScene } = await import('../../src/core/planner/continuityValidator.js');
    const warnings = validateOneSettingPerScene({
      shots: [
        { shotNumber: 1, focus: { primary: 'protagonist', background: ['forest'] } },
        { shotNumber: 2, focus: { primary: 'protagonist', background: ['forest'] } },
        { shotNumber: 3, focus: { primary: 'protagonist', background: ['forest_edge'] } },
        { shotNumber: 4, focus: { primary: 'protagonist', background: ['forest_edge'] } },
      ],
      knownSettingRefIds: ['forest', 'forest_edge'],
    });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.shotNumber).toBe(3);
  });
});

describe('validateNewScenesNewLocations (Layer C3)', () => {
  it('passes when consecutive scenes use different settings', async () => {
    const { validateNewScenesNewLocations } = await import('../../src/core/planner/continuityValidator.js');
    const warnings = validateNewScenesNewLocations({
      scenes: [
        { sceneNumber: 1, primarySetting: 'underground_tunnel' },
        { sceneNumber: 2, primarySetting: 'forest' },
        { sceneNumber: 3, primarySetting: 'forest_edge' },
      ],
    });
    expect(warnings).toHaveLength(0);
  });

  it('warns when consecutive scenes share a setting', async () => {
    const { validateNewScenesNewLocations } = await import('../../src/core/planner/continuityValidator.js');
    const warnings = validateNewScenesNewLocations({
      scenes: [
        { sceneNumber: 1, primarySetting: 'diner' },
        { sceneNumber: 2, primarySetting: 'diner' },
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/diner/);
  });

  it('does not warn when the transition is marked as a time skip', async () => {
    const { validateNewScenesNewLocations } = await import('../../src/core/planner/continuityValidator.js');
    const warnings = validateNewScenesNewLocations({
      scenes: [
        { sceneNumber: 1, primarySetting: 'apartment' },
        { sceneNumber: 2, primarySetting: 'apartment', timeSkip: true },
      ],
    });
    expect(warnings).toHaveLength(0);
  });

  it('handles missing primarySetting gracefully (skips that pair)', async () => {
    const { validateNewScenesNewLocations } = await import('../../src/core/planner/continuityValidator.js');
    const warnings = validateNewScenesNewLocations({
      scenes: [
        { sceneNumber: 1, primarySetting: 'forest' },
        { sceneNumber: 2 },
        { sceneNumber: 3, primarySetting: 'forest' },
      ],
    });
    // Scene 2 has no primarySetting, so we can't compare 1→2 or 2→3 strictly.
    expect(warnings).toHaveLength(0);
  });

  it('flags every consecutive pair that violates the rule', async () => {
    const { validateNewScenesNewLocations } = await import('../../src/core/planner/continuityValidator.js');
    const warnings = validateNewScenesNewLocations({
      scenes: [
        { sceneNumber: 1, primarySetting: 'cafe' },
        { sceneNumber: 2, primarySetting: 'cafe' },
        { sceneNumber: 3, primarySetting: 'cafe' },
      ],
    });
    expect(warnings).toHaveLength(2);
  });
});
