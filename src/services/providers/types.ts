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
  type: 'character' | 'setting' | 'establishing';
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
  seed?: number;
  /** Directory where the output file should be saved */
  outputDir: string;
  /** Optional filename prefix */
  filenamePrefix?: string;
  /** Reference images for consistency (image+text-to-image mode) */
  referenceImages?: ProviderReferenceImage[];
  /** Optional workflow name override (for custom workflows) */
  workflowName?: string;
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
  /** Absolute path to the source image */
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
  /** Optional workflow name override (for custom workflows) */
  workflowName?: string;
}

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
