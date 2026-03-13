/**
 * Workflow Registry - Central system for managing multiple ComfyUI workflows.
 *
 * Provides workflow discovery, selection, and metadata management
 * to enable agents to choose the right workflow for each task.
 */

export enum WorkflowType {
  IMAGE_GENERATION = 'image_generation',
  IMAGE_EDITING = 'image_editing',
  VIDEO_GENERATION = 'video_generation',
}

export interface WorkflowMetadata {
  name: string;
  filename: string;
  workflowType: WorkflowType;
  description: string;
  capabilities: string[];
  displayName: string;

  // Input requirements
  requiresBaseImage: boolean;
  supportsTextPrompts: boolean;
  supportsImageToImage: boolean;

  // Output characteristics
  outputFormat: 'image' | 'video';

  // Performance characteristics
  estimatedTimeSeconds: number;
  qualityLevel: 'draft' | 'standard' | 'high' | 'ultra';
}

/**
 * Registry for managing multiple ComfyUI workflows.
 */
class WorkflowRegistry {
  private workflows: Map<string, WorkflowMetadata> = new Map();

  constructor() {
    this.registerBuiltinWorkflows();
  }

  private registerBuiltinWorkflows(): void {
    // 1. Z-Image Turbo - Fast high-quality image generation (default)
    this.register({
      name: 'zimage',
      filename: 'zimage_standard.json',
      workflowType: WorkflowType.IMAGE_GENERATION,
      description: 'Fast high-quality image generation using Z-Image Turbo model with Qwen text encoder. Best for creating scene images quickly with excellent quality.',
      capabilities: [
        'text-to-image',
        'fast-generation',
        'high-quality-rendering',
        'scene-creation',
      ],
      displayName: 'Z-Image Turbo',
      requiresBaseImage: false,
      supportsTextPrompts: true,
      supportsImageToImage: false,
      outputFormat: 'image',
      estimatedTimeSeconds: 15,
      qualityLevel: 'high',
    });

    // 2. Chroma-Radiance - Base image generation (legacy)
    this.register({
      name: 'chroma_radiance',
      filename: 'Chroma-Radiance_00548_.json',
      workflowType: WorkflowType.IMAGE_GENERATION,
      description: 'High-quality base image generation using Chroma-Radiance model. Best for creating initial scene images from text descriptions.',
      capabilities: [
        'text-to-image',
        'high-quality-rendering',
        'photorealistic-output',
        'scene-creation',
      ],
      displayName: 'Chroma Radiance',
      requiresBaseImage: false,
      supportsTextPrompts: true,
      supportsImageToImage: false,
      outputFormat: 'image',
      estimatedTimeSeconds: 45,
      qualityLevel: 'high',
    });

    // 3. FireRed Edit Lightning - Fast image editing with up to 3 reference images (default)
    this.register({
      name: 'qwen_edit',
      filename: 'qwen_edit-lightning.json',
      workflowType: WorkflowType.IMAGE_EDITING,
      description: 'Fast intelligent image editing using FireRed Image Edit 1.1 with Lightning acceleration. Supports 1-3 input images for editing, combining, or transforming visuals based on text instructions. Use for scene generation with character/setting references.',
      capabilities: [
        'image-to-image',
        'multi-image-input',
        'intelligent-editing',
        'scene-variation',
        'visual-modification',
        'consistency-preservation',
        'reference-based-generation',
      ],
      displayName: 'FireRed Image Editor (Lightning)',
      requiresBaseImage: true,
      supportsTextPrompts: true,
      supportsImageToImage: true,
      outputFormat: 'image',
      estimatedTimeSeconds: 15,
      qualityLevel: 'high',
    });

    // 3b. Qwen Edit Simple - Slower but higher quality variant
    this.register({
      name: 'qwen_edit_hq',
      filename: 'qwen_edit-simple.json',
      workflowType: WorkflowType.IMAGE_EDITING,
      description: 'High-quality image editing using Qwen model (slower). Supports 1-3 input images. Use when quality is more important than speed.',
      capabilities: [
        'image-to-image',
        'multi-image-input',
        'intelligent-editing',
        'scene-variation',
        'visual-modification',
        'consistency-preservation',
        'reference-based-generation',
      ],
      displayName: 'Qwen Image Editor (HQ)',
      requiresBaseImage: true,
      supportsTextPrompts: true,
      supportsImageToImage: true,
      outputFormat: 'image',
      estimatedTimeSeconds: 60,
      qualityLevel: 'ultra',
    });

    // 4. LTX-2.3 GGUF - Video generation (supports both I2V and T2V via toggle)
    this.register({
      name: 'ltx23',
      filename: 'video_ltx23_gguf.json',
      workflowType: WorkflowType.VIDEO_GENERATION,
      description: 'Generate video using LTX-2.3 GGUF model. Supports both image-to-video and text-to-video modes via a toggle. Duration in seconds (1-20). Uses GGUF quantized models for efficient generation.',
      capabilities: [
        'single-image-to-video',
        'text-to-video',
        'motion-from-prompt',
        'fast-generation',
        'camera-movement',
        'character-animation',
        'configurable-duration',
      ],
      displayName: 'LTX-2.3 Video (GGUF)',
      requiresBaseImage: false,
      supportsTextPrompts: true,
      supportsImageToImage: true,
      outputFormat: 'video',
      estimatedTimeSeconds: 60,
      qualityLevel: 'standard',
    });
  }

  /**
   * Register a workflow with its metadata.
   */
  register(metadata: WorkflowMetadata): void {
    this.workflows.set(metadata.name, metadata);
  }

  /**
   * Get workflow metadata by name.
   */
  get(name: string): WorkflowMetadata | undefined {
    return this.workflows.get(name);
  }

  /**
   * Get list of all registered workflows.
   */
  listAll(): WorkflowMetadata[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Get workflows of a specific type.
   */
  listByType(workflowType: WorkflowType): WorkflowMetadata[] {
    return this.listAll().filter(wf => wf.workflowType === workflowType);
  }

  /**
   * Intelligently select the best workflow for a task.
   */
  selectWorkflow(
    task: string,
    hasBaseImage: boolean = false,
    preferSpeed: boolean = false
  ): WorkflowMetadata | undefined {
    const taskLower = task.toLowerCase();

    // Determine workflow type from task description
    let workflowType: WorkflowType;
    if (['video', 'animate', 'motion', 'movie'].some(kw => taskLower.includes(kw))) {
      workflowType = WorkflowType.VIDEO_GENERATION;
    } else if (['edit', 'modify', 'change', 'adjust', 'variation', 'refine'].some(kw => taskLower.includes(kw))) {
      workflowType = WorkflowType.IMAGE_EDITING;
    } else {
      workflowType = WorkflowType.IMAGE_GENERATION;
    }

    // Get candidates
    let candidates = this.listByType(workflowType);

    // Filter by base image requirement
    if (workflowType === WorkflowType.IMAGE_EDITING && !hasBaseImage) {
      candidates = this.listByType(WorkflowType.IMAGE_GENERATION);
    }

    if (!candidates.length) {
      return undefined;
    }

    // Sort by preference
    if (preferSpeed) {
      candidates.sort((a, b) => a.estimatedTimeSeconds - b.estimatedTimeSeconds);
    } else {
      const qualityOrder: Record<string, number> = { ultra: 4, high: 3, standard: 2, draft: 1 };
      candidates.sort((a, b) =>
        (qualityOrder[b.qualityLevel] || 0) - (qualityOrder[a.qualityLevel] || 0)
      );
    }

    return candidates[0];
  }

  /**
   * Get the best workflow for generating a specific scene.
   */
  getWorkflowForScene(
    sceneNumber: number,
    hasPreviousScene: boolean = false,
    preferConsistency: boolean = true
  ): WorkflowMetadata {
    // First scene always uses base image generation
    if (sceneNumber === 1 || !hasPreviousScene) {
      return this.get('zimage')!;
    }

    // Subsequent scenes can use editing for consistency
    if (preferConsistency && hasPreviousScene) {
      return this.get('qwen_edit')!;
    }

    // Otherwise use base generation
    return this.get('zimage')!;
  }

  /**
   * Export registry to dictionary format for agents.
   */
  toDict(): { workflows: Array<Record<string, unknown>> } {
    return {
      workflows: this.listAll().map(wf => ({
        name: wf.name,
        filename: wf.filename,
        type: wf.workflowType,
        description: wf.description,
        capabilities: wf.capabilities,
        requires_base_image: wf.requiresBaseImage,
        supports_text_prompts: wf.supportsTextPrompts,
        output_format: wf.outputFormat,
        estimated_time: `${wf.estimatedTimeSeconds}s`,
        quality: wf.qualityLevel,
      })),
    };
  }
}

// Global singleton registry
const registry = new WorkflowRegistry();

export function getRegistry(): WorkflowRegistry {
  return registry;
}

export { WorkflowRegistry };
