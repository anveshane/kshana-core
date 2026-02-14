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
  /** Primary input image filename (for single-image workflows) */
  inputImageFilename?: string;
  /** Additional reference image filenames (for qwen_edit - up to 3 total) */
  referenceImageFilenames?: string[];
}

export interface WanStartEndParams {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  filenamePrefix?: string;
  startImageFilename: string;
  endImageFilename: string;
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
 * Parameterize Qwen Edit Simple workflow for image editing.
 * Takes a base image and up to 2 additional reference images.
 * Uses qwen_edit-simple.json which has no rgthree dependencies.
 *
 * Image slots:
 * - Node 4: Primary image (required) - the main image being edited
 * - Node 5: Optional 2nd reference image (e.g., character reference)
 * - Node 6: Optional 3rd reference image (e.g., setting reference)
 */
export function parameterizeQwenEditWorkflow(
  template: WorkflowTemplate,
  params: WorkflowParams
): Record<string, unknown> {
  // Deep copy
  const workflow: WorkflowTemplate = JSON.parse(JSON.stringify(template));
  const seed = params.seed ?? Math.floor(Math.random() * 2 ** 32);

  // Get all reference images (primary + additional)
  const allImages: string[] = [];
  if (params.inputImageFilename) {
    allImages.push(params.inputImageFilename);
  }
  if (params.referenceImageFilenames) {
    allImages.push(...params.referenceImageFilenames);
  }

  // Simple workflow node IDs: 4 = primary, 5 = ref2, 6 = ref3
  const loadImageNodeIds = [4, 5, 6];

  // Track which nodes to remove (bypassed LoadImage nodes break connections)
  const nodesToRemove = new Set<number>();

  // Modify the LiteGraph format
  for (const node of workflow.nodes || []) {
    const nodeId = node.id;
    const nodeType = node.type;

    // LoadImage nodes - assign images in order
    if (nodeType === 'LoadImage') {
      const nodeIndex = loadImageNodeIds.indexOf(nodeId);
      if (nodeIndex !== -1 && nodeIndex < allImages.length) {
        const imageName = allImages[nodeIndex];
        if (node.widgets_values && imageName) {
          node.widgets_values[0] = imageName;
          node.mode = 0; // Enable
        }
      } else if (nodeIndex !== -1) {
        // No image for this slot - mark for removal
        nodesToRemove.add(nodeId);
      }
    }

    // Positive prompt (node 11)
    if (nodeType === 'TextEncodeQwenImageEditPlus' && nodeId === 11) {
      if (node.widgets_values) {
        node.widgets_values[0] = params.prompt;
      }
    }

    // Negative prompt (node 12)
    if (nodeType === 'TextEncodeQwenImageEditPlus' && nodeId === 12) {
      if (node.widgets_values && params.negativePrompt) {
        node.widgets_values[0] = params.negativePrompt;
      }
    }

    // KSampler (node 13) - set seed
    if (nodeType === 'KSampler' && nodeId === 13) {
      if (node.widgets_values) {
        node.widgets_values[0] = seed;
      }
    }

    // SaveImage (node 15) - set filename prefix
    if (nodeType === 'SaveImage' && nodeId === 15) {
      if (node.widgets_values) {
        node.widgets_values[0] = params.filenamePrefix || 'QwenEdit';
      }
    }
  }

  // Remove unused LoadImage nodes
  workflow.nodes = (workflow.nodes || []).filter(node => !nodesToRemove.has(node.id));

  // Remove links connected to removed nodes
  workflow.links = (workflow.links || []).filter(link => {
    const sourceNode = link[1];
    return !nodesToRemove.has(sourceNode);
  });

  // Convert to API format
  const apiWorkflow = workflowToPrompt(workflow);

  return apiWorkflow;
}

/**
 * Parameterize Wan 2.2 Lightning workflow for video generation.
 * Returns workflow in API format ready for submission.
 * Supports both old workflow (node 52 LoadImage) and new wan-singleimage.json (node 106 LoadImage).
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

    // LoadImage - support both node 52 (old workflow) and node 106 (wan-singleimage.json)
    if (nodeType === 'LoadImage') {
      if (params.inputImageFilename && node.widgets_values) {
        node.widgets_values[0] = params.inputImageFilename;
        console.log(`[WanWorkflow] Set LoadImage (node ${nodeId}) image to: ${params.inputImageFilename}`);
      }
    }
    // Positive prompt (Node 6) - identified by title containing "Positive"
    else if (nodeType === 'CLIPTextEncode' && node.title?.includes('Positive')) {
      if (node.widgets_values) {
        node.widgets_values[0] = params.prompt || '';
        console.log(`[WanWorkflow] Set positive prompt (node ${nodeId}) to: ${(params.prompt || '').substring(0, 50)}...`);
      }
    }
    // Negative prompt (Node 7) - identified by title containing "Negative"
    else if (nodeType === 'CLIPTextEncode' && node.title?.includes('Negative')) {
      if (params.negativePrompt && node.widgets_values) {
        node.widgets_values[0] = params.negativePrompt;
        console.log(`[WanWorkflow] Set negative prompt (node ${nodeId})`);
      }
    }
    // Seed (rgthree) node - set seed value
    else if (nodeType === 'Seed (rgthree)') {
      if (node.widgets_values && Array.isArray(node.widgets_values)) {
        node.widgets_values[0] = seed;
        console.log(`[WanWorkflow] Set seed (node ${nodeId}) to: ${seed}`);
      }
    }
    // KSamplerAdvanced - Seed control (for workflows without Seed rgthree node)
    else if (nodeType === 'KSamplerAdvanced') {
      if (node.widgets_values && node.widgets_values.length > 1) {
        node.widgets_values[1] = seed;
      }
    }
    // VHS_VideoCombine - Filename (support both node 82 and node 99)
    else if (nodeType === 'VHS_VideoCombine') {
      if (node.widgets_values && typeof node.widgets_values === 'object') {
        if (!Array.isArray(node.widgets_values)) {
          (node.widgets_values as Record<string, unknown>)['filename_prefix'] = params.filenamePrefix || 'Wan';
          console.log(`[WanWorkflow] Set VHS_VideoCombine (node ${nodeId}) filename_prefix to: ${params.filenamePrefix || 'Wan'}`);
        }
      }
    }
  }

  // Convert to API format
  const apiWorkflow = workflowToPrompt(workflow);

  // Ensure LoadImage node has the correct image filename in API format
  // Check for both node 52 (old) and node 106 (new)
  for (const nodeIdStr of ['52', '106']) {
    const loadImageNode = apiWorkflow[nodeIdStr] as { class_type?: string; inputs?: Record<string, unknown> } | undefined;
    if (loadImageNode && loadImageNode.class_type === 'LoadImage' && params.inputImageFilename) {
      loadImageNode.inputs = loadImageNode.inputs || {};
      loadImageNode.inputs['image'] = params.inputImageFilename;
      console.log(`[WanWorkflow] API format - Set LoadImage (node ${nodeIdStr}) inputs.image to: ${params.inputImageFilename}`);
    }
  }

  // Remove non-essential visualization/debug nodes that may not be installed
  // These nodes are only for debugging and not needed for actual generation
  const nodesToRemove = [
    'SigmasPreview',      // Debug node from RES4LYF package
    'Note',               // Comment nodes
    'MarkdownNote',       // Comment nodes
  ];

  for (const [nodeId, node] of Object.entries(apiWorkflow)) {
    const nodeData = node as { class_type?: string };
    if (nodesToRemove.includes(nodeData.class_type || '')) {
      delete apiWorkflow[nodeId];
      console.log(`[WanWorkflow] Removed non-essential node ${nodeId} (${nodeData.class_type})`);
    }
  }

  return apiWorkflow;
}

/**
 * Parameterize Wan Start-End workflow for video generation between two images.
 * Uses WanFunInpaintToVideo node for interpolation between start and end frames.
 */
export function parameterizeWanStartEndWorkflow(
  template: WorkflowTemplate,
  params: WanStartEndParams
): Record<string, unknown> {
  // Deep copy
  const workflow: WorkflowTemplate = JSON.parse(JSON.stringify(template));
  const seed = params.seed ?? Math.floor(Math.random() * 2 ** 32);

  // Modify the LiteGraph format
  for (const node of workflow.nodes || []) {
    const nodeId = node.id;
    const nodeType = node.type;

    // LoadImage for start image (Node 110)
    if (nodeId === 110 && nodeType === 'LoadImage') {
      if (node.widgets_values) {
        node.widgets_values[0] = params.startImageFilename;
        console.log(`[WanStartEnd] Set start image (node 110) to: ${params.startImageFilename}`);
      }
    }
    // LoadImage for end image (Node 112)
    else if (nodeId === 112 && nodeType === 'LoadImage') {
      if (node.widgets_values) {
        node.widgets_values[0] = params.endImageFilename;
        console.log(`[WanStartEnd] Set end image (node 112) to: ${params.endImageFilename}`);
      }
    }
    // Positive prompt (Node 99) - identified by title containing "Positive"
    else if (nodeType === 'CLIPTextEncode' && node.title?.includes('Positive')) {
      if (node.widgets_values) {
        node.widgets_values[0] = params.prompt || '';
        console.log(`[WanStartEnd] Set positive prompt (node ${nodeId}) to: ${(params.prompt || '').substring(0, 50)}...`);
      }
    }
    // Negative prompt (Node 91) - identified by title containing "Negative"
    else if (nodeType === 'CLIPTextEncode' && node.title?.includes('Negative')) {
      if (params.negativePrompt && node.widgets_values) {
        node.widgets_values[0] = params.negativePrompt;
        console.log(`[WanStartEnd] Set negative prompt (node ${nodeId})`);
      }
    }
    // KSamplerAdvanced - Seed control
    else if (nodeType === 'KSamplerAdvanced') {
      if (node.widgets_values && Array.isArray(node.widgets_values) && node.widgets_values.length > 1) {
        node.widgets_values[1] = seed;
      }
    }
    // SaveVideo (Node 158) - Filename prefix
    else if (nodeType === 'SaveVideo') {
      if (node.widgets_values && Array.isArray(node.widgets_values)) {
        node.widgets_values[0] = params.filenamePrefix ? `video/${params.filenamePrefix}` : 'video/ComfyUI';
        console.log(`[WanStartEnd] Set SaveVideo filename_prefix to: ${node.widgets_values[0]}`);
      }
    }
  }

  // Convert to API format
  const apiWorkflow = workflowToPrompt(workflow);

  // Ensure LoadImage nodes have correct image filenames in API format
  const startImageNode = apiWorkflow['110'] as { class_type?: string; inputs?: Record<string, unknown> } | undefined;
  if (startImageNode && startImageNode.class_type === 'LoadImage') {
    startImageNode.inputs = startImageNode.inputs || {};
    startImageNode.inputs['image'] = params.startImageFilename;
    console.log(`[WanStartEnd] API format - Set start image (node 110) to: ${params.startImageFilename}`);
  }

  const endImageNode = apiWorkflow['112'] as { class_type?: string; inputs?: Record<string, unknown> } | undefined;
  if (endImageNode && endImageNode.class_type === 'LoadImage') {
    endImageNode.inputs = endImageNode.inputs || {};
    endImageNode.inputs['image'] = params.endImageFilename;
    console.log(`[WanStartEnd] API format - Set end image (node 112) to: ${params.endImageFilename}`);
  }

  // Remove non-essential nodes
  const nodesToRemove = ['Note', 'MarkdownNote'];
  for (const [nodeId, node] of Object.entries(apiWorkflow)) {
    const nodeData = node as { class_type?: string };
    if (nodesToRemove.includes(nodeData.class_type || '')) {
      delete apiWorkflow[nodeId];
      console.log(`[WanStartEnd] Removed non-essential node ${nodeId} (${nodeData.class_type})`);
    }
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
    /** Additional reference image filenames (for qwen_edit - up to 3 total including inputImageFilename) */
    referenceImageFilenames?: string[];
    startImageFilename?: string;
    endImageFilename?: string;
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
  } else if (workflowName === 'wan_lightning' || workflowName === 'wan_single_image') {
    // Both wan_lightning (legacy) and wan_single_image use the same parameterization
    return parameterizeWanWorkflow(template, {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      seed: params.seed,
      filenamePrefix,
      inputImageFilename: params.inputImageFilename,
    });
  } else if (workflowName === 'wan_start_end') {
    // Start-end workflow requires both start and end images
    if (!params.startImageFilename || !params.endImageFilename) {
      throw new Error('wan_start_end workflow requires both startImageFilename and endImageFilename');
    }
    return parameterizeWanStartEndWorkflow(template, {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      seed: params.seed,
      filenamePrefix,
      startImageFilename: params.startImageFilename,
      endImageFilename: params.endImageFilename,
    });
  } else if (workflowName === 'qwen_edit') {
    // Qwen Edit workflow for image-to-image editing (supports up to 3 images)
    if (!params.inputImageFilename) {
      throw new Error('qwen_edit workflow requires inputImageFilename');
    }
    return parameterizeQwenEditWorkflow(template, {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      seed: params.seed,
      filenamePrefix,
      inputImageFilename: params.inputImageFilename,
      referenceImageFilenames: params.referenceImageFilenames,
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

    // First, add all linked inputs
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

    // Special handling for KSampler (standard version)
    if (nodeType === 'KSampler' && Array.isArray(widgetValues) && widgetValues.length === 7) {
      convertedInputs['seed'] = widgetValues[0];
      convertedInputs['steps'] = widgetValues[2];
      convertedInputs['cfg'] = widgetValues[3];
      convertedInputs['sampler_name'] = widgetValues[4];
      convertedInputs['scheduler'] = widgetValues[5];
      convertedInputs['denoise'] = widgetValues[6];
    }
    // Special handling for KSamplerAdvanced
    else if (nodeType === 'KSamplerAdvanced' && Array.isArray(widgetValues)) {
      // KSamplerAdvanced widget order: add_noise, noise_seed, control_after_generate, steps, cfg, sampler_name, scheduler, start_at_step, end_at_step, return_with_leftover_noise
      convertedInputs['add_noise'] = widgetValues[0];
      convertedInputs['noise_seed'] = widgetValues[1];
      // widgetValues[2] is control_after_generate (not needed in API)
      convertedInputs['steps'] = widgetValues[3];
      convertedInputs['cfg'] = widgetValues[4];
      convertedInputs['sampler_name'] = widgetValues[5];
      convertedInputs['scheduler'] = widgetValues[6];
      convertedInputs['start_at_step'] = widgetValues[7];
      convertedInputs['end_at_step'] = widgetValues[8];
      convertedInputs['return_with_leftover_noise'] = widgetValues[9];
    }
    // Special handling for LoadImage - only needs 'image' input
    else if (nodeType === 'LoadImage') {
      if (Array.isArray(widgetValues) && widgetValues.length > 0) {
        convertedInputs['image'] = widgetValues[0];
      }
    }
    // Special handling for Seed (rgthree)
    else if (nodeType === 'Seed (rgthree)' && Array.isArray(widgetValues)) {
      convertedInputs['seed'] = widgetValues[0];
    }
    // Special handling for VHS_VideoCombine - uses object-based widgets_values
    else if (nodeType === 'VHS_VideoCombine') {
      if (typeof widgetValues === 'object' && !Array.isArray(widgetValues)) {
        // Object-based widget values - copy directly
        const wv = widgetValues as Record<string, unknown>;
        convertedInputs['frame_rate'] = wv['frame_rate'];
        convertedInputs['loop_count'] = wv['loop_count'];
        convertedInputs['filename_prefix'] = wv['filename_prefix'];
        convertedInputs['format'] = wv['format'];
        convertedInputs['pingpong'] = wv['pingpong'];
        convertedInputs['save_output'] = wv['save_output'];
        if (wv['pix_fmt'] !== undefined) convertedInputs['pix_fmt'] = wv['pix_fmt'];
        if (wv['crf'] !== undefined) convertedInputs['crf'] = wv['crf'];
        if (wv['save_metadata'] !== undefined) convertedInputs['save_metadata'] = wv['save_metadata'];
        if (wv['trim_to_audio'] !== undefined) convertedInputs['trim_to_audio'] = wv['trim_to_audio'];
      }
    }
    // Special handling for INTConstant and easy float
    else if ((nodeType === 'INTConstant' || nodeType === 'easy float') && Array.isArray(widgetValues)) {
      convertedInputs['value'] = widgetValues[0];
    }
    // Special handling for WanImageToVideo
    else if (nodeType === 'WanImageToVideo' && Array.isArray(widgetValues)) {
      convertedInputs['width'] = widgetValues[0];
      convertedInputs['height'] = widgetValues[1];
      convertedInputs['length'] = widgetValues[2];
      convertedInputs['batch_size'] = widgetValues[3];
    }
    // Special handling for CLIPTextEncode
    else if (nodeType === 'CLIPTextEncode' && Array.isArray(widgetValues)) {
      convertedInputs['text'] = widgetValues[0];
    }
    // Special handling for ModelSamplingSD3
    else if (nodeType === 'ModelSamplingSD3' && Array.isArray(widgetValues)) {
      convertedInputs['shift'] = widgetValues[0];
    }
    // Special handling for FastUnsharpSharpen
    else if (nodeType === 'FastUnsharpSharpen' && Array.isArray(widgetValues)) {
      convertedInputs['strength'] = widgetValues[0];
    }
    // Special handling for UNETLoader
    else if (nodeType === 'UNETLoader' && Array.isArray(widgetValues)) {
      convertedInputs['unet_name'] = widgetValues[0];
      convertedInputs['weight_dtype'] = widgetValues[1];
    }
    // Special handling for CLIPLoader
    else if (nodeType === 'CLIPLoader' && Array.isArray(widgetValues)) {
      convertedInputs['clip_name'] = widgetValues[0];
      convertedInputs['type'] = widgetValues[1];
      if (widgetValues[2] !== undefined) convertedInputs['device'] = widgetValues[2];
    }
    // Special handling for VAELoader
    else if (nodeType === 'VAELoader' && Array.isArray(widgetValues)) {
      convertedInputs['vae_name'] = widgetValues[0];
    }
    // Special handling for WanFunInpaintToVideo (start-end workflow)
    else if (nodeType === 'WanFunInpaintToVideo' && Array.isArray(widgetValues)) {
      convertedInputs['width'] = widgetValues[0];
      convertedInputs['height'] = widgetValues[1];
      convertedInputs['length'] = widgetValues[2];
      convertedInputs['batch_size'] = widgetValues[3];
    }
    // Special handling for CreateVideo
    else if (nodeType === 'CreateVideo' && Array.isArray(widgetValues)) {
      convertedInputs['fps'] = widgetValues[0];
    }
    // Special handling for SaveVideo
    else if (nodeType === 'SaveVideo' && Array.isArray(widgetValues)) {
      convertedInputs['filename_prefix'] = widgetValues[0];
      convertedInputs['format'] = widgetValues[1];
      convertedInputs['codec'] = widgetValues[2];
    }
    // Special handling for LoraLoaderModelOnly
    else if (nodeType === 'LoraLoaderModelOnly' && Array.isArray(widgetValues)) {
      convertedInputs['lora_name'] = widgetValues[0];
      convertedInputs['strength_model'] = widgetValues[1];
    }
    // Special handling for LoraLoader (full version with clip)
    else if (nodeType === 'LoraLoader' && Array.isArray(widgetValues)) {
      convertedInputs['lora_name'] = widgetValues[0];
      convertedInputs['strength_model'] = widgetValues[1];
      convertedInputs['strength_clip'] = widgetValues[2];
    }
    // Special handling for ModelSamplingAuraFlow
    else if (nodeType === 'ModelSamplingAuraFlow' && Array.isArray(widgetValues)) {
      convertedInputs['shift'] = widgetValues[0];
    }
    // Special handling for CFGNorm
    else if (nodeType === 'CFGNorm' && Array.isArray(widgetValues)) {
      convertedInputs['strength'] = widgetValues[0];
    }
    // Special handling for ImageScaleToTotalPixels
    else if (nodeType === 'ImageScaleToTotalPixels' && Array.isArray(widgetValues)) {
      convertedInputs['upscale_method'] = widgetValues[0];
      convertedInputs['megapixels'] = widgetValues[1];
      convertedInputs['resolution_steps'] = widgetValues[2] ?? 1;
    }
    // Special handling for ImageScale (explicit width/height)
    else if (nodeType === 'ImageScale' && Array.isArray(widgetValues)) {
      convertedInputs['upscale_method'] = widgetValues[0];
      convertedInputs['width'] = widgetValues[1];
      convertedInputs['height'] = widgetValues[2];
      convertedInputs['crop'] = widgetValues[3] ?? 'disabled';
    }
    // Special handling for TextEncodeQwenImageEditPlus
    else if (nodeType === 'TextEncodeQwenImageEditPlus' && Array.isArray(widgetValues)) {
      convertedInputs['prompt'] = widgetValues[0];
    }
    // Special handling for SaveImage
    else if (nodeType === 'SaveImage' && Array.isArray(widgetValues)) {
      convertedInputs['filename_prefix'] = widgetValues[0];
    }
    // Default handling for other nodes
    else if (Array.isArray(widgetValues)) {
      let widgetIndex = 0;
      for (const inputSpec of inputsSpec) {
        const name = inputSpec.name;
        if (!name) continue;

        // Skip if already set via link
        if (convertedInputs[name] !== undefined) continue;

        const linkId = inputSpec.link;
        if (linkId === null || linkId === undefined) {
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
    mode?: number;
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
