/**
 * Built-in workflow manifests.
 *
 * These define the parameter mappings for all shipped workflows.
 * Same format as user-imported custom workflow manifests — no special treatment.
 */
import type { WorkflowManifest } from './WorkflowAnalyzer.js';

/**
 * Z-Image Turbo — fast text-to-image (API format).
 * Nodes: 6=positive CLIPTextEncode, 7=negative CLIPTextEncode,
 *        3=KSampler, 13=EmptySD3LatentImage, 9=SaveImage
 */
export const ZIMAGE_MANIFEST: WorkflowManifest = {
  name: 'zimage',
  displayName: 'Z-Image Turbo',
  description: 'Fast high-quality image generation using Z-Image Turbo model with Qwen text encoder.',
  workflowType: 'image_generation',
  outputFormat: 'image',
  qualityLevel: 'high',
  estimatedTimeSeconds: 15,
  parameterMap: {
    positivePrompt: { nodeId: '6', inputKey: 'text' },
    negativePrompt: { nodeId: '7', inputKey: 'text' },
    seed: { nodeId: '3', inputKey: 'seed' },
    width: { nodeId: '13', inputKey: 'width' },
    height: { nodeId: '13', inputKey: 'height' },
    outputNode: { nodeId: '9' },
    filenamePrefix: { nodeId: '9', inputKey: 'filename_prefix' },
  },
  postProcess: {
    removeNoteNodes: true,
  },
  confidence: { promptDetection: 'high', typeDetection: 'high', notes: [] },
};

/**
 * Chroma-Radiance — high-quality text-to-image (legacy).
 * Same node pattern as zimage but different model/scheduler.
 * After LiteGraph→API conversion, nodes are identified by class_type scan.
 * These IDs are set dynamically at registration time via auto-analysis.
 */
export const CHROMA_RADIANCE_MANIFEST: WorkflowManifest = {
  name: 'chroma_radiance',
  displayName: 'Chroma Radiance',
  description: 'High-quality base image generation using Chroma-Radiance model.',
  workflowType: 'image_generation',
  outputFormat: 'image',
  qualityLevel: 'high',
  estimatedTimeSeconds: 45,
  parameterMap: {
    // Populated dynamically via analyzeWorkflow() at registration time
  },
  postProcess: {
    removeNoteNodes: true,
  },
  confidence: { promptDetection: 'high', typeDetection: 'high', notes: ['Manifest auto-generated from LiteGraph workflow'] },
};

/**
 * FireRed Image Editor (Lightning) — fast image editing with 1-3 reference images.
 * LiteGraph format: nodes 4,5,6=LoadImage, 11=positive prompt, 12=negative prompt,
 *                   13=KSampler, 15=SaveImage
 * After API conversion these become string IDs.
 */
export const QWEN_EDIT_MANIFEST: WorkflowManifest = {
  name: 'qwen_edit',
  displayName: 'FireRed Image Editor (Lightning)',
  description: 'Fast intelligent image editing using FireRed with 1-3 input images.',
  workflowType: 'image_editing',
  outputFormat: 'image',
  qualityLevel: 'high',
  estimatedTimeSeconds: 15,
  parameterMap: {
    // Populated dynamically via analyzeWorkflow() at registration time
  },
  postProcess: {
    removeUnusedInputImages: true,
    removeNoteNodes: true,
  },
  confidence: { promptDetection: 'high', typeDetection: 'high', notes: ['Manifest auto-generated from LiteGraph workflow'] },
};

/**
 * Qwen Edit HQ — slower but higher quality variant.
 * Same node layout as qwen_edit (Lightning).
 */
export const QWEN_EDIT_HQ_MANIFEST: WorkflowManifest = {
  name: 'qwen_edit_hq',
  displayName: 'Qwen Image Editor (HQ)',
  description: 'High-quality image editing using Qwen model (slower). Supports 1-3 input images.',
  workflowType: 'image_editing',
  outputFormat: 'image',
  qualityLevel: 'ultra',
  estimatedTimeSeconds: 60,
  parameterMap: {
    // Populated dynamically via analyzeWorkflow() at registration time
  },
  postProcess: {
    removeUnusedInputImages: true,
    removeNoteNodes: true,
  },
  confidence: { promptDetection: 'high', typeDetection: 'high', notes: ['Manifest auto-generated from LiteGraph workflow'] },
};

/**
 * LTX-2.3 Video (GGUF) — video generation with I2V/T2V toggle.
 * LiteGraph format with SetNode/GetNode pattern.
 * Key nodes: 121=positive prompt, 110=negative prompt, 167=LoadImage,
 *            291=duration, 292=width, 293=height, 290=T2V toggle,
 *            140=VHS_VideoCombine output
 * After API conversion (with SetGetNode resolution) these become string IDs.
 */
export const LTX23_MANIFEST: WorkflowManifest = {
  name: 'ltx23',
  displayName: 'LTX-2.3 Video (GGUF)',
  description: 'Video generation using LTX-2.3 GGUF model. Supports I2V and T2V modes.',
  workflowType: 'video_generation',
  outputFormat: 'video',
  qualityLevel: 'standard',
  estimatedTimeSeconds: 60,
  parameterMap: {
    // Populated dynamically via analyzeWorkflow() at registration time.
    // Extra mappings for t2v toggle and duration are added post-analysis.
  },
  postProcess: {
    removeNoteNodes: true,
    bypassEmptyLoraLoaders: true,
  },
  confidence: { promptDetection: 'high', typeDetection: 'high', notes: ['Manifest auto-generated from LiteGraph workflow'] },
};

/**
 * FLUX 2 Klein Edit — multi-reference image editing with 1-4 reference images.
 * API format workflow with ReferenceLatent conditioning chain.
 * Image 1 is required; images 2-4 are optional (pruned at runtime).
 */
export const FLUX2_KLEIN_EDIT_MANIFEST: WorkflowManifest = {
  name: 'flux2_klein_edit',
  displayName: 'FLUX 2 Klein Edit',
  description: 'Multi-reference image editing using FLUX 2 Klein 9B. Supports 1-4 reference images.',
  workflowType: 'image_editing',
  outputFormat: 'image',
  qualityLevel: 'high',
  estimatedTimeSeconds: 10,
  parameterMap: {
    positivePrompt: { nodeId: '109', inputKey: 'text' },
    seed: { nodeId: '92:73', inputKey: 'noise_seed' },
    outputNode: { nodeId: '94' },
    filenamePrefix: { nodeId: '94', inputKey: 'filename_prefix' },
    inputImages: [
      { nodeId: '76', inputKey: 'image' },
      { nodeId: '81', inputKey: 'image' },
      { nodeId: '82', inputKey: 'image' },
      { nodeId: '83', inputKey: 'image' },
    ],
  },
  postProcess: {
    removeNoteNodes: true,
    referenceImageChain: {
      targetNodeId: '92:63',
      positiveInputKey: 'positive',
      negativeInputKey: 'negative',
      groups: [
        {
          // Image 1 (required) — excludes 92:81 (GetImageSize) since it's shared
          nodeIds: ['76', '92:80', '92:79:78', '92:79:77', '92:79:76'],
          positiveEndNodeId: '92:79:77',
          negativeEndNodeId: '92:79:76',
        },
        {
          // Image 2 (optional)
          nodeIds: ['81', '92:85', '92:84:78', '92:84:77', '92:84:76'],
          positiveEndNodeId: '92:84:77',
          negativeEndNodeId: '92:84:76',
        },
        {
          // Image 3 (optional)
          nodeIds: ['82', '92:87', '92:88:78', '92:88:77', '92:88:76'],
          positiveEndNodeId: '92:88:77',
          negativeEndNodeId: '92:88:76',
        },
        {
          // Image 4 (optional)
          nodeIds: ['83', '92:89', '92:89:78', '92:89:77', '92:89:76'],
          positiveEndNodeId: '92:89:77',
          negativeEndNodeId: '92:89:76',
        },
      ],
    },
  },
  confidence: { promptDetection: 'high', typeDetection: 'high', notes: [] },
};

/** All built-in manifests keyed by workflow name. */
export const BUILTIN_MANIFESTS: Record<string, WorkflowManifest> = {
  zimage: ZIMAGE_MANIFEST,
  chroma_radiance: CHROMA_RADIANCE_MANIFEST,
  qwen_edit: QWEN_EDIT_MANIFEST,
  qwen_edit_hq: QWEN_EDIT_HQ_MANIFEST,
  ltx23: LTX23_MANIFEST,
  flux2_klein_edit: FLUX2_KLEIN_EDIT_MANIFEST,
};
