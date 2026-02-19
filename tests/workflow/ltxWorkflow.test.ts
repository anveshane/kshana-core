/**
 * Unit tests for LTX-2 workflow parameterization.
 * Verifies LoraLoaderModelOnly nodes with lora_name "None" are bypassed
 * (ComfyUI rejects "None" as it's not in the installed LoRAs list).
 */
import { describe, it, expect } from 'vitest';
import {
  loadWorkflowTemplate,
  parameterizeLtxT2VWorkflow,
  parameterizeLtxI2VWorkflow,
} from '../../src/services/comfyui/WorkflowLoader.js';

describe('LTX workflow parameterization', () => {
  it('parameterizeLtxT2VWorkflow bypasses LoraLoaderModelOnly nodes with lora_name "None"', () => {
    const template = loadWorkflowTemplate('video_ltx2_t2v-final.json');
    const apiWorkflow = parameterizeLtxT2VWorkflow(template, {
      prompt: 'A test prompt',
      width: 480,
      height: 480,
      frameCount: 121,
      seed: 12345,
    });

    // No LoraLoaderModelOnly node should have lora_name "None" in the output
    for (const [nodeId, node] of Object.entries(apiWorkflow)) {
      const nodeData = node as { class_type?: string; inputs?: Record<string, unknown> };
      if (nodeData.class_type === 'LoraLoaderModelOnly') {
        const loraName = nodeData.inputs?.['lora_name'];
        expect(String(loraName).toLowerCase()).not.toBe('none');
      }
    }

    // Workflow should still have essential nodes (SaveVideo, CheckpointLoaderSimple, etc.)
    const classTypes = Object.values(apiWorkflow).map(
      (n) => (n as { class_type?: string }).class_type
    );
    expect(classTypes).toContain('SaveVideo');
    expect(classTypes).toContain('CheckpointLoaderSimple');
  });

  it('parameterizeLtxI2VWorkflow bypasses LoraLoaderModelOnly nodes with lora_name "None"', () => {
    const template = loadWorkflowTemplate('video_ltx2_i2v-final.json');
    const apiWorkflow = parameterizeLtxI2VWorkflow(template, {
      prompt: 'A test motion prompt',
      inputImageFilename: 'test_image.png',
      frameCount: 241,
      seed: 67890,
    });

    // No LoraLoaderModelOnly node should have lora_name "None" in the output
    for (const [nodeId, node] of Object.entries(apiWorkflow)) {
      const nodeData = node as { class_type?: string; inputs?: Record<string, unknown> };
      if (nodeData.class_type === 'LoraLoaderModelOnly') {
        const loraName = nodeData.inputs?.['lora_name'];
        expect(String(loraName).toLowerCase()).not.toBe('none');
      }
    }
  });

  it('parameterizeLtxT2VWorkflow produces valid API format with required inputs', () => {
    const template = loadWorkflowTemplate('video_ltx2_t2v-final.json');
    const apiWorkflow = parameterizeLtxT2VWorkflow(template, {
      prompt: 'INT. BOOKSTORE – DAY. Live-action video footage.',
      width: 480,
      height: 480,
      frameCount: 241,
      seed: 618023952,
      filenamePrefix: 'Placement5_video',
    });

    // SaveVideo should have the correct filename_prefix
    const saveVideoNode = Object.entries(apiWorkflow).find(
      ([, n]) => (n as { class_type?: string }).class_type === 'SaveVideo'
    );
    expect(saveVideoNode).toBeDefined();
    const inputs = (saveVideoNode![1] as { inputs?: Record<string, unknown> }).inputs;
    expect(inputs?.filename_prefix).toBe('video/Placement5_video');
  });
});
