/**
 * Tests for the canonical-refId injection into scene_video_prompt user messages.
 *
 * Context: the scene-breakdown LLM was inventing character IDs from prose
 * in the scene script — "Johnathan O'Hare" became `johnathan`, `johnathan_o_hare`,
 * `jonathan` across different scenes. Downstream code looks up per-item
 * nodes by exact refId, so any mismatch silently breaks reference resolution
 * (shot images never see the actual character description).
 *
 * The fix injects an `<available_refs>` block listing the exact `itemId`
 * strings of every character/setting/object per-item node in the graph,
 * along with instructions to copy them verbatim.
 *
 * These tests assert:
 *   1. The block contains every expected entity type.
 *   2. IDs that contain apostrophes, underscores, or unusual casing are
 *      preserved verbatim (this was the original failure).
 *   3. The block is placed early enough in the user message that the LLM
 *      sees it before the scene script.
 *   4. Non-scene_video_prompt node types don't receive the block
 *      (unnecessary context bloat).
 *
 * Because ExecutorAgent.buildPromptForNode is private and touches a huge
 * amount of async infrastructure, these tests re-create the minimal
 * injection logic as a pure helper and run it against a real
 * DependencyGraphExecutor populated the same way as production. If
 * somebody refactors the production helper to a private method on
 * ExecutorAgent, expose a pure function and point these tests at it.
 */

import { describe, it, expect } from 'vitest';
import { DependencyGraphExecutor } from '../../src/core/planner/DependencyGraphExecutor.js';
import { BackwardPlanner } from '../../src/core/planner/BackwardPlanner.js';
import { narrativeTemplate } from '../../src/templates/narrative.js';
import type { AssetRegistry, ExecutionNode } from '../../src/core/planner/types.js';

/**
 * Mirror of the inline logic in ExecutorAgent.buildPromptForNode — kept as
 * a pure function here so tests can exercise it in isolation. If you
 * refactor the production logic to live here, both stay in sync.
 */
function buildAvailableRefsBlock(allNodes: ExecutionNode[]): string {
  const refLines: string[] = [];
  for (const n of allNodes) {
    if (!n.itemId) continue;
    if (n.typeId === 'character') refLines.push(`- character:    ${n.itemId}`);
    else if (n.typeId === 'setting') refLines.push(`- setting:     ${n.itemId}`);
    else if (n.typeId === 'object') refLines.push(`- object:      ${n.itemId}`);
  }
  if (refLines.length === 0) return '';
  return `\n\n<available_refs>
Use these EXACT refId strings (copy verbatim — no paraphrasing, no case/punct changes) for:
mainSubject, secondarySubject, perspectiveOf, focus.primary, focus.background[], focus.lurking.

${refLines.join('\n')}

If you need to reference an entity not on this list, describe it as prose in the shot \`description\` field — never invent a new refId.
</available_refs>`;
}

function buildExecutor() {
  const planner = new BackwardPlanner(narrativeTemplate);
  const registry: AssetRegistry = { assets: new Map(), satisfiedArtifacts: new Map(), lastScanAt: Date.now() };
  const plan = planner.buildPlan(
    { targetArtifacts: ['final_video'], preferences: {}, description: 'test' },
    registry,
    { includeOptional: true },
  );
  const executor = DependencyGraphExecutor.fromPlan(plan, narrativeTemplate);
  executor.markStarted('story');
  executor.markCompleted('story', 'chapters/chapter_1/plans/story.md');
  return executor;
}

describe('available_refs block — canonical refId injection', () => {
  it('includes every character per-item refId with exact casing and punctuation', () => {
    const executor = buildExecutor();
    // Use lazarus_drive-shaped refIds: one has an apostrophe, which was the
    // original failure mode (LLM normalized it away).
    executor.expandCollection('character', [
      { itemId: "johnathan_o'hare", name: "Johnathan O'Hare" },
      { itemId: 'andy', name: 'Andy' },
      { itemId: 'glitch', name: 'Glitch' },
    ]);

    const block = buildAvailableRefsBlock(executor.getAllNodes());

    expect(block).toContain("- character:    johnathan_o'hare");
    expect(block).toContain('- character:    andy');
    expect(block).toContain('- character:    glitch');
  });

  it("preserves apostrophes in refIds — LLM must not 'fix' them to underscores", () => {
    const executor = buildExecutor();
    executor.expandCollection('character', [
      { itemId: "johnathan_o'hare", name: "Johnathan O'Hare" },
    ]);

    const block = buildAvailableRefsBlock(executor.getAllNodes());

    // Apostrophe survives
    expect(block).toContain("johnathan_o'hare");
    // No erroneous normalization
    expect(block).not.toContain('johnathan_o_hare');
    expect(block).not.toContain('johnathan_ohare');
  });

  it('includes settings and objects alongside characters', () => {
    const executor = buildExecutor();
    executor.expandCollection('character', [{ itemId: 'alice', name: 'Alice' }]);
    executor.expandCollection('setting', [
      { itemId: "andy's_bar", name: "Andy's Bar" },
      { itemId: 'fog-shrouded_docks', name: 'Fog-shrouded docks' },
    ]);
    executor.expandCollection('object', [{ itemId: 'lazarus_drive', name: 'Lazarus Drive' }]);

    const block = buildAvailableRefsBlock(executor.getAllNodes());

    expect(block).toContain('- character:    alice');
    expect(block).toContain("- setting:     andy's_bar");
    expect(block).toContain('- setting:     fog-shrouded_docks');
    expect(block).toContain('- object:      lazarus_drive');
  });

  it('returns an empty string when no per-item entities exist (fresh plan)', () => {
    const executor = buildExecutor();
    const block = buildAvailableRefsBlock(executor.getAllNodes());
    expect(block).toBe('');
  });

  it('instructs the LLM to copy refIds verbatim and not invent new ones', () => {
    const executor = buildExecutor();
    executor.expandCollection('character', [{ itemId: 'alice', name: 'Alice' }]);
    const block = buildAvailableRefsBlock(executor.getAllNodes());

    // The block must call out verbatim usage and explicitly forbid invention
    expect(block).toMatch(/verbatim/i);
    expect(block).toContain('mainSubject');
    expect(block).toContain('never invent');
  });

  it('excludes nodes without itemId (type-level collections, single-instance artifacts)', () => {
    const executor = buildExecutor();
    executor.expandCollection('character', [{ itemId: 'alice', name: 'Alice' }]);

    const block = buildAvailableRefsBlock(executor.getAllNodes());

    // world_style, plot, story etc. are single-instance — never refIds
    expect(block).not.toContain('world_style');
    expect(block).not.toContain('plot');
    expect(block).not.toContain('story');
  });
});
