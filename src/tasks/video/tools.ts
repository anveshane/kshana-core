/**
 * Video generation tools for the video creation task.
 * These tools integrate with ComfyUI for actual image/video generation.
 */
import * as fs from 'fs';
import * as path from 'path';
import { nanoid } from 'nanoid';
import { createTool } from '../../core/tools/index.js';
import type { ToolDefinition } from '../../core/llm/index.js';
import {
  ComfyUIClient,
  loadWorkflowTemplate,
  parameterizeWorkflowByName,
  getRegistry,
} from '../../services/comfyui/index.js';
import {
  PROJECT_DIR,
  addAsset,
  loadProject,
  updateCharacter,
  updateSetting,
  updateScene,
} from './workflow/index.js';

/**
 * Context for linking artifacts to project entities.
 */
export interface ArtifactContext {
  /** Type of entity this artifact belongs to */
  entityType: 'scene' | 'character' | 'setting';
  /** Scene number (for scene images/videos) */
  sceneNumber?: number;
  /** Character name (for character reference images) */
  characterName?: string;
  /** Setting name (for setting reference images) */
  settingName?: string;
  /** Whether this is an image or video artifact */
  artifactType: 'image' | 'video';
}

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
  promptId?: string; // ComfyUI prompt ID
  /** Context for linking artifact to project */
  context?: ArtifactContext;
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

// Get the project assets directory
function getAssetsDir(): string {
  const assetsDir = path.join(process.cwd(), PROJECT_DIR, 'assets', 'images');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  return assetsDir;
}

/**
 * Submit an image generation job to ComfyUI.
 */
async function submitImageGeneration(params: ImageGenerationParams): Promise<{
  jobId: string;
  status: string;
  error?: string;
}> {
  const {
    scene_number,
    prompt,
    negative_prompt = '',
    aspect_ratio = '16:9',
    seed,
    image_type = 'scene',
    character_name,
    setting_name,
  } = params;

  // Determine filename prefix based on image type
  let filenamePrefix: string;
  let logDesc: string;

  if (image_type === 'character_ref' && character_name) {
    const cleanName = character_name.replace(/[^a-zA-Z0-9]/g, '');
    filenamePrefix = `CharRef_${cleanName}`;
    logDesc = `character reference for ${character_name}`;
  } else if (image_type === 'setting_ref' && setting_name) {
    const cleanName = setting_name.replace(/[^a-zA-Z0-9]/g, '');
    filenamePrefix = `SettingRef_${cleanName}`;
    logDesc = `setting reference for ${setting_name}`;
  } else {
    filenamePrefix = `Scene${scene_number}`;
    logDesc = `scene ${scene_number}`;
  }

  // Determine context for linking artifact to project
  let context: ArtifactContext;
  if (image_type === 'character_ref' && character_name) {
    context = { entityType: 'character', characterName: character_name, artifactType: 'image' };
  } else if (image_type === 'setting_ref' && setting_name) {
    context = { entityType: 'setting', settingName: setting_name, artifactType: 'image' };
  } else {
    context = { entityType: 'scene', sceneNumber: scene_number, artifactType: 'image' };
  }

  // Create job for tracking
  const jobId = `img-${Date.now()}-${nanoid(6)}`;
  const job: GenerationJob = {
    id: jobId,
    type: 'image',
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    context,
  };
  jobs.set(jobId, job);

  try {
    const registry = getRegistry();
    const workflowMetadata = registry.get('zimage');

    if (!workflowMetadata) {
      throw new Error("Workflow 'zimage' not found");
    }

    const template = loadWorkflowTemplate(workflowMetadata.filename);
    const workflow = parameterizeWorkflowByName('zimage', template, {
      sceneNumber: scene_number,
      prompt,
      negativePrompt: negative_prompt,
      aspectRatio: aspect_ratio,
      style: 'cinematic',
      seed,
      filenamePrefix,
    });

    // Queue workflow to ComfyUI
    const client = new ComfyUIClient({
      outputDir: getAssetsDir(),
    });

    const promptId = await client.queueWorkflow(workflow as Record<string, unknown>);

    // Update job with prompt ID
    job.promptId = promptId;
    job.status = 'processing';
    job.updatedAt = Date.now();

    return {
      jobId,
      status: 'submitted',
    };
  } catch (error) {
    job.status = 'failed';
    job.error = String(error);
    job.updatedAt = Date.now();

    return {
      jobId,
      status: 'error',
      error: String(error),
    };
  }
}

/**
 * Wait for a ComfyUI job to complete and download the result.
 */
async function waitForComfyUIJob(jobId: string, timeout: number = 300): Promise<{
  status: string;
  artifactId?: string;
  filePath?: string;
  error?: string;
}> {
  const job = jobs.get(jobId);
  if (!job) {
    return { status: 'error', error: `Job not found: ${jobId}` };
  }

  if (!job.promptId) {
    return { status: 'error', error: 'Job has no ComfyUI prompt ID' };
  }

  try {
    const assetsDir = getAssetsDir();
    const client = new ComfyUIClient({
      outputDir: assetsDir,
      timeout,
    });

    // Wait for completion
    const completionResult = await client.waitForCompletion(job.promptId, (pct, msg) => {
      job.progress = pct;
      job.updatedAt = Date.now();
    });

    if (completionResult.status !== 'completed' && completionResult.status !== 'completed_with_timeout') {
      job.status = 'failed';
      job.error = 'Job did not complete';
      job.updatedAt = Date.now();
      return { status: 'failed', error: 'Job did not complete' };
    }

    // Get output images
    const images = await client.getOutputImages(job.promptId);
    if (!images.length) {
      job.status = 'failed';
      job.error = 'No output images found';
      job.updatedAt = Date.now();
      return { status: 'failed', error: 'No output images found' };
    }

    // Download first image
    const firstImage = images[0]!;
    const outputFilename = `${nanoid(8)}_${firstImage.filename}`;
    const savedPath = await client.downloadImage(
      firstImage.filename,
      firstImage.subfolder,
      firstImage.type,
      outputFilename
    );

    // Create artifact ID
    const artifactId = `img_${nanoid(8)}`;

    // Get relative path for storage
    const projectDir = path.join(process.cwd(), PROJECT_DIR);
    let relativePath: string;
    try {
      relativePath = path.relative(projectDir, savedPath);
    } catch {
      relativePath = savedPath;
    }

    // Determine asset type based on context
    let assetType: 'character_ref' | 'setting_ref' | 'scene_image' | 'scene_video' = 'scene_image';
    if (job.context) {
      if (job.context.entityType === 'character') {
        assetType = 'character_ref';
      } else if (job.context.entityType === 'setting') {
        assetType = 'setting_ref';
      } else if (job.context.artifactType === 'video') {
        assetType = 'scene_video';
      }
    } else if (job.type === 'video') {
      assetType = 'scene_video';
    }

    // Store artifact in project manifest
    try {
      addAsset({
        id: artifactId,
        type: assetType,
        path: relativePath,
        createdAt: Date.now(),
        metadata: { jobId: job.id, promptId: job.promptId },
      });
    } catch {
      // Project may not exist yet, that's OK
    }

    // Link artifact to project entity (character, setting, or scene)
    if (job.context) {
      try {
        if (job.context.entityType === 'character' && job.context.characterName) {
          updateCharacter(job.context.characterName, {
            referenceImageId: artifactId,
            referenceImagePath: relativePath,
          });
          console.log(`Linked artifact ${artifactId} to character: ${job.context.characterName}`);
        } else if (job.context.entityType === 'setting' && job.context.settingName) {
          updateSetting(job.context.settingName, {
            referenceImageId: artifactId,
            referenceImagePath: relativePath,
          });
          console.log(`Linked artifact ${artifactId} to setting: ${job.context.settingName}`);
        } else if (job.context.entityType === 'scene' && job.context.sceneNumber !== undefined) {
          if (job.context.artifactType === 'video') {
            updateScene(job.context.sceneNumber, {
              videoArtifactId: artifactId,
            });
            console.log(`Linked video artifact ${artifactId} to scene: ${job.context.sceneNumber}`);
          } else {
            updateScene(job.context.sceneNumber, {
              imageArtifactId: artifactId,
            });
            console.log(`Linked image artifact ${artifactId} to scene: ${job.context.sceneNumber}`);
          }
        }
      } catch (e) {
        console.warn(`Failed to link artifact to project entity: ${e}`);
      }
    }

    // Update job
    job.status = 'completed';
    job.progress = 100;
    job.result = {
      artifactId,
      path: relativePath,
    };
    job.updatedAt = Date.now();

    return {
      status: 'completed',
      artifactId,
      filePath: relativePath,
    };
  } catch (error) {
    job.status = 'failed';
    job.error = String(error);
    job.updatedAt = Date.now();

    return {
      status: 'error',
      error: String(error),
    };
  }
}

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
  `Generate an image using ComfyUI. Supports two modes:

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

    // Submit to ComfyUI
    const result = await submitImageGeneration(params);

    if (result.status === 'error') {
      return {
        status: 'error',
        error: result.error,
        job_id: result.jobId,
      };
    }

    return {
      status: 'submitted',
      job_id: result.jobId,
      generation_mode: generationMode,
      message: generationMode === 'text_to_image'
        ? `Text-to-image generation job submitted. Use wait_for_job("${result.jobId}") to check status.`
        : `Image+text-to-image generation job submitted with ${params.reference_images?.length ?? 0} reference images. Use wait_for_job("${result.jobId}") to check status.`,
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
  `Generate a video from a scene image using ComfyUI's Wan Lightning workflow.

Takes a scene image artifact and creates a short video clip with motion.
The tool will return a job ID. Use wait_for_job to check completion.`,
  {
    type: 'object',
    properties: {
      scene_image_artifact_id: {
        type: 'string',
        description: 'Artifact ID of the scene image to animate',
      },
      scene_number: {
        type: 'number',
        description: 'Scene number',
      },
      prompt: {
        type: 'string',
        description: 'Optional motion description for the video',
      },
      seed: {
        type: 'number',
        description: 'Random seed for reproducibility (optional)',
      },
    },
    required: ['scene_image_artifact_id', 'scene_number'],
  },
  async (args) => {
    const sceneImageArtifactId = args['scene_image_artifact_id'] as string;
    const sceneNumber = args['scene_number'] as number;
    const prompt = (args['prompt'] as string) || '';
    const seed = args['seed'] as number | undefined;

    // Create job for tracking with context for linking
    const jobId = `vid-${Date.now()}-${nanoid(6)}`;
    const job: GenerationJob = {
      id: jobId,
      type: 'video',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      context: {
        entityType: 'scene',
        sceneNumber,
        artifactType: 'video',
      },
    };
    jobs.set(jobId, job);

    try {
      // Find the image file from the artifact ID
      const project = loadProject();
      if (!project) {
        throw new Error('No project found');
      }

      // Look for the artifact in project assets or scenes
      let imagePath: string | undefined;

      // Check scenes for the image artifact
      for (const scene of project.scenes) {
        if (scene.imageArtifactId === sceneImageArtifactId) {
          // Look up the asset path from the manifest
          const assetsDir = path.join(process.cwd(), PROJECT_DIR, 'assets');
          const manifestPath = path.join(assetsDir, 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            const asset = manifest.assets?.find((a: { id: string }) => a.id === sceneImageArtifactId);
            if (asset) {
              imagePath = path.join(process.cwd(), PROJECT_DIR, asset.path);
            }
          }
          break;
        }
      }

      if (!imagePath || !fs.existsSync(imagePath)) {
        throw new Error(`Image not found for artifact: ${sceneImageArtifactId}`);
      }

      const registry = getRegistry();
      const workflowMetadata = registry.get('wan_lightning');

      if (!workflowMetadata) {
        throw new Error("Workflow 'wan_lightning' not found");
      }

      const assetsDir = path.join(process.cwd(), PROJECT_DIR, 'assets', 'videos');
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }

      const client = new ComfyUIClient({
        outputDir: assetsDir,
      });

      // Upload the image to ComfyUI
      const uploadResult = await client.uploadImage(imagePath, 'input', true);

      // Load and parameterize the workflow
      const template = loadWorkflowTemplate(workflowMetadata.filename);
      const workflow = parameterizeWorkflowByName('wan_lightning', template, {
        sceneNumber,
        prompt,
        seed,
        inputImageFilename: uploadResult.name,
        filenamePrefix: `Scene${sceneNumber}_video`,
      });

      // Queue workflow
      const promptId = await client.queueWorkflow(workflow as Record<string, unknown>);

      // Update job
      job.promptId = promptId;
      job.status = 'processing';
      job.updatedAt = Date.now();

      return {
        status: 'submitted',
        job_id: jobId,
        message: `Video generation job submitted. Use wait_for_job("${jobId}") to check status.`,
        params: {
          scene_number: sceneNumber,
          image_artifact: sceneImageArtifactId,
          prompt,
        },
      };
    } catch (error) {
      job.status = 'failed';
      job.error = String(error);
      job.updatedAt = Date.now();

      return {
        status: 'error',
        job_id: jobId,
        error: String(error),
      };
    }
  }
);

/**
 * Edit image tool.
 * This is a COMPLEX tool - requires user confirmation.
 */
export const editImageTool: ToolDefinition = createTool(
  'edit_image',
  `Edit an existing image based on a text prompt using ComfyUI's Qwen Edit workflow.

Uses intelligent editing to modify specific parts of an image.
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

    // Create job for tracking with context for linking
    const jobId = `edit-${Date.now()}-${nanoid(6)}`;
    const job: GenerationJob = {
      id: jobId,
      type: 'image',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      context: {
        entityType: 'scene',
        sceneNumber: params.scene_number,
        artifactType: 'image',
      },
    };
    jobs.set(jobId, job);

    try {
      const registry = getRegistry();
      const workflowMetadata = registry.get('qwen_edit');

      if (!workflowMetadata) {
        throw new Error("Workflow 'qwen_edit' not found");
      }

      // Resolve the image path
      let imagePath = params.base_image_path;
      if (!path.isAbsolute(imagePath) && !imagePath.startsWith('.')) {
        // Assume it's relative to project
        imagePath = path.join(process.cwd(), PROJECT_DIR, imagePath);
      }

      if (!fs.existsSync(imagePath)) {
        throw new Error(`Base image not found: ${params.base_image_path}`);
      }

      const assetsDir = getAssetsDir();
      const client = new ComfyUIClient({
        outputDir: assetsDir,
      });

      // Upload the base image
      const uploadResult = await client.uploadImage(imagePath, 'input', true);

      // Load and parameterize workflow
      const template = loadWorkflowTemplate(workflowMetadata.filename);
      const workflow = parameterizeWorkflowByName('qwen_edit', template, {
        sceneNumber: params.scene_number,
        prompt: params.edit_prompt,
        negativePrompt: params.negative_prompt,
        aspectRatio: params.aspect_ratio,
        seed: params.seed,
        inputImageFilename: uploadResult.name,
        filenamePrefix: `Scene${params.scene_number}_edit`,
      });

      // Queue workflow
      const promptId = await client.queueWorkflow(workflow as Record<string, unknown>);

      // Update job
      job.promptId = promptId;
      job.status = 'processing';
      job.updatedAt = Date.now();

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
    } catch (error) {
      job.status = 'failed';
      job.error = String(error);
      job.updatedAt = Date.now();

      return {
        status: 'error',
        job_id: jobId,
        error: String(error),
      };
    }
  }
);

/**
 * Wait for job tool.
 * Used to check the status of async generation jobs and download results.
 */
export const waitForJobTool: ToolDefinition = createTool(
  'wait_for_job',
  `Wait for a generation job to complete and get the result.

Use this after submitting generate_image, generate_video, or edit_image to check status.
When job completes, returns the artifact ID and file path.`,
  {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'The job ID returned from a generation tool',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default: 300)',
      },
    },
    required: ['job_id'],
  },
  async (args) => {
    const jobId = args['job_id'] as string;
    const timeout = (args['timeout'] as number) || 300;
    const job = jobs.get(jobId);

    if (!job) {
      return {
        status: 'error',
        error: `Job not found: ${jobId}`,
      };
    }

    // If job is still pending/processing, wait for ComfyUI
    if (job.status === 'pending' || job.status === 'processing') {
      if (job.promptId) {
        const result = await waitForComfyUIJob(jobId, timeout);
        return {
          job_id: job.id,
          type: job.type,
          status: result.status,
          artifact_id: result.artifactId,
          file_path: result.filePath,
          error: result.error,
        };
      }
    }

    // Return current job status
    return {
      job_id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      artifact_id: job.result?.artifactId,
      file_path: job.result?.path,
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
