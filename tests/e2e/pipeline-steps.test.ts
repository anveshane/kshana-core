/**
 * E2E Pipeline Step Tests
 *
 * Runs the executor ONCE through the full pipeline with a real LLM,
 * then validates every step's output structure and content.
 *
 * Run: pnpm test:e2e
 * Requires: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL configured in .env
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';  // used by readJsonOutput internally
import {
  createTestProject,
  createTestLLM,
  createTestExecutor,
  readJsonOutput,
  readMdOutput,
  wordCount,
  extractImageReferences,
} from './helpers.js';
import type { LLMClient } from '../../src/core/llm/index.js';
import type { ExecutorAgent } from '../../src/core/planner/ExecutorAgent.js';
import type { ExecutionNode } from '../../src/core/planner/types.js';

// Check LLM reachability (not just env var presence)
async function isLLMReachable(): Promise<boolean> {
  try {
    const url = process.env['LLM_BASE_URL'];
    if (!url) return false;
    const apiKey = process.env['LLM_API_KEY'] ?? '';
    const headers: Record<string, string> = {};
    if (apiKey && apiKey !== 'not-needed') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(10000), headers });
    return res.ok;
  } catch {
    return false;
  }
}

let LLM_AVAILABLE = false;

beforeAll(async () => {
  LLM_AVAILABLE = await isLLMReachable();
  if (!LLM_AVAILABLE) {
    console.log('LLM not reachable — skipping E2E tests');
  }
}, 15000);

describe('Pipeline E2E Steps', () => {
  let projectDir: string;
  let llm: LLMClient;
  let executor: ExecutorAgent;
  let allNodes: ExecutionNode[];

  // Run the full pipeline once
  beforeAll(async () => {
    if (!LLM_AVAILABLE) return;

    projectDir = createTestProject();
    llm = createTestLLM();
    executor = createTestExecutor(projectDir, llm, undefined, {
      skipMediaGeneration: true,
    });

    console.log(`E2E test project: ${projectDir}`);
    console.log(`LLM: ${process.env['LLM_BASE_URL']} / ${process.env['LLM_MODEL']}`);
    console.log('Running full pipeline...');

    const start = Date.now();

    // Run executor to completion (or until stuck)
    await executor.run('Create a 1-minute cinematic video');

    allNodes = executor.getExecutor().getAllNodes();
    const completed = allNodes.filter(n => n.status === 'completed').length;
    const failed = allNodes.filter(n => n.status === 'failed').length;
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`Pipeline finished in ${elapsed}s: ${completed} completed, ${failed} failed, ${allNodes.length} total`);
  }, 3600000); // 60 min timeout for full pipeline

  // Helper to find completed node by type
  function findNode(typeId: string): ExecutionNode | undefined {
    return allNodes?.find(n => n.typeId === typeId && n.status === 'completed');
  }
  function findNodes(typeId: string): ExecutionNode[] {
    return allNodes?.filter(n => n.typeId === typeId && n.status === 'completed') ?? [];
  }

  // =========================================================================
  // Step 1: original_input → plot
  // =========================================================================
  it('Step 1: original_input → plot', () => {
    if (!LLM_AVAILABLE) return;

    const node = findNode('plot');
    expect(node).toBeDefined();
    expect(node!.outputPath).toBeDefined();

    const content = readMdOutput(projectDir, node!.outputPath!);
    expect(content.length).toBeGreaterThan(100);
    expect(wordCount(content)).toBeGreaterThan(20);

    // Should reference elements from original_input
    const lower = content.toLowerCase();
    expect(
      lower.includes('parvati') || lower.includes('village') ||
      lower.includes('temple') || lower.includes('diary')
    ).toBe(true);
  });

  // =========================================================================
  // Step 2: plot → story
  // =========================================================================
  it('Step 2: plot → story', () => {
    if (!LLM_AVAILABLE) return;

    const node = findNode('story');
    expect(node).toBeDefined();

    const content = readMdOutput(projectDir, node!.outputPath!);
    expect(content.length).toBeGreaterThan(500);
    expect(wordCount(content)).toBeGreaterThan(100);
  });

  // =========================================================================
  // Step 3: story → collection extraction
  // =========================================================================
  it('Step 3: story → collection extraction produced characters, settings, scenes', () => {
    if (!LLM_AVAILABLE) return;

    const chars = findNodes('character');
    const settings = findNodes('setting');
    const scenes = findNodes('scene');

    expect(chars.length).toBeGreaterThanOrEqual(1);
    expect(settings.length).toBeGreaterThanOrEqual(1);
    expect(scenes.length).toBeGreaterThanOrEqual(1);

    console.log(`Extracted: ${chars.length} characters, ${settings.length} settings, ${scenes.length} scenes`);
  });

  // =========================================================================
  // Step 4: character profile
  // =========================================================================
  it('Step 4: character profile', () => {
    if (!LLM_AVAILABLE) return;

    const chars = findNodes('character');
    expect(chars.length).toBeGreaterThanOrEqual(1);

    const first = chars[0];
    const content = readMdOutput(projectDir, first.outputPath!);
    expect(content.length).toBeGreaterThan(100);

    // Should contain the character's name (first part of itemId)
    const namePart = (first.itemId ?? '').split('_')[0];
    if (namePart.length > 2) {
      expect(content.toLowerCase()).toContain(namePart.toLowerCase());
    }
  });

  // =========================================================================
  // Step 5: setting profile
  // =========================================================================
  it('Step 5: setting profile', () => {
    if (!LLM_AVAILABLE) return;

    const settings = findNodes('setting');
    expect(settings.length).toBeGreaterThanOrEqual(1);

    const first = settings[0];
    const content = readMdOutput(projectDir, first.outputPath!);
    expect(content.length).toBeGreaterThan(50);
  });

  // =========================================================================
  // Step 6: scene description
  // =========================================================================
  it('Step 6: scene description', () => {
    if (!LLM_AVAILABLE) return;

    const scenes = findNodes('scene');
    expect(scenes.length).toBeGreaterThanOrEqual(1);

    const first = scenes[0];
    const content = readMdOutput(projectDir, first.outputPath!);
    expect(content.length).toBeGreaterThan(100);
  });

  // =========================================================================
  // Step 7: character_image prompt (JSON)
  // =========================================================================
  it('Step 7: character_image prompt is valid JSON', () => {
    if (!LLM_AVAILABLE) return;

    const nodes = findNodes('character_image');
    expect(nodes.length).toBeGreaterThanOrEqual(1);

    for (const node of nodes) {
      expect(node.outputPath).toBeDefined();
      // Should be .json (new format) or .png (if image was generated)
      if (node.outputPath!.endsWith('.json')) {
        const json = readJsonOutput(projectDir, node.outputPath!) as Record<string, unknown>;

        expect(json.imagePrompt).toBeDefined();
        expect(typeof json.imagePrompt).toBe('string');
        expect(json.negativePrompt).toBeDefined();
        expect(typeof json.negativePrompt).toBe('string');
        expect(json.aspectRatio).toBeDefined();
        expect(String(json.aspectRatio)).toMatch(/^\d+:\d+$/);

        // Should NOT have generationMode or references
        expect(json.generationMode).toBeUndefined();
        expect(json.references).toBeUndefined();

        const promptWords = wordCount(json.imagePrompt as string);
        expect(promptWords).toBeGreaterThanOrEqual(20);

        // Should mention studio background (from guide)
        expect((json.imagePrompt as string).toLowerCase()).toContain('studio');
      }
    }

    console.log(`Validated ${nodes.length} character_image prompts`);
  });

  // =========================================================================
  // Step 8: setting_image prompt (JSON)
  // =========================================================================
  it('Step 8: setting_image prompt is valid JSON', () => {
    if (!LLM_AVAILABLE) return;

    const nodes = findNodes('setting_image');
    expect(nodes.length).toBeGreaterThanOrEqual(1);

    for (const node of nodes) {
      if (node.outputPath!.endsWith('.json')) {
        const json = readJsonOutput(projectDir, node.outputPath!) as Record<string, unknown>;

        expect(json.imagePrompt).toBeDefined();
        expect(typeof json.imagePrompt).toBe('string');
        expect(json.negativePrompt).toBeDefined();
        expect(json.aspectRatio).toBeDefined();

        // Negative prompt should exclude people
        const neg = (json.negativePrompt as string).toLowerCase();
        expect(
          neg.includes('people') || neg.includes('person') ||
          neg.includes('character') || neg.includes('human')
        ).toBe(true);
      }
    }

    console.log(`Validated ${nodes.length} setting_image prompts`);
  });

  // =========================================================================
  // Step 9: scene_video_prompt (structured JSON shots)
  // =========================================================================
  it('Step 9: scene_video_prompt has structured shots', () => {
    if (!LLM_AVAILABLE) return;

    const nodes = findNodes('scene_video_prompt');
    expect(nodes.length).toBeGreaterThanOrEqual(1);

    for (const node of nodes) {
      const json = readJsonOutput(projectDir, node.outputPath!) as Record<string, unknown>;

      expect(json.shots).toBeDefined();
      expect(Array.isArray(json.shots)).toBe(true);
      const shots = json.shots as Array<Record<string, unknown>>;
      expect(shots.length).toBeGreaterThanOrEqual(2);
      expect(shots.length).toBeLessThanOrEqual(10);

      for (const shot of shots) {
        expect(typeof shot.shotNumber).toBe('number');
        expect(typeof shot.shotType).toBe('string');
        expect(typeof shot.duration).toBe('number');
        expect(shot.duration as number).toBeGreaterThanOrEqual(2);
        expect(shot.duration as number).toBeLessThanOrEqual(15);
        expect(typeof shot.description).toBe('string');
        expect((shot.description as string).length).toBeGreaterThan(10);
      }

      const totalDuration = shots.reduce((sum, s) => sum + (s.duration as number), 0);
      console.log(`scene_video_prompt ${node.itemId}: ${shots.length} shots, ${totalDuration}s`);
    }
  });

  // =========================================================================
  // Step 10: shot extraction (deterministic)
  // =========================================================================
  it('Step 10: shot_image_prompt nodes were created from extraction', () => {
    if (!LLM_AVAILABLE) return;

    const shotPrompts = allNodes.filter(n => n.typeId === 'shot_image_prompt' && n.itemId?.includes('shot_'));
    expect(shotPrompts.length).toBeGreaterThanOrEqual(2);

    console.log(`Found ${shotPrompts.length} per-shot nodes`);
  });

  // =========================================================================
  // Step 11: shot_image_prompt (JSON with references)
  // =========================================================================
  it('Step 11: shot_image_prompt has valid JSON with references', () => {
    if (!LLM_AVAILABLE) return;

    const nodes = findNodes('shot_image_prompt').filter(n => n.itemId?.includes('shot_'));
    expect(nodes.length).toBeGreaterThanOrEqual(1);

    let withRefs = 0;
    let withoutRefs = 0;

    for (const node of nodes) {
      if (!node.outputPath?.endsWith('.json')) continue;

      const json = readJsonOutput(projectDir, node.outputPath!) as Record<string, unknown>;

      expect(json.imagePrompt).toBeDefined();
      expect(typeof json.imagePrompt).toBe('string');
      expect(json.negativePrompt).toBeDefined();
      expect(json.aspectRatio).toBeDefined();
      expect(json.generationMode).toBeDefined();
      expect(['text_to_image', 'image_text_to_image']).toContain(json.generationMode);
      expect(Array.isArray(json.references)).toBe(true);

      const refs = json.references as Array<Record<string, unknown>>;
      if (json.generationMode === 'image_text_to_image') {
        expect(refs.length).toBeGreaterThan(0);
        withRefs++;

        for (const ref of refs) {
          expect(typeof ref.imageNumber).toBe('number');
          expect(['character', 'setting']).toContain(ref.type);
          expect(typeof ref.refId).toBe('string');
          expect(ref.refId as string).toMatch(/^(character_image|setting_image):/);
        }

        // imagePrompt should reference each image N
        const imageRefs = extractImageReferences(json.imagePrompt as string);
        for (const ref of refs) {
          expect(imageRefs).toContain(ref.imageNumber as number);
        }
      } else {
        withoutRefs++;
      }
    }

    console.log(`Shot prompts: ${withRefs} with refs, ${withoutRefs} without refs`);

    // All shots must use reference images — the test story has characters and settings
    expect(withoutRefs).toBe(0);
    expect(withRefs).toBe(nodes.filter(n => n.outputPath?.endsWith('.json')).length);
  });

  // =========================================================================
  // Step 12: Reference consistency
  // =========================================================================
  it('Step 12: reference refIds resolve to completed nodes', () => {
    if (!LLM_AVAILABLE) return;

    const graph = executor.getExecutor();
    const shotPrompts = findNodes('shot_image_prompt').filter(n => n.itemId?.includes('shot_'));

    let checked = 0;
    for (const node of shotPrompts) {
      if (!node.outputPath?.endsWith('.json')) continue;

      const json = readJsonOutput(projectDir, node.outputPath!) as {
        generationMode: string;
        imagePrompt: string;
        references: Array<{ imageNumber: number; type: string; refId: string }>;
      };

      if (json.generationMode === 'image_text_to_image' && json.references.length > 0) {
        for (const ref of json.references) {
          const refNode = graph.getNode(ref.refId);
          expect(refNode).toBeDefined();
          expect(refNode!.status).toBe('completed');
        }

        // No fabricated image numbers
        const imageRefs = extractImageReferences(json.imagePrompt);
        const validNumbers = new Set(json.references.map(r => r.imageNumber));
        for (const num of imageRefs) {
          expect(validNumbers.has(num)).toBe(true);
        }
        checked++;
      }
    }

    console.log(`Verified ${checked} shot prompts for reference consistency`);
  });

  // =========================================================================
  // Summary
  // =========================================================================
  it('Summary: pipeline completed with expected nodes', () => {
    if (!LLM_AVAILABLE) return;

    const completed = allNodes.filter(n => n.status === 'completed');
    const failed = allNodes.filter(n => n.status === 'failed');

    console.log(`\n=== PIPELINE SUMMARY ===`);
    console.log(`Total nodes: ${allNodes.length}`);
    console.log(`Completed: ${completed.length}`);
    console.log(`Failed: ${failed.length}`);
    if (failed.length > 0) {
      console.log(`Failed nodes:`);
      for (const f of failed) {
        console.log(`  ${f.id}: ${f.error}`);
      }
    }

    // At minimum: plot, story, chars, settings, scenes, char_images, setting_images, scene_video_prompts should complete
    // shot_image_prompt and shot_video depend on ComfyUI which may not be available in tests
    expect(findNode('plot')).toBeDefined();
    expect(findNode('story')).toBeDefined();
    expect(findNodes('character').length).toBeGreaterThanOrEqual(1);
    expect(findNodes('setting').length).toBeGreaterThanOrEqual(1);
    expect(findNodes('scene').length).toBeGreaterThanOrEqual(1);
  });
});
