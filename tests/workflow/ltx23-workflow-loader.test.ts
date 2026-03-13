import { describe, expect, it } from 'vitest';

import {
  loadWorkflowTemplate,
  parameterizeLtx23Workflow,
  validateLtx23WorkflowTemplate,
} from '../../src/services/comfyui/WorkflowLoader.js';

describe('ltx23 workflow loader', () => {
  it('validates the checked-in workflow structure', () => {
    const template = loadWorkflowTemplate('video_ltx23_gguf.json');

    expect(validateLtx23WorkflowTemplate(template)).toEqual({
      durationNodeId: expect.any(Number),
      widthNodeId: expect.any(Number),
      heightNodeId: expect.any(Number),
      positivePromptNodeId: expect.any(Number),
      negativePromptNodeId: expect.any(Number),
      inputImageNodeId: expect.any(Number),
      t2vModeNodeId: expect.any(Number),
      outputNodeId: expect.any(Number),
    });
  });

  it('injects duration, prompt, image, dimensions, toggle, and output prefix into the API prompt', () => {
    const template = loadWorkflowTemplate('video_ltx23_gguf.json');
    const bindings = validateLtx23WorkflowTemplate(template);

    const prompt = parameterizeLtx23Workflow(template, {
      prompt: 'A camera push-in across the desert ruins.',
      inputImageFilename: 'scene-1-shot-1.png',
      durationSeconds: 6,
      width: 1280,
      height: 720,
      filenamePrefix: 'Scene1_shot1_video',
      t2vMode: false,
    });

    expect(prompt[String(bindings.durationNodeId)]).toEqual(
      expect.objectContaining({
        inputs: expect.objectContaining({
          value: 6,
        }),
      })
    );
    expect(prompt[String(bindings.widthNodeId)]).toEqual(
      expect.objectContaining({
        inputs: expect.objectContaining({
          value: 1280,
        }),
      })
    );
    expect(prompt[String(bindings.heightNodeId)]).toEqual(
      expect.objectContaining({
        inputs: expect.objectContaining({
          value: 720,
        }),
      })
    );
    expect(prompt[String(bindings.positivePromptNodeId)]).toEqual(
      expect.objectContaining({
        inputs: expect.objectContaining({
          text: 'A camera push-in across the desert ruins.',
        }),
      })
    );
    expect(prompt[String(bindings.inputImageNodeId)]).toEqual(
      expect.objectContaining({
        inputs: expect.objectContaining({
          image: 'scene-1-shot-1.png',
        }),
      })
    );
    expect(prompt[String(bindings.t2vModeNodeId)]).toEqual(
      expect.objectContaining({
        inputs: expect.objectContaining({
          value: false,
        }),
      })
    );
    expect(prompt[String(bindings.outputNodeId)]).toEqual(
      expect.objectContaining({
        inputs: expect.objectContaining({
          filename_prefix: 'video/Scene1_shot1_video',
        }),
      })
    );
  });
});
