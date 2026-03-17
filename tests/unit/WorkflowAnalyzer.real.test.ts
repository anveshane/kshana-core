/**
 * Tests using the real zimage_standard API-format workflow export.
 * Verifies the analyzer handles real-world workflows correctly.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  analyzeWorkflow,
  isLiteGraphFormat,
} from '../../src/services/comfyui/WorkflowAnalyzer.js';
import {
  parameterizeCustomWorkflow,
} from '../../src/services/comfyui/WorkflowLoader.js';

const REAL_WORKFLOW_PATH = '/Users/ganaraj/Downloads/zimage_standard_api.json';

describe('WorkflowAnalyzer with real zimage_standard API export', () => {
  const rawWorkflow = JSON.parse(fs.readFileSync(REAL_WORKFLOW_PATH, 'utf-8'));

  it('detects as API format (not LiteGraph)', () => {
    expect(isLiteGraphFormat(rawWorkflow)).toBe(false);
  });

  describe('analyzeWorkflow', () => {
    const manifest = analyzeWorkflow(rawWorkflow, 'zimage-custom', 'Z-Image Custom');

    it('detects positive prompt node (node 6 - CLIPTextEncode)', () => {
      expect(manifest.parameterMap.positivePrompt).toBeDefined();
      expect(manifest.parameterMap.positivePrompt!.nodeId).toBe('6');
      expect(manifest.parameterMap.positivePrompt!.inputKey).toBe('text');
    });

    it('detects negative prompt node (node 7 - CLIPTextEncode with "blurry ugly bad")', () => {
      expect(manifest.parameterMap.negativePrompt).toBeDefined();
      expect(manifest.parameterMap.negativePrompt!.nodeId).toBe('7');
      expect(manifest.parameterMap.negativePrompt!.inputKey).toBe('text');
    });

    it('detects seed node (node 3 - KSampler)', () => {
      expect(manifest.parameterMap.seed).toBeDefined();
      expect(manifest.parameterMap.seed!.nodeId).toBe('3');
      expect(manifest.parameterMap.seed!.inputKey).toBe('seed');
    });

    it('detects dimension node (node 13 - EmptySD3LatentImage)', () => {
      expect(manifest.parameterMap.width).toEqual({ nodeId: '13', inputKey: 'width' });
      expect(manifest.parameterMap.height).toEqual({ nodeId: '13', inputKey: 'height' });
    });

    it('detects output node (node 9 - SaveImage)', () => {
      expect(manifest.parameterMap.outputNode).toEqual({ nodeId: '9' });
      expect(manifest.parameterMap.filenamePrefix).toEqual({ nodeId: '9', inputKey: 'filename_prefix' });
    });

    it('infers image_generation type', () => {
      expect(manifest.workflowType).toBe('image_generation');
      expect(manifest.outputFormat).toBe('image');
    });

    it('has no input images (text-to-image workflow)', () => {
      expect(manifest.parameterMap.inputImages).toBeUndefined();
    });

    it('reports confidence levels', () => {
      expect(manifest.confidence.promptDetection).toBe('high');
      expect(manifest.confidence.typeDetection).toBe('high');
    });

    it('preserves name and displayName', () => {
      expect(manifest.name).toBe('zimage-custom');
      expect(manifest.displayName).toBe('Z-Image Custom');
    });
  });

  describe('parameterizeCustomWorkflow', () => {
    const manifest = analyzeWorkflow(rawWorkflow, 'zimage-custom');

    it('sets positive prompt on node 6 (overrides linked input)', () => {
      const result = parameterizeCustomWorkflow(rawWorkflow, manifest, {
        prompt: 'A dramatic sunset over a mountain range',
      });

      const node6 = result['6'] as { inputs: Record<string, unknown> };
      // Should replace the linked input ["35", 0] with a direct string
      expect(node6.inputs.text).toBe('A dramatic sunset over a mountain range');
    });

    it('sets negative prompt on node 7', () => {
      const result = parameterizeCustomWorkflow(rawWorkflow, manifest, {
        negativePrompt: 'low quality, artifacts',
      });

      const node7 = result['7'] as { inputs: Record<string, unknown> };
      expect(node7.inputs.text).toBe('low quality, artifacts');
    });

    it('sets seed on node 3', () => {
      const result = parameterizeCustomWorkflow(rawWorkflow, manifest, {
        seed: 42,
      });

      const node3 = result['3'] as { inputs: Record<string, unknown> };
      expect(node3.inputs.seed).toBe(42);
    });

    it('sets dimensions on node 13', () => {
      const result = parameterizeCustomWorkflow(rawWorkflow, manifest, {
        width: 1536,
        height: 864,
      });

      const node13 = result['13'] as { inputs: Record<string, unknown> };
      expect(node13.inputs.width).toBe(1536);
      expect(node13.inputs.height).toBe(864);
    });

    it('sets filename prefix on node 9', () => {
      const result = parameterizeCustomWorkflow(rawWorkflow, manifest, {
        filenamePrefix: 'Scene1',
      });

      const node9 = result['9'] as { inputs: Record<string, unknown> };
      expect(node9.inputs.filename_prefix).toBe('Scene1');
    });

    it('preserves unmodified nodes (ZEngineer, loaders, etc.)', () => {
      const result = parameterizeCustomWorkflow(rawWorkflow, manifest, {
        prompt: 'test prompt',
      });

      // ZEngineer node should be untouched
      const node32 = result['32'] as { inputs: Record<string, unknown> };
      expect(node32.inputs.input_prompt).toBe(
        (rawWorkflow['32'] as { inputs: Record<string, unknown> }).inputs.input_prompt,
      );

      // UNETLoader should be untouched
      const node16 = result['16'] as { inputs: Record<string, unknown> };
      expect(node16.inputs.unet_name).toBe('z_image_turbo_bf16.safetensors');

      // CLIPLoader should be untouched
      const node18 = result['18'] as { inputs: Record<string, unknown> };
      expect(node18.inputs.clip_name).toBe('qwen_3_4b.safetensors');
    });

    it('sets all params at once', () => {
      const result = parameterizeCustomWorkflow(rawWorkflow, manifest, {
        prompt: 'A cinematic shot of a warrior',
        negativePrompt: 'blurry, deformed',
        seed: 999,
        width: 1536,
        height: 864,
        filenamePrefix: 'warrior_scene',
      });

      expect((result['6'] as any).inputs.text).toBe('A cinematic shot of a warrior');
      expect((result['7'] as any).inputs.text).toBe('blurry, deformed');
      expect((result['3'] as any).inputs.seed).toBe(999);
      expect((result['13'] as any).inputs.width).toBe(1536);
      expect((result['13'] as any).inputs.height).toBe(864);
      expect((result['9'] as any).inputs.filename_prefix).toBe('warrior_scene');
    });

    it('does not mutate the original workflow', () => {
      const original = JSON.parse(JSON.stringify(rawWorkflow));
      parameterizeCustomWorkflow(rawWorkflow, manifest, {
        prompt: 'modified prompt',
        seed: 1,
      });

      // Original should be unchanged
      expect(rawWorkflow).toEqual(original);
    });
  });
});
