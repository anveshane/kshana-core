/**
 * WorkflowParser — parses ComfyUI workflow JSON to extract input nodes
 * and auto-detect pipeline type. Optionally uses LLM for intelligent
 * analysis of the workflow graph.
 */

import type { LLMClient } from '../../core/llm/index.js';

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

// ---------------------------------------------------------------------------
// LLM-assisted workflow analysis
// ---------------------------------------------------------------------------

export interface WorkflowAnalysis {
  /** LLM-suggested pipeline type */
  pipeline: string;
  /** Human-readable display name */
  displayName: string;
  /** What this workflow does (2-3 sentences for LLM prompt injection) */
  llmDescription: string;
  /** When to choose this workflow (selection guidance for LLM) */
  selectionCriteria: string;
  /** Suggested input mappings: nodeId → standard input name */
  suggestedMappings: Array<{ nodeId: string; classType: string; suggestedInput: string; reason: string }>;
  /** Brief explanation of how the workflow works */
  explanation: string;
}

/**
 * Use an LLM to analyze a ComfyUI workflow and generate intelligent suggestions
 * for the integration wizard. The LLM reads the node graph topology and understands
 * what each node does, producing much better results than pattern matching.
 */
export async function analyzeWorkflowWithLLM(
  workflowJson: string,
  parsed: ParsedWorkflow,
  llm: LLMClient,
): Promise<WorkflowAnalysis> {
  // Build a compact summary of the node graph for the LLM
  const data = JSON.parse(workflowJson);
  const isLiteGraph = Array.isArray(data.nodes);

  let nodeSummary: string;
  if (isLiteGraph) {
    // Summarize LiteGraph nodes: id, type, title, connections
    const nodeList = data.nodes.map((n: any) => {
      const connections = (n.inputs || [])
        .filter((inp: any) => inp.link !== null && inp.link !== undefined)
        .map((inp: any) => `${inp.name}←link${inp.link}`)
        .join(', ');
      return `  Node ${n.id}: ${n.type}${n.title && n.title !== n.type ? ` "${n.title}"` : ''}${connections ? ` [${connections}]` : ''}${n.mode === 4 ? ' (BYPASSED)' : ''}`;
    }).join('\n');
    nodeSummary = `LiteGraph format, ${data.nodes.length} nodes:\n${nodeList}`;
  } else {
    // API format
    const nodeList = Object.entries(data).map(([id, node]: [string, any]) => {
      const inputs = node.inputs ? Object.entries(node.inputs)
        .filter(([, v]: [string, any]) => Array.isArray(v)) // linked inputs
        .map(([k, v]: [string, any]) => `${k}←node${v[0]}`)
        .join(', ') : '';
      return `  Node ${id}: ${node.class_type}${inputs ? ` [${inputs}]` : ''}`;
    }).join('\n');
    nodeSummary = `API format, ${Object.keys(data).length} nodes:\n${nodeList}`;
  }

  // List the input nodes we found
  const inputNodeSummary = parsed.inputNodes.map(n =>
    `  Node ${n.nodeId}: ${n.classType} "${n.title}" (${n.inputType})`
  ).join('\n');

  const systemPrompt = `You are an expert in ComfyUI workflows. Analyze this workflow and provide structured information for integrating it into an AI video production system.

The system has 4 pipeline types:
- image_generation: Creates images from text (e.g., Stable Diffusion, FLUX)
- image_editing: Modifies images with references (e.g., inpainting, style transfer, SAM+edit)
- image_processing: Preprocesses images for video (e.g., depth extraction, segmentation, ControlNet prep)
- video_generation: Creates video from images/text (e.g., LTX, AnimateDiff, SVD)

Standard input names the system supports:
- prompt: Text prompt for generation
- negative_prompt: Negative text prompt
- first_frame: First frame image for video generation
- last_frame: Last frame image for video generation
- mid_frame: Mid-point frame image
- base_image: Input image for editing/processing
- reference_image_1, reference_image_2: Reference images for consistency
- edit_prompt: Text describing what to change
- mask: Segmentation mask
- seed: Random seed
- width, height: Output dimensions
- durationSeconds: Video duration
- filenamePrefix: Output filename prefix

Respond ONLY with a JSON object (no markdown fences).`;

  const userPrompt = `Analyze this ComfyUI workflow:

${nodeSummary}

Input nodes detected:
${inputNodeSummary}

Output types detected: ${parsed.outputTypes.join(', ') || 'none detected'}
Heuristic pipeline guess: ${parsed.detectedPipeline}

Respond with this JSON structure:
{
  "pipeline": "image_generation|image_editing|image_processing|video_generation",
  "displayName": "Human-readable name for this workflow",
  "llmDescription": "2-3 sentences describing what this workflow does, written for an AI that needs to decide whether to use it",
  "selectionCriteria": "When should this workflow be chosen over alternatives",
  "suggestedMappings": [
    { "nodeId": "123", "classType": "LoadImage", "suggestedInput": "first_frame", "reason": "This is the primary image input feeding into the video sampler" }
  ],
  "explanation": "Brief technical explanation of how this workflow works"
}`;

  const response = await llm.generate({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
  });

  let content = (response.content || '').trim();
  // Strip markdown fences if present
  if (content.startsWith('```')) {
    content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  return JSON.parse(content) as WorkflowAnalysis;
}
