/**
 * buildGrokEditWorkflow — generates a ComfyUI API-format workflow that
 * invokes GrokImageEditNode (model `grok-imagine-image-beta`) with 1
 * base image + 0..4 reference images, fanned in through BatchImagesNode.
 *
 * Why a dynamic builder instead of parameterizing a static template:
 *   - BatchImagesNode's `images.imageN` slots are required inputs in
 *     API format — "bypass" is UI-only. Omitting a slot fails submission.
 *   - Building the JSON in code lets us produce exactly-N-slot workflows
 *     per call, with no dead LoadImage nodes.
 *
 * Empirical constraints (verified via scripts/probe-grok-batch-2img.ts):
 *   - `BatchImagesNode` is a true multi-ref aggregator — 2-image input
 *     yields 1 output (not 2). This is what makes Grok see multiple
 *     refs as unified context rather than iterating one-edit-per-image.
 *   - `GrokImageEditNode` on ComfyUI Cloud caps at 3 input images
 *     total (`ValueError: A maximum of 3 input images is supported.`).
 *     So 1 base + up to 2 refs = 3 images max per call.
 *   - Base image wires into images.image0; refs fill images.image1 and
 *     images.image2.
 *   - Keys use dot-notation: the literal key string contains a dot.
 */
import { describe, it, expect } from 'vitest';
import { buildGrokEditWorkflow } from '../../src/services/providers/comfyui/grokWorkflowBuilder.js';

const REQUIRED_FIELDS = {
  prompt: 'edit into cyberpunk',
  seed: 12345,
  filenamePrefix: 'Grok_test',
  resolution: '1K' as const,
  aspectRatio: 'auto' as const,
  baseImage: 'base.png',
};

describe('buildGrokEditWorkflow', () => {
  it('builds a 1-image (base only, no refs) workflow with BatchImagesNode BYPASSED', () => {
    // Regression: BatchImagesNode requires a minimum of 2 inputs
    // (image0 + image1). With 0 refs we previously produced only
    // image0 → ComfyUI rejected with `required_input_missing: image1`.
    // Fix: for 0-ref edits, wire LoadImage(base) directly into
    // GrokImageEditNode's `image` input — no BatchImagesNode at all.
    const wf = buildGrokEditWorkflow({ ...REQUIRED_FIELDS, refs: [] });
    // Expected nodes: SaveImage(3), LoadImage base(6), GrokImageEditNode(8)
    // — NO BatchImagesNode, NO refs.
    expect(Object.keys(wf).sort()).toEqual(['3', '6', '8']);
    expect(wf['9']).toBeUndefined();

    const grok = wf['8'] as any;
    expect(grok.class_type).toBe('GrokImageEditNode');
    expect(grok.inputs.model).toBe('grok-imagine-image-beta');
    expect(grok.inputs.image).toEqual(['6', 0]);  // direct from LoadImage, not BatchImagesNode
    expect(grok.inputs.prompt).toBe('edit into cyberpunk');
    expect(grok.inputs.seed).toBe(12345);
    expect(grok.inputs.resolution).toBe('1K');
    expect(grok.inputs.aspect_ratio).toBe('auto');
    expect(grok.inputs.number_of_images).toBe(1);

    expect((wf['6'] as any).inputs.image).toBe('base.png');
  });

  it('builds a 3-image (base + 2 refs) workflow', () => {
    const wf = buildGrokEditWorkflow({ ...REQUIRED_FIELDS, refs: ['refA.png', 'refB.png'] });
    // base(6), refs(10, 11), batch(9), grok(8), save(3)
    expect(Object.keys(wf).sort()).toEqual(['10', '11', '3', '6', '8', '9']);

    const batch = wf['9'] as any;
    expect(batch.inputs['images.image0']).toEqual(['6', 0]);
    expect(batch.inputs['images.image1']).toEqual(['10', 0]);
    expect(batch.inputs['images.image2']).toEqual(['11', 0]);
    expect(batch.inputs['images.image3']).toBeUndefined();

    expect((wf['10'] as any).inputs.image).toBe('refA.png');
    expect((wf['11'] as any).inputs.image).toBe('refB.png');
  });

  it('builds a full 3-image (base + 2 refs) workflow — the cap', () => {
    const refs = ['r1.png', 'r2.png'];
    const wf = buildGrokEditWorkflow({ ...REQUIRED_FIELDS, refs });
    // base(6), refs(10, 11), batch(9), grok(8), save(3)
    expect(Object.keys(wf).sort()).toEqual(['10', '11', '3', '6', '8', '9']);

    const batch = wf['9'] as any;
    // images.image0, images.image1, images.image2 — 3 total
    for (let i = 0; i < 3; i++) {
      expect(batch.inputs[`images.image${i}`]).toBeDefined();
    }
    expect(batch.inputs['images.image3']).toBeUndefined();

    expect((wf['10'] as any).inputs.image).toBe('r1.png');
    expect((wf['11'] as any).inputs.image).toBe('r2.png');
  });

  it('throws when refs exceed the 2-ref cap (3 total images)', () => {
    const tooMany = ['r1.png', 'r2.png', 'r3.png']; // 3 refs → 4 total
    expect(() => buildGrokEditWorkflow({ ...REQUIRED_FIELDS, refs: tooMany }))
      .toThrow(/max|cap|2|3/i);
  });

  it('uses the supplied filenamePrefix on SaveImage', () => {
    const wf = buildGrokEditWorkflow({ ...REQUIRED_FIELDS, refs: [], filenamePrefix: 'MyShot_s1_s3' });
    expect((wf['3'] as any).inputs.filename_prefix).toBe('MyShot_s1_s3');
    expect((wf['3'] as any).inputs.images).toEqual(['8', 0]);
  });

  it('emits dot-notation input keys on BatchImagesNode (not nested objects)', () => {
    // Regression: ComfyUI expects the literal string key "images.image0",
    // not { images: { image0: [...] } }. If we nest them, the server
    // silently ignores them and the edit fails to see any input images.
    const wf = buildGrokEditWorkflow({ ...REQUIRED_FIELDS, refs: ['a.png'] });
    const batch = wf['9'] as any;
    const keys = Object.keys(batch.inputs).sort();
    expect(keys).toContain('images.image0');
    expect(keys).toContain('images.image1');
    // There should be NO nested `images` key containing `image0`
    expect(batch.inputs.images).toBeUndefined();
  });

  it('propagates resolution and aspect_ratio to the Grok node', () => {
    const wf = buildGrokEditWorkflow({
      ...REQUIRED_FIELDS,
      refs: [],
      resolution: '2K',
      aspectRatio: '16:9',
    });
    expect((wf['8'] as any).inputs.resolution).toBe('2K');
    expect((wf['8'] as any).inputs.aspect_ratio).toBe('16:9');
  });
});
