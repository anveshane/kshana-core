/**
 * ExecutorPipeline Integration Tests
 *
 * Tests the DependencyGraphExecutor's pipeline orchestration using the real
 * BackwardPlanner and narrative template. No live LLM — only fixture-based
 * state transitions on the executor graph.
 *
 * Covers:
 * 1. Node ordering (dependency-correct topological order)
 * 2. Collection expansion (per-item node creation + wiring)
 * 3. Self-healing (reset completed nodes with missing output files)
 * 4. Stale prompt detection (dependency completedAt > prompt mtime)
 * 5. Failed node handling (downstream dependents blocked)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { narrativeTemplate } from '../../src/templates/narrative.js';
import { BackwardPlanner } from '../../src/core/planner/BackwardPlanner.js';
import { DependencyGraphExecutor } from '../../src/core/planner/DependencyGraphExecutor.js';
import type { UserGoal, AssetRegistry, ExecutionNode } from '../../src/core/planner/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_DIR = join(process.cwd(), 'test-temp-executor-pipeline');

function emptyRegistry(): AssetRegistry {
  return {
    assets: new Map(),
    satisfiedArtifacts: new Map(),
    lastScanAt: Date.now(),
  };
}

function makeGoal(targets: string[]): UserGoal {
  return {
    targetArtifacts: targets,
    preferences: {},
    description: 'Test goal',
  };
}

/**
 * Build a fresh executor targeting final_video (the full narrative pipeline).
 */
function buildFullExecutor(): DependencyGraphExecutor {
  const planner = new BackwardPlanner(narrativeTemplate);
  const goal = makeGoal(['final_video']);
  const plan = planner.buildPlan(goal, emptyRegistry());
  return DependencyGraphExecutor.fromPlan(plan, narrativeTemplate);
}

/**
 * Complete a node and return newly ready nodes (convenience wrapper).
 */
function completeNode(
  executor: DependencyGraphExecutor,
  nodeId: string,
  outputPath?: string,
): ExecutionNode[] {
  executor.markStarted(nodeId);
  return executor.markCompleted(nodeId, outputPath);
}

// ---------------------------------------------------------------------------
// 1. Node Ordering
// ---------------------------------------------------------------------------

describe('ExecutorPipeline — Node ordering', () => {
  let executor: DependencyGraphExecutor;

  beforeEach(() => {
    executor = buildFullExecutor();
  });

  it('picks plot as the first ready node (no dependencies)', () => {
    const ready = executor.getNextReady();
    expect(ready.length).toBe(1);
    expect(ready[0]!.typeId).toBe('plot');
  });

  it('unlocks story after plot completes', () => {
    completeNode(executor, 'plot');
    const ready = executor.getNextReady();
    const typeIds = ready.map(n => n.typeId);
    expect(typeIds).toContain('story');
  });

  it('unlocks character, setting, scene after story completes', () => {
    completeNode(executor, 'plot');
    completeNode(executor, 'story');
    const ready = executor.getNextReady();
    const typeIds = ready.map(n => n.typeId);
    // character/setting/scene are all collections that depend on story,
    // but getNextReady skips unexpanded type-level collections (isCollection && !itemId).
    // So none of these should appear as ready until expanded.
    // Only non-collection nodes whose deps are met should be ready.
    // At this point no non-collection dependents of story have their deps met either
    // (world_style also depends on scene + setting which are pending).
    // So ready should be empty — the ExecutorAgent would call expandPendingCollections.
    expect(typeIds).toEqual([]);
  });

  it('respects transitive dependency ordering (world_style depends on story + scene + setting)', () => {
    // world_style depends on story, scene (all), setting (all)
    const node = executor.getNode('world_style');
    expect(node).toBeDefined();
    expect(node!.dependencies).toContain('story');
    expect(node!.dependencies).toContain('scene');
    expect(node!.dependencies).toContain('setting');
  });

  it('character_image depends on character and world_style', () => {
    const node = executor.getNode('character_image');
    expect(node).toBeDefined();
    expect(node!.dependencies).toContain('character');
    expect(node!.dependencies).toContain('world_style');
  });
});

// ---------------------------------------------------------------------------
// 2. Collection Expansion
// ---------------------------------------------------------------------------

describe('ExecutorPipeline — Collection expansion', () => {
  let executor: DependencyGraphExecutor;

  beforeEach(() => {
    executor = buildFullExecutor();
  });

  it('creates per-item nodes when a collection is expanded', () => {
    // Expand the "character" collection with two items
    const newNodes = executor.expandCollection('character', [
      { itemId: 'kai', name: 'Kai' },
      { itemId: 'aria', name: 'Aria' },
    ]);

    expect(newNodes.length).toBe(2);
    expect(newNodes.map(n => n.id).sort()).toEqual(['character:aria', 'character:kai']);
    // The type-level node should be removed
    expect(executor.getNode('character')).toBeUndefined();
    // Per-item nodes should exist
    expect(executor.getNode('character:kai')).toBeDefined();
    expect(executor.getNode('character:aria')).toBeDefined();
  });

  it('per-item nodes inherit the same dependencies as the type-level node', () => {
    // character depends on story
    const origDeps = executor.getNode('character')!.dependencies;

    executor.expandCollection('character', [
      { itemId: 'kai', name: 'Kai' },
    ]);

    const kaiNode = executor.getNode('character:kai')!;
    expect(kaiNode.dependencies).toEqual(origDeps);
  });

  it('rewires matching-scope dependents to per-item nodes (character_image)', () => {
    // character_image has scope=matching on character.
    // Expanding character should also expand character_image.
    executor.expandCollection('character', [
      { itemId: 'kai', name: 'Kai' },
      { itemId: 'aria', name: 'Aria' },
    ]);

    // character_image type-level node should be replaced
    expect(executor.getNode('character_image')).toBeUndefined();
    // Per-item character_image nodes should exist
    const kaiImg = executor.getNode('character_image:kai');
    const ariaImg = executor.getNode('character_image:aria');
    expect(kaiImg).toBeDefined();
    expect(ariaImg).toBeDefined();

    // Each character_image item should depend on the matching character item
    expect(kaiImg!.dependencies).toContain('character:kai');
    expect(ariaImg!.dependencies).toContain('character:aria');
  });

  it('per-item character_image becomes ready only after its character item + world_style complete', () => {
    // Expand character
    executor.expandCollection('character', [
      { itemId: 'kai', name: 'Kai' },
    ]);

    // Complete prerequisites
    completeNode(executor, 'plot');
    completeNode(executor, 'story');

    // character:kai is ready now (depends on story)
    let ready = executor.getNextReady();
    expect(ready.map(n => n.id)).toContain('character:kai');

    // Complete character:kai, but world_style is still pending
    completeNode(executor, 'character:kai');
    ready = executor.getNextReady();
    // character_image:kai should NOT be ready (world_style is pending)
    expect(ready.map(n => n.id)).not.toContain('character_image:kai');
  });

  it('all-scope dependents depend on every expanded item', () => {
    // scene depends on character (scope=all) and setting (scope=all)
    // Expand character with two items
    executor.expandCollection('character', [
      { itemId: 'kai', name: 'Kai' },
      { itemId: 'aria', name: 'Aria' },
    ]);

    const sceneNode = executor.getNode('scene');
    expect(sceneNode).toBeDefined();
    // scene should now depend on both character items
    expect(sceneNode!.dependencies).toContain('character:kai');
    expect(sceneNode!.dependencies).toContain('character:aria');
  });
});

// ---------------------------------------------------------------------------
// 3. Self-healing (missing output files)
// ---------------------------------------------------------------------------

describe('ExecutorPipeline — Self-healing missing outputs', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('resets a completed node to pending when its output file is missing', () => {
    const executor = buildFullExecutor();
    // Simulate: plot was completed with an output path that does not exist on disk
    executor.markStarted('plot');
    executor.markCompleted('plot', 'plans/plot.md');
    const plotNode = executor.getNode('plot')!;
    expect(plotNode.status).toBe('completed');

    // Now simulate the self-healing check the ExecutorAgent does:
    // walk all completed nodes and reset any whose output path is missing
    for (const node of executor.getAllNodes()) {
      if (node.status === 'completed' && node.outputPath) {
        const fullPath = join(TEST_DIR, node.outputPath);
        if (!existsSync(fullPath)) {
          node.status = 'pending';
          node.outputPath = undefined;
          node.completedAt = undefined;
        }
      }
    }

    const plotAfter = executor.getNode('plot')!;
    expect(plotAfter.status).toBe('pending');
    expect(plotAfter.outputPath).toBeUndefined();
    expect(plotAfter.completedAt).toBeUndefined();
  });

  it('does NOT reset a completed node when its output file exists', () => {
    const executor = buildFullExecutor();
    const outputRelPath = 'plans/plot.md';
    const fullPath = join(TEST_DIR, outputRelPath);

    // Create the output file on disk
    mkdirSync(join(TEST_DIR, 'plans'), { recursive: true });
    writeFileSync(fullPath, '# Plot outline\nSomething interesting happens.');

    executor.markStarted('plot');
    executor.markCompleted('plot', outputRelPath);

    // Self-healing check
    for (const node of executor.getAllNodes()) {
      if (node.status === 'completed' && node.outputPath) {
        const fp = join(TEST_DIR, node.outputPath);
        if (!existsSync(fp)) {
          node.status = 'pending';
          node.outputPath = undefined;
          node.completedAt = undefined;
        }
      }
    }

    const plotNode = executor.getNode('plot')!;
    expect(plotNode.status).toBe('completed');
    expect(plotNode.outputPath).toBe(outputRelPath);
  });

  it('downstream dependents become blocked after a node is reset', () => {
    const executor = buildFullExecutor();

    // Complete plot, then complete story
    completeNode(executor, 'plot', 'plans/plot.md');
    completeNode(executor, 'story', 'plans/story.md');

    // story is completed, so its dependents may be ready.
    // Now reset story (simulate missing output)
    const storyNode = executor.getNode('story')!;
    storyNode.status = 'pending';
    storyNode.outputPath = undefined;
    storyNode.completedAt = undefined;

    // Nothing downstream of story should be ready
    const ready = executor.getNextReady();
    for (const r of ready) {
      // Only plot-level or nodes not depending on story should be ready
      expect(r.dependencies).not.toContain('story');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Stale Prompt Detection
// ---------------------------------------------------------------------------

describe('ExecutorPipeline — Stale prompt detection', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  /**
   * Replicates the isPromptStale logic from ExecutorAgent:
   * a prompt is stale if any dependency node's completedAt > the prompt file mtime.
   */
  function isPromptStale(
    executor: DependencyGraphExecutor,
    node: ExecutionNode,
    promptPath: string,
  ): boolean {
    try {
      const { statSync } = require('fs') as typeof import('fs');
      const promptMtime = statSync(promptPath).mtimeMs;

      for (const depId of node.dependencies) {
        const depNode = executor.getNode(depId);
        if (depNode?.completedAt && depNode.completedAt > promptMtime) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  it('detects a prompt as stale when a dependency was re-completed after the prompt was written', () => {
    const executor = buildFullExecutor();

    // Complete plot
    executor.markStarted('plot');
    executor.markCompleted('plot', 'plans/plot.md');

    // Write a prompt file with an old mtime (simulate "written before the dependency was re-completed")
    const promptPath = join(TEST_DIR, 'story-prompt.md');
    writeFileSync(promptPath, 'Generate a story based on the plot.');

    // Set the prompt file mtime to 10 seconds in the past
    const pastTime = new Date(Date.now() - 10_000);
    utimesSync(promptPath, pastTime, pastTime);

    // Now re-complete the plot (simulating a reset + re-run)
    // The completedAt will be Date.now() which is after the prompt mtime
    executor.invalidateNode('plot');
    executor.markStarted('plot');
    executor.markCompleted('plot', 'plans/plot.md');

    const storyNode = executor.getNode('story')!;
    const stale = isPromptStale(executor, storyNode, promptPath);
    expect(stale).toBe(true);
  });

  it('does NOT flag a prompt as stale when dependencies were completed before it was written', () => {
    const executor = buildFullExecutor();

    // Complete plot first
    executor.markStarted('plot');
    executor.markCompleted('plot', 'plans/plot.md');

    // Wait a tiny bit then write prompt (mtime will be after completedAt)
    const promptPath = join(TEST_DIR, 'story-prompt-fresh.md');

    // Manually set the plot completedAt to the past
    const plotNode = executor.getNode('plot')!;
    plotNode.completedAt = Date.now() - 10_000;

    // Write prompt file now (mtime = now)
    writeFileSync(promptPath, 'Generate a story.');

    const storyNode = executor.getNode('story')!;
    const stale = isPromptStale(executor, storyNode, promptPath);
    expect(stale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Failed Node Handling
// ---------------------------------------------------------------------------

describe('ExecutorPipeline — Failed node handling', () => {
  let executor: DependencyGraphExecutor;

  beforeEach(() => {
    executor = buildFullExecutor();
  });

  it('blocks downstream dependents when a node fails', () => {
    // Complete plot
    completeNode(executor, 'plot');

    // Fail story
    executor.markStarted('story');
    executor.markFailed('story', 'LLM returned empty content');

    // Nothing that depends on story should be ready
    const ready = executor.getNextReady();
    for (const node of ready) {
      const allDeps = getAllTransitiveDeps(executor, node.id);
      expect(allDeps).not.toContain('story');
    }
    // Specifically: character, setting, scene, world_style all depend on story
    expect(ready.map(n => n.typeId)).not.toContain('character');
    expect(ready.map(n => n.typeId)).not.toContain('setting');
    expect(ready.map(n => n.typeId)).not.toContain('scene');
    expect(ready.map(n => n.typeId)).not.toContain('world_style');
  });

  it('unblocks dependents after a failed node is invalidated and re-completed', () => {
    completeNode(executor, 'plot');

    // Fail story
    executor.markStarted('story');
    executor.markFailed('story', 'timeout');

    // Nothing depending on story is ready
    let ready = executor.getNextReady();
    expect(ready.length).toBe(0);

    // Invalidate (reset) and re-complete
    executor.invalidateNode('story');
    expect(executor.getNode('story')!.status).toBe('pending');

    // story should become ready again (plot is still completed)
    ready = executor.getNextReady();
    expect(ready.map(n => n.id)).toContain('story');

    // Re-complete story
    completeNode(executor, 'story');

    // Now downstream collections can be expanded
    // (they are type-level collections so won't show in getNextReady,
    // but they should be in pending status with deps satisfied)
    const charNode = executor.getNode('character')!;
    expect(charNode.status).toBe('pending');
    // character's deps should all be completed
    for (const depId of charNode.dependencies) {
      const dep = executor.getNode(depId);
      expect(dep?.status).toBe('completed');
    }
  });

  it('marks the executor as NOT complete when failed nodes exist', () => {
    completeNode(executor, 'plot');
    executor.markStarted('story');
    executor.markFailed('story', 'error');

    expect(executor.isComplete()).toBe(false);
    const progress = executor.getProgress();
    expect(progress.failed).toBe(1);
    expect(progress.completed).toBe(1);
  });

  it('invalidateNode cascades through dependents chain', () => {
    // Use type-level nodes (before expansion) so dependent edges are intact.
    // plot -> story -> character/setting/scene (via dependents)
    completeNode(executor, 'plot');
    completeNode(executor, 'story');

    // Invalidate plot — should cascade to story and everything downstream
    const invalidated = executor.invalidateNode('plot');
    const invalidatedIds = invalidated.map(n => n.id);

    expect(invalidatedIds).toContain('plot');
    expect(invalidatedIds).toContain('story');
    // character, setting, scene are dependents of story
    expect(invalidatedIds).toContain('character');
    expect(invalidatedIds).toContain('setting');
    expect(invalidatedIds).toContain('scene');

    // All should be reset to pending
    expect(executor.getNode('plot')!.status).toBe('pending');
    expect(executor.getNode('story')!.status).toBe('pending');
    expect(executor.getNode('character')!.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// Utility: get all transitive dependencies of a node
// ---------------------------------------------------------------------------
function getAllTransitiveDeps(
  executor: DependencyGraphExecutor,
  nodeId: string,
): string[] {
  const result = new Set<string>();
  const queue = [nodeId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const node = executor.getNode(id);
    if (!node) continue;

    for (const depId of node.dependencies) {
      result.add(depId);
      queue.push(depId);
    }
  }

  return Array.from(result);
}

// Need to import afterEach at the top level
import { afterEach } from 'vitest';
