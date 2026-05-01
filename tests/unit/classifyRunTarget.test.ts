/**
 * Tests for `classifyRunTarget`.
 *
 * Background: the run-to entry point accepts a `target` string that is
 * either a stage typeId (`shot_image`) or a node id (`shot_image:scene_1_shot_1`)
 * or null (no gate). The classifier resolves it into the structured
 * RunExecutorTarget shape that runExecutor consumes. Aliases like
 * `scene_1_shot_2.image` need a project's executor state to resolve;
 * those are handled by the caller via resolveNodeId.
 */
import { describe, it, expect } from 'vitest';
import { classifyRunTarget } from '../../src/server/runners/classifyRunTarget.js';
import { VALID_STAGES } from '../../src/core/planner/stages.js';

describe('classifyRunTarget', () => {
  it('returns empty target when given null', () => {
    expect(classifyRunTarget(null)).toEqual({});
  });

  it('returns empty target when given undefined', () => {
    expect(classifyRunTarget(undefined)).toEqual({});
  });

  it('returns empty target when given empty string', () => {
    expect(classifyRunTarget('')).toEqual({});
  });

  it('classifies a known stage typeId as a stage', () => {
    // `shot_image` is in VALID_STAGES.
    const stage = VALID_STAGES.find(s => s === 'shot_image') ?? VALID_STAGES[0]!;
    expect(classifyRunTarget(stage)).toEqual({ stage });
  });

  it('classifies a fully-qualified node id as a nodeId', () => {
    expect(classifyRunTarget('shot_image:scene_1_shot_1')).toEqual({
      nodeId: 'shot_image:scene_1_shot_1',
    });
  });

  it('throws on an unknown bareword target (not a stage, not a node id)', () => {
    expect(() => classifyRunTarget('not_a_stage')).toThrow(/unknown|invalid|not a stage/i);
  });

  it('treats dot-aliases (e.g. scene_1_shot_2.image) as node-ish — caller must resolve', () => {
    // Aliases need the project's executor state to resolve; this
    // helper just notes that a colon-or-dot target needs aliasResolution.
    const result = classifyRunTarget('scene_1_shot_2.image');
    expect(result).toEqual({ alias: 'scene_1_shot_2.image' });
  });
});
