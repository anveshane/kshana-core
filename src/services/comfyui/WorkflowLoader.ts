/**
 * Workflow template loader and parameterization utilities.
 *
 * Handles loading ComfyUI workflow JSON templates and injecting
 * dynamic parameters like prompts, dimensions, and sampling settings.
 */

import * as fs from 'fs';
import * as path from 'path';

// Get the workflows directory (relative to project root)
const WORKFLOWS_DIR = path.resolve(process.cwd(), 'workflows');

/**
 * Load a workflow JSON template from the workflows directory.
 */
export function loadWorkflowTemplate(templateName: string): WorkflowTemplate {
  const templatePath = path.join(WORKFLOWS_DIR, templateName);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Workflow template not found: ${templatePath}`);
  }

  const content = fs.readFileSync(templatePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Convert aspect ratio string to width and height dimensions.
 */
export function aspectRatioToDimensions(aspectRatio: string): [number, number] {
  const ratioMap: Record<string, [number, number]> = {
    '16:9': [1536, 864],
    '9:16': [864, 1536],
    '1:1': [1024, 1024],
    '4:3': [1366, 1024],
    '3:4': [1024, 1366],
  };
  return ratioMap[aspectRatio] || [1024, 1024];
}

export interface WorkflowParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfg?: number;
  filenamePrefix?: string;
  inputImageFilename?: string;
}

/**
 * Parameterize Z-Image workflow.
 */
export function parameterizeZImageWorkflow(
  template: WorkflowTemplate,
  params: WorkflowParams
): Record<string, unknown> {
  // Deep copy
  let workflow = JSON.parse(JSON.stringify(template));

  // Convert to API format if it's LiteGraph format
  if ('nodes' in workflow && 'links' in workflow) {
    workflow = workflowToPrompt(workflow);
  }

  // Remove Note nodes
  workflow = Object.fromEntries(
    Object.entries(workflow).filter(([, v]) => {
      const node = v as { class_type?: string };
      return node.class_type !== 'Note';
    })
  );

  // Randomize seed if not provided
  const seed = params.seed ?? Math.floor(Math.random() * 2 ** 32);
  const negPrompt = params.negativePrompt || 'blurry ugly bad';

  // Find and update nodes by class_type
  for (const [, node] of Object.entries(workflow)) {
    const nodeData = node as { class_type?: string; inputs?: Record<string, unknown> };
    const classType = nodeData.class_type;
    const inputs = nodeData.inputs || {};

    if (classType === 'CLIPTextEncode') {
      const currentText = (inputs['text'] as string) || '';
      if (currentText.toLowerCase().includes('blurry') ||
          currentText.toLowerCase().includes('ugly') ||
          currentText.toLowerCase().includes('bad')) {
        inputs['text'] = negPrompt;
      } else {
        inputs['text'] = params.prompt;
      }
    } else if (classType === 'EmptySD3LatentImage') {
      inputs['width'] = params.width || 1024;
      inputs['height'] = params.height || 1024;
      inputs['batch_size'] = 1;
    } else if (classType === 'KSampler') {
      inputs['seed'] = seed;
      inputs['steps'] = params.steps || 9;
      inputs['cfg'] = params.cfg || 1.0;
      inputs['denoise'] = 1.0;
    } else if (classType === 'SaveImage') {
      inputs['filename_prefix'] = params.filenamePrefix || 'ZImage';
    }
  }

  return workflow;
}

/**
 * Parameterize Chroma-Radiance workflow.
 */
export function parameterizeChromaRadianceWorkflow(
  template: WorkflowTemplate,
  params: WorkflowParams
): Record<string, unknown> {
  // Deep copy
  let workflow = JSON.parse(JSON.stringify(template));

  // Convert to API format if it's LiteGraph format
  if ('nodes' in workflow && 'links' in workflow) {
    workflow = workflowToPrompt(workflow);
  }

  // Remove Note nodes
  workflow = Object.fromEntries(
    Object.entries(workflow).filter(([, v]) => {
      const node = v as { class_type?: string };
      return !['Note', 'MarkdownNote'].includes(node.class_type || '');
    })
  );

  const seed = params.seed ?? Math.floor(Math.random() * 2 ** 32);

  for (const [, node] of Object.entries(workflow)) {
    const nodeData = node as { class_type?: string; inputs?: Record<string, unknown> };
    const classType = nodeData.class_type;
    const inputs = nodeData.inputs || {};

    if (classType === 'CLIPTextEncode') {
      const currentText = (inputs['text'] as string) || '';
      const isNegative = currentText.toLowerCase().includes('blurry') ||
                        currentText.toLowerCase().includes('ugly') ||
                        currentText.toLowerCase().includes('bad') ||
                        currentText.toLowerCase().includes('worst');
      if (isNegative) {
        if (params.negativePrompt) {
          inputs['text'] = params.negativePrompt;
        }
      } else {
        inputs['text'] = params.prompt;
      }
    } else if (classType === 'EmptyChromaRadianceLatentImage') {
      inputs['width'] = params.width || 1024;
      inputs['height'] = params.height || 1024;
      inputs['batch_size'] = 1;
    } else if (classType === 'RandomNoise') {
      inputs['noise_seed'] = seed;
    } else if (classType === 'SaveImage') {
      inputs['filename_prefix'] = params.filenamePrefix || 'Chroma';
    }
  }

  return workflow;
}

/**
 * Parameterize Wan 2.2 Lightning workflow for video generation.
 * Returns workflow in API format ready for submission.
 */
export function parameterizeWanWorkflow(
  template: WorkflowTemplate,
  params: WorkflowParams
): Record<string, unknown> {
  // Deep copy and convert to API format
  const workflow: WorkflowTemplate = JSON.parse(JSON.stringify(template));
  const seed = params.seed ?? Math.floor(Math.random() * 2 ** 32);

  // First, modify the LiteGraph format
  for (const node of workflow.nodes || []) {
    const nodeId = node.id;
    const nodeType = node.type;

    // LoadImage (Node 52)
    if (nodeId === 52 && nodeType === 'LoadImage') {
      if (params.inputImageFilename && node.widgets_values) {
        node.widgets_values[0] = params.inputImageFilename;
        console.log(`[WanWorkflow] Set LoadImage (node 52) image to: ${params.inputImageFilename}`);
      }
    }
    // Positive prompt (Node 6)
    else if (nodeId === 6 && nodeType === 'CLIPTextEncode') {
      if (node.widgets_values) {
        node.widgets_values[0] = params.prompt || '';
        console.log(`[WanWorkflow] Set positive prompt (node 6) to: ${(params.prompt || '').substring(0, 50)}...`);
      }
    }
    // Negative prompt (Node 7)
    else if (nodeId === 7 && nodeType === 'CLIPTextEncode') {
      if (params.negativePrompt && node.widgets_values) {
        node.widgets_values[0] = params.negativePrompt;
      }
    }
    // KSamplerAdvanced - Seed control
    else if (nodeType === 'KSamplerAdvanced') {
      if (node.widgets_values && node.widgets_values.length > 1) {
        node.widgets_values[1] = seed;
      }
    }
    // VHS_VideoCombine (Node 82) - Filename
    else if (nodeId === 82 && nodeType === 'VHS_VideoCombine') {
      if (node.widgets_values && typeof node.widgets_values === 'object') {
        if (!Array.isArray(node.widgets_values)) {
          (node.widgets_values as Record<string, unknown>)['filename_prefix'] = params.filenamePrefix || 'Wan';
        }
      }
    }
  }

  // Convert to API format
  const apiWorkflow = workflowToPrompt(workflow);

  // Ensure LoadImage node has the correct image filename in API format
  // The API format uses 'image' input for the filename
  const loadImageNode = apiWorkflow['52'] as { class_type?: string; inputs?: Record<string, unknown> } | undefined;
  if (loadImageNode && loadImageNode.class_type === 'LoadImage' && params.inputImageFilename) {
    loadImageNode.inputs = loadImageNode.inputs || {};
    loadImageNode.inputs['image'] = params.inputImageFilename;
    console.log(`[WanWorkflow] API format - Set LoadImage inputs.image to: ${params.inputImageFilename}`);
  }

  return apiWorkflow;
}

/**
 * Route to the correct parameterization function based on workflow name.
 */
export function parameterizeWorkflowByName(
  workflowName: string,
  template: WorkflowTemplate,
  params: {
    sceneNumber: number;
    prompt: string;
    negativePrompt?: string;
    aspectRatio?: string;
    style?: string;
    seed?: number;
    inputImageFilename?: string;
    filenamePrefix?: string;
  }
): Record<string, unknown> | WorkflowTemplate {
  const aspectRatio = params.aspectRatio || '16:9';
  const filenamePrefix = params.filenamePrefix || `Scene${params.sceneNumber}`;

  if (workflowName === 'chroma_radiance') {
    let [width, height] = [1024, 1024];
    if (aspectRatio === '16:9') [width, height] = [1536, 864];
    else if (aspectRatio === '9:16') [width, height] = [864, 1536];
    else if (aspectRatio === '4:3') [width, height] = [1366, 1024];
    else if (aspectRatio === '3:4') [width, height] = [1024, 1366];

    return parameterizeChromaRadianceWorkflow(template, {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      width,
      height,
      seed: params.seed,
      filenamePrefix,
    });
  } else if (workflowName === 'zimage') {
    let [width, height] = [1024, 1024];
    if (aspectRatio === '16:9') [width, height] = [1536, 864];
    else if (aspectRatio === '9:16') [width, height] = [864, 1536];
    else if (aspectRatio === '4:3') [width, height] = [1366, 1024];
    else if (aspectRatio === '3:4') [width, height] = [1024, 1366];

    return parameterizeZImageWorkflow(template, {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      width,
      height,
      seed: params.seed,
      steps: 9,
      cfg: 1.0,
      filenamePrefix,
    });
  } else if (workflowName === 'wan_lightning') {
    return parameterizeWanWorkflow(template, {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      seed: params.seed,
      filenamePrefix,
      inputImageFilename: params.inputImageFilename,
    });
  }

  // Default: return template as-is
  return template;
}

/**
 * Convert ComfyUI workflow (UI format) into the API prompt format.
 */
export function workflowToPrompt(workflow: WorkflowTemplate): Record<string, unknown> {
  const prompt: Record<string, unknown> = {};
  const nodes = workflow.nodes || [];
  const links = workflow.links || [];

  // Map link id -> (source_node_id, source_output_index)
  const linkLookup: Map<number, [number, number]> = new Map();
  for (const link of links) {
    if (Array.isArray(link) && link.length >= 6) {
      const [linkId, fromNode, fromSlot] = link;
      linkLookup.set(linkId, [fromNode, fromSlot]);
    }
  }

  for (const node of nodes) {
    const nodeId = String(node.id);
    if (nodeId === 'None') continue;

    const nodeType = node.type;
    const inputsSpec = node.inputs || [];
    const widgetValues = node.widgets_values || [];

    const convertedInputs: Record<string, unknown> = {};

    // Special handling for KSampler
    if (nodeType === 'KSampler' && widgetValues.length === 7) {
      convertedInputs['seed'] = widgetValues[0];
      convertedInputs['steps'] = widgetValues[2];
      convertedInputs['cfg'] = widgetValues[3];
      convertedInputs['sampler_name'] = widgetValues[4];
      convertedInputs['scheduler'] = widgetValues[5];
      convertedInputs['denoise'] = widgetValues[6];
    }
    // Special handling for LoadImage - only needs 'image' input
    else if (nodeType === 'LoadImage') {
      // widgets_values[0] is the image filename
      if (widgetValues.length > 0) {
        convertedInputs['image'] = widgetValues[0];
      }
    } else {
      let widgetIndex = 0;
      for (const inputSpec of inputsSpec) {
        const name = inputSpec.name;
        if (!name) continue;

        const linkId = inputSpec.link;
        if (linkId !== null && linkId !== undefined) {
          const source = linkLookup.get(linkId);
          if (source) {
            const [fromNode, fromSlot] = source;
            convertedInputs[name] = [String(fromNode), fromSlot];
          }
        } else {
          let value: unknown = undefined;
          if (widgetIndex < widgetValues.length) {
            value = widgetValues[widgetIndex];
            widgetIndex++;
          } else if ('default' in inputSpec) {
            value = inputSpec.default;
          } else if ('value' in inputSpec) {
            value = inputSpec.value;
          }
          convertedInputs[name] = value;
        }
      }
    }

    // Add linked inputs for KSampler
    if (nodeType === 'KSampler') {
      for (const inputSpec of inputsSpec) {
        const name = inputSpec.name;
        const linkId = inputSpec.link;
        if (linkId !== null && linkId !== undefined && name) {
          const source = linkLookup.get(linkId);
          if (source) {
            const [fromNode, fromSlot] = source;
            convertedInputs[name] = [String(fromNode), fromSlot];
          }
        }
      }
    }

    prompt[nodeId] = {
      class_type: nodeType,
      inputs: convertedInputs,
    };
  }

  return prompt;
}

// Type definitions

export interface WorkflowTemplate {
  nodes?: Array<{
    id: number;
    type: string;
    title?: string;
    inputs?: Array<{
      name: string;
      link?: number | null;
      default?: unknown;
      value?: unknown;
    }>;
    widgets_values?: unknown[];
  }>;
  links?: Array<[number, number, number, number, number, string]>;
  [key: string]: unknown;
}
