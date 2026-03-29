/**
 * WorkflowParser — parses ComfyUI workflow JSON to extract input nodes
 * and auto-detect pipeline type. Used by the workflow integration wizard.
 */

export interface ParsedNode {
  /** Node ID in the workflow */
  nodeId: string;
  /** ComfyUI class type (e.g., 'LoadImage', 'CLIPTextEncode') */
  classType: string;
  /** Human-readable title (from node.title or generated) */
  title: string;
  /** Suggested standard input mapping */
  suggestedInput?: string;
  /** What kind of input this is */
  inputType: 'image' | 'text' | 'number' | 'other';
}

export interface ParsedWorkflow {
  /** Auto-detected pipeline type */
  detectedPipeline: 'image_generation' | 'image_editing' | 'video_generation' | 'unknown';
  /** Input nodes the user needs to map */
  inputNodes: ParsedNode[];
  /** Total node count */
  totalNodes: number;
  /** Output node types found */
  outputTypes: string[];
}

/** Node types that represent user-configurable inputs */
const INPUT_NODE_TYPES: Record<string, { inputType: ParsedNode['inputType']; suggestedInput?: string }> = {
  'LoadImage': { inputType: 'image', suggestedInput: 'first_frame' },
  'CLIPTextEncode': { inputType: 'text', suggestedInput: 'prompt' },
  'INTConstant': { inputType: 'number' },
  'PrimitiveBoolean': { inputType: 'other' },
  'KSampler': { inputType: 'number', suggestedInput: 'seed' },
  'RandomNoise': { inputType: 'number', suggestedInput: 'seed' },
  'EmptySD3LatentImage': { inputType: 'number', suggestedInput: 'width' },
  'EmptyLatentImage': { inputType: 'number', suggestedInput: 'width' },
  'SaveImage': { inputType: 'text', suggestedInput: 'filenamePrefix' },
  'VHS_VideoCombine': { inputType: 'text', suggestedInput: 'filenamePrefix' },
  'TextEncodeQwenImageEditPlus': { inputType: 'text', suggestedInput: 'prompt' },
};

/** Node types that indicate output — used to auto-detect pipeline type */
const OUTPUT_INDICATORS: Record<string, string> = {
  'VHS_VideoCombine': 'video_generation',
  'SaveAnimatedWEBP': 'video_generation',
  'SaveImage': 'image_generation',
  'LTXVImgToVideoInplace': 'video_generation',
};

/**
 * Parse a ComfyUI workflow JSON (LiteGraph or API format) and extract
 * mappable input nodes + auto-detect pipeline type.
 */
export function parseWorkflow(workflowJson: string): ParsedWorkflow {
  const data = JSON.parse(workflowJson);

  // Detect format: LiteGraph has 'nodes' array, API format is flat node map
  const isLiteGraph = Array.isArray(data.nodes);

  const inputNodes: ParsedNode[] = [];
  const outputTypes: string[] = [];
  let totalNodes = 0;

  if (isLiteGraph) {
    // LiteGraph format: { nodes: [...], links: [...] }
    totalNodes = data.nodes.length;
    for (const node of data.nodes) {
      const classType = node.type || '';
      const nodeId = String(node.id);
      const title = node.title || classType;

      // Check if this is an output node
      if (OUTPUT_INDICATORS[classType]) {
        outputTypes.push(OUTPUT_INDICATORS[classType]);
      }

      // Check if this is a configurable input node
      const inputInfo = INPUT_NODE_TYPES[classType];
      if (inputInfo) {
        // Skip bypassed nodes (mode = 4)
        if (node.mode === 4) continue;

        inputNodes.push({
          nodeId,
          classType,
          title,
          suggestedInput: inputInfo.suggestedInput,
          inputType: inputInfo.inputType,
        });
      }
    }
  } else {
    // API format: { "nodeId": { class_type, inputs: {} }, ... }
    const nodeEntries = Object.entries(data);
    totalNodes = nodeEntries.length;
    for (const [nodeId, nodeData] of nodeEntries) {
      const node = nodeData as { class_type?: string; _meta?: { title?: string } };
      const classType = node.class_type || '';
      const title = node._meta?.title || classType;

      if (OUTPUT_INDICATORS[classType]) {
        outputTypes.push(OUTPUT_INDICATORS[classType]);
      }

      const inputInfo = INPUT_NODE_TYPES[classType];
      if (inputInfo) {
        inputNodes.push({
          nodeId,
          classType,
          title,
          suggestedInput: inputInfo.suggestedInput,
          inputType: inputInfo.inputType,
        });
      }
    }
  }

  // Auto-detect pipeline type from output nodes
  let detectedPipeline: ParsedWorkflow['detectedPipeline'] = 'unknown';
  if (outputTypes.includes('video_generation')) {
    detectedPipeline = 'video_generation';
  } else if (outputTypes.includes('image_generation')) {
    // If there are LoadImage nodes, it's likely editing; otherwise generation
    const hasImageInputs = inputNodes.some(n => n.classType === 'LoadImage');
    detectedPipeline = hasImageInputs ? 'image_editing' : 'image_generation';
  }

  return { detectedPipeline, inputNodes, totalNodes, outputTypes };
}
