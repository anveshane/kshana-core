/**
 * TDD Tests for per-shot node expansion after reset.
 *
 * When scene-level collection nodes expand into per-shot nodes,
 * dependencies must reference per-shot nodes, NOT deleted scene-level parents.
 *
 * Bug: shot_image:scene_1_shot_1 depended on shot_image_prompt:scene_1
 * (scene-level, deleted by reset) instead of shot_image_prompt:scene_1_shot_1.
 * This caused a deadlock where serial mode waited for content nodes that
 * could never become ready.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Per-shot expansion: no orphaned dependencies', () => {
  it('shot_image deps must use per-shot prompt IDs (scene_1_shot_1), not scene-level (scene_1)', async () => {
    const { validateNoDanglingDeps } = await import('../../src/core/planner/shotReferenceMapping.js');

    // Simulate correctly wired graph
    const goodGraph = {
      'shot_image_prompt:scene_1_shot_1': { id: 'shot_image_prompt:scene_1_shot_1', dependencies: [] },
      'shot_image_prompt:scene_1_shot_2': { id: 'shot_image_prompt:scene_1_shot_2', dependencies: [] },
      'shot_image:scene_1_shot_1': { id: 'shot_image:scene_1_shot_1', dependencies: ['shot_image_prompt:scene_1_shot_1'] },
      'shot_image:scene_1_shot_2': { id: 'shot_image:scene_1_shot_2', dependencies: ['shot_image_prompt:scene_1_shot_2'] },
    };
    expect(validateNoDanglingDeps(goodGraph)).toHaveLength(0);

    // Simulate incorrectly wired graph (scene-level dep that was deleted)
    const badGraph = {
      'shot_image_prompt:scene_1_shot_1': { id: 'shot_image_prompt:scene_1_shot_1', dependencies: [] },
      'shot_image:scene_1_shot_1': { id: 'shot_image:scene_1_shot_1', dependencies: ['shot_image_prompt:scene_1'] }, // scene-level — MISSING
    };
    const orphans = validateNoDanglingDeps(badGraph);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].missingDep).toBe('shot_image_prompt:scene_1');
  });
});

describe('Per-shot expansion: dependency validation utility', () => {
  it('validateNoDanglingDeps finds missing dependencies', async () => {
    const { validateNoDanglingDeps } = await import('../../src/core/planner/shotReferenceMapping.js');

    const nodes = {
      'shot_image:scene_1_shot_1': {
        id: 'shot_image:scene_1_shot_1',
        dependencies: ['shot_image_prompt:scene_1_shot_1', 'character_image:elena'],
      },
      'shot_image_prompt:scene_1_shot_1': {
        id: 'shot_image_prompt:scene_1_shot_1',
        dependencies: [],
      },
      // character_image:elena is MISSING
    };

    const orphans = validateNoDanglingDeps(nodes as any);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].nodeId).toBe('shot_image:scene_1_shot_1');
    expect(orphans[0].missingDep).toBe('character_image:elena');
  });

  it('validateNoDanglingDeps returns empty for valid graph', async () => {
    const { validateNoDanglingDeps } = await import('../../src/core/planner/shotReferenceMapping.js');

    const nodes = {
      'a': { id: 'a', dependencies: ['b'] },
      'b': { id: 'b', dependencies: [] },
    };

    const orphans = validateNoDanglingDeps(nodes as any);
    expect(orphans).toHaveLength(0);
  });
});
