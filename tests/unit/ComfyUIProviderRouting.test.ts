import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ComfyUIProvider video routing guards', () => {
  let tempRoot: string;

  beforeEach(() => {
    vi.resetModules();
    tempRoot = mkdtempSync(join(tmpdir(), 'comfy-provider-routing-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('fails fast when v2v_extend resolves to a non-v2v workflow', async () => {
    const sourceVideoPath = join(tempRoot, 'prev.mp4');
    writeFileSync(sourceVideoPath, 'fake-video');

    vi.doMock('../../src/services/providers/WorkflowModeRegistry.js', () => ({
      getWorkflowModeRegistry: () => ({
        getWorkflowForStrategy: () => ({
          id: 'ltx23_fml2v_cloud',
          displayName: 'LTX 2.3 FML2V (Cloud)',
          pipeline: 'video_generation',
          llmDescription: 'test',
          selectionCriteria: 'test',
          outputType: 'video',
          priority: 1,
          strategies: ['fmlfv'],
          inputRequirements: [
            { id: 'first_frame', type: 'image', source: 'shot_image', description: 'First frame', required: true },
            { id: 'mid_frame', type: 'image', source: 'shot_image', description: 'Mid frame', required: true },
            { id: 'last_frame', type: 'image', source: 'shot_image', description: 'Last frame', required: true },
            { id: 'prompt', type: 'text', source: 'llm', description: 'Prompt', required: true },
          ],
          workflowFile: 'ltx23_fml2v_cloud.json',
          format: 'api',
          parameterMappings: [],
        }),
      }),
    }));

    const { ComfyUIProvider } = await import('../../src/services/providers/comfyui/ComfyUIProvider.js');
    const provider = new ComfyUIProvider();

    await expect(provider.generateVideo({
      sourceImagePath: '',
      sourceVideoPath,
      prompt: 'continue shot',
      outputDir: tempRoot,
      modeId: 'v2v_extend',
    })).rejects.toThrow(/does not support requested video strategy 'v2v_extend'|missing inputs: source_video/);
  });
});
