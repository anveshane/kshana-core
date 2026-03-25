/**
 * E2E Pipeline Step Tests
 *
 * Tests every step of the pipeline with a REAL LLM.
 * Each test runs the executor for one step and validates the output.
 *
 * Run: pnpm test:e2e
 * Requires: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL env vars
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  createTestProject,
  createTestLLM,
  createTestExecutor,
  runUntilNodeCompletes,
  readJsonOutput,
  readMdOutput,
  wordCount,
  extractImageReferences,
} from './helpers.js';
import { extractCollectionItems } from '../../src/core/planner/collectionExtractor.js';
import type { LLMClient } from '../../src/core/llm/index.js';
import type { ExecutorAgent } from '../../src/core/planner/ExecutorAgent.js';

// Skip all tests if LLM is not configured
const LLM_AVAILABLE = !!(process.env['LLM_BASE_URL'] && process.env['LLM_API_KEY']);
const describeE2E = LLM_AVAILABLE ? describe : describe.skip;

describeE2E('Pipeline E2E Steps', () => {
  let projectDir: string;
  let llm: LLMClient;
  let executor: ExecutorAgent;

  beforeAll(() => {
    projectDir = createTestProject();
    llm = createTestLLM();
    console.log(`E2E test project: ${projectDir}`);
  });

  // =========================================================================
  // Step 1: original_input → plot
  // =========================================================================
  it('Step 1: original_input → plot', async () => {
    executor = createTestExecutor(projectDir, llm);
    const result = await runUntilNodeCompletes(executor, 'plot');

    expect(result).not.toBeNull();
    expect(result!.node.typeId).toBe('plot');

    const plotPath = result!.outputPath;
    expect(existsSync(join(projectDir, plotPath))).toBe(true);

    const content = readMdOutput(projectDir, plotPath);
    expect(content.length).toBeGreaterThan(100);
    expect(wordCount(content)).toBeGreaterThan(20);

    // Should reference elements from original_input
    const lowerContent = content.toLowerCase();
    expect(
      lowerContent.includes('parvati') ||
      lowerContent.includes('village') ||
      lowerContent.includes('temple') ||
      lowerContent.includes('diary')
    ).toBe(true);
  }, 120000);

  // =========================================================================
  // Step 2: plot → story
  // =========================================================================
  it('Step 2: plot → story', async () => {
    executor = createTestExecutor(projectDir, llm);
    const result = await runUntilNodeCompletes(executor, 'story');

    expect(result).not.toBeNull();
    expect(result!.node.typeId).toBe('story');

    const content = readMdOutput(projectDir, result!.outputPath);
    expect(content.length).toBeGreaterThan(500);
    expect(wordCount(content)).toBeGreaterThan(100);
  }, 180000);

  // =========================================================================
  // Step 3: story → collection extraction
  // =========================================================================
  it('Step 3: story → collection extraction', async () => {
    // Read the completed story
    const graph = executor.getExecutor();
    const storyNode = graph.getAllNodes().find(n => n.typeId === 'story' && n.status === 'completed');
    expect(storyNode).toBeDefined();

    const storyContent = readMdOutput(projectDir, storyNode!.outputPath!);
    const items = await extractCollectionItems(storyNode!, storyContent, llm);

    expect(items).not.toBeNull();
    expect(items!.characters).toBeDefined();
    expect(items!.characters!.length).toBeGreaterThanOrEqual(1);
    expect(items!.settings).toBeDefined();
    expect(items!.settings!.length).toBeGreaterThanOrEqual(1);
    expect(items!.scenes).toBeDefined();
    expect(items!.scenes!.length).toBeGreaterThanOrEqual(1);

    // Each scene should have sceneNumber and title
    for (const scene of items!.scenes!) {
      expect(typeof scene.sceneNumber).toBe('number');
      expect(scene.title.length).toBeGreaterThan(0);
    }

    console.log(`Extracted: ${items!.characters!.length} characters, ${items!.settings!.length} settings, ${items!.scenes!.length} scenes`);
  }, 120000);

  // =========================================================================
  // Step 4: story → character profile
  // =========================================================================
  it('Step 4: story → character profile', async () => {
    executor = createTestExecutor(projectDir, llm);
    const result = await runUntilNodeCompletes(executor, 'character');

    expect(result).not.toBeNull();
    expect(result!.node.typeId).toBe('character');

    const content = readMdOutput(projectDir, result!.outputPath);
    expect(content.length).toBeGreaterThan(100);

    // Should contain character name
    const charName = result!.node.itemId ?? '';
    expect(content.toLowerCase()).toContain(charName.replace(/_/g, ' ').toLowerCase().split(' ')[0]);
  }, 120000);

  // =========================================================================
  // Step 5: story → setting profile
  // =========================================================================
  it('Step 5: story → setting profile', async () => {
    executor = createTestExecutor(projectDir, llm);
    const result = await runUntilNodeCompletes(executor, 'setting');

    expect(result).not.toBeNull();
    expect(result!.node.typeId).toBe('setting');

    const content = readMdOutput(projectDir, result!.outputPath);
    expect(content.length).toBeGreaterThan(50);
  }, 120000);

  // =========================================================================
  // Step 6: story + chars + settings → scene
  // =========================================================================
  it('Step 6: story → scene description', async () => {
    executor = createTestExecutor(projectDir, llm);
    const result = await runUntilNodeCompletes(executor, 'scene');

    expect(result).not.toBeNull();
    expect(result!.node.typeId).toBe('scene');

    const content = readMdOutput(projectDir, result!.outputPath);
    expect(content.length).toBeGreaterThan(100);
  }, 120000);

  // =========================================================================
  // Step 7: character → character_image prompt (JSON)
  // =========================================================================
  it('Step 7: character → character_image prompt', async () => {
    executor = createTestExecutor(projectDir, llm);
    const result = await runUntilNodeCompletes(executor, 'character_image');

    expect(result).not.toBeNull();
    expect(result!.node.typeId).toBe('character_image');

    // Should be JSON
    expect(result!.outputPath.endsWith('.json')).toBe(true);
    const json = readJsonOutput(projectDir, result!.outputPath) as {
      imagePrompt?: string;
      negativePrompt?: string;
      aspectRatio?: string;
      generationMode?: string;
      references?: unknown[];
    };

    // Required fields
    expect(json.imagePrompt).toBeDefined();
    expect(typeof json.imagePrompt).toBe('string');
    expect(json.negativePrompt).toBeDefined();
    expect(typeof json.negativePrompt).toBe('string');
    expect(json.aspectRatio).toBeDefined();
    expect(json.aspectRatio).toMatch(/^\d+:\d+$/);

    // Should NOT have generationMode or references (always text-to-image)
    expect(json.generationMode).toBeUndefined();
    expect(json.references).toBeUndefined();

    // Prompt quality checks
    const promptWords = wordCount(json.imagePrompt!);
    expect(promptWords).toBeGreaterThanOrEqual(30);
    expect(promptWords).toBeLessThanOrEqual(400);

    // Should mention studio background (from character_image_guide)
    expect(json.imagePrompt!.toLowerCase()).toContain('studio');

    console.log(`Character image prompt: ${promptWords} words, aspect: ${json.aspectRatio}`);
  }, 120000);

  // =========================================================================
  // Step 8: setting → setting_image prompt (JSON)
  // =========================================================================
  it('Step 8: setting → setting_image prompt', async () => {
    executor = createTestExecutor(projectDir, llm);
    const result = await runUntilNodeCompletes(executor, 'setting_image');

    expect(result).not.toBeNull();
    expect(result!.outputPath.endsWith('.json')).toBe(true);

    const json = readJsonOutput(projectDir, result!.outputPath) as {
      imagePrompt?: string;
      negativePrompt?: string;
      aspectRatio?: string;
    };

    expect(json.imagePrompt).toBeDefined();
    expect(typeof json.imagePrompt).toBe('string');
    expect(json.negativePrompt).toBeDefined();
    expect(json.aspectRatio).toBeDefined();

    // Setting images should not contain people
    const negLower = json.negativePrompt!.toLowerCase();
    expect(
      negLower.includes('people') || negLower.includes('person') || negLower.includes('character')
    ).toBe(true);

    console.log(`Setting image prompt: ${wordCount(json.imagePrompt!)} words`);
  }, 120000);

  // =========================================================================
  // Step 9: scene + images → scene_video_prompt (JSON)
  // =========================================================================
  it('Step 9: scene → scene_video_prompt (structured JSON shots)', async () => {
    executor = createTestExecutor(projectDir, llm);
    const result = await runUntilNodeCompletes(executor, 'scene_video_prompt');

    expect(result).not.toBeNull();
    expect(result!.outputPath.endsWith('.json')).toBe(true);

    const json = readJsonOutput(projectDir, result!.outputPath) as {
      sceneNumber?: number;
      sceneTitle?: string;
      totalDuration?: number;
      shots?: Array<{
        shotNumber: number;
        shotType: string;
        duration: number;
        description: string;
        characters?: string[];
        setting?: string | null;
      }>;
    };

    // Required structure
    expect(json.shots).toBeDefined();
    expect(Array.isArray(json.shots)).toBe(true);
    expect(json.shots!.length).toBeGreaterThanOrEqual(2);
    expect(json.shots!.length).toBeLessThanOrEqual(8);

    // Each shot must have required fields
    for (const shot of json.shots!) {
      expect(typeof shot.shotNumber).toBe('number');
      expect(typeof shot.shotType).toBe('string');
      expect(shot.shotType.length).toBeGreaterThan(0);
      expect(typeof shot.duration).toBe('number');
      expect(shot.duration).toBeGreaterThanOrEqual(2);
      expect(shot.duration).toBeLessThanOrEqual(15);
      expect(typeof shot.description).toBe('string');
      expect(shot.description.length).toBeGreaterThan(10);
    }

    // Shot durations should sum to totalDuration (if provided)
    const totalShotDuration = json.shots!.reduce((sum, s) => sum + s.duration, 0);
    if (json.totalDuration) {
      expect(Math.abs(totalShotDuration - json.totalDuration)).toBeLessThanOrEqual(2);
    }

    // Characters should be valid itemIds
    for (const shot of json.shots!) {
      if (shot.characters) {
        for (const char of shot.characters) {
          expect(typeof char).toBe('string');
          expect(char.length).toBeGreaterThan(0);
        }
      }
    }

    console.log(`Scene video prompt: ${json.shots!.length} shots, total ${totalShotDuration}s`);
  }, 120000);

  // =========================================================================
  // Step 10: scene_video_prompt → shot extraction (no LLM)
  // =========================================================================
  it('Step 10: scene_video_prompt → shot extraction', async () => {
    // Find the completed scene_video_prompt
    const graph = executor.getExecutor();
    const svpNode = graph.getAllNodes().find(n => n.typeId === 'scene_video_prompt' && n.status === 'completed');
    expect(svpNode).toBeDefined();

    const content = readFileSync(join(projectDir, svpNode!.outputPath!), 'utf-8');
    const items = await extractCollectionItems(svpNode!, content, llm);

    expect(items).not.toBeNull();
    expect(items!.shots).toBeDefined();
    expect(items!.shots!.length).toBeGreaterThanOrEqual(2);

    for (const shot of items!.shots!) {
      expect(typeof shot.shotNumber).toBe('number');
      expect(typeof shot.shotType).toBe('string');
      expect(typeof shot.duration).toBe('number');
    }

    console.log(`Extracted ${items!.shots!.length} shots`);
  }, 10000);

  // =========================================================================
  // Step 11: scene_video_prompt + images → shot_image_prompt (JSON)
  // =========================================================================
  it('Step 11: shot_image_prompt (JSON with references)', async () => {
    executor = createTestExecutor(projectDir, llm);
    const result = await runUntilNodeCompletes(executor, 'shot_image_prompt');

    expect(result).not.toBeNull();
    expect(result!.outputPath.endsWith('.json')).toBe(true);

    const json = readJsonOutput(projectDir, result!.outputPath) as {
      imagePrompt?: string;
      negativePrompt?: string;
      aspectRatio?: string;
      generationMode?: string;
      references?: Array<{
        imageNumber: number;
        type: string;
        refId: string;
      }>;
    };

    // Required fields
    expect(json.imagePrompt).toBeDefined();
    expect(typeof json.imagePrompt).toBe('string');
    expect(json.negativePrompt).toBeDefined();
    expect(json.aspectRatio).toBeDefined();
    expect(json.generationMode).toBeDefined();
    expect(json.references).toBeDefined();
    expect(Array.isArray(json.references)).toBe(true);

    // Generation mode should be set
    expect(['text_to_image', 'image_text_to_image']).toContain(json.generationMode);

    if (json.generationMode === 'image_text_to_image') {
      // References should be populated
      expect(json.references!.length).toBeGreaterThan(0);

      for (const ref of json.references!) {
        expect(typeof ref.imageNumber).toBe('number');
        expect(ref.imageNumber).toBeGreaterThanOrEqual(1);
        expect(['character', 'setting']).toContain(ref.type);
        expect(ref.refId).toMatch(/^(character_image|setting_image):/);
      }

      // imagePrompt should reference each image N
      const imageRefs = extractImageReferences(json.imagePrompt!);
      for (const ref of json.references!) {
        expect(imageRefs).toContain(ref.imageNumber);
      }
    }

    console.log(`Shot prompt: mode=${json.generationMode}, refs=${json.references?.length ?? 0}`);
  }, 120000);

  // =========================================================================
  // Step 12: Verify reference consistency
  // =========================================================================
  it('Step 12: reference image consistency', async () => {
    const graph = executor.getExecutor();

    // Find all completed shot_image_prompt nodes
    const shotPrompts = graph.getAllNodes().filter(
      n => n.typeId === 'shot_image_prompt' && n.status === 'completed' && n.outputPath?.endsWith('.json')
    );

    expect(shotPrompts.length).toBeGreaterThanOrEqual(1);

    for (const shotNode of shotPrompts) {
      const json = readJsonOutput(projectDir, shotNode.outputPath!) as {
        imagePrompt: string;
        generationMode: string;
        references: Array<{ imageNumber: number; type: string; refId: string }>;
      };

      if (json.generationMode === 'image_text_to_image' && json.references.length > 0) {
        // Every refId should resolve to an existing completed node
        for (const ref of json.references) {
          const refNode = graph.getNode(ref.refId);
          // Node should exist (might not have .png if image gen didn't run in tests)
          expect(refNode).toBeDefined();
          expect(refNode!.status).toBe('completed');
        }

        // No fabricated image numbers in prompt
        const imageRefs = extractImageReferences(json.imagePrompt);
        const validNumbers = new Set(json.references.map(r => r.imageNumber));
        for (const num of imageRefs) {
          expect(validNumbers.has(num)).toBe(true);
        }
      }
    }

    console.log(`Verified ${shotPrompts.length} shot prompts for reference consistency`);
  }, 10000);
});
