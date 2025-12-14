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

    // 3. Qwen Edit Simple - Image editing with up to 3 reference images
    this.register({
      name: 'qwen_edit',
      filename: 'qwen_edit-simple.json',
      workflowType: WorkflowType.IMAGE_EDITING,
      description: 'Intelligent image editing using Qwen model. Supports 1-3 input images for editing, combining, or transforming visuals based on text instructions. Use for scene generation with character/setting references.',
      capabilities: [
        'image-to-image',
        'multi-image-input',
        'intelligent-editing',
        'scene-variation',
        'visual-modification',
        'consistency-preservation',
        'reference-based-generation',
      ],
      displayName: 'Qwen Image Editor',
      requiresBaseImage: true,
      supportsTextPrompts: true,
      supportsImageToImage: true,
      outputFormat: 'image',
      estimatedTimeSeconds: 35,
      qualityLevel: 'high',
    });

    // 4. Wan 2.2 Lightning - Video generation (legacy - kept for compatibility)
    this.register({
      name: 'wan_lightning',
      filename: 'Wan 2.2 Lightning Standard.json',
      workflowType: WorkflowType.VIDEO_GENERATION,
      description: 'Fast video generation using Wan 2.2 Lightning model. Convert image sequences into smooth videos with motion and transitions.',
      capabilities: [
        'image-to-video',
        'motion-generation',
        'fast-processing',
        'smooth-transitions',
        'sequence-animation',
      ],
      displayName: 'Wan Lightning Video',
      requiresBaseImage: true,
      supportsTextPrompts: false,
      supportsImageToImage: true,
      outputFormat: 'video',
      estimatedTimeSeconds: 60,
      qualityLevel: 'standard',
    });

    // 5. Wan Single Image - Video from single image with motion prompt
    this.register({
      name: 'wan_single_image',
      filename: 'wan-singleimage.json',
      workflowType: WorkflowType.VIDEO_GENERATION,
      description: 'Generate video from a single image with motion guided by a text prompt. Best for animating static images with camera movements, character motion, or environmental effects.',
      capabilities: [
        'single-image-to-video',
        'motion-from-prompt',
        'camera-movement',
        'character-animation',
        'environmental-effects',
      ],
      displayName: 'Wan Single Image Video',
      requiresBaseImage: true,
      supportsTextPrompts: true,
      supportsImageToImage: true,
      outputFormat: 'video',
      estimatedTimeSeconds: 90,
      qualityLevel: 'standard',
    });

    // 6. Wan Start-End - Video interpolation between two frames
    this.register({
      name: 'wan_start_end',
      filename: 'wan start-end.json',
      workflowType: WorkflowType.VIDEO_GENERATION,
      description: 'Generate video by interpolating between a start frame and end frame. Best for creating smooth transitions between two keyframes, scene transitions, or morphing effects.',
      capabilities: [
        'frame-interpolation',
        'start-end-video',
        'smooth-transitions',
        'keyframe-animation',
        'scene-morphing',
      ],
      displayName: 'Wan Start-End Video',
      requiresBaseImage: true,
      supportsTextPrompts: true,
      supportsImageToImage: true,
      outputFormat: 'video',
      estimatedTimeSeconds: 120,
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
