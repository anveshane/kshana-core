/**
 * Provider abstraction types for image and video generation.
 * Supports multiple backends (ComfyUI, Google, xAI) with a unified interface.
 */

/**
 * Capabilities a provider can support.
 */
export type GenerationCapability = 'image_generation' | 'image_editing' | 'video_generation';

/**
 * Unified progress info emitted during generation.
 */
export interface ProviderProgressInfo {
  percentage: number;
  message: string;
  done: boolean;
  step?: number;
  maxSteps?: number;
}

/**
 * Result of any generation operation.
 */
export interface GenerationResult {
  /** Absolute path to the generated file */
  filePath: string;
  /** MIME type of the output */
  mimeType: string;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Reference image for consistency in generation.
 */
export interface ProviderReferenceImage {
  /** Absolute path to the reference image file */
  filePath: string;
  /** Type of reference */
  type: 'character' | 'setting';
  /** Name of the character or setting */
  name: string;
}

/**
 * Input for image generation.
 */
export interface ImageGenerationInput {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  /** Override width in pixels (takes precedence over aspectRatio) */
  width?: number;
  /** Override height in pixels (takes precedence over aspectRatio) */
  height?: number;
  seed?: number;
  /** Directory where the output file should be saved */
  outputDir: string;
  /** Optional filename prefix */
  filenamePrefix?: string;
  /** Reference images for consistency (image+text-to-image mode) */
  referenceImages?: ProviderReferenceImage[];
}

/**
 * Input for image editing.
 */
export interface ImageEditInput {
  editPrompt: string;
  /** Absolute path to the base image to edit */
  baseImagePath: string;
  /** Additional reference images (up to 2) */
  referenceImages?: string[];
  negativePrompt?: string;
  aspectRatio?: string;
  seed?: number;
  /** Directory where the output file should be saved */
  outputDir: string;
  /** Optional filename prefix */
  filenamePrefix?: string;
}

/**
 * Input for video generation from an image.
 */
export interface VideoGenerationInput {
  /** Absolute path to the source image (backward compat — first frame) */
  sourceImagePath: string;
  /** Motion/animation prompt */
  prompt: string;
  /** Duration in seconds */
  durationSeconds?: number;
  width?: number;
  height?: number;
  seed?: number;
  /** Directory where the output file should be saved */
  outputDir: string;
  /** Optional filename prefix */
  filenamePrefix?: string;
  /** Additional frame images keyed by input requirement ID (e.g., { last_frame: "/path/to/last.png" }) */
  frameImages?: Record<string, string>;
  /** Workflow mode ID for routing to the correct workflow */
  modeId?: string;
  /** Absolute path to source video for V2V extend (previous shot's video) */
  sourceVideoPath?: string;
}

// ---------------------------------------------------------------------------
// Workflow Mode types — capability-based routing
// ---------------------------------------------------------------------------

/** Which pipeline stage a workflow belongs to */
export type WorkflowPipeline = 'image_generation' | 'image_editing' | 'image_processing' | 'video_generation';

/** Where an input comes from at runtime */
export type InputSource =
  | 'shot_image'            // from generated shot image(s)
  | 'shot_video'            // from previous shot video (v2v extend)
  | 'shot_motion_directive' // from motion directive text
  | 'image_processing'      // from stage 4 output (chaining)
  | 'llm'                   // LLM generates at runtime
  | 'user'                  // user provides at project setup
  | 'system';               // system params (seed, width, height, duration, prefix)

/** A single input that a workflow requires */
export interface InputRequirement {
  /** Identifier matching parameterMappings (e.g., 'first_frame', 'prompt') */
  id: string;
  /** Data type */
  type: 'image' | 'video' | 'text' | 'number' | 'mask' | 'depth_map';
  /** Where the executor should resolve this input from */
  source: InputSource;
  /** Human-readable description (shown in wizard + used by LLM) */
  description: string;
  /** Whether this input is required or optional */
  required: boolean;
}

/** Maps an input requirement to a specific ComfyUI node */
export interface ParameterMapping {
  /** Input requirement ID (must match an inputRequirement.id or a system param) */
  input: string;
  /** ComfyUI node ID in the workflow */
  nodeId: string;
  /** Field name on the node's inputs/widgets */
  field: string;
  /** Default value to use when the input is not provided at runtime */
  defaultValue?: unknown;
}

/**
 * Unified workflow manifest — describes what a workflow does,
 * what it needs, and how to parameterize it.
 * Lives as a `*.manifest.json` sidecar next to the workflow JSON.
 */
export interface WorkflowManifest {
  /** Unique mode ID (e.g., 'i2v', 'flfv', 'sam_inpaint') */
  id: string;
  /** Human-readable name */
  displayName: string;
  /** Which pipeline stage: video_generation or image_processing */
  pipeline: WorkflowPipeline;
  /** 2-3 sentence description for the LLM to understand what this mode does */
  llmDescription: string;
  /** When the LLM should choose this mode (selection guidance) */
  selectionCriteria: string;
  /** What the workflow produces */
  outputType: 'video' | 'image';
  /** Priority for tie-breaking (lower = preferred) */
  priority: number;

  /** What inputs the workflow needs */
  inputRequirements: InputRequirement[];

  /** ComfyUI workflow filename (relative to same directory) */
  workflowFile: string;
  /** Workflow format: 'litegraph' (node editor) or 'api' (API format) */
  format: 'litegraph' | 'api';
  /** Maps inputs to ComfyUI node IDs */
  parameterMappings: ParameterMapping[];

  /** Keywords to inject into prompts for LoRA activation or style triggers */
  promptKeywords?: {
    /** Keywords prepended to the prompt (e.g., "GHIBSKY style, ") */
    prepend?: string;
    /** Keywords appended to the prompt (e.g., ", in the style of ohwx") */
    append?: string;
    /** Keywords added to negative prompt */
    negativeAppend?: string;
  };

  /**
   * Generation strategies this workflow supports (e.g., ['i2v', 't2v', 'flfv']).
   * Used for routing: when the LLM picks a strategy per shot, the system finds
   * the best workflow that supports that strategy.
   *
   * Inferred from inputRequirements if not explicitly set:
   * - Has shot_image inputs → supports 'i2v'
   * - Has no shot_image inputs → supports 't2v'
   * - Has 'last_frame' input → also supports 'flfv'
   * - Has 'mid_frame' input → also supports 'fmlfv'
   */
  strategies?: string[];

  /** Whether this is a built-in workflow (immutable, always present, cannot be removed) */
  builtIn?: boolean;
  /** Whether this mode is currently active (built-ins are always active) */
  active?: boolean;
  /** Whether this is a user-selected override for its pipeline (overrides the built-in default) */
  isOverride?: boolean;
  /** Which ComfyUI mode this workflow is for: "local", "cloud", or "both" (default) */
  mode?: 'local' | 'cloud' | 'both';
}

/**
 * A manifest file can contain a single mode or an array of modes
 * (when one workflow supports multiple generation strategies).
 */
export type WorkflowManifestFile = WorkflowManifest | WorkflowManifest[];

/**
 * Progress callback type.
 */
export type ProviderProgressCallback = (info: ProviderProgressInfo) => void;

/**
 * Interface that all generation providers must implement.
 */
export interface GenerationProvider {
  /** Unique identifier for this provider */
  readonly id: string;
  /** Human-readable name */
  readonly displayName: string;
  /** Capabilities this provider supports */
  readonly capabilities: GenerationCapability[];

  /**
   * Check if this provider is available (API keys set, service reachable, etc.).
   */
  isAvailable(): boolean;

  /**
   * Generate an image from a text prompt.
   * Only callable if capabilities includes 'image_generation'.
   */
  generateImage?(
    input: ImageGenerationInput,
    onProgress?: ProviderProgressCallback,
  ): Promise<GenerationResult>;

  /**
   * Edit an existing image.
   * Only callable if capabilities includes 'image_editing'.
   */
  editImage?(
    input: ImageEditInput,
    onProgress?: ProviderProgressCallback,
  ): Promise<GenerationResult>;

  /**
   * Generate a video from an image.
   * Only callable if capabilities includes 'video_generation'.
   */
  generateVideo?(
    input: VideoGenerationInput,
    onProgress?: ProviderProgressCallback,
  ): Promise<GenerationResult>;
}
