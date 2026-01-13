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

export interface LtxWorkflowParams {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  filenamePrefix?: string;
  width?: number;
  height?: number;
  frameCount?: number;
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
 * Parameterize LTX-2 Text-to-Video workflow.
 * Uses subgraph node (type b7c2d337-c38d-4c04-922b-2d638449d13e) for generation.
 * The subgraph is expanded before conversion to API format since ComfyUI's API
 * doesn't support subgraph nodes directly.
 */
export function parameterizeLtxT2VWorkflow(
  template: WorkflowTemplate,
  params: LtxWorkflowParams
): Record<string, unknown> {
  // Deep copy
  let workflow: WorkflowTemplate = JSON.parse(JSON.stringify(template));
  const seed = params.seed ?? Math.floor(Math.random() * 2 ** 32);

  // Modify the LiteGraph format - set values on the subgraph node's widgets_values
  for (const node of workflow.nodes || []) {
    const nodeId = node.id;
    const nodeType = node.type;

    // Subgraph node (node 92) - LTX 2.0 generation
    // widgets_values: [prompt, frame_count, width, height, seed]
    if (nodeId === 92 && node.widgets_values) {
      node.widgets_values[0] = params.prompt;
      node.widgets_values[1] = params.frameCount || 121;
      node.widgets_values[2] = params.width || 640;
      node.widgets_values[3] = params.height || 640;
      node.widgets_values[4] = seed;
      console.log(`[LtxT2V] Set subgraph (node 92): prompt="${(params.prompt || '').substring(0, 50)}...", frames=${params.frameCount || 121}, ${params.width || 640}x${params.height || 640}, seed=${seed}`);
    }
    // SaveVideo node
    else if (nodeType === 'SaveVideo' && node.widgets_values) {
      node.widgets_values[0] = params.filenamePrefix ? `video/${params.filenamePrefix}` : 'video/LTX_T2V';
      console.log(`[LtxT2V] Set SaveVideo filename_prefix to: ${node.widgets_values[0]}`);
    }
  }

  // Expand subgraphs before converting to API format
  // ComfyUI's API doesn't support subgraph nodes directly
  workflow = expandSubgraphs(workflow);

  // Convert to API format
  const apiWorkflow = workflowToPrompt(workflow);

  // Remove non-essential nodes
  const nodesToRemove = ['Note', 'MarkdownNote'];
  for (const [nodeId, node] of Object.entries(apiWorkflow)) {
    const nodeData = node as { class_type?: string };
    if (nodesToRemove.includes(nodeData.class_type || '')) {
      delete apiWorkflow[nodeId];
      console.log(`[LtxT2V] Removed non-essential node ${nodeId} (${nodeData.class_type})`);
    }
  }

  return apiWorkflow;
}

/**
 * Parameterize LTX-2 Image-to-Video workflow.
 * Takes an input image and animates it based on prompt.
 * The subgraph is expanded before conversion to API format since ComfyUI's API
 * doesn't support subgraph nodes directly.
 */
export function parameterizeLtxI2VWorkflow(
  template: WorkflowTemplate,
  params: LtxWorkflowParams
): Record<string, unknown> {
  // Deep copy
  let workflow: WorkflowTemplate = JSON.parse(JSON.stringify(template));
  const seed = params.seed ?? Math.floor(Math.random() * 2 ** 32);

  // Modify the LiteGraph format - set values on nodes
  for (const node of workflow.nodes || []) {
    const nodeId = node.id;
    const nodeType = node.type;

    // LoadImage node (node 98)
    if (nodeId === 98 && nodeType === 'LoadImage' && node.widgets_values) {
      node.widgets_values[0] = params.inputImageFilename;
      console.log(`[LtxI2V] Set LoadImage (node 98) to: ${params.inputImageFilename}`);
    }
    // Subgraph node (node 92) - LTX 2.0 generation
    // widgets_values for i2v: [prompt, frame_count, seed]
    else if (nodeId === 92 && node.widgets_values) {
      node.widgets_values[0] = params.prompt;
      node.widgets_values[1] = params.frameCount || 241;
      node.widgets_values[2] = seed;
      console.log(`[LtxI2V] Set subgraph (node 92): prompt="${(params.prompt || '').substring(0, 50)}...", frames=${params.frameCount || 241}, seed=${seed}`);
    }
    // SaveVideo node
    else if (nodeType === 'SaveVideo' && node.widgets_values) {
      node.widgets_values[0] = params.filenamePrefix ? `video/${params.filenamePrefix}` : 'video/LTX_I2V';
      console.log(`[LtxI2V] Set SaveVideo filename_prefix to: ${node.widgets_values[0]}`);
    }
  }

  // Expand subgraphs before converting to API format
  // ComfyUI's API doesn't support subgraph nodes directly
  workflow = expandSubgraphs(workflow);

  // Convert to API format
  const apiWorkflow = workflowToPrompt(workflow);

  // Ensure LoadImage node has correct image filename in API format
  // Note: After expansion, the LoadImage node ID is still 98 (not part of subgraph)
  const loadImageNode = apiWorkflow['98'] as { class_type?: string; inputs?: Record<string, unknown> } | undefined;
  if (loadImageNode && loadImageNode.class_type === 'LoadImage' && params.inputImageFilename) {
    loadImageNode.inputs = loadImageNode.inputs || {};
    loadImageNode.inputs['image'] = params.inputImageFilename;
    console.log(`[LtxI2V] API format - Set LoadImage (node 98) inputs.image to: ${params.inputImageFilename}`);
  }

  // Remove non-essential nodes
  const nodesToRemove = ['Note', 'MarkdownNote'];
  for (const [nodeId, node] of Object.entries(apiWorkflow)) {
    const nodeData = node as { class_type?: string };
    if (nodesToRemove.includes(nodeData.class_type || '')) {
      delete apiWorkflow[nodeId];
      console.log(`[LtxI2V] Removed non-essential node ${nodeId} (${nodeData.class_type})`);
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
  } else if (workflowName === 'ltx_t2v') {
    // LTX-2 Text-to-Video workflow
    return parameterizeLtxT2VWorkflow(template, {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      seed: params.seed,
      filenamePrefix,
      width: params.aspectRatio === '16:9' ? 1280 : params.aspectRatio === '9:16' ? 720 : 640,
      height: params.aspectRatio === '16:9' ? 720 : params.aspectRatio === '9:16' ? 1280 : 640,
      frameCount: (params as { frameCount?: number }).frameCount,
    });
  } else if (workflowName === 'ltx_i2v') {
    // LTX-2 Image-to-Video workflow
    if (!params.inputImageFilename) {
      throw new Error('ltx_i2v workflow requires inputImageFilename');
    }
    return parameterizeLtxI2VWorkflow(template, {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      seed: params.seed,
      filenamePrefix,
      inputImageFilename: params.inputImageFilename,
      frameCount: (params as { frameCount?: number }).frameCount,
    });
  }

  // Default: return template as-is
  return template;
}

/**
 * Expand subgraphs in a workflow by replacing subgraph nodes with their internal nodes.
 * This is necessary because ComfyUI's API doesn't support subgraph nodes directly.
 */
export function expandSubgraphs(workflow: WorkflowTemplate): WorkflowTemplate {
  const definitions = workflow.definitions?.subgraphs || [];
  if (definitions.length === 0) {
    return workflow; // No subgraphs to expand
  }

  // Deep copy
  const expanded: WorkflowTemplate = JSON.parse(JSON.stringify(workflow));
  const mainNodes = expanded.nodes || [];
  const mainLinks = expanded.links || [];

  // Find the highest node ID in the main workflow to use as offset
  let maxNodeId = Math.max(...mainNodes.map(n => n.id), 0);
  let maxLinkId = Math.max(...mainLinks.map(l => l[0]), 0);

  // Process each subgraph node
  const subgraphNodes = mainNodes.filter(n =>
    n.type && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(n.type)
  );

  for (const subgraphNode of subgraphNodes) {
    const subgraphDef = definitions.find(d => d.id === subgraphNode.type);
    if (!subgraphDef) {
      console.log(`[expandSubgraphs] Warning: No definition found for subgraph ${subgraphNode.type}`);
      continue;
    }

    console.log(`[expandSubgraphs] Expanding subgraph "${subgraphDef.name}" (node ${subgraphNode.id})`);

    // Get nodes and links from the subgraph definition
    const subNodes = (subgraphDef as { nodes?: Array<{ id: number; type: string; inputs?: Array<{ name: string; link?: number | null }>; widgets_values?: unknown[]; [key: string]: unknown }> }).nodes || [];
    const subInputs = (subgraphDef as { inputs?: Array<{ name: string; linkIds: number[] }> }).inputs || [];
    const subOutputs = (subgraphDef as { outputs?: Array<{ name: string; linkIds: number[] }> }).outputs || [];

    // Normalize subgraph links - they can be in object format or array format
    const rawSubLinks = (subgraphDef as { links?: unknown[] }).links || [];
    const subLinks: Array<[number, number, number, number, number, string]> = rawSubLinks.map(link => {
      if (Array.isArray(link)) {
        return link as [number, number, number, number, number, string];
      }
      // Object format: {id, origin_id, origin_slot, target_id, target_slot, type}
      const objLink = link as { id: number; origin_id: number; origin_slot: number; target_id: number; target_slot: number; type: string };
      return [objLink.id, objLink.origin_id, objLink.origin_slot, objLink.target_id, objLink.target_slot, objLink.type];
    });

    // Create ID mappings for remapping
    const nodeIdMap = new Map<number, number>();
    const linkIdMap = new Map<number, number>();

    // Remap node IDs (skip input/output virtual nodes -10, -20)
    for (const node of subNodes) {
      if (node.id < 0) continue; // Skip virtual I/O nodes
      const newId = ++maxNodeId;
      nodeIdMap.set(node.id, newId);
    }

    // Remap link IDs (only for non-virtual links)
    for (const link of subLinks) {
      const [, fromNode, , toNode] = link;
      if (fromNode >= 0 && toNode >= 0) {
        const newId = ++maxLinkId;
        linkIdMap.set(link[0], newId);
      }
    }

    // Build mapping: which proxy widget value goes to which internal node/input
    // proxyWidgets format: [[targetNode, inputName], ...] where targetNode === "-1" means external input
    const proxyWidgets = subgraphNode.properties?.proxyWidgets || [];
    const widgetValues = subgraphNode.widgets_values || [];

    // Map from (internal node id, input slot) -> value from proxy widget
    const inputValueMap = new Map<string, unknown>();

    for (let widgetIdx = 0; widgetIdx < proxyWidgets.length && widgetIdx < widgetValues.length; widgetIdx++) {
      const proxyWidget = proxyWidgets[widgetIdx];
      if (!proxyWidget || proxyWidget[0] !== '-1') continue;

      const inputName = proxyWidget[1];
      const value = widgetValues[widgetIdx];

      // Find the subgraph input with this name
      const subInput = subInputs.find(inp => inp.name === inputName);
      if (!subInput) continue;

      // Find links that carry this input value (from virtual node -10)
      for (const linkId of subInput.linkIds || []) {
        const link = subLinks.find(l => l[0] === linkId);
        if (link && link[1] === -10) {
          // This link goes from virtual input -10 to an internal node
          const [, , , targetNode, targetSlot] = link;
          if (targetNode > 0) {
            inputValueMap.set(`${targetNode}:${targetSlot}`, value);
            console.log(`[expandSubgraphs] Mapped widget "${inputName}" -> node ${targetNode} slot ${targetSlot}: "${String(value).substring(0, 40)}..."`);
          }
        }
      }
    }

    // Add remapped nodes to main workflow
    for (const node of subNodes) {
      if (node.id < 0) continue; // Skip virtual I/O nodes

      // Deep copy the node
      const newNode = JSON.parse(JSON.stringify(node)) as typeof mainNodes[0];
      const oldId = node.id;
      newNode.id = nodeIdMap.get(oldId) || oldId;

      // Remap input links and update widget values
      if (newNode.inputs) {
        for (let inputIdx = 0; inputIdx < newNode.inputs.length; inputIdx++) {
          const input = newNode.inputs[inputIdx];
          const mapKey = `${oldId}:${inputIdx}`;
          const mappedValue = inputValueMap.get(mapKey);

          if (mappedValue !== undefined) {
            // This input receives a value from the proxy widget
            // Set the widget value at the appropriate position
            if (Array.isArray(newNode.widgets_values)) {
              updateNodeWidgetValue(newNode, input.name, mappedValue);
              console.log(`[expandSubgraphs] Set node ${newNode.id} (${node.type}) input "${input.name}" = "${String(mappedValue).substring(0, 40)}..."`);
            }
            // Clear the link since we're providing the value via widget
            input.link = null;
          } else if (input.link != null) {
            // Remap the link ID if it's a valid internal link
            const newLinkId = linkIdMap.get(input.link);
            if (newLinkId !== undefined) {
              input.link = newLinkId;
            } else {
              // This link was from virtual node or not in subgraph, clear it
              input.link = null;
            }
          }
        }
      }

      // Update output links references
      if (newNode.outputs) {
        for (const output of newNode.outputs as Array<{ links?: number[] }>) {
          if (output.links) {
            output.links = output.links
              .map(linkId => linkIdMap.get(linkId))
              .filter((id): id is number => id !== undefined);
          }
        }
      }

      mainNodes.push(newNode);
    }

    // Add remapped internal links to main workflow
    for (const link of subLinks) {
      const [linkId, fromNode, fromSlot, toNode, toSlot, type] = link;

      // Skip links involving virtual I/O nodes
      if (fromNode < 0 || toNode < 0) continue;

      const newLinkId = linkIdMap.get(linkId);
      if (newLinkId === undefined) continue;

      const newLink: [number, number, number, number, number, string] = [
        newLinkId,
        nodeIdMap.get(fromNode) || fromNode,
        fromSlot,
        nodeIdMap.get(toNode) || toNode,
        toSlot,
        type
      ];
      mainLinks.push(newLink);
    }

    // Connect subgraph outputs to external targets
    // Find links in the main workflow that connect FROM this subgraph node
    for (const mainLink of [...mainLinks]) {
      const [linkId, fromNode, fromSlot, toNode, toSlot, type] = mainLink;
      if (fromNode === subgraphNode.id) {
        // Find the corresponding output in the subgraph
        const subOutput = subOutputs[fromSlot];
        if (subOutput) {
          // Find the internal link that connects TO the virtual output node (-20)
          for (const subLink of subLinks) {
            const [subLinkId, subFromNode, subFromSlot, subToNode] = subLink;
            if (subToNode === -20) {
              const outputLinkIds = subOutput.linkIds || [];
              if (outputLinkIds.includes(subLinkId)) {
                // Reroute the main link to come from the internal source node
                const newFromNode = nodeIdMap.get(subFromNode);
                if (newFromNode) {
                  // Update the main link
                  const linkIndex = mainLinks.findIndex(l => l[0] === linkId);
                  if (linkIndex >= 0) {
                    mainLinks[linkIndex] = [linkId, newFromNode, subFromSlot, toNode, toSlot, type];
                    console.log(`[expandSubgraphs] Output: Rerouted link ${linkId} from subgraph to internal node ${newFromNode}`);
                  }
                }
              }
            }
          }
        }
      }
    }

    // Connect external inputs TO the subgraph's internal nodes
    // Find links in the main workflow that connect TO this subgraph node
    const linksToRemove: number[] = [];
    for (const mainLink of [...mainLinks]) {
      const [linkId, fromNode, fromSlot, toNode, toSlot, type] = mainLink;
      if (toNode === subgraphNode.id) {
        // Find the corresponding input in the subgraph
        const subInput = subInputs[toSlot];
        if (subInput) {
          // Find internal links that carry this input (from virtual node -10)
          for (const linkIdFromInput of subInput.linkIds || []) {
            const internalLink = subLinks.find(l => l[0] === linkIdFromInput);
            if (internalLink && internalLink[1] === -10) {
              // This link goes from -10 to an internal node
              const [, , , internalToNode, internalToSlot, internalType] = internalLink;
              const newToNode = nodeIdMap.get(internalToNode);
              if (newToNode) {
                // Create a new link from the external source to the internal target
                const newLinkId = ++maxLinkId;
                const newLink: [number, number, number, number, number, string] = [
                  newLinkId,
                  fromNode,
                  fromSlot,
                  newToNode,
                  internalToSlot,
                  type
                ];
                mainLinks.push(newLink);

                // Update the internal node's input to reference this new link
                const targetNode = mainNodes.find(n => n.id === newToNode);
                if (targetNode?.inputs?.[internalToSlot]) {
                  targetNode.inputs[internalToSlot].link = newLinkId;
                }

                console.log(`[expandSubgraphs] Input: Connected external node ${fromNode} to internal node ${newToNode}:${internalToSlot}`);
              }
            }
          }
        }
        // Mark original link to subgraph for removal
        linksToRemove.push(linkId);
      }
    }

    // Remove links that went to the subgraph node
    for (const linkId of linksToRemove) {
      const idx = mainLinks.findIndex(l => l[0] === linkId);
      if (idx >= 0) {
        mainLinks.splice(idx, 1);
      }
    }

    // Remove the subgraph node from the main workflow
    const nodeIndex = mainNodes.findIndex(n => n.id === subgraphNode.id);
    if (nodeIndex >= 0) {
      mainNodes.splice(nodeIndex, 1);
      console.log(`[expandSubgraphs] Removed subgraph node ${subgraphNode.id}`);
    }
  }

  expanded.nodes = mainNodes;
  expanded.links = mainLinks;
  delete expanded.definitions; // Remove subgraph definitions after expansion

  // Collapse Reroute nodes within the expanded subgraph
  collapseRerouteNodesInternal(expanded);

  // Remove remaining UI-only nodes (PrimitiveNode, etc.)
  return removeUIOnlyNodes(expanded);
}

/**
 * Collapse Reroute nodes by directly connecting their sources to destinations.
 * This modifies the workflow in place.
 */
function collapseRerouteNodesInternal(workflow: WorkflowTemplate): void {
  const nodes = workflow.nodes || [];
  const links = workflow.links || [];

  // Find all Reroute nodes
  const rerouteNodes = nodes.filter(n => n.type === 'Reroute');
  if (rerouteNodes.length === 0) return;

  const rerouteIds = new Set(rerouteNodes.map(n => n.id));
  console.log(`[collapseRerouteNodesInternal] Found ${rerouteNodes.length} Reroute nodes`);

  // Build link lookup: linkId -> link tuple
  const linkById = new Map<number, [number, number, number, number, number, string]>();
  for (const link of links) {
    linkById.set(link[0], link);
  }

  // For each Reroute, trace through to find the original source
  // (handling chains of Reroutes)
  function findOriginalSource(nodeId: number): [number, number] | null {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return null;

    if (node.type !== 'Reroute') {
      return null; // Not used for non-Reroutes
    }

    const inputLink = node.inputs?.[0]?.link;
    if (inputLink == null) return null;

    const linkData = linkById.get(inputLink);
    if (!linkData) return null;

    const [, sourceNodeId, sourceSlot] = linkData;

    // If source is also a Reroute, follow the chain
    if (rerouteIds.has(sourceNodeId)) {
      return findOriginalSource(sourceNodeId);
    }

    return [sourceNodeId, sourceSlot];
  }

  // Update all links that come FROM Reroute nodes to come from the original source
  for (const rerouteNode of rerouteNodes) {
    const originalSource = findOriginalSource(rerouteNode.id);
    if (!originalSource) {
      console.log(`[collapseRerouteNodesInternal] Could not find source for Reroute ${rerouteNode.id}`);
      continue;
    }

    const [sourceNode, sourceSlot] = originalSource;

    // Find all links that come FROM this Reroute and update them
    for (const link of links) {
      if (link[1] === rerouteNode.id) {
        const oldFrom = link[1];
        link[1] = sourceNode;
        link[2] = sourceSlot;
        console.log(`[collapseRerouteNodesInternal] Reroute ${oldFrom}: rerouted link ${link[0]} to source ${sourceNode}:${sourceSlot}`);
      }
    }
  }

  // Remove Reroute nodes from the nodes array
  workflow.nodes = nodes.filter(n => !rerouteIds.has(n.id));

  // Remove links that go INTO Reroute nodes
  workflow.links = links.filter(link => !rerouteIds.has(link[3]));

  console.log(`[collapseRerouteNodesInternal] Removed ${rerouteIds.size} Reroute nodes`);
}

/**
 * Remove UI-only nodes that don't exist in ComfyUI's API.
 * Note: Reroute nodes are handled by collapseRerouteNodesInternal before this.
 */
function removeUIOnlyNodes(workflow: WorkflowTemplate): WorkflowTemplate {
  let nodes = workflow.nodes || [];
  let links = workflow.links || [];

  // Types of UI-only nodes to handle (these are frontend-only nodes)
  // Note: PrimitiveInt and PrimitiveFloat ARE valid API nodes
  // Note: Reroute is handled by collapseRerouteNodesInternal
  const uiOnlyTypes = new Set(['PrimitiveNode']);

  // Handle PrimitiveNode - propagate values to target nodes
  const primitiveNodes = nodes.filter(n => n.type === 'PrimitiveNode');
  for (const primNode of primitiveNodes) {
    const value = (primNode.widgets_values as unknown[])?.[0];
    if (value === undefined) continue;

    // Find output links from this primitive
    const outputs = primNode.outputs as Array<{ links?: number[] }> | undefined;
    const outputLinks = outputs?.[0]?.links || [];

    for (const linkId of outputLinks) {
      const link = links.find(l => l[0] === linkId);
      if (!link) continue;

      const [, , , targetNodeId, targetSlot] = link;
      const targetNode = nodes.find(n => n.id === targetNodeId);
      if (!targetNode) continue;

      // Find which input corresponds to this slot
      const targetInputs = targetNode.inputs || [];
      const targetInput = targetInputs[targetSlot];
      if (targetInput) {
        // Clear the link and the value will come from widgets_values
        targetInput.link = null;
        // For certain node types, we can set the widget value directly
        updateNodeWidgetValue(targetNode, targetInput.name, value);
        console.log(`[removeUIOnlyNodes] PrimitiveNode ${primNode.id}: propagated "${String(value).substring(0, 30)}" to node ${targetNodeId}`);
      }
    }
  }

  // Collect all UI-only node IDs
  const uiOnlyNodeIds = new Set(
    nodes.filter(n => uiOnlyTypes.has(n.type)).map(n => n.id)
  );

  if (uiOnlyNodeIds.size > 0) {
    // Remove UI-only nodes
    nodes = nodes.filter(n => !uiOnlyNodeIds.has(n.id));

    // Remove links involving UI-only nodes
    links = links.filter(link => !uiOnlyNodeIds.has(link[1]) && !uiOnlyNodeIds.has(link[3]));

    console.log(`[removeUIOnlyNodes] Removed ${uiOnlyNodeIds.size} UI-only nodes`);
  }

  workflow.nodes = nodes;
  workflow.links = links;

  return workflow;
}

/**
 * Helper to update a node's widget value by input name.
 * Different node types have different widget value layouts.
 */
function updateNodeWidgetValue(
  node: { type: string; widgets_values?: unknown[] },
  inputName: string,
  value: unknown
): void {
  if (!node.widgets_values) {
    node.widgets_values = [];
  }

  // Map input names to widget indices for known node types
  const nodeType = node.type;

  if (nodeType === 'CLIPTextEncode') {
    if (inputName === 'text') node.widgets_values[0] = value;
  } else if (nodeType === 'RandomNoise') {
    if (inputName === 'noise_seed') node.widgets_values[0] = value;
  } else if (nodeType === 'PrimitiveInt') {
    if (inputName === 'value') node.widgets_values[0] = value;
  } else if (nodeType === 'PrimitiveFloat') {
    if (inputName === 'value') node.widgets_values[0] = value;
  } else if (nodeType === 'EmptyImage') {
    if (inputName === 'width') node.widgets_values[0] = value;
    else if (inputName === 'height') node.widgets_values[1] = value;
    else if (inputName === 'batch_size') node.widgets_values[2] = value;
  } else if (nodeType === 'EmptyLTXVLatentVideo') {
    if (inputName === 'width') node.widgets_values[0] = value;
    else if (inputName === 'height') node.widgets_values[1] = value;
    else if (inputName === 'length') node.widgets_values[2] = value;
    else if (inputName === 'batch_size') node.widgets_values[3] = value;
  } else if (nodeType === 'LTXVEmptyLatentAudio') {
    if (inputName === 'frames_number') node.widgets_values[0] = value;
    else if (inputName === 'frame_rate') node.widgets_values[1] = value;
    else if (inputName === 'batch_size') node.widgets_values[2] = value;
  } else if (nodeType === 'LTXVConditioning') {
    if (inputName === 'frame_rate') node.widgets_values[0] = value;
  } else if (nodeType === 'LoadImage') {
    if (inputName === 'image') node.widgets_values[0] = value;
  } else if (nodeType === 'CreateVideo') {
    if (inputName === 'fps') node.widgets_values[0] = value;
  } else if (nodeType === 'CheckpointLoaderSimple') {
    if (inputName === 'ckpt_name') node.widgets_values[0] = value;
  } else if (nodeType === 'LTXVAudioVAELoader') {
    if (inputName === 'ckpt_name') node.widgets_values[0] = value;
  } else if (nodeType === 'LTXAVTextEncoderLoader') {
    if (inputName === 'text_encoder') node.widgets_values[0] = value;
    else if (inputName === 'ckpt_name') node.widgets_values[1] = value;
  } else if (nodeType === 'LoraLoaderModelOnly') {
    if (inputName === 'lora_name') node.widgets_values[0] = value;
    else if (inputName === 'strength_model') node.widgets_values[1] = value;
  } else {
    // Generic fallback: try to find the widget index from input position
    console.log(`[updateNodeWidgetValue] Unknown node type ${nodeType}, skipping widget update for "${inputName}"`);
  }
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
    // Special handling for subgraph nodes (UUID-like type names)
    // These are collapsed ComfyUI subgraphs with proxy widgets
    else if (nodeType && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeType)) {
      // Map widgets using proxyWidgets mapping if available
      const proxyWidgets = (node as { properties?: { proxyWidgets?: Array<[string, string]> } }).properties?.proxyWidgets;
      if (proxyWidgets && Array.isArray(widgetValues)) {
        for (let i = 0; i < proxyWidgets.length && i < widgetValues.length; i++) {
          const proxyWidget = proxyWidgets[i];
          if (proxyWidget) {
            const [targetNode, inputName] = proxyWidget;
            // "-1" means it's an external input that should be exposed
            if (targetNode === '-1' && inputName) {
              convertedInputs[inputName] = widgetValues[i];
            }
          }
        }
      }
      console.log(`[workflowToPrompt] Handled subgraph node ${nodeId} (${nodeType.substring(0, 8)}...) with ${Object.keys(convertedInputs).length} inputs`);
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
    }
    // Special handling for TextEncodeQwenImageEditPlus
    else if (nodeType === 'TextEncodeQwenImageEditPlus' && Array.isArray(widgetValues)) {
      convertedInputs['prompt'] = widgetValues[0];
    }
    // Special handling for SaveImage
    else if (nodeType === 'SaveImage' && Array.isArray(widgetValues)) {
      convertedInputs['filename_prefix'] = widgetValues[0];
    }
    // Special handling for LTXVEmptyLatentAudio - widget values are positional regardless of links
    else if (nodeType === 'LTXVEmptyLatentAudio' && Array.isArray(widgetValues)) {
      // widgets_values: [frames_number, frame_rate, batch_size]
      // Only set if not already linked
      if (!convertedInputs['frames_number']) convertedInputs['frames_number'] = widgetValues[0];
      if (!convertedInputs['frame_rate']) convertedInputs['frame_rate'] = widgetValues[1];
      if (!convertedInputs['batch_size']) convertedInputs['batch_size'] = widgetValues[2];
    }
    // Special handling for EmptyLTXVLatentVideo
    else if (nodeType === 'EmptyLTXVLatentVideo' && Array.isArray(widgetValues)) {
      // widgets_values: [width, height, length, batch_size]
      if (!convertedInputs['width']) convertedInputs['width'] = widgetValues[0];
      if (!convertedInputs['height']) convertedInputs['height'] = widgetValues[1];
      if (!convertedInputs['length']) convertedInputs['length'] = widgetValues[2];
      if (!convertedInputs['batch_size']) convertedInputs['batch_size'] = widgetValues[3];
    }
    // Special handling for PrimitiveInt
    else if (nodeType === 'PrimitiveInt' && Array.isArray(widgetValues)) {
      convertedInputs['value'] = widgetValues[0];
      convertedInputs['control_after_generate'] = widgetValues[1] || 'fixed';
    }
    // Special handling for PrimitiveFloat
    else if (nodeType === 'PrimitiveFloat' && Array.isArray(widgetValues)) {
      convertedInputs['value'] = widgetValues[0];
      convertedInputs['control_after_generate'] = widgetValues[1] || 'fixed';
    }
    // Special handling for RandomNoise
    else if (nodeType === 'RandomNoise' && Array.isArray(widgetValues)) {
      convertedInputs['noise_seed'] = widgetValues[0];
      if (widgetValues[1] !== undefined) convertedInputs['control_after_generate'] = widgetValues[1];
    }
    // Special handling for KSamplerSelect
    else if (nodeType === 'KSamplerSelect' && Array.isArray(widgetValues)) {
      convertedInputs['sampler_name'] = widgetValues[0];
    }
    // Special handling for LTXVScheduler
    else if (nodeType === 'LTXVScheduler' && Array.isArray(widgetValues)) {
      // widgets_values: [steps, max_shift, base_shift, stretch, terminal]
      if (!convertedInputs['steps']) convertedInputs['steps'] = widgetValues[0];
      if (!convertedInputs['max_shift']) convertedInputs['max_shift'] = widgetValues[1];
      if (!convertedInputs['base_shift']) convertedInputs['base_shift'] = widgetValues[2];
      if (!convertedInputs['stretch']) convertedInputs['stretch'] = widgetValues[3];
      if (!convertedInputs['terminal']) convertedInputs['terminal'] = widgetValues[4];
    }
    // Special handling for LTXVConditioning
    else if (nodeType === 'LTXVConditioning' && Array.isArray(widgetValues)) {
      if (!convertedInputs['frame_rate']) convertedInputs['frame_rate'] = widgetValues[0];
    }
    // Special handling for CFGGuider
    else if (nodeType === 'CFGGuider' && Array.isArray(widgetValues)) {
      if (!convertedInputs['cfg']) convertedInputs['cfg'] = widgetValues[0];
    }
    // Special handling for ManualSigmas
    else if (nodeType === 'ManualSigmas' && Array.isArray(widgetValues)) {
      convertedInputs['sigmas'] = widgetValues[0];
    }
    // Special handling for LatentUpscaleModelLoader
    else if (nodeType === 'LatentUpscaleModelLoader' && Array.isArray(widgetValues)) {
      convertedInputs['model_name'] = widgetValues[0];
    }
    // Special handling for CheckpointLoaderSimple
    else if (nodeType === 'CheckpointLoaderSimple' && Array.isArray(widgetValues)) {
      convertedInputs['ckpt_name'] = widgetValues[0];
    }
    // Special handling for LTXVAudioVAELoader
    else if (nodeType === 'LTXVAudioVAELoader' && Array.isArray(widgetValues)) {
      convertedInputs['ckpt_name'] = widgetValues[0];
    }
    // Special handling for LTXAVTextEncoderLoader
    else if (nodeType === 'LTXAVTextEncoderLoader' && Array.isArray(widgetValues)) {
      convertedInputs['text_encoder'] = widgetValues[0];
      convertedInputs['ckpt_name'] = widgetValues[1];
    }
    // Special handling for EmptyImage
    else if (nodeType === 'EmptyImage' && Array.isArray(widgetValues)) {
      if (!convertedInputs['width']) convertedInputs['width'] = widgetValues[0];
      if (!convertedInputs['height']) convertedInputs['height'] = widgetValues[1];
      if (!convertedInputs['batch_size']) convertedInputs['batch_size'] = widgetValues[2];
      if (!convertedInputs['color']) convertedInputs['color'] = widgetValues[3];
    }
    // Special handling for ImageScaleBy
    else if (nodeType === 'ImageScaleBy' && Array.isArray(widgetValues)) {
      convertedInputs['upscale_method'] = widgetValues[0];
      convertedInputs['scale_by'] = widgetValues[1];
    }
    // Special handling for LTXVImgToVideoInplace
    else if (nodeType === 'LTXVImgToVideoInplace' && Array.isArray(widgetValues)) {
      convertedInputs['strength'] = widgetValues[0];
      convertedInputs['bypass'] = widgetValues[1];
    }
    // Special handling for LTXVPreprocess
    else if (nodeType === 'LTXVPreprocess' && Array.isArray(widgetValues)) {
      convertedInputs['img_compression'] = widgetValues[0];
    }
    // Special handling for ResizeImagesByLongerEdge
    else if (nodeType === 'ResizeImagesByLongerEdge' && Array.isArray(widgetValues)) {
      convertedInputs['longer_edge'] = widgetValues[0];
    }
    // Special handling for ResizeImageMaskNode
    else if (nodeType === 'ResizeImageMaskNode' && Array.isArray(widgetValues)) {
      convertedInputs['resize_type'] = widgetValues[0];
      convertedInputs['resize_type.width'] = widgetValues[1];
      convertedInputs['resize_type.height'] = widgetValues[2];
      convertedInputs['resize_type.crop'] = widgetValues[3];
      convertedInputs['scale_method'] = widgetValues[4];
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
    properties?: {
      proxyWidgets?: Array<[string, string]>;
      [key: string]: unknown;
    };
  }>;
  links?: Array<[number, number, number, number, number, string]>;
  definitions?: {
    subgraphs?: Array<{
      id: string;
      name: string;
      [key: string]: unknown;
    }>;
  };
  [key: string]: unknown;
}
