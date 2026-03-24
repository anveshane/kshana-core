/**
 * Tests for DependencyGraphExecutor
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraphExecutor } from '../../src/core/planner/DependencyGraphExecutor.js';
import { BackwardPlanner } from '../../src/core/planner/BackwardPlanner.js';
import type { VideoTemplate } from '../../src/core/templates/types.js';
import type { AssetRegistry, UserGoal } from '../../src/core/planner/types.js';

// Reuse the same test template from BackwardPlanner tests
const createTestTemplate = (): VideoTemplate => ({
  id: 'test_template',
  displayName: 'Test Template',
  description: 'A template for testing',
  version: '1.0.0',
  defaultStyle: 'default',
  styles: [
    {
      id: 'default',
      displayName: 'Default',
      description: 'Default style',
      promptModifiers: [],
      negativePrompt: [],
    },
  ],
  inputTypes: [
    {
      id: 'idea',
      displayName: 'Idea',
      description: 'A simple idea',
      examples: ['A story about...'],
      skipsArtifacts: [],
      mapsToArtifact: 'plot',
    },
  ],
  artifactTypes: {
    plot: {
      id: 'plot',
      displayName: 'Plot',
      category: 'concept',
      description: 'The plot outline',
      isCollection: false,
      outputFormat: 'markdown',
      filePattern: 'plot.md',
      agentType: 'planning',
      promptFile: 'plot.md',
      isExpensive: false,
      requiresPerItemApproval: false,
      dependencies: [],
    },
    story: {
      id: 'story',
      displayName: 'Story',
      category: 'structure',
      description: 'The full story',
      isCollection: false,
      outputFormat: 'markdown',
      filePattern: 'story.md',
      agentType: 'content',
      promptFile: 'story.md',
      isExpensive: false,
      requiresPerItemApproval: false,
      dependencies: [
        { artifactTypeId: 'plot', required: true, usage: 'context' },
      ],
    },
    character: {
      id: 'character',
      displayName: 'Characters',
      category: 'entity',
      description: 'Story characters',
      isCollection: true,
      itemName: 'character',
      outputFormat: 'markdown',
      filePattern: 'characters/{{name}}.md',
      agentType: 'content',
      promptFile: 'character.md',
      isExpensive: false,
      requiresPerItemApproval: false,
      dependencies: [
        { artifactTypeId: 'story', required: true, usage: 'context' },
      ],
    },
    character_image: {
      id: 'character_image',
      displayName: 'Character Images',
      category: 'visual_ref',
      description: 'Images of characters',
      isCollection: true,
      itemName: 'character image',
      outputFormat: 'image',
      filePattern: 'assets/characters/{{name}}.png',
      agentType: 'image',
      promptFile: 'character_image.md',
      isExpensive: true,
      requiresPerItemApproval: true,
      dependencies: [
        { artifactTypeId: 'character', required: true, usage: 'reference', scope: 'matching' },
      ],
    },
    scene: {
      id: 'scene',
      displayName: 'Scenes',
      category: 'segment',
      description: 'Story scenes',
      isCollection: true,
      itemName: 'scene',
      outputFormat: 'markdown',
      filePattern: 'scenes/scene_{{index}}.md',
      agentType: 'content',
      promptFile: 'scene.md',
      isExpensive: false,
      requiresPerItemApproval: false,
      dependencies: [
        { artifactTypeId: 'story', required: true, usage: 'context' },
        { artifactTypeId: 'character', required: true, usage: 'context', scope: 'all' },
      ],
    },
    scene_image: {
      id: 'scene_image',
      displayName: 'Scene Images',
      category: 'visual_ref',
      description: 'Images for scenes',
      isCollection: true,
      itemName: 'scene image',
      outputFormat: 'image',
      filePattern: 'assets/scenes/{{name}}.png',
      agentType: 'image',
      promptFile: 'scene_image.md',
      isExpensive: true,
      requiresPerItemApproval: true,
      dependencies: [
        { artifactTypeId: 'scene', required: true, usage: 'context', scope: 'matching' },
        { artifactTypeId: 'character_image', required: true, usage: 'reference', scope: 'matching' },
      ],
    },
    final_video: {
      id: 'final_video',
      displayName: 'Final Video',
      category: 'final',
      description: 'The final assembled video',
      isCollection: false,
      outputFormat: 'video',
      filePattern: 'assets/final_video.mp4',
      agentType: 'video',
      promptFile: 'final_video.md',
      isExpensive: true,
      requiresPerItemApproval: false,
      dependencies: [
        { artifactTypeId: 'scene_image', required: true, usage: 'input', scope: 'all' },
      ],
    },
  },
  contextVariables: {
    $plot: 'plot',
    $story: 'story',
  },
  orchestratorPrompt: 'orchestrator.md',
});

const createEmptyRegistry = (): AssetRegistry => ({
  assets: new Map(),
  satisfiedArtifacts: new Map(),
  lastScanAt: Date.now(),
});

function buildExecutor(template?: VideoTemplate) {
  const t = template ?? createTestTemplate();
  const planner = new BackwardPlanner(t);
  const goal: UserGoal = {
    targetArtifacts: ['final_video'],
    preferences: {},
    description: 'Create a final video',
  };
  const registry = createEmptyRegistry();
  const plan = planner.buildPlan(goal, registry);
  return DependencyGraphExecutor.fromPlan(plan, t);
}

describe('DependencyGraphExecutor', () => {
  let template: VideoTemplate;

  beforeEach(() => {
    template = createTestTemplate();
  });

  describe('fromPlan', () => {
    it('creates nodes for all plan steps', () => {
      const executor = buildExecutor(template);
      const nodes = executor.getAllNodes();
      // Should have all 7 artifact types as nodes
      expect(nodes.length).toBe(7);
    });

    it('all nodes start as pending', () => {
      const executor = buildExecutor(template);
      for (const node of executor.getAllNodes()) {
        expect(node.status).toBe('pending');
      }
    });
  });

  describe('getNextReady', () => {
    it('returns only root nodes (no dependencies) initially', () => {
      const executor = buildExecutor(template);
      const ready = executor.getNextReady();
      expect(ready.length).toBe(1);
      expect(ready[0].typeId).toBe('plot');
    });

    it('returns story after plot completes', () => {
      const executor = buildExecutor(template);
      executor.markStarted('plot');
      executor.markCompleted('plot', 'plot.md');

      const ready = executor.getNextReady();
      expect(ready.length).toBe(1);
      expect(ready[0].typeId).toBe('story');
    });

    it('returns character and scene after story completes (both depend on story)', () => {
      const executor = buildExecutor(template);
      executor.markStarted('plot');
      executor.markCompleted('plot', 'plot.md');
      executor.markStarted('story');
      executor.markCompleted('story', 'story.md');

      const ready = executor.getNextReady();
      const typeIds = ready.map(n => n.typeId).sort();
      // character depends on story only
      // scene depends on story AND character (all scope) — so scene is NOT ready yet
      expect(typeIds).toEqual(['character']);
    });

    it('returns no nodes when all are completed', () => {
      const executor = buildExecutor(template);
      // Complete everything in order
      for (const typeId of ['plot', 'story', 'character', 'character_image', 'scene', 'scene_image', 'final_video']) {
        executor.markStarted(typeId);
        executor.markCompleted(typeId);
      }
      expect(executor.getNextReady()).toEqual([]);
      expect(executor.isComplete()).toBe(true);
    });
  });

  describe('markCompleted', () => {
    it('returns newly ready dependents', () => {
      const executor = buildExecutor(template);
      executor.markStarted('plot');
      const newlyReady = executor.markCompleted('plot', 'plot.md');
      expect(newlyReady.length).toBe(1);
      expect(newlyReady[0].typeId).toBe('story');
    });

    it('stores outputPath and artifactId', () => {
      const executor = buildExecutor(template);
      executor.markStarted('plot');
      executor.markCompleted('plot', 'plans/plot.md', 'artifact_123');

      const node = executor.getNode('plot');
      expect(node?.outputPath).toBe('plans/plot.md');
      expect(node?.artifactId).toBe('artifact_123');
      expect(node?.completedAt).toBeDefined();
    });
  });

  describe('markFailed', () => {
    it('sets error and failed status', () => {
      const executor = buildExecutor(template);
      executor.markStarted('plot');
      executor.markFailed('plot', 'LLM call failed');

      const node = executor.getNode('plot');
      expect(node?.status).toBe('failed');
      expect(node?.error).toBe('LLM call failed');
    });

    it('blocks dependents from becoming ready', () => {
      const executor = buildExecutor(template);
      executor.markStarted('plot');
      executor.markFailed('plot', 'failed');

      const ready = executor.getNextReady();
      expect(ready).toEqual([]);
    });
  });

  describe('invalidateNode (redo)', () => {
    it('resets the target node and all downstream dependents', () => {
      const executor = buildExecutor(template);

      // Complete the whole chain: plot → story → character
      executor.markStarted('plot');
      executor.markCompleted('plot', 'plot.md');
      executor.markStarted('story');
      executor.markCompleted('story', 'story.md');
      executor.markStarted('character');
      executor.markCompleted('character', 'chars.md');

      // Invalidate story — should cascade to character (and beyond)
      const invalidated = executor.invalidateNode('story');
      const invalidatedIds = invalidated.map(n => n.id).sort();

      expect(invalidatedIds).toContain('story');
      expect(invalidatedIds).toContain('character');
      // scene also depends on story
      expect(invalidatedIds).toContain('scene');

      // story should now be pending, plot should still be completed
      expect(executor.getNode('story')?.status).toBe('pending');
      expect(executor.getNode('plot')?.status).toBe('completed');

      // story should be the next ready node (its dep — plot — is still completed)
      const ready = executor.getNextReady();
      expect(ready.length).toBe(1);
      expect(ready[0].typeId).toBe('story');
    });

    it('clears completedAt on the executor', () => {
      const executor = buildExecutor(template);
      // Complete everything
      for (const typeId of ['plot', 'story', 'character', 'character_image', 'scene', 'scene_image', 'final_video']) {
        executor.markStarted(typeId);
        executor.markCompleted(typeId);
      }
      expect(executor.isComplete()).toBe(true);

      executor.invalidateNode('story');
      expect(executor.isComplete()).toBe(false);
    });
  });

  describe('expandCollection', () => {
    it('replaces type-level node with per-item nodes', () => {
      const executor = buildExecutor(template);

      // Complete up to character being ready
      executor.markStarted('plot');
      executor.markCompleted('plot');
      executor.markStarted('story');
      executor.markCompleted('story');

      // Expand character into alice and bob
      const newNodes = executor.expandCollection('character', [
        { itemId: 'alice', name: 'Alice' },
        { itemId: 'bob', name: 'Bob' },
      ]);

      expect(newNodes.length).toBe(2);
      expect(executor.getNode('character')).toBeUndefined(); // old node removed
      expect(executor.getNode('character:alice')).toBeDefined();
      expect(executor.getNode('character:bob')).toBeDefined();

      // Per-item nodes should inherit the original dependencies
      expect(executor.getNode('character:alice')?.dependencies).toContain('story');
      expect(executor.getNode('character:bob')?.dependencies).toContain('story');
    });

    it('newly created item nodes are ready if dependencies are completed', () => {
      const executor = buildExecutor(template);

      executor.markStarted('plot');
      executor.markCompleted('plot');
      executor.markStarted('story');
      executor.markCompleted('story');

      executor.expandCollection('character', [
        { itemId: 'alice', name: 'Alice' },
      ]);

      const ready = executor.getNextReady();
      const readyIds = ready.map(n => n.id);
      expect(readyIds).toContain('character:alice');
    });

    it('rewires matching-scope dependents to per-item nodes', () => {
      const executor = buildExecutor(template);

      executor.markStarted('plot');
      executor.markCompleted('plot');
      executor.markStarted('story');
      executor.markCompleted('story');

      // Expand character — character_image has matching scope on character
      executor.expandCollection('character', [
        { itemId: 'alice', name: 'Alice' },
        { itemId: 'bob', name: 'Bob' },
      ]);

      // character_image should now also be expanded into per-item nodes
      expect(executor.getNode('character_image')).toBeUndefined(); // old node removed
      expect(executor.getNode('character_image:alice')).toBeDefined();
      expect(executor.getNode('character_image:bob')).toBeDefined();

      // character_image:alice should depend on character:alice
      expect(executor.getNode('character_image:alice')?.dependencies).toContain('character:alice');
    });
  });

  describe('getProgress', () => {
    it('returns correct counts', () => {
      const executor = buildExecutor(template);
      executor.markStarted('plot');
      executor.markCompleted('plot');
      executor.markStarted('story');

      const progress = executor.getProgress();
      expect(progress.completed).toBe(1);
      expect(progress.inProgress).toBe(1);
      expect(progress.pending).toBe(5);
      expect(progress.total).toBe(7);
    });
  });

  describe('serialization (session resume)', () => {
    it('round-trips through getState/fromState', () => {
      const executor = buildExecutor(template);
      executor.markStarted('plot');
      executor.markCompleted('plot', 'plot.md', 'art_1');

      const state = executor.getState();
      const restored = DependencyGraphExecutor.fromState(state, template);

      // Restored executor should have same state
      expect(restored.getNode('plot')?.status).toBe('completed');
      expect(restored.getNode('plot')?.outputPath).toBe('plot.md');
      expect(restored.getNode('story')?.status).toBe('pending');

      // getNextReady should return story
      const ready = restored.getNextReady();
      expect(ready.length).toBe(1);
      expect(ready[0].typeId).toBe('story');
    });
  });

  describe('producesCollectionItems', () => {
    it('returns true for nodes with collection dependents', () => {
      const executor = buildExecutor(template);
      const storyNode = executor.getNode('story')!;
      // story has character (collection) and scene (collection) as dependents
      expect(executor.producesCollectionItems(storyNode)).toBe(true);
    });

    it('returns false for leaf nodes', () => {
      const executor = buildExecutor(template);
      const finalNode = executor.getNode('final_video')!;
      expect(executor.producesCollectionItems(finalNode)).toBe(false);
    });
  });
});
