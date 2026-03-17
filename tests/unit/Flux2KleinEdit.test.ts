import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parameterizeCustomWorkflow } from '../../src/services/comfyui/WorkflowLoader.js';
import { FLUX2_KLEIN_EDIT_MANIFEST } from '../../src/services/comfyui/builtinManifests.js';

function loadWorkflow(): Record<string, unknown> {
  const raw = readFileSync(join(process.cwd(), 'workflows', 'flux2_klein_edit.json'), 'utf-8');
  return JSON.parse(raw);
}

function getNodeInputs(workflow: Record<string, unknown>, nodeId: string): Record<string, unknown> | undefined {
  const node = workflow[nodeId] as { inputs?: Record<string, unknown> } | undefined;
  return node?.inputs;
}

describe('FLUX 2 Klein Edit — reference image chain pruning', () => {
  it('keeps all 4 images when 4 filenames provided', () => {
    const result = parameterizeCustomWorkflow(loadWorkflow(), FLUX2_KLEIN_EDIT_MANIFEST, {
      prompt: 'A portrait in a garden',
      inputImageFilenames: ['img1.png', 'img2.png', 'img3.png', 'img4.png'],
    });

    // All LoadImage nodes should exist
    expect(result['76']).toBeDefined();
    expect(result['81']).toBeDefined();
    expect(result['82']).toBeDefined();
    expect(result['83']).toBeDefined();

    // All ReferenceLatent nodes should exist
    expect(result['92:89:77']).toBeDefined(); // Image 4 positive
    expect(result['92:89:76']).toBeDefined(); // Image 4 negative

    // CFGGuider should point to image 4's endpoints (last in chain)
    const guider = getNodeInputs(result, '92:63');
    expect(guider?.positive).toEqual(['92:89:77', 0]);
    expect(guider?.negative).toEqual(['92:89:76', 0]);

    // Verify image filenames were set
    expect(getNodeInputs(result, '76')?.image).toBe('img1.png');
    expect(getNodeInputs(result, '81')?.image).toBe('img2.png');
    expect(getNodeInputs(result, '82')?.image).toBe('img3.png');
    expect(getNodeInputs(result, '83')?.image).toBe('img4.png');
  });

  it('prunes image 4 when 3 filenames provided', () => {
    const result = parameterizeCustomWorkflow(loadWorkflow(), FLUX2_KLEIN_EDIT_MANIFEST, {
      prompt: 'A portrait in a garden',
      inputImageFilenames: ['img1.png', 'img2.png', 'img3.png'],
    });

    // Images 1-3 should exist
    expect(result['76']).toBeDefined();
    expect(result['81']).toBeDefined();
    expect(result['82']).toBeDefined();

    // Image 4 nodes should be removed
    expect(result['83']).toBeUndefined();       // LoadImage 4
    expect(result['92:89']).toBeUndefined();     // Scale 4
    expect(result['92:89:78']).toBeUndefined();  // VAEEncode 4
    expect(result['92:89:77']).toBeUndefined();  // ReferenceLatent positive 4
    expect(result['92:89:76']).toBeUndefined();  // ReferenceLatent negative 4

    // CFGGuider should point to image 3's endpoints
    const guider = getNodeInputs(result, '92:63');
    expect(guider?.positive).toEqual(['92:88:77', 0]);
    expect(guider?.negative).toEqual(['92:88:76', 0]);
  });

  it('prunes images 3-4 when 2 filenames provided', () => {
    const result = parameterizeCustomWorkflow(loadWorkflow(), FLUX2_KLEIN_EDIT_MANIFEST, {
      prompt: 'A portrait in a garden',
      inputImageFilenames: ['img1.png', 'img2.png'],
    });

    // Images 1-2 should exist
    expect(result['76']).toBeDefined();
    expect(result['81']).toBeDefined();

    // Image 3 nodes should be removed
    expect(result['82']).toBeUndefined();
    expect(result['92:87']).toBeUndefined();
    expect(result['92:88:78']).toBeUndefined();
    expect(result['92:88:77']).toBeUndefined();
    expect(result['92:88:76']).toBeUndefined();

    // Image 4 nodes should be removed
    expect(result['83']).toBeUndefined();
    expect(result['92:89']).toBeUndefined();
    expect(result['92:89:78']).toBeUndefined();
    expect(result['92:89:77']).toBeUndefined();
    expect(result['92:89:76']).toBeUndefined();

    // CFGGuider should point to image 2's endpoints
    const guider = getNodeInputs(result, '92:63');
    expect(guider?.positive).toEqual(['92:84:77', 0]);
    expect(guider?.negative).toEqual(['92:84:76', 0]);
  });

  it('prunes images 2-4 when 1 filename provided', () => {
    const result = parameterizeCustomWorkflow(loadWorkflow(), FLUX2_KLEIN_EDIT_MANIFEST, {
      prompt: 'A portrait in a garden',
      inputImageFilenames: ['img1.png'],
    });

    // Image 1 should exist
    expect(result['76']).toBeDefined();
    expect(result['92:80']).toBeDefined();  // Scale 1
    expect(result['92:79:78']).toBeDefined(); // VAEEncode 1
    expect(result['92:79:77']).toBeDefined(); // ReferenceLatent positive 1
    expect(result['92:79:76']).toBeDefined(); // ReferenceLatent negative 1

    // Images 2-4 should all be removed
    expect(result['81']).toBeUndefined();
    expect(result['82']).toBeUndefined();
    expect(result['83']).toBeUndefined();

    // CFGGuider should point to image 1's endpoints
    const guider = getNodeInputs(result, '92:63');
    expect(guider?.positive).toEqual(['92:79:77', 0]);
    expect(guider?.negative).toEqual(['92:79:76', 0]);
  });

  it('shared nodes (GetImageSize, scheduler, etc.) are preserved regardless of image count', () => {
    const result = parameterizeCustomWorkflow(loadWorkflow(), FLUX2_KLEIN_EDIT_MANIFEST, {
      prompt: 'A portrait',
      inputImageFilenames: ['img1.png'],
    });

    // Shared infrastructure should always be present
    expect(result['92:81']).toBeDefined();  // GetImageSize
    expect(result['92:62']).toBeDefined();  // Flux2Scheduler
    expect(result['92:66']).toBeDefined();  // EmptyFlux2LatentImage
    expect(result['92:63']).toBeDefined();  // CFGGuider
    expect(result['92:64']).toBeDefined();  // SamplerCustomAdvanced
    expect(result['92:65']).toBeDefined();  // VAEDecode
    expect(result['92:70']).toBeDefined();  // UNETLoader
    expect(result['92:71']).toBeDefined();  // CLIPLoader
    expect(result['92:72']).toBeDefined();  // VAELoader
    expect(result['92:74']).toBeDefined();  // CLIPTextEncode
    expect(result['92:86']).toBeDefined();  // ConditioningZeroOut
    expect(result['94']).toBeDefined();     // SaveImage
  });

  it('sets prompt text correctly', () => {
    const result = parameterizeCustomWorkflow(loadWorkflow(), FLUX2_KLEIN_EDIT_MANIFEST, {
      prompt: 'A detailed cinematic portrait',
      inputImageFilenames: ['img1.png'],
    });

    expect(getNodeInputs(result, '109')?.text).toBe('A detailed cinematic portrait');
  });

  it('randomizes seed when not provided', () => {
    const result = parameterizeCustomWorkflow(loadWorkflow(), FLUX2_KLEIN_EDIT_MANIFEST, {
      prompt: 'test',
      inputImageFilenames: ['img1.png'],
    });

    const seed = getNodeInputs(result, '92:73')?.noise_seed;
    expect(seed).toBeDefined();
    expect(typeof seed).toBe('number');
  });

  it('uses provided seed when given', () => {
    const result = parameterizeCustomWorkflow(loadWorkflow(), FLUX2_KLEIN_EDIT_MANIFEST, {
      prompt: 'test',
      seed: 42,
      inputImageFilenames: ['img1.png'],
    });

    expect(getNodeInputs(result, '92:73')?.noise_seed).toBe(42);
  });
});
