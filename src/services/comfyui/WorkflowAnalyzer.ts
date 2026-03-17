/**
 * WorkflowAnalyzer - Auto-detects parameter mappings from ComfyUI API-format workflows.
 *
 * Scans node class_type values to identify prompt, seed, dimension, image input,
 * and output nodes. Produces a WorkflowManifest that the generic parameterizer uses.
 */

import { workflowToPrompt, resolveSetGetNodes, type WorkflowTemplate } from './WorkflowLoader.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ParameterMapping {
  nodeId: string;
  inputKey: string;
}

export interface WorkflowManifest {
  name: string;
  displayName: string;
  description: string;
  workflowType: 'image_generation' | 'image_editing' | 'video_generation';
  outputFormat: 'image' | 'video';
  qualityLevel?: 'draft' | 'standard' | 'high' | 'ultra';
  estimatedTimeSeconds?: number;

  parameterMap: {
    positivePrompt?: ParameterMapping;
    negativePrompt?: ParameterMapping;
    seed?: ParameterMapping;
    width?: ParameterMapping;
    height?: ParameterMapping;
    inputImages?: ParameterMapping[];
    outputNode?: { nodeId: string };
    filenamePrefix?: ParameterMapping;

    /** Arbitrary extra parameter mappings (e.g., t2v toggle, duration). */
    extra?: Array<{
      name: string;
      nodeId: string;
      inputKey: string;
    }>;
  };

  /** Post-processing options applied after parameter writes. */
  postProcess?: {
    /** Remove LoadImage nodes that weren't assigned an image. */
    removeUnusedInputImages?: boolean;
    /** Remove Note/MarkdownNote nodes (cosmetic cleanup). */
    removeNoteNodes?: boolean;
    /** Bypass LoraLoaderModelOnly nodes with lora_name "None". */
    bypassEmptyLoraLoaders?: boolean;
    /**
     * Prune unused reference images from a ReferenceLatent conditioning chain.
     *
     * Use this for workflows where reference images are chained through
     * ReferenceLatent nodes (e.g., FLUX Klein edit). When fewer images are
     * provided than the workflow supports, unused groups are removed and
     * the target node (e.g., CFGGuider) is rewired to the last active group.
     *
     * Group 0 is always required. Groups 1+ are optional.
     */
    referenceImageChain?: {
      /** Node that receives the final conditioning (e.g., CFGGuider). */
      targetNodeId: string;
      /** Input key for positive conditioning on target node. */
      positiveInputKey: string;
      /** Input key for negative conditioning on target node. */
      negativeInputKey: string;
      /** Ordered groups, one per reference image slot. */
      groups: Array<{
        /** All node IDs belonging to this reference image (removed as a unit). */
        nodeIds: string[];
        /** The positive-chain ReferenceLatent node ID (rewire target). */
        positiveEndNodeId: string;
        /** The negative-chain ReferenceLatent node ID (rewire target). */
        negativeEndNodeId: string;
      }>;
    };
  };

  /** Flags for cases where auto-detection is uncertain */
  confidence: {
    promptDetection: 'high' | 'medium' | 'low';
    typeDetection: 'high' | 'medium' | 'low';
    notes: string[];
  };
}

// ── Node class_type detection tables ───────────────────────────────────────────

/** Nodes that accept text prompts (positive/negative) */
const PROMPT_NODE_TYPES = new Set([
  'CLIPTextEncode',
  'CLIPTextEncodeSDXL',
  'CLIPTextEncodeFlux',
  'TextEncodeQwenImageEditPlus',
]);

/** Nodes with seed parameters */
const SEED_NODE_MAP: Record<string, string> = {
  'KSampler': 'seed',
  'KSamplerAdvanced': 'noise_seed',
  'RandomNoise': 'noise_seed',
  'SamplerCustomAdvanced': 'noise_seed',
  'KSampler (Efficient)': 'seed',
};

/** Nodes with dimension parameters (width/height) */
const DIMENSION_NODE_TYPES = new Set([
  'EmptyLatentImage',
  'EmptySD3LatentImage',
  'EmptyHunyuanLatentVideo',
]);

/** Nodes that load input images */
const IMAGE_INPUT_NODE_TYPES = new Set([
  'LoadImage',
  'LoadImageMask',
]);

/** Nodes that produce image output */
const IMAGE_OUTPUT_NODE_TYPES = new Set([
  'SaveImage',
  'PreviewImage',
]);

/** Nodes that produce video output */
const VIDEO_OUTPUT_NODE_TYPES = new Set([
  'VHS_VideoCombine',
  'SaveAnimatedWEBP',
]);

// ── Detection logic ────────────────────────────────────────────────────────────

interface DetectedNode {
  nodeId: string;
  classType: string;
  inputs: Record<string, unknown>;
  title?: string;
}

/**
 * Check if a workflow JSON is in LiteGraph UI format (has nodes/links arrays).
 * If so, convert to API format using workflowToPrompt().
 */
export function isLiteGraphFormat(workflow: unknown): workflow is WorkflowTemplate {
  if (!workflow || typeof workflow !== 'object') return false;
  const wf = workflow as Record<string, unknown>;
  return Array.isArray(wf['nodes']) && Array.isArray(wf['links']);
}

/**
 * Convert LiteGraph format to API format if needed.
 * Handles SetNode/GetNode resolution for workflows that use virtual node patterns.
 * Returns the workflow in API format (flat {nodeId: {class_type, inputs}} structure).
 */
export function ensureApiFormat(workflow: unknown): Record<string, unknown> {
  if (isLiteGraphFormat(workflow)) {
    const resolved = resolveSetGetNodes(workflow);
    return workflowToPrompt(resolved);
  }
  return workflow as Record<string, unknown>;
}

/**
 * Extract detected nodes from an API-format workflow.
 */
function extractNodes(apiWorkflow: Record<string, unknown>): DetectedNode[] {
  const nodes: DetectedNode[] = [];

  for (const [nodeId, nodeData] of Object.entries(apiWorkflow)) {
    if (!nodeData || typeof nodeData !== 'object') continue;
    const node = nodeData as Record<string, unknown>;
    const classType = node['class_type'] as string | undefined;
    if (!classType) continue;

    nodes.push({
      nodeId,
      classType,
      inputs: (node['inputs'] as Record<string, unknown>) || {},
      title: (node['_meta'] as Record<string, unknown>)?.['title'] as string | undefined,
    });
  }

  return nodes;
}

/**
 * Detect positive and negative prompt nodes.
 * Heuristic: if a CLIPTextEncode node's text contains negative-sounding defaults
 * or its title contains "negative", treat it as negative prompt.
 */
function detectPromptNodes(nodes: DetectedNode[]): {
  positive?: ParameterMapping;
  negative?: ParameterMapping;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
} {
  const promptNodes = nodes.filter(n => PROMPT_NODE_TYPES.has(n.classType));
  const notes: string[] = [];

  if (promptNodes.length === 0) {
    return { confidence: 'low', notes: ['No prompt nodes detected'] };
  }

  if (promptNodes.length === 1) {
    return {
      positive: { nodeId: promptNodes[0]!.nodeId, inputKey: 'text' },
      confidence: 'high',
      notes: [],
    };
  }

  // Multiple prompt nodes — try to distinguish positive from negative
  let positive: DetectedNode | undefined;
  let negative: DetectedNode | undefined;

  for (const node of promptNodes) {
    const title = (node.title || '').toLowerCase();
    const text = String(node.inputs['text'] || '').toLowerCase();

    const isNegative =
      title.includes('negative') ||
      text.includes('bad quality') ||
      text.includes('worst quality') ||
      text.includes('low quality') ||
      text.includes('ugly') ||
      text.includes('blurry') ||
      text.includes('deformed');

    if (isNegative && !negative) {
      negative = node;
    } else if (!positive) {
      positive = node;
    }
  }

  // Fallback: first is positive, second is negative
  if (!positive && promptNodes.length >= 1) {
    positive = promptNodes[0];
  }
  if (!negative && promptNodes.length >= 2) {
    negative = promptNodes[1];
  }

  const confidence = promptNodes.length === 2 ? 'high' : 'medium';
  if (promptNodes.length > 2) {
    notes.push(`${promptNodes.length} prompt nodes found — mapped first two, others ignored`);
  }

  return {
    positive: positive ? { nodeId: positive.nodeId, inputKey: 'text' } : undefined,
    negative: negative ? { nodeId: negative.nodeId, inputKey: 'text' } : undefined,
    confidence,
    notes,
  };
}

/**
 * Detect seed node.
 */
function detectSeedNode(nodes: DetectedNode[]): ParameterMapping | undefined {
  for (const node of nodes) {
    const inputKey = SEED_NODE_MAP[node.classType];
    if (inputKey) {
      return { nodeId: node.nodeId, inputKey };
    }
  }
  return undefined;
}

/**
 * Detect dimension nodes (width/height).
 */
function detectDimensionNode(nodes: DetectedNode[]): {
  width?: ParameterMapping;
  height?: ParameterMapping;
} {
  for (const node of nodes) {
    if (DIMENSION_NODE_TYPES.has(node.classType)) {
      return {
        width: { nodeId: node.nodeId, inputKey: 'width' },
        height: { nodeId: node.nodeId, inputKey: 'height' },
      };
    }
  }
  return {};
}

/**
 * Detect input image nodes.
 */
function detectInputImageNodes(nodes: DetectedNode[]): ParameterMapping[] {
  return nodes
    .filter(n => IMAGE_INPUT_NODE_TYPES.has(n.classType))
    .map(n => ({ nodeId: n.nodeId, inputKey: 'image' }));
}

/**
 * Detect output node and format.
 */
function detectOutputNode(nodes: DetectedNode[]): {
  outputNode?: { nodeId: string };
  filenamePrefix?: ParameterMapping;
  outputFormat: 'image' | 'video';
} {
  // Check video outputs first
  for (const node of nodes) {
    if (VIDEO_OUTPUT_NODE_TYPES.has(node.classType)) {
      return {
        outputNode: { nodeId: node.nodeId },
        filenamePrefix: { nodeId: node.nodeId, inputKey: 'filename_prefix' },
        outputFormat: 'video',
      };
    }
  }

  // Check image outputs
  for (const node of nodes) {
    if (IMAGE_OUTPUT_NODE_TYPES.has(node.classType)) {
      return {
        outputNode: { nodeId: node.nodeId },
        filenamePrefix: { nodeId: node.nodeId, inputKey: 'filename_prefix' },
        outputFormat: 'image',
      };
    }
  }

  return { outputFormat: 'image' };
}

/**
 * Infer workflow type from detected features.
 */
function inferWorkflowType(
  outputFormat: 'image' | 'video',
  inputImages: ParameterMapping[],
): {
  workflowType: 'image_generation' | 'image_editing' | 'video_generation';
  confidence: 'high' | 'medium' | 'low';
} {
  if (outputFormat === 'video') {
    return { workflowType: 'video_generation', confidence: 'high' };
  }

  if (inputImages.length > 0) {
    return { workflowType: 'image_editing', confidence: 'medium' };
  }

  return { workflowType: 'image_generation', confidence: 'high' };
}

// ── Main analyzer ──────────────────────────────────────────────────────────────

/**
 * Analyze a ComfyUI API-format workflow and produce a WorkflowManifest.
 *
 * @param apiWorkflow - The workflow in API format ({nodeId: {class_type, inputs}}).
 *                      If LiteGraph format is passed, it will be auto-converted.
 * @param name - Slug name for the workflow (e.g., "my-anime-workflow")
 * @param displayName - Human-readable name
 * @param description - Description of what the workflow does
 */
export function analyzeWorkflow(
  rawWorkflow: unknown,
  name: string,
  displayName?: string,
  description?: string,
): WorkflowManifest {
  const apiWorkflow = ensureApiFormat(rawWorkflow);
  const nodes = extractNodes(apiWorkflow);
  const notes: string[] = [];

  // Detect all parameter mappings
  const promptResult = detectPromptNodes(nodes);
  notes.push(...promptResult.notes);

  const seed = detectSeedNode(nodes);
  if (!seed) notes.push('No seed node detected — workflow will use its own default');

  const dimensions = detectDimensionNode(nodes);
  const inputImages = detectInputImageNodes(nodes);
  const outputResult = detectOutputNode(nodes);

  if (!outputResult.outputNode) {
    notes.push('No output node detected — workflow may not produce downloadable output');
  }

  const typeResult = inferWorkflowType(outputResult.outputFormat, inputImages);
  notes.push(...(typeResult.confidence !== 'high' ? [`Workflow type '${typeResult.workflowType}' inferred with ${typeResult.confidence} confidence`] : []));

  // Compute overall prompt detection confidence
  const promptConfidence = promptResult.confidence;
  const typeConfidence = typeResult.confidence;

  return {
    name,
    displayName: displayName || name,
    description: description || `Custom ${typeResult.workflowType} workflow`,
    workflowType: typeResult.workflowType,
    outputFormat: outputResult.outputFormat,
    qualityLevel: 'standard',
    estimatedTimeSeconds: outputResult.outputFormat === 'video' ? 60 : 30,

    parameterMap: {
      positivePrompt: promptResult.positive,
      negativePrompt: promptResult.negative,
      seed,
      width: dimensions.width,
      height: dimensions.height,
      inputImages: inputImages.length > 0 ? inputImages : undefined,
      outputNode: outputResult.outputNode,
      filenamePrefix: outputResult.filenamePrefix,
    },

    confidence: {
      promptDetection: promptConfidence,
      typeDetection: typeConfidence,
      notes,
    },
  };
}
