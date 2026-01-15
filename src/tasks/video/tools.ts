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
  parameterizeLtxT2VWorkflow,
  getRegistry,
} from '../../services/comfyui/index.js';
import {
  PROJECT_DIR,
  AGENT_DIR,
  addAsset,
  loadProject,
  updateCharacter,
  updateSetting,
  updateScene,
  getProjectStyleConfig,
  STYLE_CONFIGS,
  getAgentDir,
  getAssets,
  readProjectFile,
} from './workflow/index.js';
import { parseImagePlacements, type ParsedImagePlacement } from './workflow/imagePlacementsParser.js';
import { parseVideoPlacements, type ParsedVideoPlacement } from './workflow/videoPlacementsParser.js';

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

// Get the project assets directory for images (legacy - still used for non-placement images)
function getAssetsDir(): string {
  const assetsDir = path.join(process.cwd(), PROJECT_DIR, AGENT_DIR, 'assets', 'images');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  return assetsDir;
}

// Get the image-placements directory for placement images
function getImagePlacementsDir(): string {
  const imagePlacementsDir = path.join(process.cwd(), PROJECT_DIR, AGENT_DIR, 'image-placements');
  if (!fs.existsSync(imagePlacementsDir)) {
    fs.mkdirSync(imagePlacementsDir, { recursive: true });
  }
  return imagePlacementsDir;
}

// Get the video-placements directory for placement videos
function getVideoPlacementsDir(): string {
  const videoPlacementsDir = path.join(process.cwd(), PROJECT_DIR, AGENT_DIR, 'video-placements');
  if (!fs.existsSync(videoPlacementsDir)) {
    fs.mkdirSync(videoPlacementsDir, { recursive: true });
  }
  return videoPlacementsDir;
}

/**
 * Get the video generation timeout from environment variable or use default.
 * Uses the existing COMFYUI_TIMEOUT environment variable (same as ComfyUIClient).
 * Default: 300 seconds (5 minutes)
 */
function getVideoGenerationTimeout(): number {
  const envTimeout = process.env['COMFYUI_TIMEOUT'];
  if (envTimeout) {
    const parsed = parseInt(envTimeout, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 300; // Default 5 minutes
}

/**
 * Generate a filename for placement images.
 * Format: image{number}_{nanoid(8)}.png
 * Example: image1_aB3cD4eF.png, image2_xY9zW2vU.png
 */
function generatePlacementFilename(placementNumber: number): string {
  const id = nanoid(8);
  return `image${placementNumber}_${id}.png`;
}

/**
 * Check if an image already exists for a placement.
 * Checks both the image-placements folder and the manifest.json.
 */
function checkImageExists(
  placementIdentifier: string,
  placementIndex?: number
): { exists: boolean; artifactId?: string; filePath?: string } {
  // Try to find by filename pattern
  const imagePlacementsDir = getImagePlacementsDir();
  const possibleFilenames = [
    `placement-${placementIndex ?? 1}.png`,
    `placement-${placementIndex ?? 1}.jpg`,
    `${placementIdentifier}.png`,
    `${placementIdentifier}.jpg`,
  ];

  for (const filename of possibleFilenames) {
    const filePath = path.join(imagePlacementsDir, filename);
    if (fs.existsSync(filePath)) {
      // Check manifest for artifact ID
      const assets = getAssets();
      const relativePath = `agent/image-placements/${filename}`;
      const asset = assets.find((a) => a.path === relativePath);
      if (asset) {
        return { exists: true, artifactId: asset.id, filePath: relativePath };
      }
      return { exists: true, filePath: relativePath };
    }
  }

  // Check manifest for any asset with matching path pattern
  const assets = getAssets();
  const matchingAsset = assets.find((a) => 
    a.path?.includes('image-placements') && 
    (a.path.includes(placementIdentifier) || (placementIndex !== undefined && a.path.includes(`placement-${placementIndex}`)))
  );

  if (matchingAsset) {
    return { exists: true, artifactId: matchingAsset.id, filePath: matchingAsset.path };
  }

  return { exists: false };
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
    generation_mode = 'text_to_image',
    reference_images = [],
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
    // Use image-placements directory for scene images (placement images), assets/images for reference images
    const outputDir = image_type === 'scene' ? getImagePlacementsDir() : getAssetsDir();
    const client = new ComfyUIClient({
      outputDir,
    });

    // Determine which workflow to use based on generation mode and reference images
    const useQwenEdit = generation_mode === 'image_text_to_image' && reference_images.length > 0;
    const workflowName = useQwenEdit ? 'qwen_edit' : 'zimage';
    const workflowMetadata = registry.get(workflowName);

    if (!workflowMetadata) {
      throw new Error(`Workflow '${workflowName}' not found`);
    }

    let inputImageFilename: string | undefined;
    const referenceImageFilenames: string[] = [];

    // If using qwen_edit, upload reference images (up to 3 total)
    if (useQwenEdit && reference_images.length > 0) {
      // Limit to 3 images total for qwen_edit workflow
      const imagesToUpload = reference_images.slice(0, 3);

      for (let i = 0; i < imagesToUpload.length; i++) {
        const refImage = imagesToUpload[i];
        if (!refImage) continue;
        const refImagePath = findImagePathFromArtifactId(refImage.image_id);

        if (!refImagePath || !fs.existsSync(refImagePath)) {
          continue;
        }

        const uploadResult = await client.uploadImage(refImagePath);

        if (i === 0) {
          // First image is the primary input (base image to edit)
          inputImageFilename = uploadResult.name;
        } else {
          // Additional images are stored separately
          referenceImageFilenames.push(uploadResult.name);
        }
      }
    }

    // Get the project style configuration and enhance the prompt
    const styleConfig = getProjectStyleConfig();
    const enhancedPrompt = `${prompt}, ${styleConfig.promptModifier}`;
    const enhancedNegativePrompt = negative_prompt
      ? `${negative_prompt}, ${styleConfig.negativePromptModifier}`
      : styleConfig.negativePromptModifier;

    const template = loadWorkflowTemplate(workflowMetadata.filename);
    const workflow = parameterizeWorkflowByName(workflowName, template, {
      sceneNumber: scene_number,
      prompt: enhancedPrompt,
      negativePrompt: enhancedNegativePrompt,
      aspectRatio: aspect_ratio,
      style: styleConfig.displayName.toLowerCase().replace(/\s+/g, '_'),
      seed,
      filenamePrefix,
      inputImageFilename,
      referenceImageFilenames: referenceImageFilenames.length > 0 ? referenceImageFilenames : undefined,
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
async function waitForComfyUIJob(jobId: string, timeout: number | undefined = undefined): Promise<{
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
    // Determine output directory based on job type and context
    let outputDir: string;
    if (job.type === 'video' && job.context?.artifactType === 'video') {
      // Video jobs use video-placements directory
      outputDir = getVideoPlacementsDir();
    } else if (job.context?.entityType === 'scene') {
      // Scene images use image-placements directory
      outputDir = getImagePlacementsDir();
    } else {
      // Reference images use assets directory
      outputDir = getAssetsDir();
    }
    
    // Use provided timeout, or get from environment variable, or default to 300
    const actualTimeout = timeout ?? (job.type === 'video' ? getVideoGenerationTimeout() : 300);
    
    const client = new ComfyUIClient({
      outputDir,
      timeout: actualTimeout,
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

    // Get output files (images or videos)
    const outputs = await client.getOutputImages(job.promptId);
    if (!outputs.length) {
      job.status = 'failed';
      const errorMsg = job.type === 'video' ? 'No output videos found' : 'No output images found';
      job.error = errorMsg;
      job.updatedAt = Date.now();
      return { status: 'failed', error: errorMsg };
    }

    // Download first output file (image or video)
    const firstOutput = outputs[0]!;
    
    // Generate descriptive filename
    let outputFilename: string;
    if (job.type === 'video' && job.context?.entityType === 'scene' && job.context.sceneNumber) {
      // Video naming: video{number}_{nanoid(8)}.mp4
      const ext = firstOutput.filename.split('.').pop() || 'mp4';
      outputFilename = `video${job.context.sceneNumber}_${nanoid(8)}.${ext}`;
    } else if (job.context?.entityType === 'scene' && job.context.sceneNumber) {
      // Image naming: image{number}_{nanoid(8)}.png
      outputFilename = generatePlacementFilename(job.context.sceneNumber);
    } else {
      // For non-placement files, use original naming with nanoid prefix
      outputFilename = `${nanoid(8)}_${firstOutput.filename}`;
    }
    
    const savedPath = await client.downloadImage(
      firstOutput.filename,
      firstOutput.subfolder,
      firstOutput.type,
      outputFilename
    );

    // Create artifact ID (use vid_ for videos, img_ for images)
    const artifactId = job.type === 'video' ? `vid_${nanoid(8)}` : `img_${nanoid(8)}`;

    // Get relative path for storage (relative to .kshana/)
    const projectDir = path.join(process.cwd(), PROJECT_DIR);
    let relativePath: string;
    try {
      relativePath = path.relative(projectDir, savedPath);
    } catch {
      relativePath = savedPath;
    }
    
    // Ensure path uses forward slashes and starts with agent/ if it's an agent asset
    if (!relativePath.startsWith('agent/') && !relativePath.startsWith('context/') && !relativePath.startsWith('index/')) {
      relativePath = `agent/${relativePath}`;
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
        } else if (job.context.entityType === 'setting' && job.context.settingName) {
          updateSetting(job.context.settingName, {
            referenceImageId: artifactId,
            referenceImagePath: relativePath,
          });
        } else if (job.context.entityType === 'scene' && job.context.sceneNumber !== undefined) {
          if (job.context.artifactType === 'video') {
            updateScene(job.context.sceneNumber, {
              videoArtifactId: artifactId,
            });
          } else {
            updateScene(job.context.sceneNumber, {
              imageArtifactId: artifactId,
            });
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

    // Return full absolute path for immediate use
    // savedPath should already be absolute from downloadImage, but ensure it is
    const absolutePath = path.isAbsolute(savedPath) ? savedPath : path.resolve(savedPath);

    return {
      status: 'completed',
      artifactId,
      filePath: absolutePath, // Return full absolute path for immediate use
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

    // Check for duplicates if this is a scene image (placement image)
    if (params.image_type === 'scene' || !params.image_type) {
      const duplicateCheck = checkImageExists(`scene-${params.scene_number}`, params.scene_number);
      if (duplicateCheck.exists) {
        return {
          status: 'skipped',
          message: 'Image already exists for this placement',
          artifact_id: duplicateCheck.artifactId,
          file_path: duplicateCheck.filePath,
          duplicate: true,
        };
      }
    }

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
 * Video generation parameters for placement videos.
 */
export interface VideoPlacementGenerationParams {
  scene_number: number;
  prompt: string;
  duration: number; // Duration in seconds (4 or 5 for optimization)
  video_type: 'animation' | 'stock_footage' | 'motion_graphics';
}

/**
 * Calculate frame count for LTX-2 workflow from duration.
 * LTX-2 requires frame count to be divisible by 8 + 1.
 * Formula: Math.floor((duration * 24) / 8) * 8 + 1
 * 
 * @param duration Duration in seconds (4 or 5 for optimization)
 * @returns Frame count (97 for 4s, 121 for 5s)
 */
function calculateFrameCount(duration: number): number {
  // 24 fps, frame count must be divisible by 8 + 1
  const baseFrames = duration * 24;
  return Math.floor(baseFrames / 8) * 8 + 1;
}

/**
 * Submit a video generation job for placement videos using LTX-2 text-to-video.
 * Generates videos directly from text prompts without requiring an intermediate image.
 */
async function submitVideoPlacementGeneration(params: VideoPlacementGenerationParams): Promise<{
  jobId: string;
  status: string;
  error?: string;
}> {
  const {
    scene_number,
    prompt,
    duration,
    video_type,
  } = params;

  // Create job for tracking
  const jobId = `vid-${Date.now()}-${nanoid(6)}`;
  const job: GenerationJob = {
    id: jobId,
    type: 'video',
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    context: {
      entityType: 'scene',
      sceneNumber: scene_number,
      artifactType: 'video',
    },
  };
  jobs.set(jobId, job);

  try {
    console.log(`[submitVideoPlacementGeneration] Generating video from text prompt for placement ${scene_number}...`);

    const registry = getRegistry();
    const workflowMetadata = registry.get('ltx_t2v');

    if (!workflowMetadata) {
      throw new Error("Workflow 'ltx_t2v' not found");
    }

    // Use video-placements directory for placement videos
    const videoPlacementsDir = getVideoPlacementsDir();

    const client = new ComfyUIClient({
      outputDir: videoPlacementsDir,
    });

    // Calculate frame count from duration (LTX-2 requires divisible by 8 + 1)
    const frameCount = calculateFrameCount(duration);

    // Get the project style configuration and enhance the prompt
    const styleConfig = getProjectStyleConfig();
    const enhancedPrompt = `${prompt}, ${styleConfig.promptModifier}`;
    const negativePrompt = 'blurry, low quality, text, watermark, static, no motion, artifacts';

    // Load and parameterize the workflow
    const template = loadWorkflowTemplate(workflowMetadata.filename);
    const workflow = parameterizeLtxT2VWorkflow(template, {
      prompt: enhancedPrompt,
      negativePrompt,
      seed: Math.floor(Math.random() * 2 ** 32),
      filenamePrefix: `Placement${scene_number}_video`,
      width: 480, // Optimized for speed: 480x480 square
      height: 480, // Optimized for speed: 480x480 square
      frameCount,
    });

    // Queue workflow
    const promptId = await client.queueWorkflow(workflow as Record<string, unknown>);

    // Update job with video prompt ID
    job.promptId = promptId;
    job.status = 'processing';
    job.updatedAt = Date.now();

    console.log(`[submitVideoPlacementGeneration] Video generation job submitted with prompt ID: ${promptId}, frame count: ${frameCount}`);

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
 * Generate a video for a placement using AI video generation.
 * This tool generates videos from text prompts for video placements.
 */
export const generateVideoPlacementTool: ToolDefinition = createTool(
  'generate_video',
  `Generate an AI video for a video placement using text-to-video generation.

This tool generates videos from text prompts for video placements identified in the transcript.
The video will be saved to the video-placements directory.

The tool will return a job ID. Use wait_for_job to check completion.`,
  {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Detailed video generation prompt describing the visual and motion',
      },
      duration: {
        type: 'number',
        description: 'Video duration in seconds (4 or 5 for optimization)',
        enum: [4, 5],
      },
      scene_number: {
        type: 'number',
        description: 'Scene/placement number for file naming',
      },
      video_type: {
        type: 'string',
        enum: ['animation', 'stock_footage', 'motion_graphics'],
        description: 'Type of video to generate',
      },
    },
    required: ['prompt', 'duration', 'scene_number', 'video_type'],
  },
  async (args) => {
    const params = args as unknown as VideoPlacementGenerationParams;

    // Submit video generation job
    const result = await submitVideoPlacementGeneration(params);

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
      message: `Video generation job submitted. Use wait_for_job("${result.jobId}") to check status.`,
      params: {
        scene_number: params.scene_number,
        video_type: params.video_type,
        duration: params.duration,
        prompt: params.prompt,
      },
    };
  }
);

/**
 * Helper function to find image path from artifact ID.
 */
function findImagePathFromArtifactId(artifactId: string): string | undefined {
  const project = loadProject();
  if (!project) return undefined;

  // Check project assets manifest (now in agent/manifest.json)
  const assets = getAssets();
  const asset = assets.find((a) => a.id === artifactId);
  if (asset) {
    // Asset path is relative to .kshana/, so join with project dir
    return path.join(process.cwd(), PROJECT_DIR, asset.path);
  }

  // Check scenes for matching artifact
  for (const scene of project.scenes) {
    if (scene.imageArtifactId === artifactId || scene.videoArtifactId === artifactId) {
      // Try to find path from assets
      const foundAsset = assets.find((a) => a.id === artifactId);
      if (foundAsset) {
        return path.join(process.cwd(), PROJECT_DIR, foundAsset.path);
      }
    }
  }

  return undefined;
}

/**
 * Generate video from single image tool.
 * This is a COMPLEX tool - requires user confirmation.
 *
 * Use this for animating a SINGLE scene - NOT for transitions between scenes.
 */
export const generateVideoFromImageTool: ToolDefinition = createTool(
  'generate_video_from_image',
  `Animate a SINGLE scene image with motion effects.

**USE THIS TOOL WHEN:**
- Creating video for ONE scene (e.g., "animate Scene 3")
- The scene has internal motion but doesn't transition to another scene
- Adding camera movement within the same scene composition
- Adding character movement, environmental effects within ONE frame

**DO NOT USE THIS TOOL WHEN:**
- You need to transition BETWEEN two different scene images
- You want to connect Scene N to Scene N+1 (use generate_video_from_frames instead)

**Input:** Single scene image artifact
**Output:** Video clip of that scene with motion

**Example motion prompts:**
- "camera slowly pans across the scene"
- "the character gestures while speaking"
- "wind blows through the trees, clouds drift"
- "subtle breathing motion, eyes blinking"

Returns a job ID. Use wait_for_job to check completion.`,
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
      motion_prompt: {
        type: 'string',
        description: 'Description of the motion/animation to apply (camera movements, character actions, environmental effects)',
      },
      negative_prompt: {
        type: 'string',
        description: 'What to avoid in the video (optional)',
      },
      seed: {
        type: 'number',
        description: 'Random seed for reproducibility (optional)',
      },
    },
    required: ['scene_image_artifact_id', 'scene_number', 'motion_prompt'],
  },
  async (args) => {
    const sceneImageArtifactId = args['scene_image_artifact_id'] as string;
    const sceneNumber = args['scene_number'] as number;
    const motionPrompt = args['motion_prompt'] as string;
    const negativePrompt = args['negative_prompt'] as string | undefined;
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
      const imagePath = findImagePathFromArtifactId(sceneImageArtifactId);

      if (!imagePath || !fs.existsSync(imagePath)) {
        throw new Error(`Image not found for artifact: ${sceneImageArtifactId}`);
      }

      const registry = getRegistry();
      const workflowMetadata = registry.get('wan_single_image');

      if (!workflowMetadata) {
        throw new Error("Workflow 'wan_single_image' not found");
      }

      const assetsDir = path.join(process.cwd(), PROJECT_DIR, AGENT_DIR, 'assets', 'videos');
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
      const workflow = parameterizeWorkflowByName('wan_single_image', template, {
        sceneNumber,
        prompt: motionPrompt,
        negativePrompt,
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
        workflow: 'wan_single_image',
        message: `Single-image video generation job submitted. Use wait_for_job("${jobId}") to check status.`,
        params: {
          scene_number: sceneNumber,
          image_artifact: sceneImageArtifactId,
          motion_prompt: motionPrompt,
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
 * Generate video from start and end frames tool.
 * This is a COMPLEX tool - requires user confirmation.
 *
 * Use this for TRANSITIONS between two different scene images.
 */
export const generateVideoFromFramesTool: ToolDefinition = createTool(
  'generate_video_from_frames',
  `Create a TRANSITION video between TWO different scene images.

**USE THIS TOOL WHEN:**
- Connecting Scene N to Scene N+1 (e.g., "transition from Scene 3 to Scene 4")
- You have TWO different scene images and need smooth motion between them
- Creating a video that starts at one composition and ends at another
- The character/camera needs to move from position A (start image) to position B (end image)

**DO NOT USE THIS TOOL WHEN:**
- You only have ONE scene image (use generate_video_from_image instead)
- You want to animate a single scene without transitioning to another

**Input:** TWO scene image artifacts (start_image + end_image)
**Output:** Video that smoothly transitions from start to end

**Example transition prompts:**
- "character walks from the doorway to the window"
- "camera smoothly dollies from wide shot to close-up"
- "smooth transition as the scene shifts from day to night"
- "the character turns and walks toward the camera"

**Typical workflow:**
1. Scene 3 image → generate_video_from_image (animate Scene 3)
2. Scene 3 + Scene 4 images → generate_video_from_frames (transition 3→4)
3. Scene 4 image → generate_video_from_image (animate Scene 4)

Returns a job ID. Use wait_for_job to check completion.`,
  {
    type: 'object',
    properties: {
      start_image_artifact_id: {
        type: 'string',
        description: 'Artifact ID of the starting frame image',
      },
      end_image_artifact_id: {
        type: 'string',
        description: 'Artifact ID of the ending frame image',
      },
      scene_number: {
        type: 'number',
        description: 'Scene number (use the scene number of the start frame)',
      },
      transition_prompt: {
        type: 'string',
        description: 'Description of the transition/motion between the two frames',
      },
      negative_prompt: {
        type: 'string',
        description: 'What to avoid in the video (optional)',
      },
      seed: {
        type: 'number',
        description: 'Random seed for reproducibility (optional)',
      },
    },
    required: ['start_image_artifact_id', 'end_image_artifact_id', 'scene_number', 'transition_prompt'],
  },
  async (args) => {
    const startImageArtifactId = args['start_image_artifact_id'] as string;
    const endImageArtifactId = args['end_image_artifact_id'] as string;
    const sceneNumber = args['scene_number'] as number;
    const transitionPrompt = args['transition_prompt'] as string;
    const negativePrompt = args['negative_prompt'] as string | undefined;
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
      // Find both image files from artifact IDs
      const startImagePath = findImagePathFromArtifactId(startImageArtifactId);
      const endImagePath = findImagePathFromArtifactId(endImageArtifactId);

      if (!startImagePath || !fs.existsSync(startImagePath)) {
        throw new Error(`Start image not found for artifact: ${startImageArtifactId}`);
      }

      if (!endImagePath || !fs.existsSync(endImagePath)) {
        throw new Error(`End image not found for artifact: ${endImageArtifactId}`);
      }

      const registry = getRegistry();
      const workflowMetadata = registry.get('wan_start_end');

      if (!workflowMetadata) {
        throw new Error("Workflow 'wan_start_end' not found");
      }

      const assetsDir = path.join(process.cwd(), PROJECT_DIR, AGENT_DIR, 'assets', 'videos');
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }

      const client = new ComfyUIClient({
        outputDir: assetsDir,
      });

      // Upload both images to ComfyUI
      const startUploadResult = await client.uploadImage(startImagePath, 'input', true);
      const endUploadResult = await client.uploadImage(endImagePath, 'input', true);

      // Load and parameterize the workflow
      const template = loadWorkflowTemplate(workflowMetadata.filename);
      const workflow = parameterizeWorkflowByName('wan_start_end', template, {
        sceneNumber,
        prompt: transitionPrompt,
        negativePrompt,
        seed,
        startImageFilename: startUploadResult.name,
        endImageFilename: endUploadResult.name,
        filenamePrefix: `Scene${sceneNumber}_transition`,
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
        workflow: 'wan_start_end',
        message: `Start-end video generation job submitted. Use wait_for_job("${jobId}") to check status.`,
        params: {
          scene_number: sceneNumber,
          start_image_artifact: startImageArtifactId,
          end_image_artifact: endImageArtifactId,
          transition_prompt: transitionPrompt,
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
 * Generate video tool (legacy wrapper).
 * This is a COMPLEX tool - requires user confirmation.
 *
 * This tool is kept for backward compatibility and routes to generate_video_from_image.
 */
export const generateVideoTool: ToolDefinition = createTool(
  'generate_video',
  `[LEGACY - prefer generate_video_from_image or generate_video_from_frames]

Generate a video from a scene image. This is a legacy tool that wraps generate_video_from_image.

For new implementations, use:
- generate_video_from_image: When you have ONE image to animate
- generate_video_from_frames: When you have TWO images (start/end) to interpolate

Returns a job ID. Use wait_for_job to check completion.`,
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
        description: 'Motion description for the video',
      },
      seed: {
        type: 'number',
        description: 'Random seed for reproducibility (optional)',
      },
    },
    required: ['scene_image_artifact_id', 'scene_number'],
  },
  async (args) => {
    // Route to the new generate_video_from_image tool
    const newArgs = {
      scene_image_artifact_id: args['scene_image_artifact_id'],
      scene_number: args['scene_number'],
      motion_prompt: args['prompt'] || 'subtle motion and movement in the scene',
      seed: args['seed'],
    };

    // Call the handler of generate_video_from_image
    return generateVideoFromImageTool.handler!(newArgs);
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
        // imagePath is already relative to .kshana/, just join
        if (!imagePath.startsWith(PROJECT_DIR)) {
          imagePath = path.join(process.cwd(), PROJECT_DIR, imagePath);
        } else {
          imagePath = path.join(process.cwd(), imagePath);
        }
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
 * Storyboard parameters for preview image generation.
 */
export interface StoryboardParams {
  /** Act or sequence number */
  act_number: number;
  /** Array of scene summaries to generate previews for */
  scene_summaries: Array<{
    scene_number: number;
    title: string;
    description: string;
  }>;
  /** Optional: Maximum number of preview images (default: 6) */
  max_images?: number;
}

/**
 * Get storyboard directory for storing preview images.
 */
function getStoryboardDir(): string {
  const storyboardDir = path.join(process.cwd(), PROJECT_DIR, AGENT_DIR, 'assets', 'storyboard');
  if (!fs.existsSync(storyboardDir)) {
    fs.mkdirSync(storyboardDir, { recursive: true });
  }
  return storyboardDir;
}

/**
 * Generate storyboard preview images for an act.
 * Creates quick preview images for key scenes to help visualize the story flow.
 */
export const generateStoryboardTool: ToolDefinition = createTool(
  'generate_storyboard',
  `Generate storyboard preview images for a sequence of scenes.

USE THIS TOOL WHEN:
- User wants to see a visual preview of the story before detailed scene generation
- Planning scene composition and flow
- Getting quick visual feedback on story direction
- Visualizing key moments in an act

This tool generates ~6 quick preview images representing key moments.
The images are lower quality but faster to generate for quick iteration.

Returns an array of job IDs that can be tracked with wait_for_job.`,
  {
    type: 'object',
    properties: {
      act_number: {
        type: 'number',
        description: 'Act or sequence number for organizing storyboard images',
      },
      scene_summaries: {
        type: 'array',
        description: 'Array of scene summaries to generate preview images for',
        items: {
          type: 'object',
          properties: {
            scene_number: {
              type: 'number',
              description: 'Scene number',
            },
            title: {
              type: 'string',
              description: 'Scene title',
            },
            description: {
              type: 'string',
              description: 'Brief description of what happens in the scene (used as image prompt)',
            },
          },
          required: ['scene_number', 'title', 'description'],
        },
      },
      max_images: {
        type: 'number',
        description: 'Maximum number of preview images to generate (default: 6)',
      },
    },
    required: ['act_number', 'scene_summaries'],
  },
  async (args) => {
    const actNumber = args['act_number'] as number;
    const sceneSummaries = args['scene_summaries'] as StoryboardParams['scene_summaries'];
    const maxImages = (args['max_images'] as number) || 6;

    if (!sceneSummaries || sceneSummaries.length === 0) {
      return {
        status: 'error',
        error: 'No scene summaries provided',
      };
    }

    // Select up to maxImages scenes evenly distributed across the summaries
    const step = Math.max(1, Math.ceil(sceneSummaries.length / maxImages));
    const selectedScenes = sceneSummaries.filter((_, index) => index % step === 0).slice(0, maxImages);

    const jobIds: string[] = [];
    const storyboardDir = getStoryboardDir();

    console.log(`[Storyboard] Generating ${selectedScenes.length} preview images for Act ${actNumber}`);

    for (const scene of selectedScenes) {
      try {
        // Create storyboard-specific prompt (concise for fast generation)
        const storyboardPrompt = `Storyboard sketch: ${scene.description}. Cinematic composition, 16:9 aspect ratio.`;

        // Use zimage for fast generation with lower step count
        const filenamePrefix = `Storyboard_Act${actNumber}_Scene${scene.scene_number}`;

        const result = await submitImageGeneration({
          scene_number: scene.scene_number,
          prompt: storyboardPrompt,
          negative_prompt: 'blurry, low quality, text, watermark',
          aspect_ratio: '16:9',
          image_type: 'scene',
          generation_mode: 'text_to_image',
        });

        if (result.status === 'submitted' && result.jobId) {
          jobIds.push(result.jobId);
          console.log(`[Storyboard] Queued scene ${scene.scene_number}: ${result.jobId}`);
        } else {
          console.error(`[Storyboard] Failed to queue scene ${scene.scene_number}: ${result.error}`);
        }
      } catch (error) {
        console.error(`[Storyboard] Error generating scene ${scene.scene_number}:`, error);
      }
    }

    return {
      status: 'submitted',
      act_number: actNumber,
      job_ids: jobIds,
      total_images: jobIds.length,
      message: `Queued ${jobIds.length} storyboard preview images for Act ${actNumber}. Use wait_for_job with each job_id to track completion.`,
      scenes_selected: selectedScenes.map(s => s.scene_number),
    };
  }
);

/**
 * Generate all images for placements defined in image-placements.md.
 * Parses the file, extracts all placements, and generates images sequentially.
 * Each image is generated one at a time, waiting for completion before moving to the next.
 */
export const generateAllImagesTool: ToolDefinition = createTool(
  'generate_all_images',
  `Generate all images for placements defined in the image-placements.md file.

This tool:
1. Reads and parses agent/content/image-placements.md
2. Extracts all placement entries (Placement 1, 2, 3, etc.)
3. Generates images sequentially, one at a time
4. Waits for each image to complete before moving to the next
5. Continues even if some images fail (logs failures but doesn't stop)
6. Returns a summary of successful and failed placements

Use this tool during the image_generation phase to process all placements automatically.
The tool handles all parsing, sequential generation, and error handling internally.`,
  {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to image-placements.md file (default: agent/content/image-placements.md)',
      },
    },
    required: [],
  },
  async (args) => {
    const filePath = (args['file_path'] as string | undefined) || 'agent/content/image-placements.md';
    
    // Read the image placements file
    const content = readProjectFile(filePath);
    if (!content) {
      return {
        status: 'error',
        error: `Image placements file not found: ${filePath}`,
      };
    }
    
    // Parse placements
    let placements: ParsedImagePlacement[];
    try {
      placements = parseImagePlacements(content);
    } catch (error) {
      return {
        status: 'error',
        error: `Failed to parse image placements: ${String(error)}`,
      };
    }
    
    if (placements.length === 0) {
      return {
        status: 'error',
        error: 'No placements found in image-placements.md',
      };
    }
    
    console.log(`[generate_all_images] Found ${placements.length} placements to generate`);
    
    const results: Array<{
      placementNumber: number;
      status: 'success' | 'failed';
      artifactId?: string;
      filePath?: string;
      error?: string;
    }> = [];
    
    // Generate images sequentially
    for (const placement of placements) {
      console.log(`[generate_all_images] Generating image for Placement ${placement.placementNumber}...`);
      
      try {
        // Submit image generation job
        // Use placement number as scene_number for tracking
        const submitResult = await submitImageGeneration({
          scene_number: placement.placementNumber,
          prompt: placement.prompt,
          negative_prompt: 'blurry, low quality, text, watermark',
          aspect_ratio: '16:9',
          image_type: 'scene', // Placement images are scene type
          generation_mode: 'text_to_image',
        });
        
        if (submitResult.status !== 'submitted' || !submitResult.jobId) {
          const errorMsg = submitResult.error || 'Failed to submit image generation';
          console.error(`[generate_all_images] Placement ${placement.placementNumber} failed: ${errorMsg}`);
          results.push({
            placementNumber: placement.placementNumber,
            status: 'failed',
            error: errorMsg,
          });
          continue;
        }
        
        // Wait for job completion
        const timeout = getVideoGenerationTimeout();
        const waitResult = await waitForComfyUIJob(submitResult.jobId, timeout);
        
        if (waitResult.status === 'completed' && waitResult.artifactId && waitResult.filePath) {
          console.log(`[generate_all_images] Placement ${placement.placementNumber} completed: ${waitResult.artifactId}`);
          results.push({
            placementNumber: placement.placementNumber,
            status: 'success',
            artifactId: waitResult.artifactId,
            filePath: waitResult.filePath,
          });
        } else {
          const errorMsg = waitResult.error || 'Image generation did not complete';
          console.error(`[generate_all_images] Placement ${placement.placementNumber} failed: ${errorMsg}`);
          results.push({
            placementNumber: placement.placementNumber,
            status: 'failed',
            error: errorMsg,
          });
        }
      } catch (error) {
        const errorMsg = String(error);
        console.error(`[generate_all_images] Placement ${placement.placementNumber} error: ${errorMsg}`);
        results.push({
          placementNumber: placement.placementNumber,
          status: 'failed',
          error: errorMsg,
        });
      }
    }
    
    // Summary
    const successful = results.filter(r => r.status === 'success');
    const failed = results.filter(r => r.status === 'failed');
    
    console.log(`[generate_all_images] Completed: ${successful.length} successful, ${failed.length} failed`);
    
    return {
      status: 'completed',
      total_placements: placements.length,
      successful: successful.length,
      failed: failed.length,
      results: results,
      message: `Generated ${successful.length} out of ${placements.length} images. ${failed.length} failed.`,
    };
  }
);

/**
 * Generate all videos for placements defined in video-placements.md.
 * Parses the file, extracts all placements, and generates videos sequentially.
 * Each video is generated one at a time, waiting for completion before moving to the next.
 */
export const generateAllVideosTool: ToolDefinition = createTool(
  'generate_all_videos',
  `Generate all videos for placements defined in the video-placements.md file.

This tool:
1. Reads and parses agent/content/video-placements.md
2. Extracts all placement entries (Placement 1, 2, 3, etc.)
3. Generates videos sequentially, one at a time
4. Waits for each video to complete before moving to the next
5. Continues even if some videos fail (logs failures but doesn't stop)
6. Returns a summary of successful and failed placements

Use this tool during the video_generation phase to process all placements automatically.
The tool handles all parsing, sequential generation, and error handling internally.
Videos are generated from text prompts (no scene_image_artifact_id required).`,
  {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to video-placements.md file (default: agent/content/video-placements.md)',
      },
    },
    required: [],
  },
  async (args) => {
    const filePath = (args['file_path'] as string | undefined) || 'agent/content/video-placements.md';
    
    // Read the video placements file
    const content = readProjectFile(filePath);
    if (!content) {
      return {
        status: 'error',
        error: `Video placements file not found: ${filePath}`,
      };
    }
    
    // Parse placements
    let placements: ParsedVideoPlacement[];
    try {
      placements = parseVideoPlacements(content);
    } catch (error) {
      return {
        status: 'error',
        error: `Failed to parse video placements: ${String(error)}`,
      };
    }
    
    if (placements.length === 0) {
      return {
        status: 'error',
        error: 'No placements found in video-placements.md',
      };
    }
    
    console.log(`[generate_all_videos] Found ${placements.length} placements to generate`);
    
    const results: Array<{
      placementNumber: number;
      status: 'success' | 'failed';
      artifactId?: string;
      filePath?: string;
      error?: string;
    }> = [];
    
    // Generate videos sequentially
    for (const placement of placements) {
      console.log(`[generate_all_videos] Generating video for Placement ${placement.placementNumber}...`);
      
      try {
        // Submit video generation job using the existing generateVideoPlacementTool handler
        const submitResult = await submitVideoPlacementGeneration({
          scene_number: placement.placementNumber,
          prompt: placement.prompt,
          duration: placement.duration,
          video_type: placement.videoType,
        });
        
        if (submitResult.status !== 'submitted' || !submitResult.jobId) {
          const errorMsg = submitResult.error || 'Failed to submit video generation';
          console.error(`[generate_all_videos] Placement ${placement.placementNumber} failed: ${errorMsg}`);
          results.push({
            placementNumber: placement.placementNumber,
            status: 'failed',
            error: errorMsg,
          });
          continue;
        }
        
        // Wait for job completion
        const timeout = getVideoGenerationTimeout();
        const waitResult = await waitForComfyUIJob(submitResult.jobId, timeout);
        
        if (waitResult.status === 'completed' && waitResult.artifactId && waitResult.filePath) {
          console.log(`[generate_all_videos] Placement ${placement.placementNumber} completed: ${waitResult.artifactId}`);
          results.push({
            placementNumber: placement.placementNumber,
            status: 'success',
            artifactId: waitResult.artifactId,
            filePath: waitResult.filePath,
          });
        } else {
          const errorMsg = waitResult.error || 'Video generation did not complete';
          console.error(`[generate_all_videos] Placement ${placement.placementNumber} failed: ${errorMsg}`);
          results.push({
            placementNumber: placement.placementNumber,
            status: 'failed',
            error: errorMsg,
          });
        }
      } catch (error) {
        const errorMsg = String(error);
        console.error(`[generate_all_videos] Placement ${placement.placementNumber} error: ${errorMsg}`);
        results.push({
          placementNumber: placement.placementNumber,
          status: 'failed',
          error: errorMsg,
        });
      }
    }
    
    // Summary
    const successful = results.filter(r => r.status === 'success');
    const failed = results.filter(r => r.status === 'failed');
    
    console.log(`[generate_all_videos] Completed: ${successful.length} successful, ${failed.length} failed`);
    
    return {
      status: 'completed',
      total_placements: placements.length,
      successful: successful.length,
      failed: failed.length,
      results: results,
      message: `Generated ${successful.length} out of ${placements.length} videos. ${failed.length} failed.`,
    };
  }
);

/**
 * Get all video generation tools.
 */
export function getVideoGenerationTools(): ToolDefinition[] {
  return [
    generateImageTool,
    generateVideoPlacementTool,
    generateVideoFromImageTool,
    generateVideoFromFramesTool,
    editImageTool,
    generateStoryboardTool,
    generateAllImagesTool,
    generateAllVideosTool,
    waitForJobTool,
  ];
}

/**
 * Register video tools as complex tools.
 * These require user confirmation before execution.
 */
export const VIDEO_COMPLEX_TOOLS = new Set([
  'generate_image',
  'generate_video_from_image',
  'generate_video_from_frames',
  'edit_image',
  'generate_storyboard',
  'generate_all_images',
  'generate_all_videos',
]);
