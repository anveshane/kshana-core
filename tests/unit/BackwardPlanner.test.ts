/**
 * Tests for BackwardPlanner
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BackwardPlanner } from '../../src/core/planner/BackwardPlanner.js';
import { AssetScanner } from '../../src/core/planner/AssetScanner.js';
import type { VideoTemplate, GenericProjectFile } from '../../src/core/templates/types.js';
import type { UserGoal, AssetRegistry } from '../../src/core/planner/types.js';

// Create a simple test template
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

describe('BackwardPlanner', () => {
  let template: VideoTemplate;
  let planner: BackwardPlanner;

  beforeEach(() => {
    template = createTestTemplate();
    planner = new BackwardPlanner(template);
  });

  describe('findRequiredArtifacts', () => {
    it('should find all dependencies for final_video', () => {
      const required = planner.findRequiredArtifacts(['final_video']);

      expect(required.has('final_video')).toBe(true);
      expect(required.has('scene_image')).toBe(true);
      expect(required.has('scene')).toBe(true);
      expect(required.has('character_image')).toBe(true);
      expect(required.has('character')).toBe(true);
      expect(required.has('story')).toBe(true);
      expect(required.has('plot')).toBe(true);
    });

    it('should find minimal dependencies for story', () => {
      const required = planner.findRequiredArtifacts(['story']);

      expect(required.has('story')).toBe(true);
      expect(required.has('plot')).toBe(true);
      expect(required.has('character')).toBe(false);
      expect(required.has('scene')).toBe(false);
    });

    it('should find no dependencies for plot', () => {
      const required = planner.findRequiredArtifacts(['plot']);

      expect(required.size).toBe(1);
      expect(required.has('plot')).toBe(true);
    });
  });

  describe('subtractSatisfied', () => {
    it('should remove fully satisfied artifacts', () => {
      const required = new Set(['plot', 'story', 'character']);
      const registry = createEmptyRegistry();
      registry.satisfiedArtifacts.set('plot', 'full');
      registry.satisfiedArtifacts.set('story', 'full');

      const toCreate = planner.subtractSatisfied(required, registry);

      expect(toCreate.has('plot')).toBe(false);
      expect(toCreate.has('story')).toBe(false);
      expect(toCreate.has('character')).toBe(true);
    });

    it('should keep partially satisfied artifacts', () => {
      const required = new Set(['character', 'character_image']);
      const registry = createEmptyRegistry();
      registry.satisfiedArtifacts.set('character', 'partial');

      const toCreate = planner.subtractSatisfied(required, registry);

      expect(toCreate.has('character')).toBe(true);
      expect(toCreate.has('character_image')).toBe(true);
    });
  });

  describe('buildPlan', () => {
    it('should build a complete plan for final_video with empty registry', () => {
      const goal: UserGoal = {
        targetArtifacts: ['final_video'],
        preferences: {},
        description: 'Create a video',
      };
      const registry = createEmptyRegistry();

      const plan = planner.buildPlan(goal, registry);

      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.skippedArtifacts.length).toBe(0);
      expect(plan.expensiveStepCount).toBeGreaterThan(0);

      // Check that dependencies come before dependents
      const stepOrder = plan.steps.map(s => s.artifactTypeId);
      const plotIndex = stepOrder.indexOf('plot');
      const storyIndex = stepOrder.indexOf('story');
      const characterIndex = stepOrder.indexOf('character');
      const sceneIndex = stepOrder.indexOf('scene');

      expect(plotIndex).toBeLessThan(storyIndex);
      expect(storyIndex).toBeLessThan(characterIndex);
      expect(characterIndex).toBeLessThan(sceneIndex);
    });

    it('should skip artifacts that are already satisfied', () => {
      const goal: UserGoal = {
        targetArtifacts: ['character'],
        preferences: {},
        description: 'Create characters',
      };
      const registry = createEmptyRegistry();
      registry.satisfiedArtifacts.set('plot', 'full');
      registry.satisfiedArtifacts.set('story', 'full');

      const plan = planner.buildPlan(goal, registry);

      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0]?.artifactTypeId).toBe('character');
      expect(plan.skippedArtifacts.length).toBe(2);
      expect(plan.skippedArtifacts.map(s => s.typeId)).toContain('plot');
      expect(plan.skippedArtifacts.map(s => s.typeId)).toContain('story');
    });

    it('should create minimal plan for story goal', () => {
      const goal: UserGoal = {
        targetArtifacts: ['story'],
        preferences: {},
        description: 'Just create a story',
      };
      const registry = createEmptyRegistry();

      const plan = planner.buildPlan(goal, registry);

      expect(plan.steps.length).toBe(2);
      const typeIds = plan.steps.map(s => s.artifactTypeId);
      expect(typeIds).toContain('plot');
      expect(typeIds).toContain('story');
      expect(typeIds).not.toContain('character');
      expect(typeIds).not.toContain('scene');
    });

    it('should mark expensive steps correctly', () => {
      const goal: UserGoal = {
        targetArtifacts: ['character_image'],
        preferences: {},
        description: 'Create character images',
      };
      const registry = createEmptyRegistry();

      const plan = planner.buildPlan(goal, registry);

      const expensiveSteps = plan.steps.filter(s => s.isExpensive);
      expect(expensiveSteps.length).toBe(1);
      expect(expensiveSteps[0]?.artifactTypeId).toBe('character_image');
      expect(plan.requiresApproval).toBe(true);
    });
  });

  describe('validatePlan', () => {
    it('should validate a correct plan', () => {
      const goal: UserGoal = {
        targetArtifacts: ['story'],
        preferences: {},
        description: 'Create a story',
      };
      const registry = createEmptyRegistry();
      const plan = planner.buildPlan(goal, registry);

      const validation = planner.validatePlan(plan);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect invalid target artifacts', () => {
      const plan = {
        goal: {
          targetArtifacts: ['nonexistent'],
          preferences: {},
          description: 'Invalid',
        },
        steps: [],
        skippedArtifacts: [],
        summary: '',
        expensiveStepCount: 0,
        requiresApproval: false,
      };

      const validation = planner.validatePlan(plan);

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });
});

describe('AssetScanner', () => {
  let template: VideoTemplate;
  let scanner: AssetScanner;

  beforeEach(() => {
    template = createTestTemplate();
    scanner = new AssetScanner(template);
  });

  describe('createEmptyRegistry', () => {
    it('should create an empty registry', () => {
      const registry = scanner.createEmptyRegistry();

      expect(registry.assets.size).toBe(0);
      expect(registry.satisfiedArtifacts.size).toBe(0);
      expect(registry.lastScanAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('registerContent', () => {
    it('should register content for a valid artifact type', () => {
      const asset = scanner.registerContent('My story content', 'story');

      expect(asset).not.toBeNull();
      expect(asset?.artifactTypeId).toBe('story');
      expect(asset?.content).toBe('My story content');
      expect(asset?.source).toBe('user_provided');
    });

    it('should return null for invalid artifact type', () => {
      const asset = scanner.registerContent('content', 'invalid_type');

      expect(asset).toBeNull();
    });

    it('should support item IDs for collections', () => {
      const asset = scanner.registerContent('Character description', 'character', 'hero');

      expect(asset).not.toBeNull();
      expect(asset?.artifactTypeId).toBe('character');
      expect(asset?.itemId).toBe('hero');
    });
  });

  describe('getSummary', () => {
    it('should generate a readable summary', () => {
      const registry = scanner.createEmptyRegistry();

      const asset = scanner.registerContent('My story', 'story');
      if (asset) {
        registry.assets.set(asset.id, asset);
        registry.satisfiedArtifacts.set('story', 'full');
      }

      const summary = scanner.getSummary(registry);

      expect(summary).toContain('Asset Registry Summary');
      expect(summary).toContain('Story');
      expect(summary).toContain('full');
    });
  });
});
