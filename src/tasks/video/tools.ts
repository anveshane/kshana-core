/**
 * Video generation tools for the video creation task.
 * These tools integrate with external services (ComfyUI, etc.) for actual generation.
 */
import { createTool } from '../../core/tools/index.js';
import type { ToolDefinition } from '../../core/llm/index.js';

/**
 * Job status for async generation tasks.
 */
export interface GenerationJob {
  id: string;
  type: 'image' | 'video';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  result?: {
    artifactId: string;
    url?: string;
    path?: string;
  };
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Reference image for consistency in scene generation.
 */
export interface ReferenceImage {
  /** Artifact ID or path to the reference image */
  image_id: string;
  /** Type of reference: character or setting */
  type: 'character' | 'setting';
  /** Name of the character or setting this references */
  name: string;
}

/**
 * Image generation parameters.
 */
export interface ImageGenerationParams {
  scene_number: number;
  prompt: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  seed?: number;
  image_type?: 'scene' | 'character_ref' | 'setting_ref';
  character_name?: string;
  setting_name?: string;
  /** Reference images for consistency (used for scene generation) */
  reference_images?: ReferenceImage[];
  /** Generation mode: text-to-image or image+text-to-image */
  generation_mode?: 'text_to_image' | 'image_text_to_image';
}

/**
 * Video generation parameters.
 */
export interface VideoGenerationParams {
  scene_artifacts: string[];
  duration?: number;
  fps?: number;
  transition?: string;
}

/**
 * Image edit parameters.
 */
export interface ImageEditParams {
  scene_number: number;
  edit_prompt: string;
  base_image_path: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  seed?: number;
}

// Job storage (in-memory for now, could be Redis/DB in production)
const jobs = new Map<string, GenerationJob>();

/**
 * Generate image tool.
 * This is a COMPLEX tool - requires user confirmation.
 *
 * Supports two modes:
 * 1. text_to_image: Pure text-to-image generation (for reference images)
 * 2. image_text_to_image: Image+text-to-image with reference images for consistency (for scenes)
 */
export const generateImageTool: ToolDefinition = createTool(
  'generate_image',
  `Generate an image. Supports two modes:

1. **Text-to-Image** (generation_mode: "text_to_image"):
   - For character reference images
   - For setting reference images
   - No reference_images needed

2. **Image+Text-to-Image** (generation_mode: "image_text_to_image"):
   - For scene images that need character/setting consistency
   - Requires reference_images array with character and setting refs
   - Uses reference images to maintain visual consistency

The tool will return a job ID. Use wait_for_job to check completion.`,
  {
    type: 'object',
    properties: {
      scene_number: {
        type: 'number',
        description: 'Scene number (for scene images) or sequence number for reference images',
      },
      prompt: {
        type: 'string',
        description: 'Detailed image generation prompt describing the visual',
      },
      negative_prompt: {
        type: 'string',
        description: 'What to avoid in the image (optional)',
      },
      aspect_ratio: {
        type: 'string',
        description: 'Image aspect ratio (default: 16:9 for video scenes)',
        enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      },
      seed: {
        type: 'number',
        description: 'Random seed for reproducibility (optional)',
      },
      image_type: {
        type: 'string',
        description: 'Type of image being generated',
        enum: ['scene', 'character_ref', 'setting_ref'],
      },
      character_name: {
        type: 'string',
        description: 'Character name (required for character_ref type)',
      },
      setting_name: {
        type: 'string',
        description: 'Setting name (required for setting_ref type)',
      },
      generation_mode: {
        type: 'string',
        description: 'Generation mode: text_to_image for refs, image_text_to_image for scenes with refs',
        enum: ['text_to_image', 'image_text_to_image'],
      },
      reference_images: {
        type: 'array',
        description: 'Reference images for consistency (required for image_text_to_image mode)',
        items: {
          type: 'object',
          properties: {
            image_id: {
              type: 'string',
              description: 'Artifact ID or path to the reference image',
            },
            type: {
              type: 'string',
              enum: ['character', 'setting'],
              description: 'Type of reference',
            },
            name: {
              type: 'string',
              description: 'Name of the character or setting',
            },
          },
          required: ['image_id', 'type', 'name'],
        },
      },
    },
    required: ['scene_number', 'prompt'],
  },
  async (args) => {
    const params = args as unknown as ImageGenerationParams;

    // Determine generation mode based on image_type and reference_images
    const generationMode = params.generation_mode ??
      (params.image_type === 'scene' && params.reference_images?.length
        ? 'image_text_to_image'
        : 'text_to_image');

    // Validate reference images for image_text_to_image mode
    if (generationMode === 'image_text_to_image' && (!params.reference_images || params.reference_images.length === 0)) {
      return {
        status: 'error',
        error: 'Reference images are required for image_text_to_image mode. Please generate character and setting reference images first.',
        suggestion: 'Use dispatch_image_agent with image_type "character_ref" or "setting_ref" to create reference images first.',
      };
    }

    // Create a job for tracking
    const jobId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: GenerationJob = {
      id: jobId,
      type: 'image',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    jobs.set(jobId, job);

    // TODO: Integrate with actual image generation backend (ComfyUI, etc.)
    // For text_to_image: Use standard text-to-image pipeline
    // For image_text_to_image: Use IP-Adapter, ControlNet, or similar for character/setting consistency
    // Note: Avoid console.log during CLI operation as it interferes with Ink rendering

    // Simulate async processing (in real implementation, this would call ComfyUI API)
    setTimeout(() => {
      const j = jobs.get(jobId);
      if (j) {
        j.status = 'completed';
        j.updatedAt = Date.now();
        j.result = {
          artifactId: `artifact-${jobId}`,
          path: `/generated/images/${jobId}.png`,
        };
      }
    }, 2000);

    return {
      status: 'submitted',
      job_id: jobId,
      generation_mode: generationMode,
      message: generationMode === 'text_to_image'
        ? `Text-to-image generation job submitted. Use wait_for_job("${jobId}") to check status.`
        : `Image+text-to-image generation job submitted with ${params.reference_images?.length ?? 0} reference images. Use wait_for_job("${jobId}") to check status.`,
      params: {
        scene_number: params.scene_number,
        image_type: params.image_type ?? 'scene',
        prompt: params.prompt,
        generation_mode: generationMode,
        reference_count: params.reference_images?.length ?? 0,
        references: params.reference_images?.map(r => `${r.type}:${r.name}`) ?? [],
      },
    };
  }
);

/**
 * Generate video tool.
 * This is a COMPLEX tool - requires user confirmation.
 */
export const generateVideoTool: ToolDefinition = createTool(
  'generate_video',
  `Generate a video from scene images. This tool requires user confirmation before execution.

Compiles multiple scene images into a video clip with transitions.
The tool will return a job ID. Use wait_for_job to check completion.`,
  {
    type: 'object',
    properties: {
      scene_artifacts: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of artifact IDs (from generated images) to compile into video',
      },
      duration: {
        type: 'number',
        description: 'Duration per scene in seconds (default: 3)',
      },
      fps: {
        type: 'number',
        description: 'Frames per second (default: 24)',
      },
      transition: {
        type: 'string',
        description: 'Transition type between scenes',
        enum: ['fade', 'crossfade', 'cut', 'dissolve'],
      },
    },
    required: ['scene_artifacts'],
  },
  async (args) => {
    const params = args as unknown as VideoGenerationParams;

    if (!params.scene_artifacts || params.scene_artifacts.length === 0) {
      return {
        status: 'error',
        error: 'No scene artifacts provided. Generate scene images first.',
      };
    }

    // Create a job for tracking
    const jobId = `vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: GenerationJob = {
      id: jobId,
      type: 'video',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    jobs.set(jobId, job);

    // TODO: Integrate with actual video generation backend
    // Note: Avoid console.log during CLI operation as it interferes with Ink rendering

    // Simulate async processing
    setTimeout(() => {
      const j = jobs.get(jobId);
      if (j) {
        j.status = 'completed';
        j.updatedAt = Date.now();
        j.result = {
          artifactId: `artifact-${jobId}`,
          path: `/generated/videos/${jobId}.mp4`,
        };
      }
    }, 5000);

    return {
      status: 'submitted',
      job_id: jobId,
      message: `Video generation job submitted. Use wait_for_job("${jobId}") to check status.`,
      params: {
        scene_count: params.scene_artifacts.length,
        duration: params.duration ?? 3,
        transition: params.transition ?? 'crossfade',
      },
    };
  }
);

/**
 * Edit image tool.
 * This is a COMPLEX tool - requires user confirmation.
 */
export const editImageTool: ToolDefinition = createTool(
  'edit_image',
  `Edit an existing image based on a text prompt. This tool requires user confirmation before execution.

Uses inpainting/outpainting to modify specific parts of an image.
The tool will return a job ID. Use wait_for_job to check completion.`,
  {
    type: 'object',
    properties: {
      scene_number: {
        type: 'number',
        description: 'Scene number for the edited image',
      },
      edit_prompt: {
        type: 'string',
        description: 'Description of the edit to make',
      },
      base_image_path: {
        type: 'string',
        description: 'Path or artifact ID of the image to edit',
      },
      negative_prompt: {
        type: 'string',
        description: 'What to avoid in the edit (optional)',
      },
      aspect_ratio: {
        type: 'string',
        description: 'Output aspect ratio (default: same as input)',
        enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      },
      seed: {
        type: 'number',
        description: 'Random seed for reproducibility (optional)',
      },
    },
    required: ['scene_number', 'edit_prompt', 'base_image_path'],
  },
  async (args) => {
    const params = args as unknown as ImageEditParams;

    // Create a job for tracking
    const jobId = `edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: GenerationJob = {
      id: jobId,
      type: 'image',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    jobs.set(jobId, job);

    // TODO: Integrate with actual image editing backend
    // Note: Avoid console.log during CLI operation as it interferes with Ink rendering

    // Simulate async processing
    setTimeout(() => {
      const j = jobs.get(jobId);
      if (j) {
        j.status = 'completed';
        j.updatedAt = Date.now();
        j.result = {
          artifactId: `artifact-${jobId}`,
          path: `/generated/images/${jobId}.png`,
        };
      }
    }, 3000);

    return {
      status: 'submitted',
      job_id: jobId,
      message: `Image edit job submitted. Use wait_for_job("${jobId}") to check status.`,
      params: {
        scene_number: params.scene_number,
        base_image: params.base_image_path,
        edit_prompt: params.edit_prompt,
      },
    };
  }
);

/**
 * Wait for job tool.
 * Used to check the status of async generation jobs.
 */
export const waitForJobTool: ToolDefinition = createTool(
  'wait_for_job',
  `Wait for a generation job to complete and get the result.

Use this after submitting generate_image, generate_video, or edit_image to check status.`,
  {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'The job ID returned from a generation tool',
      },
    },
    required: ['job_id'],
  },
  async (args) => {
    const jobId = args['job_id'] as string;
    const job = jobs.get(jobId);

    if (!job) {
      return {
        status: 'error',
        error: `Job not found: ${jobId}`,
      };
    }

    return {
      job_id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      result: job.result,
      error: job.error,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
    };
  }
);

/**
 * Get all video generation tools.
 */
export function getVideoGenerationTools(): ToolDefinition[] {
  return [generateImageTool, generateVideoTool, editImageTool, waitForJobTool];
}

/**
 * Register video tools as complex tools.
 * These require user confirmation before execution.
 */
export const VIDEO_COMPLEX_TOOLS = new Set(['generate_image', 'generate_video', 'edit_image']);
