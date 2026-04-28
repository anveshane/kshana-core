/**
 * Tests for the stage-gate decision — `isStageGateSatisfied`.
 *
 * This is the core predicate that decides whether `/run-to <stage>` should
 * pause execution. The ExecutorAgent calls it after every node completion
 * (and once pre-loop for idempotency). Keeping it pure means we test the
 * semantics in isolation — no LLM, no graph expansion, no filesystem.
 *
 * The scenarios here trace directly to the design brief:
 *   - Multi-typeId alias: a "stage" like `character_image` resolves to
 *     {character_image, setting_image, object_image}; gate only fires when
 *     ALL three have completed (including every per-item child).
 *   - Per-item wait-all: gate fires only after every per-item node
 *     (character:alice, character:bob) is terminal — not the first.
 *   - Failed-as-terminal: one failed node doesn't block the gate;
 *     prevents self-repair from spinning forever.
 *   - Redo-isolation wins: an active redo_node must not trip the gate.
 *   - Pre-expansion tolerance: if the gate typeIds have no nodes yet
 *     (collection hasn't been expanded), gate does NOT fire — the loop
 *     should keep running and expand.
 */

import { describe, it, expect } from 'vitest';
import {
  isStageGateSatisfied,
  resolveStageToTypeIds,
  type GateNode,
} from '../../src/core/planner/stages.js';

function gate(stage: string): Set<string> {
  const ids = resolveStageToTypeIds(stage);
  if (!ids) throw new Error(`bad stage: ${stage}`);
  return new Set(ids);
}

describe('isStageGateSatisfied — multi-typeId alias (character_image)', () => {
  // The alias `character_image` covers three sibling reference-image types.
  // Gate must not fire until all three are done across all per-item children.

  it('does NOT fire when object_image is still pending (one sibling lagging)', () => {
    const nodes: GateNode[] = [
      { typeId: 'character_image', status: 'completed' },
      { typeId: 'setting_image',   status: 'completed' },
      { typeId: 'object_image',    status: 'pending' },
    ];
    expect(isStageGateSatisfied(nodes, gate('character_image'), false)).toBe(false);
  });

  it('does NOT fire when a setting_image is in_progress', () => {
    const nodes: GateNode[] = [
      { typeId: 'character_image', status: 'completed' },
      { typeId: 'setting_image',   status: 'in_progress' },
      { typeId: 'object_image',    status: 'completed' },
    ];
    expect(isStageGateSatisfied(nodes, gate('character_image'), false)).toBe(false);
  });

  it('fires when all three sibling types are terminal (completed)', () => {
    const nodes: GateNode[] = [
      { typeId: 'character_image', status: 'completed' },
      { typeId: 'setting_image',   status: 'completed' },
      { typeId: 'object_image',    status: 'completed' },
    ];
    expect(isStageGateSatisfied(nodes, gate('character_image'), false)).toBe(true);
  });

  it('ignores nodes outside the gate (plot/story/shot_video) — only gated types count', () => {
    const nodes: GateNode[] = [
      { typeId: 'plot',             status: 'pending' },  // irrelevant
      { typeId: 'story',            status: 'pending' },  // irrelevant
      { typeId: 'shot_video',       status: 'pending' },  // irrelevant (downstream)
      { typeId: 'character_image',  status: 'completed' },
      { typeId: 'setting_image',    status: 'completed' },
      { typeId: 'object_image',     status: 'completed' },
    ];
    expect(isStageGateSatisfied(nodes, gate('character_image'), false)).toBe(true);
  });
});

describe('isStageGateSatisfied — per-item wait-all (character alias)', () => {
  // Stage `character` gates the `character` typeId. Multiple per-item nodes
  // (character:alice, character:bob) all share that typeId.

  it('does NOT fire after just one per-item character completes', () => {
    const nodes: GateNode[] = [
      { typeId: 'character', status: 'completed' },  // character:alice
      { typeId: 'character', status: 'pending' },    // character:bob
      { typeId: 'character', status: 'pending' },    // character:glitch
    ];
    expect(isStageGateSatisfied(nodes, gate('character'), false)).toBe(false);
  });

  it('fires once every per-item character is terminal', () => {
    const nodes: GateNode[] = [
      { typeId: 'character', status: 'completed' },
      { typeId: 'character', status: 'completed' },
      { typeId: 'character', status: 'completed' },
    ];
    expect(isStageGateSatisfied(nodes, gate('character'), false)).toBe(true);
  });
});

describe('isStageGateSatisfied — terminal statuses', () => {
  it('treats `skipped` as terminal', () => {
    const nodes: GateNode[] = [
      { typeId: 'plot', status: 'skipped' },
    ];
    expect(isStageGateSatisfied(nodes, gate('plot'), false)).toBe(true);
  });

  it('treats `failed` as terminal (so self-repair cannot loop past the gate)', () => {
    const nodes: GateNode[] = [
      { typeId: 'character_image', status: 'completed' },
      { typeId: 'setting_image',   status: 'completed' },
      { typeId: 'object_image',    status: 'failed' },
    ];
    expect(isStageGateSatisfied(nodes, gate('character_image'), false)).toBe(true);
  });

  it('does NOT treat `in_progress` as terminal', () => {
    const nodes: GateNode[] = [
      { typeId: 'plot', status: 'in_progress' },
    ];
    expect(isStageGateSatisfied(nodes, gate('plot'), false)).toBe(false);
  });

  it('does NOT treat `ready` as terminal', () => {
    const nodes: GateNode[] = [
      { typeId: 'plot', status: 'ready' },
    ];
    expect(isStageGateSatisfied(nodes, gate('plot'), false)).toBe(false);
  });
});

describe('isStageGateSatisfied — redo-isolation interaction', () => {
  // When a user triggers `redo_node`, the executor scopes its run to
  // just the invalidated nodes. The stage gate must NOT fire from a
  // coincidentally-satisfied set of gated nodes during that scope —
  // otherwise users would see a spurious "paused at stage" for a redo.

  it('returns false whenever redo-isolation is active, even if the gate would otherwise fire', () => {
    const nodes: GateNode[] = [
      { typeId: 'character_image', status: 'completed' },
      { typeId: 'setting_image',   status: 'completed' },
      { typeId: 'object_image',    status: 'completed' },
    ];
    expect(isStageGateSatisfied(nodes, gate('character_image'), true)).toBe(false);
  });
});

describe('isStageGateSatisfied — no gate configured', () => {
  it('returns false when stopAtStageTypeIds is null', () => {
    const nodes: GateNode[] = [
      { typeId: 'plot', status: 'completed' },
    ];
    expect(isStageGateSatisfied(nodes, null, false)).toBe(false);
  });
});

describe('isStageGateSatisfied — pre-expansion tolerance', () => {
  // Collections (character, setting, scene, character_image, etc.) are
  // expanded lazily by the executor. On first pass after `story`
  // completes, no `character:*` per-item nodes exist yet — just the
  // type-level collection placeholder. The gate must wait for expansion.

  it('does NOT fire when zero nodes belong to the gated typeIds (unexpanded)', () => {
    // Graph has nothing of the gated typeId yet — e.g., character_image
    // hasn't expanded because we're still generating story.
    const nodes: GateNode[] = [
      { typeId: 'plot',     status: 'completed' },
      { typeId: 'story',    status: 'in_progress' },
    ];
    expect(isStageGateSatisfied(nodes, gate('character_image'), false)).toBe(false);
  });
});

describe('isStageGateSatisfied — empty graph edge case', () => {
  it('returns false when no nodes exist at all', () => {
    expect(isStageGateSatisfied([], gate('plot'), false)).toBe(false);
  });
});

describe('isStageGateSatisfied — single-type stages like plot and story', () => {
  it('fires when the single gated plot is complete', () => {
    const nodes: GateNode[] = [
      { typeId: 'plot', status: 'completed' },
      { typeId: 'story', status: 'pending' },  // downstream, irrelevant
    ];
    expect(isStageGateSatisfied(nodes, gate('plot'), false)).toBe(true);
  });

  it('does not fire when plot has not started yet', () => {
    const nodes: GateNode[] = [
      { typeId: 'plot', status: 'pending' },
    ];
    expect(isStageGateSatisfied(nodes, gate('plot'), false)).toBe(false);
  });
});

describe('isStageGateSatisfied — shot_video (large per-item collection)', () => {
  // Most extreme per-item case: a project might have 18+ shot_video nodes
  // across 3 scenes. Gate must wait for every one.

  it('does NOT fire with 17/18 shot_videos complete and one pending', () => {
    const nodes: GateNode[] = Array.from({ length: 17 }, () => ({
      typeId: 'shot_video', status: 'completed' as const,
    }));
    nodes.push({ typeId: 'shot_video', status: 'pending' });
    expect(isStageGateSatisfied(nodes, gate('shot_video'), false)).toBe(false);
  });

  it('fires only after all 18/18 shot_videos are terminal', () => {
    const nodes: GateNode[] = Array.from({ length: 18 }, () => ({
      typeId: 'shot_video', status: 'completed' as const,
    }));
    expect(isStageGateSatisfied(nodes, gate('shot_video'), false)).toBe(true);
  });
});
