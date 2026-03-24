/**
 * Tests for structured JSON shot pipeline:
 * - scene_video_prompt → structured JSON with characters/setting per shot
 * - shot_image_prompt → structured JSON with reference mapping
 * - Reference resolution from executor graph state
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraphExecutor } from '../../src/core/planner/DependencyGraphExecutor.js';
import { BackwardPlanner } from '../../src/core/planner/BackwardPlanner.js';
import { extractCollectionItems } from '../../src/core/planner/collectionExtractor.js';
import type { VideoTemplate } from '../../src/core/templates/types.js';
import type { AssetRegistry } from '../../src/core/planner/types.js';

const mockLlm = {} as any;

// Template with the full shot pipeline
function createShotPipelineTemplate(): VideoTemplate {
  return {
    id: 'test',
    displayName: 'Test',
    description: 'Test template with shot pipeline',
    version: '1.0.0',
    defaultStyle: 'default',
    styles: [{ id: 'default', displayName: 'Default', description: '', promptModifiers: [], negativePrompt: [] }],
    inputTypes: [{ id: 'idea', displayName: 'Idea', description: '', examples: [], skipsArtifacts: [], mapsToArtifact: 'plot' }],
    artifactTypes: {
      plot: {
        id: 'plot', displayName: 'Plot', category: 'concept', description: '', isCollection: false,
        outputFormat: 'markdown', filePattern: 'plot.md', agentType: 'planning', promptFile: '', isExpensive: false, requiresPerItemApproval: false,
        dependencies: [],
      },
      story: {
        id: 'story', displayName: 'Story', category: 'structure', description: '', isCollection: false,
        outputFormat: 'markdown', filePattern: 'story.md', agentType: 'content', promptFile: '', isExpensive: false, requiresPerItemApproval: false,
        dependencies: [{ artifactTypeId: 'plot', required: true, usage: 'context' }],
      },
      character: {
        id: 'character', displayName: 'Characters', category: 'entity', description: '', isCollection: true,
        outputFormat: 'markdown', filePattern: 'characters/{{name}}.md', agentType: 'content', promptFile: '', isExpensive: false, requiresPerItemApproval: false,
        dependencies: [{ artifactTypeId: 'story', required: true, usage: 'context' }],
      },
      setting: {
        id: 'setting', displayName: 'Settings', category: 'environment', description: '', isCollection: true,
        outputFormat: 'markdown', filePattern: 'settings/{{name}}.md', agentType: 'content', promptFile: '', isExpensive: false, requiresPerItemApproval: false,
        dependencies: [{ artifactTypeId: 'story', required: true, usage: 'context' }],
      },
      character_image: {
        id: 'character_image', displayName: 'Character Images', category: 'visual_ref', description: '', isCollection: true,
        outputFormat: 'image', filePattern: 'assets/characters/{{name}}.png', agentType: 'image', promptFile: '', isExpensive: true, requiresPerItemApproval: true,
        dependencies: [{ artifactTypeId: 'character', required: true, usage: 'reference', scope: 'matching' }],
      },
      setting_image: {
        id: 'setting_image', displayName: 'Setting Images', category: 'visual_ref', description: '', isCollection: true,
        outputFormat: 'image', filePattern: 'assets/settings/{{name}}.png', agentType: 'image', promptFile: '', isExpensive: true, requiresPerItemApproval: true,
        dependencies: [{ artifactTypeId: 'setting', required: true, usage: 'reference', scope: 'matching' }],
      },
      scene: {
        id: 'scene', displayName: 'Scenes', category: 'segment', description: '', isCollection: true,
        outputFormat: 'markdown', filePattern: 'scenes/{{name}}.md', agentType: 'content', promptFile: '', isExpensive: false, requiresPerItemApproval: false,
        dependencies: [{ artifactTypeId: 'story', required: true, usage: 'context' }],
      },
      scene_video_prompt: {
        id: 'scene_video_prompt', displayName: 'Motion Prompts', category: 'structure', description: '', isCollection: true,
        outputFormat: 'json', filePattern: 'prompts/videos/{{name}}.motion.md', agentType: 'content', promptFile: '', isExpensive: false, requiresPerItemApproval: false,
        dependencies: [{ artifactTypeId: 'scene', required: true, usage: 'context', scope: 'matching' }],
      },
      shot_image_prompt: {
        id: 'shot_image_prompt', displayName: 'Shot Prompts', category: 'structure', description: '', isCollection: true,
        outputFormat: 'markdown', filePattern: 'prompts/shots/scene-{{index}}-shot-{{subindex}}.json', agentType: 'content', promptFile: '', isExpensive: false, requiresPerItemApproval: false,
        dependencies: [{ artifactTypeId: 'scene_video_prompt', required: true, usage: 'context', scope: 'matching' }],
      },
      final_video: {
        id: 'final_video', displayName: 'Final Video', category: 'final', description: '', isCollection: false,
        outputFormat: 'video', filePattern: 'final.mp4', agentType: 'video', promptFile: '', isExpensive: true, requiresPerItemApproval: false,
        dependencies: [{ artifactTypeId: 'shot_image_prompt', required: true, usage: 'input', scope: 'all' }],
      },
    },
    contextVariables: {},
    orchestratorPrompt: '',
  };
}

function buildExecutor(template: VideoTemplate) {
  const planner = new BackwardPlanner(template);
  const registry: AssetRegistry = { assets: new Map(), satisfiedArtifacts: new Map(), lastScanAt: Date.now() };
  const plan = planner.buildPlan({ targetArtifacts: ['final_video'], preferences: {}, description: 'test' }, registry);
  return DependencyGraphExecutor.fromPlan(plan, template);
}

describe('Shot Reference Mapping Pipeline', () => {
  let template: VideoTemplate;
  let executor: DependencyGraphExecutor;

  beforeEach(() => {
    template = createShotPipelineTemplate();
    executor = buildExecutor(template);
  });

  describe('scene_video_prompt JSON extraction', () => {
    it('extracts shots with characters and settings from structured JSON', async () => {
      const json = JSON.stringify({
        sceneNumber: 1,
        sceneTitle: 'The Chase',
        totalDuration: 30,
        shots: [
          { shotNumber: 1, shotType: 'wide', duration: 10, description: 'Wide shot', characters: ['alice', 'bob'], setting: 'forest' },
          { shotNumber: 2, shotType: 'close_up', duration: 8, description: 'Close up', characters: ['alice'], setting: null },
          { shotNumber: 3, shotType: 'tracking', duration: 12, description: 'Tracking shot', characters: ['bob'], setting: 'forest' },
        ],
      });

      const result = await extractCollectionItems(
        { id: 'svp:s1', typeId: 'scene_video_prompt', itemId: 'scene_1', status: 'completed', displayName: '', isExpensive: false, isCollection: false, dependencies: [], dependents: [] },
        json,
        mockLlm,
      );

      expect(result!.shots).toHaveLength(3);
      expect(result!.shots![0].characters).toEqual(['alice', 'bob']);
      expect(result!.shots![0].setting).toBe('forest');
      expect(result!.shots![1].characters).toEqual(['alice']);
      expect(result!.shots![1].setting).toBeNull();
    });

    it('shot durations sum to totalDuration', async () => {
      const json = JSON.stringify({
        sceneNumber: 1,
        totalDuration: 30,
        shots: [
          { shotNumber: 1, shotType: 'wide', duration: 10, description: 'A' },
          { shotNumber: 2, shotType: 'medium', duration: 12, description: 'B' },
          { shotNumber: 3, shotType: 'close', duration: 8, description: 'C' },
        ],
      });

      const result = await extractCollectionItems(
        { id: 'svp:s1', typeId: 'scene_video_prompt', itemId: 'scene_1', status: 'completed', displayName: '', isExpensive: false, isCollection: false, dependencies: [], dependents: [] },
        json,
        mockLlm,
      );

      const totalShotDuration = result!.shots!.reduce((sum, s) => sum + s.duration, 0);
      expect(totalShotDuration).toBe(30);
    });
  });

  describe('shot_image_prompt JSON validation', () => {
    it('valid shot image prompt JSON', () => {
      const json = {
        imagePrompt: 'The woman from image 1 stands in the doorway of the room from image 2.',
        negativePrompt: 'blurry, text, watermark',
        aspectRatio: '16:9',
        generationMode: 'image_text_to_image',
        references: [
          { imageNumber: 1, type: 'character', refId: 'character_image:alice' },
          { imageNumber: 2, type: 'setting', refId: 'setting_image:forest' },
        ],
      };

      const parsed = JSON.parse(JSON.stringify(json));
      expect(parsed.imagePrompt).toContain('image 1');
      expect(parsed.imagePrompt).toContain('image 2');
      expect(parsed.generationMode).toBe('image_text_to_image');
      expect(parsed.references).toHaveLength(2);
      expect(parsed.references[0].refId).toBe('character_image:alice');
      expect(parsed.references[1].refId).toBe('setting_image:forest');
    });

    it('text_to_image mode when no references available', () => {
      const json = {
        imagePrompt: 'A wide shot of a forest clearing at dawn.',
        negativePrompt: 'blurry',
        aspectRatio: '16:9',
        generationMode: 'text_to_image',
        references: [],
      };

      const parsed = JSON.parse(JSON.stringify(json));
      expect(parsed.generationMode).toBe('text_to_image');
      expect(parsed.references).toHaveLength(0);
      expect(parsed.imagePrompt).not.toContain('image');
    });

    it('refId is resolvable to executor node', () => {
      // Set up executor with completed character_image
      executor.markStarted('plot');
      executor.markCompleted('plot');
      executor.markStarted('story');
      executor.markCompleted('story');

      // Expand characters and settings
      executor.expandCollection('character', [
        { itemId: 'alice', name: 'Alice' },
      ]);
      executor.expandCollection('setting', [
        { itemId: 'forest', name: 'Forest' },
      ]);

      // Add character/setting image nodes manually (they may not be in the plan
      // if final_video doesn't depend on them, but they exist in the project)
      executor.addNode({
        id: 'character_image:alice',
        typeId: 'character_image',
        itemId: 'alice',
        status: 'completed',
        displayName: 'Character Image: Alice',
        isExpensive: true,
        isCollection: false,
        dependencies: ['character:alice'],
        dependents: [],
        outputPath: 'assets/characters/alice.png',
        completedAt: Date.now(),
      });
      executor.addNode({
        id: 'setting_image:forest',
        typeId: 'setting_image',
        itemId: 'forest',
        status: 'completed',
        displayName: 'Setting Image: Forest',
        isExpensive: true,
        isCollection: false,
        dependencies: ['setting:forest'],
        dependents: [],
        outputPath: 'assets/settings/forest.png',
        completedAt: Date.now(),
      });

      // Simulate shot prompt JSON output with refIds
      const shotPromptJson = {
        imagePrompt: 'The woman from image 1 in the clearing from image 2',
        generationMode: 'image_text_to_image',
        references: [
          { imageNumber: 1, type: 'character', refId: 'character_image:alice' },
          { imageNumber: 2, type: 'setting', refId: 'setting_image:forest' },
        ],
      };

      // Resolve refIds to actual file paths using the executor
      const resolvedPaths = shotPromptJson.references.map(ref => {
        const node = executor.getNode(ref.refId);
        return {
          imageNumber: ref.imageNumber,
          type: ref.type,
          filePath: node?.outputPath,
        };
      });

      expect(resolvedPaths[0].filePath).toBe('assets/characters/alice.png');
      expect(resolvedPaths[1].filePath).toBe('assets/settings/forest.png');
    });
  });

  describe('full expansion chain', () => {
    it('scene → scene_video_prompt → shot_image_prompt expansion preserves structure', () => {
      executor.markStarted('plot');
      executor.markCompleted('plot');
      executor.markStarted('story');
      executor.markCompleted('story');

      // Expand scenes
      executor.expandCollection('scene', [
        { itemId: 'scene_1', name: 'Scene 1' },
      ]);

      // Verify cascade created scene_video_prompt and shot_image_prompt per-scene
      expect(executor.getNode('scene_video_prompt:scene_1')).toBeDefined();
      expect(executor.getNode('shot_image_prompt:scene_1')).toBeDefined();
      expect(executor.getNode('shot_image_prompt:scene_1')?.isCollection).toBe(true);

      // Complete scene and scene_video_prompt
      executor.markStarted('scene:scene_1');
      executor.markCompleted('scene:scene_1');
      executor.markStarted('scene_video_prompt:scene_1');
      executor.markCompleted('scene_video_prompt:scene_1', 'svp_scene_1.json');

      // Expand shot_image_prompt:scene_1 into per-shot nodes
      executor.expandCollection('shot_image_prompt:scene_1', [
        { itemId: 'scene_1_shot_1', name: 'Shot 1: wide' },
        { itemId: 'scene_1_shot_2', name: 'Shot 2: close_up' },
      ]);

      // Per-shot nodes exist
      expect(executor.getNode('shot_image_prompt:scene_1_shot_1')).toBeDefined();
      expect(executor.getNode('shot_image_prompt:scene_1_shot_2')).toBeDefined();

      // Per-shot nodes depend on scene_video_prompt:scene_1
      expect(executor.getNode('shot_image_prompt:scene_1_shot_1')?.dependencies).toContain('scene_video_prompt:scene_1');

      // Per-shot nodes should be ready (their dep is completed)
      const ready = executor.getNextReady();
      const readyIds = ready.map(n => n.id);
      expect(readyIds).toContain('shot_image_prompt:scene_1_shot_1');
      expect(readyIds).toContain('shot_image_prompt:scene_1_shot_2');
    });
  });
});
