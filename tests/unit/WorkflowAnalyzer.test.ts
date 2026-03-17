import { describe, it, expect } from 'vitest';
import {
  analyzeWorkflow,
  isLiteGraphFormat,
  ensureApiFormat,
} from '../../src/services/comfyui/WorkflowAnalyzer.js';
import {
  parameterizeCustomWorkflow,
} from '../../src/services/comfyui/WorkflowLoader.js';

// ── Sample API-format workflows for testing ────────────────────────────────────

/** Minimal text-to-image workflow (like zimage) */
const SAMPLE_T2I_WORKFLOW: Record<string, unknown> = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 42,
      steps: 20,
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
      model: ['4', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
  },
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'model.safetensors' },
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: { width: 1024, height: 1024, batch_size: 1 },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'a beautiful sunset over mountains', clip: ['4', 1] },
    _meta: { title: 'Positive Prompt' },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'bad quality, worst quality, ugly', clip: ['4', 1] },
    _meta: { title: 'Negative Prompt' },
  },
  '8': {
    class_type: 'VAEDecode',
    inputs: { samples: ['3', 0], vae: ['4', 2] },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'output', images: ['8', 0] },
  },
};

/** Image editing workflow with LoadImage */
const SAMPLE_EDIT_WORKFLOW: Record<string, unknown> = {
  '1': {
    class_type: 'LoadImage',
    inputs: { image: 'input.png' },
  },
  '2': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'make it look like anime', clip: ['4', 1] },
    _meta: { title: 'Edit Prompt' },
  },
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 0,
      steps: 20,
      cfg: 7,
      sampler_name: 'euler',
      model: ['4', 0],
      positive: ['2', 0],
      latent_image: ['5', 0],
    },
  },
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'model.safetensors' },
  },
  '5': {
    class_type: 'VAEEncode',
    inputs: { pixels: ['1', 0], vae: ['4', 2] },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'edited', images: ['8', 0] },
  },
};

/** Video generation workflow with VHS_VideoCombine */
const SAMPLE_VIDEO_WORKFLOW: Record<string, unknown> = {
  '1': {
    class_type: 'LoadImage',
    inputs: { image: 'frame.png' },
  },
  '2': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'camera panning left', clip: ['4', 1] },
  },
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 123,
      steps: 30,
      model: ['4', 0],
      positive: ['2', 0],
      latent_image: ['5', 0],
    },
  },
  '10': {
    class_type: 'VHS_VideoCombine',
    inputs: {
      filename_prefix: 'video_output',
      images: ['8', 0],
      frame_rate: 24,
    },
  },
};

/** Workflow with RandomNoise seed node (advanced sampler) */
const SAMPLE_ADVANCED_WORKFLOW: Record<string, unknown> = {
  '1': {
    class_type: 'RandomNoise',
    inputs: { noise_seed: 999 },
  },
  '2': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'test prompt', clip: ['4', 1] },
  },
  '3': {
    class_type: 'EmptySD3LatentImage',
    inputs: { width: 512, height: 512, batch_size: 1 },
  },
  '9': {
    class_type: 'PreviewImage',
    inputs: { filename_prefix: 'preview', images: ['8', 0] },
  },
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('WorkflowAnalyzer', () => {
  describe('isLiteGraphFormat', () => {
    it('detects LiteGraph format (has nodes and links arrays)', () => {
      expect(isLiteGraphFormat({ nodes: [], links: [] })).toBe(true);
      expect(isLiteGraphFormat({ nodes: [{ id: 1 }], links: [[1, 2, 3, 4, 5, 'INT']] })).toBe(true);
    });

    it('rejects API format', () => {
      expect(isLiteGraphFormat(SAMPLE_T2I_WORKFLOW)).toBe(false);
    });

    it('rejects invalid inputs', () => {
      expect(isLiteGraphFormat(null)).toBe(false);
      expect(isLiteGraphFormat(undefined)).toBe(false);
      expect(isLiteGraphFormat('string')).toBe(false);
      expect(isLiteGraphFormat({ nodes: 'not array' })).toBe(false);
    });
  });

  describe('ensureApiFormat', () => {
    it('passes through API format unchanged', () => {
      const result = ensureApiFormat(SAMPLE_T2I_WORKFLOW);
      expect(result).toBe(SAMPLE_T2I_WORKFLOW);
    });
  });

  describe('analyzeWorkflow - text-to-image', () => {
    it('detects prompt nodes (positive and negative)', () => {
      const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test-t2i');
      expect(manifest.parameterMap.positivePrompt).toEqual({ nodeId: '6', inputKey: 'text' });
      expect(manifest.parameterMap.negativePrompt).toEqual({ nodeId: '7', inputKey: 'text' });
    });

    it('detects seed node', () => {
      const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test-t2i');
      expect(manifest.parameterMap.seed).toEqual({ nodeId: '3', inputKey: 'seed' });
    });

    it('detects dimension node', () => {
      const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test-t2i');
      expect(manifest.parameterMap.width).toEqual({ nodeId: '5', inputKey: 'width' });
      expect(manifest.parameterMap.height).toEqual({ nodeId: '5', inputKey: 'height' });
    });

    it('detects output node', () => {
      const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test-t2i');
      expect(manifest.parameterMap.outputNode).toEqual({ nodeId: '9' });
      expect(manifest.parameterMap.filenamePrefix).toEqual({ nodeId: '9', inputKey: 'filename_prefix' });
    });

    it('infers image_generation type', () => {
      const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test-t2i');
      expect(manifest.workflowType).toBe('image_generation');
      expect(manifest.outputFormat).toBe('image');
    });

    it('has no input images', () => {
      const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test-t2i');
      expect(manifest.parameterMap.inputImages).toBeUndefined();
    });

    it('sets name and displayName', () => {
      const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'my-workflow', 'My Workflow');
      expect(manifest.name).toBe('my-workflow');
      expect(manifest.displayName).toBe('My Workflow');
    });
  });

  describe('analyzeWorkflow - image editing', () => {
    it('detects LoadImage as input image', () => {
      const manifest = analyzeWorkflow(SAMPLE_EDIT_WORKFLOW, 'test-edit');
      expect(manifest.parameterMap.inputImages).toHaveLength(1);
      expect(manifest.parameterMap.inputImages![0]).toEqual({ nodeId: '1', inputKey: 'image' });
    });

    it('infers image_editing type', () => {
      const manifest = analyzeWorkflow(SAMPLE_EDIT_WORKFLOW, 'test-edit');
      expect(manifest.workflowType).toBe('image_editing');
    });
  });

  describe('analyzeWorkflow - video generation', () => {
    it('detects VHS_VideoCombine as video output', () => {
      const manifest = analyzeWorkflow(SAMPLE_VIDEO_WORKFLOW, 'test-video');
      expect(manifest.parameterMap.outputNode).toEqual({ nodeId: '10' });
      expect(manifest.outputFormat).toBe('video');
    });

    it('infers video_generation type', () => {
      const manifest = analyzeWorkflow(SAMPLE_VIDEO_WORKFLOW, 'test-video');
      expect(manifest.workflowType).toBe('video_generation');
    });
  });

  describe('analyzeWorkflow - advanced sampler', () => {
    it('detects RandomNoise seed node', () => {
      const manifest = analyzeWorkflow(SAMPLE_ADVANCED_WORKFLOW, 'test-advanced');
      expect(manifest.parameterMap.seed).toEqual({ nodeId: '1', inputKey: 'noise_seed' });
    });

    it('detects EmptySD3LatentImage dimensions', () => {
      const manifest = analyzeWorkflow(SAMPLE_ADVANCED_WORKFLOW, 'test-advanced');
      expect(manifest.parameterMap.width).toEqual({ nodeId: '3', inputKey: 'width' });
      expect(manifest.parameterMap.height).toEqual({ nodeId: '3', inputKey: 'height' });
    });

    it('detects PreviewImage as output node', () => {
      const manifest = analyzeWorkflow(SAMPLE_ADVANCED_WORKFLOW, 'test-advanced');
      expect(manifest.parameterMap.outputNode).toEqual({ nodeId: '9' });
    });
  });

  describe('analyzeWorkflow - confidence', () => {
    it('has high confidence for standard t2i workflow', () => {
      const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test');
      expect(manifest.confidence.promptDetection).toBe('high');
      expect(manifest.confidence.typeDetection).toBe('high');
    });

    it('notes when no seed node found', () => {
      const noSeedWorkflow: Record<string, unknown> = {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'test' } },
        '2': { class_type: 'SaveImage', inputs: { filename_prefix: 'out' } },
      };
      const manifest = analyzeWorkflow(noSeedWorkflow, 'no-seed');
      expect(manifest.confidence.notes).toContain(
        'No seed node detected — workflow will use its own default'
      );
    });
  });

  describe('analyzeWorkflow - edge cases', () => {
    it('handles workflow with no recognized nodes', () => {
      const emptyWorkflow = {
        '1': { class_type: 'UnknownCustomNode', inputs: { foo: 'bar' } },
      };
      const manifest = analyzeWorkflow(emptyWorkflow, 'empty');
      expect(manifest.parameterMap.positivePrompt).toBeUndefined();
      expect(manifest.parameterMap.seed).toBeUndefined();
      expect(manifest.confidence.promptDetection).toBe('low');
    });

    it('handles workflow with single prompt node', () => {
      const singlePrompt = {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'positive prompt' } },
        '2': { class_type: 'SaveImage', inputs: { filename_prefix: 'out' } },
      };
      const manifest = analyzeWorkflow(singlePrompt, 'single');
      expect(manifest.parameterMap.positivePrompt).toEqual({ nodeId: '1', inputKey: 'text' });
      expect(manifest.parameterMap.negativePrompt).toBeUndefined();
      expect(manifest.confidence.promptDetection).toBe('high');
    });
  });
});

describe('parameterizeCustomWorkflow', () => {
  it('sets prompt on mapped node', () => {
    const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test');
    const workflow = JSON.parse(JSON.stringify(SAMPLE_T2I_WORKFLOW));
    const result = parameterizeCustomWorkflow(workflow, manifest, {
      prompt: 'new custom prompt',
    });

    const node6 = result['6'] as { inputs: { text: string } };
    expect(node6.inputs.text).toBe('new custom prompt');
  });

  it('sets negative prompt', () => {
    const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test');
    const result = parameterizeCustomWorkflow(
      JSON.parse(JSON.stringify(SAMPLE_T2I_WORKFLOW)),
      manifest,
      { negativePrompt: 'no artifacts' },
    );

    const node7 = result['7'] as { inputs: { text: string } };
    expect(node7.inputs.text).toBe('no artifacts');
  });

  it('sets seed', () => {
    const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test');
    const result = parameterizeCustomWorkflow(
      JSON.parse(JSON.stringify(SAMPLE_T2I_WORKFLOW)),
      manifest,
      { seed: 12345 },
    );

    const node3 = result['3'] as { inputs: { seed: number } };
    expect(node3.inputs.seed).toBe(12345);
  });

  it('sets dimensions', () => {
    const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test');
    const result = parameterizeCustomWorkflow(
      JSON.parse(JSON.stringify(SAMPLE_T2I_WORKFLOW)),
      manifest,
      { width: 1536, height: 864 },
    );

    const node5 = result['5'] as { inputs: { width: number; height: number } };
    expect(node5.inputs.width).toBe(1536);
    expect(node5.inputs.height).toBe(864);
  });

  it('sets filename prefix', () => {
    const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test');
    const result = parameterizeCustomWorkflow(
      JSON.parse(JSON.stringify(SAMPLE_T2I_WORKFLOW)),
      manifest,
      { filenamePrefix: 'Scene1' },
    );

    const node9 = result['9'] as { inputs: { filename_prefix: string } };
    expect(node9.inputs.filename_prefix).toBe('Scene1');
  });

  it('sets input image filenames', () => {
    const manifest = analyzeWorkflow(SAMPLE_EDIT_WORKFLOW, 'test');
    const result = parameterizeCustomWorkflow(
      JSON.parse(JSON.stringify(SAMPLE_EDIT_WORKFLOW)),
      manifest,
      { inputImageFilenames: ['uploaded_image.png'] },
    );

    const node1 = result['1'] as { inputs: { image: string } };
    expect(node1.inputs.image).toBe('uploaded_image.png');
  });

  it('auto-randomizes seed when not provided but mapped', () => {
    const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test');
    const result = parameterizeCustomWorkflow(
      JSON.parse(JSON.stringify(SAMPLE_T2I_WORKFLOW)),
      manifest,
      { prompt: 'new prompt' },
    );

    // Seed should be randomized (not the original 42)
    const node3 = result['3'] as { inputs: { seed: number } };
    expect(typeof node3.inputs.seed).toBe('number');

    // Original negative prompt should remain (not provided in params)
    const node7 = result['7'] as { inputs: { text: string } };
    expect(node7.inputs.text).toBe('bad quality, worst quality, ugly');
  });

  it('creates deep copy (does not mutate input)', () => {
    const manifest = analyzeWorkflow(SAMPLE_T2I_WORKFLOW, 'test');
    const original = JSON.parse(JSON.stringify(SAMPLE_T2I_WORKFLOW));
    parameterizeCustomWorkflow(original, manifest, { prompt: 'modified' });

    // Original should be unchanged since parameterizeCustomWorkflow does deep copy
    const node6 = original['6'] as { inputs: { text: string } };
    expect(node6.inputs.text).toBe('a beautiful sunset over mountains');
  });
});
