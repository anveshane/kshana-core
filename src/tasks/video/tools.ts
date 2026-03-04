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
  getProjectDir,
  addAsset,
  loadProject,
  updateCharacter,
  updateSetting,
  updateScene,
  getProjectStyleConfig,
  STYLE_CONFIGS,
} from './workflow/index.js';

/**
 * A single shot within a multi-shot scene breakdown.
 */
export interface ShotPrompt {
  shotNumber: number;
  shotType: string;  // By distance: extreme_wide, wide, medium_wide, medium, medium_close_up, close_up, extreme_close_up. By angle: low_angle, high_angle, dutch_angle, birds_eye. By purpose: establishing, reaction, over_the_shoulder, two_shot, pov, insert, cutaway, tracking.
  duration: number;  // 4-8 seconds
  prompt: string;    // single flowing paragraph for this shot only
  dialogue: string | null;  // character dialogue for LTX-2 audio, null if none
  cameraWork: string;  // e.g. "slow push-in", "static close-up with subtle drift"
  referenceImages: string[];  // character/setting ref paths relevant to this shot
}

/**
 * Multi-shot motion prompt for a scene.
 * Each scene is broken into 2-4 shots of 4-8 seconds each.
 */
export interface MultiShotMotionPrompt {
  sceneNumber: number;
  sceneTitle: string;
  shots: ShotPrompt[];
  totalSceneDuration: number;
  referenceImages: string[];  // all ref images for the scene
}

/**
 * JSON schema for structured motion prompt output from the LLM.
 * Used with OpenAI's response_format to guarantee valid JSON.
 * Now supports multi-shot scene breakdowns with dialogue.
 */
export const MOTION_PROMPT_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'motion_prompt',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        sceneNumber: { type: 'number' },
        sceneTitle: { type: 'string' },
        shots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              shotNumber: { type: 'number' },
              shotType: { type: 'string' },
              duration: { type: 'number' },
              prompt: { type: 'string' },
              dialogue: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              cameraWork: { type: 'string' },
              referenceImages: { type: 'array', items: { type: 'string' } },
            },
            required: ['shotNumber', 'shotType', 'duration', 'prompt', 'dialogue', 'cameraWork', 'referenceImages'],
            additionalProperties: false,
          },
        },
        totalSceneDuration: { type: 'number' },
        referenceImages: { type: 'array', items: { type: 'string' } },
      },
      required: ['sceneNumber', 'sceneTitle', 'shots', 'totalSceneDuration', 'referenceImages'],
      additionalProperties: false,
    },
  },
};

/**
 * Parse a motion prompt file, handling both legacy single-prompt and new multi-shot formats.
 * Legacy format: { prompt: string, referenceImages: string[] }
 * Multi-shot format: { sceneNumber, sceneTitle, shots: [...], ... }
 */
export function parseMotionPrompt(raw: string): MultiShotMotionPrompt {
  const parsed = JSON.parse(raw);
  if (parsed.shots && Array.isArray(parsed.shots)) {
    return parsed as MultiShotMotionPrompt;
  }
  // Legacy single-prompt format
  return {
    sceneNumber: 0,
    sceneTitle: 'Untitled',
    shots: [{
      shotNumber: 1,
      shotType: 'full_scene',
      duration: 6,
      prompt: parsed.prompt,
      dialogue: null,
      cameraWork: 'as described',
      referenceImages: parsed.referenceImages ?? [],
    }],
    totalSceneDuration: 6,
    referenceImages: parsed.referenceImages ?? [],
  };
}

/**
 * Context for linking artifacts to project entities.
 */
export interface ArtifactContext {
  /** Type of entity this artifact belongs to */
  entityType: 'scene' | 'character' | 'setting';
  /** Scene number (for scene images/videos) */
  sceneNumber?: number;
  /** Shot number within a scene (for multi-shot video generation) */
  shotNumber?: number;
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
  type: 'image' | 'video' | 'infographic';
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
  reference_images?: string[];
  negative_prompt?: string;
  aspect_ratio?: string;
  seed?: number;
}

// Job storage (in-memory for now, could be Redis/DB in production)
const jobs = new Map<string, GenerationJob>();

// Get the project assets directory
function getAssetsDir(): string {
  const assetsDir = path.join(getProjectDir(), 'assets', 'images');
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
  suggestion?: string;
  failedReferences?: Array<{ image_id: string; type: string; name: string }>;
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
    const client = new ComfyUIClient({
      outputDir: getAssetsDir(),
    });

    // Fail early if image_text_to_image mode is requested but no reference images are provided
    if (generation_mode === 'image_text_to_image' && reference_images.length === 0) {
      job.status = 'failed';
      job.error = 'generation_mode is image_text_to_image but no reference images were provided or could be resolved.';
      job.updatedAt = Date.now();
      return {
        jobId,
        status: 'error',
        error: job.error,
        suggestion: 'Ensure reference images are specified with actual file paths in the prompt file, or provide reference_images in the tool call.',
      };
    }

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
          console.warn(`[generate_image] Failed to resolve ref image: id="${refImage.image_id}" type=${refImage.type} name="${refImage.name}" → path: ${refImagePath ?? 'null'}`);
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

    // Fail explicitly if qwen_edit mode but no reference images could be resolved
    if (useQwenEdit && !inputImageFilename) {
      job.status = 'failed';
      job.error = 'No reference images could be resolved or uploaded for image_text_to_image mode.';
      job.updatedAt = Date.now();
      return {
        jobId,
        status: 'error',
        error: job.error,
        suggestion: 'Ensure character/setting reference images exist and referenceImagePath is set in project.json.',
        failedReferences: reference_images.map(r => ({ image_id: r.image_id, type: r.type, name: r.name })),
      };
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
    const projectDir = getProjectDir();
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

The tool will return a job ID. Use wait_for_job to check completion.

**Prompt source**: Provide EITHER \`prompt\` (inline text) OR \`prompt_file\` (path to .prompt.md file). Using \`prompt_file\` is preferred as it reads from approved prompt files.`,
  {
    type: 'object',
    properties: {
      scene_number: {
        type: 'number',
        description: 'Scene number (for scene images) or sequence number for reference images',
      },
      prompt: {
        type: 'string',
        description: 'Detailed image generation prompt describing the visual (use prompt_file instead if prompt exists in a file)',
      },
      prompt_file: {
        type: 'string',
        description: 'Path to prompt file (e.g., "prompts/images/characters/alice.prompt.md"). Reads the prompt from this file instead of requiring inline prompt text.',
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
        description: 'ONLY character and setting reference images for visual consistency (required for image_text_to_image mode). Do NOT include other scene images or shot images — only character_ref and setting_ref artifacts.',
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
    required: ['scene_number'],
  },
  async (args) => {
    let params = args as unknown as ImageGenerationParams;

    // If prompt_file is provided, read and parse the prompt from the file
    const promptFile = args['prompt_file'] as string | undefined;
    if (promptFile) {
      const fullPath = path.join(getProjectDir(), promptFile);
      if (!fs.existsSync(fullPath)) {
        return {
          status: 'error',
          error: `Prompt file not found: ${promptFile}`,
          suggestion: 'Check that the prompt file path is correct and the file exists.',
        };
      }
      const promptContent = fs.readFileSync(fullPath, 'utf-8');

      // Parse the prompt file for both prompt text and metadata
      const parsed = parsePromptFile(promptContent);
      params = { ...params, prompt: parsed.prompt };

      // Apply generation mode from prompt file if not explicitly provided
      if (parsed.generationMode && !params.generation_mode) {
        params.generation_mode = parsed.generationMode;
      }

      // Apply negative prompt from prompt file if not explicitly provided
      if (parsed.negativePrompt && !params.negative_prompt) {
        params.negative_prompt = parsed.negativePrompt;
      }

      // Apply aspect ratio from prompt file if not explicitly provided
      if (parsed.aspectRatio && !params.aspect_ratio) {
        params.aspect_ratio = parsed.aspectRatio as ImageGenerationParams['aspect_ratio'];
      }

      // If references are specified in prompt file and not provided in args, resolve them
      if (parsed.references.length > 0 && !params.reference_images?.length) {
        const resolvedRefs = resolveReferencesToPaths(parsed.references);
        if (resolvedRefs && resolvedRefs.length > 0) {
          params.reference_images = resolvedRefs;
          // Auto-set generation mode to image_text_to_image when we have references
          if (!params.generation_mode) {
            params.generation_mode = 'image_text_to_image';
          }
        } else if (parsed.generationMode === 'image_text_to_image') {
          // Prompt file specifies image_text_to_image but references couldn't be resolved
          return {
            status: 'error',
            error: `Prompt file specifies image_text_to_image mode with references (${parsed.references.map(r => r.name).join(', ')}), but reference images could not be found in project state.`,
            suggestion: 'Ensure character/setting reference images have been generated and are tracked in project.json.',
            requested_references: parsed.references,
          };
        }
      }
    }

    // Validate that we have a prompt from either source
    if (!params.prompt) {
      return {
        status: 'error',
        error: 'No prompt provided. Supply either "prompt" (inline text) or "prompt_file" (path to prompt file).',
      };
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
 * Parsed metadata from a prompt file.
 */
interface PromptFileMetadata {
  /** The actual prompt text */
  prompt: string;
  /** Generation mode (text_to_image or image_text_to_image) */
  generationMode?: 'text_to_image' | 'image_text_to_image';
  /** Reference images specified in the prompt */
  references: Array<{
    type: 'character' | 'setting';
    name: string;
    refId?: string;
    /** Direct relative path to the reference image file (preferred over name-based lookup) */
    path?: string;
  }>;
  /** Negative prompt if specified */
  negativePrompt?: string;
  /** Aspect ratio if specified */
  aspectRatio?: string;
}

/**
 * Extract prompt text from a markdown file.
 * Handles files that may have:
 * 1. Markdown headers (e.g., "# Image Prompt: ...") - skipped
 * 2. Metadata sections (e.g., "**Purpose**:", "**Key Elements**:") - stopped before
 *
 * The actual prompt is typically the first paragraph after the header.
 */
function extractPromptFromMarkdown(content: string): string {
  // Try structured prompt headers first (used by .motion.md and .prompt.md)
  const motionMatch = content.match(/\*\*Motion Prompt:\*\*\s*\n([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n$)/i);
  if (motionMatch?.[1]?.trim()) return motionMatch[1].trim();

  const imageMatch = content.match(/\*\*Image Prompt:\*\*\s*\n([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n$)/i);
  if (imageMatch?.[1]?.trim()) return imageMatch[1].trim();

  // Existing line-by-line fallback for plain text prompts
  const lines = content.split('\n');
  const promptLines: string[] = [];
  let startIndex = 0;

  // Skip the first line if it's a markdown header
  if (lines[0]?.trim().startsWith('#')) {
    startIndex = 1;
  }

  // Collect lines until we hit metadata (lines starting with **) or end of content
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line?.trim() || '';

    // Stop at metadata sections (bold headers like **Purpose**:)
    if (trimmed.startsWith('**') && trimmed.includes(':')) {
      break;
    }

    // Skip empty lines at the beginning
    if (promptLines.length === 0 && trimmed === '') {
      continue;
    }

    promptLines.push(line || '');
  }

  return promptLines.join('\n').trim();
}

/**
 * Parse a prompt file to extract both the prompt text and metadata.
 * Supports scene image prompts that include generation mode and reference images.
 *
 * Expected format for scene prompts:
 * ```
 * **Image Prompt:**
 * [prompt text]
 *
 * **Reference Images:**
 * - Character: Alice (ref_id: char_alice_001)
 * - Setting: Forest (ref_id: setting_forest_001)
 *
 * **Generation Mode:**
 * image_text_to_image
 *
 * **Negative Prompt:**
 * [negative prompt text]
 *
 * **Aspect Ratio:**
 * 16:9
 * ```
 */
function parsePromptFile(content: string): PromptFileMetadata {
  const result: PromptFileMetadata = {
    prompt: '',
    references: [],
  };

  // Check for structured prompt format (scene prompts)
  const imagePromptMatch = content.match(/\*\*Image Prompt:\*\*\s*\n([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n$)/i);
  if (imagePromptMatch && imagePromptMatch[1]) {
    result.prompt = imagePromptMatch[1].trim();
  } else {
    // Fall back to simple extraction
    result.prompt = extractPromptFromMarkdown(content);
  }

  // Parse generation mode
  const modeMatch = content.match(/\*\*Generation Mode:\*\*\s*\n\s*(text_to_image|image_text_to_image)/i);
  if (modeMatch && modeMatch[1]) {
    result.generationMode = modeMatch[1].toLowerCase() as 'text_to_image' | 'image_text_to_image';
  }

  // Parse reference images
  // Supported formats:
  //   "- Character: Name"
  //   "- Character: Name [path/to/image.png]"
  //   "- Setting: Name [path/to/image.png]"
  //   "- Character: Name (ref_id: xxx)"
  //   "- image1: Name (character) - path/to/image.png"
  const refSection = content.match(/\*\*Reference Images:\*\*\s*\n([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n$)/i);
  if (refSection && refSection[1]) {
    const refLines = refSection[1].split('\n');
    for (const line of refLines) {
      // Extract inline path from [path] brackets or trailing "- path" format
      const bracketPathMatch = line.match(/\[([^\]]+\.(?:png|jpg|jpeg|webp))\]/i);
      const trailingPathMatch = line.match(/[-–]\s*((?:assets|characters|settings)\/[^\s]+\.(?:png|jpg|jpeg|webp))\s*$/i);
      const inlinePath = bracketPathMatch?.[1] || trailingPathMatch?.[1] || undefined;

      // Match character references
      const charMatch = line.match(/^-\s*(?:image\d+:\s*)?(?:Character:\s*)([^(\[-]+?)(?:\s*[\[(-].*)?$/i);
      if (charMatch && charMatch[1] && /character/i.test(line)) {
        result.references.push({
          type: 'character',
          name: charMatch[1].trim(),
          path: inlinePath,
        });
        continue;
      }

      // Match setting references
      const settingMatch = line.match(/^-\s*(?:image\d+:\s*)?(?:Setting:\s*)([^(\[-]+?)(?:\s*[\[(-].*)?$/i);
      if (settingMatch && settingMatch[1] && /setting/i.test(line)) {
        result.references.push({
          type: 'setting',
          name: settingMatch[1].trim(),
          path: inlinePath,
        });
        continue;
      }

      // Fallback: match "- imageN: Name (type)" format
      const imageNMatch = line.match(/^-\s*image\d+:\s*([^(]+?)\s*\((\w+)\)/i);
      if (imageNMatch && imageNMatch[1] && imageNMatch[2]) {
        const type = imageNMatch[2].toLowerCase();
        if (type === 'character' || type === 'setting') {
          result.references.push({
            type: type as 'character' | 'setting',
            name: imageNMatch[1].trim(),
            path: inlinePath,
          });
        }
      }
    }
  }

  // Parse negative prompt
  const negativeMatch = content.match(/\*\*Negative Prompt:\*\*\s*\n([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n$)/i);
  if (negativeMatch && negativeMatch[1]) {
    result.negativePrompt = negativeMatch[1].trim();
  }

  // Parse aspect ratio
  const aspectMatch = content.match(/\*\*Aspect Ratio:\*\*\s*\n\s*([\d:]+)/i);
  if (aspectMatch && aspectMatch[1]) {
    result.aspectRatio = aspectMatch[1].trim();
  }

  return result;
}

/**
 * Resolve reference names to actual image paths from project state.
 */
function resolveReferencesToPaths(
  references: PromptFileMetadata['references']
): Array<{ image_id: string; type: 'character' | 'setting'; name: string }> | null {
  const project = loadProject();
  if (!project) {
    return null;
  }

  const projectDir = getProjectDir();
  const resolved: Array<{ image_id: string; type: 'character' | 'setting'; name: string }> = [];

  for (const ref of references) {
    // Priority 1: Direct path specified in prompt file — most reliable
    if (ref.path) {
      const fullPath = path.isAbsolute(ref.path) ? ref.path : path.join(projectDir, ref.path);
      if (fs.existsSync(fullPath)) {
        resolved.push({
          image_id: fullPath,
          type: ref.type,
          name: ref.name,
        });
        continue;
      }
      // Path specified but doesn't exist — warn and fall through to other methods
      console.warn(`[resolveReferencesToPaths] Direct path not found: ${fullPath} (ref: ${ref.type}:${ref.name})`);
    }

    // Priority 2: Lookup from project.characters / project.settings arrays
    if (ref.type === 'character') {
      const character = project.characters.find(
        c => c.name.toLowerCase().includes(ref.name.toLowerCase()) ||
             ref.name.toLowerCase().includes(c.name.toLowerCase())
      );
      if (character?.referenceImagePath) {
        resolved.push({
          image_id: path.join(projectDir, character.referenceImagePath),
          type: 'character',
          name: character.name,
        });
        continue;
      } else if (character?.referenceImageId) {
        const imagePath = project.content?.images?.itemFiles?.[character.referenceImageId];
        if (imagePath) {
          resolved.push({
            image_id: path.join(projectDir, imagePath),
            type: 'character',
            name: character.name,
          });
          continue;
        }
      }
    } else if (ref.type === 'setting') {
      const setting = project.settings.find(
        s => s.name.toLowerCase().includes(ref.name.toLowerCase()) ||
             ref.name.toLowerCase().includes(s.name.toLowerCase())
      );
      if (setting?.referenceImagePath) {
        resolved.push({
          image_id: path.join(projectDir, setting.referenceImagePath),
          type: 'setting',
          name: setting.name,
        });
        continue;
      } else if (setting?.referenceImageId) {
        const imagePath = project.content?.images?.itemFiles?.[setting.referenceImageId];
        if (imagePath) {
          resolved.push({
            image_id: path.join(projectDir, imagePath),
            type: 'setting',
            name: setting.name,
          });
          continue;
        }
      }
    }

    // Priority 3: Fallback — scan content.images.itemFiles for matching filename pattern
    // This handles cases where project.characters/settings arrays are empty but images exist
    const itemFiles = project.content?.images?.itemFiles;
    if (itemFiles) {
      const refPrefix = ref.type === 'character' ? 'CharRef' : 'SettingRef';
      const searchName = ref.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      for (const [_imgId, imgPath] of Object.entries(itemFiles)) {
        const filename = path.basename(imgPath as string).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (filename.includes(refPrefix.toLowerCase()) && filename.includes(searchName)) {
          const fullPath = path.join(projectDir, imgPath as string);
          if (fs.existsSync(fullPath)) {
            resolved.push({
              image_id: fullPath,
              type: ref.type,
              name: ref.name,
            });
            break;
          }
        }
      }
    }
  }

  return resolved.length > 0 ? resolved : null;
}

/**
 * Helper function to find image path from artifact ID.
 */
function findImagePathFromArtifactId(artifactId: string): string | undefined {
  // If the input is already an existing absolute file path, return it directly
  if (path.isAbsolute(artifactId) && fs.existsSync(artifactId)) {
    return artifactId;
  }

  const project = loadProject();
  if (!project) return undefined;

  // Check project assets manifest
  const assetsDir = path.join(getProjectDir(), 'assets');
  const manifestPath = path.join(assetsDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const asset = manifest.assets?.find((a: { id: string }) => a.id === artifactId);
    if (asset) {
      return path.join(getProjectDir(), asset.path);
    }
  }

  // Check scenes for matching artifact
  for (const scene of project.scenes) {
    if (scene.imageArtifactId === artifactId) {
      // Try to find path from manifest
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const asset = manifest.assets?.find((a: { id: string }) => a.id === artifactId);
        if (asset) {
          return path.join(getProjectDir(), asset.path);
        }
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
  `Animate exactly ONE shot image into a video using the LTX-2 model.

**IMPORTANT:** This tool takes a single shot image and animates it. Call it once per shot.
A scene is composed of multiple shots — call this tool separately for each shot.

**Input:** Single shot image artifact ID + motion prompt
**Output:** Video clip of that shot with motion

**Example motion prompts:**
- "camera slowly pans across the scene"
- "the character gestures while speaking"
- "wind blows through the trees, clouds drift"
- "subtle breathing motion, eyes blinking"

Returns a job ID. Use wait_for_job to check completion.

**Motion prompt source**: Provide EITHER \`motion_prompt\` (inline text) OR \`motion_prompt_file\` (path to prompt file). Using \`motion_prompt_file\` is preferred as it reads from approved prompt files. If the file is a multi-shot JSON, you MUST specify \`shot_number\` to select the prompt for this shot.`,
  {
    type: 'object',
    properties: {
      shot_image_artifact_id: {
        type: 'string',
        description: 'Artifact ID of the single shot image to animate',
      },
      scene_number: {
        type: 'number',
        description: 'Scene number this shot belongs to',
      },
      shot_number: {
        type: 'number',
        description: 'Shot number within the scene',
      },
      motion_prompt: {
        type: 'string',
        description: 'Description of the motion/animation to apply (use motion_prompt_file instead if prompt exists in a file)',
      },
      motion_prompt_file: {
        type: 'string',
        description: 'Path to motion prompt file. If JSON with multiple shots, shot_number is used to select the correct prompt.',
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
    required: ['shot_image_artifact_id', 'scene_number', 'shot_number'],
  },
  async (args) => {
    const shotImageArtifactId = args['shot_image_artifact_id'] as string;
    const sceneNumber = args['scene_number'] as number;
    const shotNumber = args['shot_number'] as number;
    let motionPrompt = args['motion_prompt'] as string | undefined;
    const negativePrompt = args['negative_prompt'] as string | undefined;
    const seed = args['seed'] as number | undefined;

    // If motion_prompt_file is provided, read and extract the prompt for this shot
    const motionPromptFile = args['motion_prompt_file'] as string | undefined;
    if (motionPromptFile) {
      const fullPath = path.join(getProjectDir(), motionPromptFile);
      if (!fs.existsSync(fullPath)) {
        return {
          status: 'error',
          error: `Motion prompt file not found: ${motionPromptFile}`,
          suggestion: 'Check that the motion prompt file path is correct and the file exists.',
        };
      }
      const promptContent = fs.readFileSync(fullPath, 'utf-8');

      if (motionPromptFile.endsWith('.json')) {
        const motionData = parseMotionPrompt(promptContent);
        const targetShot = motionData.shots.find(s => s.shotNumber === shotNumber);

        if (!targetShot) {
          return {
            status: 'error',
            error: `Shot ${shotNumber} not found in motion prompt file. Available shots: ${motionData.shots.map(s => s.shotNumber).join(', ')}`,
          };
        }

        motionPrompt = targetShot.prompt;
        if (targetShot.dialogue) {
          motionPrompt += ` The character speaks: "${targetShot.dialogue}"`;
        }
      } else {
        motionPrompt = extractPromptFromMarkdown(promptContent);
      }
    }

    if (!motionPrompt) {
      return {
        status: 'error',
        error: 'No motion prompt provided. Supply either "motion_prompt" (inline text) or "motion_prompt_file" (path to prompt file).',
      };
    }

    // Resolve the single shot image
    const imagePath = findImagePathFromArtifactId(shotImageArtifactId);
    if (!imagePath || !fs.existsSync(imagePath)) {
      return { status: 'error', error: `Image not found for artifact: ${shotImageArtifactId}` };
    }

    const registry = getRegistry();
    const workflowName = 'ltx_i2v';
    const workflowMetadata = registry.get(workflowName);
    if (!workflowMetadata) {
      return { status: 'error', error: `Workflow '${workflowName}' not found` };
    }

    const assetsDir = path.join(getProjectDir(), 'assets', 'videos');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

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
        sceneNumber,
        shotNumber,
        artifactType: 'video',
      },
    };
    jobs.set(jobId, job);

    try {
      const client = new ComfyUIClient({ outputDir: assetsDir });
      const uploadResult = await client.uploadImage(imagePath, 'input', true);
      const template = loadWorkflowTemplate(workflowMetadata.filename);
      const workflow = parameterizeWorkflowByName(workflowName, template, {
        sceneNumber,
        prompt: motionPrompt,
        negativePrompt,
        seed,
        inputImageFilename: uploadResult.name,
        filenamePrefix: `Scene${sceneNumber}_shot${shotNumber}_video`,
      });

      const promptId = await client.queueWorkflow(workflow as Record<string, unknown>);
      job.promptId = promptId;
      job.status = 'processing';
      job.updatedAt = Date.now();

      return {
        status: 'submitted',
        job_id: jobId,
        workflow: workflowName,
        message: `Shot ${shotNumber} of Scene ${sceneNumber} submitted for video generation. Use wait_for_job("${jobId}") to check status.`,
        params: {
          scene_number: sceneNumber,
          shot_number: shotNumber,
          image_artifact: shotImageArtifactId,
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
 * Generate video tool (legacy wrapper).
 * This is a COMPLEX tool - requires user confirmation.
 *
 * This tool is kept for backward compatibility and routes to generate_video_from_image.
 */
export const generateVideoTool: ToolDefinition = createTool(
  'generate_video',
  `[LEGACY - prefer generate_video_from_image]

Generate a video from a scene image. This is a legacy tool that wraps generate_video_from_image.

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
  `Edit or compose an image using ComfyUI's Qwen Edit workflow. Supports up to 3 input images.

The base image becomes "image1" in the prompt. Additional reference_images become "image2" and "image3".
To reference characters/settings, use natural phrasing like "Parvati from image1" or "the setting from image3".

IMPORTANT: The order of images matters. Match your prompt references to the image order:
- image1 = base_image_path (primary/base image)
- image2 = reference_images[0] (e.g. first character reference)
- image3 = reference_images[1] (e.g. second character or setting reference)

DO NOT use this tool for adding text, subtitles, or dialogue overlays to images. Use compose_panel instead — it is instant, free, and produces better text rendering.

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
        description: 'Description of the edit/composition. Reference input images as "image1", "image2", "image3" matching their order.',
      },
      base_image_path: {
        type: 'string',
        description: 'Path to the primary image (becomes image1 in prompt)',
      },
      reference_images: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to 2 additional reference image paths (become image2, image3). Use for character refs, setting refs, or style references.',
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

      // Resolve the base image path
      let imagePath = params.base_image_path;
      if (!path.isAbsolute(imagePath) && !imagePath.startsWith('.')) {
        imagePath = path.join(getProjectDir(), imagePath);
      }

      if (!fs.existsSync(imagePath)) {
        throw new Error(`Base image not found: ${params.base_image_path}`);
      }

      const assetsDir = getAssetsDir();
      const client = new ComfyUIClient({
        outputDir: assetsDir,
      });

      // Upload the base image (image1)
      const uploadResult = await client.uploadImage(imagePath, 'input', true);

      // Upload reference images (image2, image3)
      const referenceImageFilenames: string[] = [];
      if (params.reference_images) {
        for (const refPath of params.reference_images.slice(0, 2)) {
          let resolvedPath = refPath;
          if (!path.isAbsolute(resolvedPath) && !resolvedPath.startsWith('.')) {
            resolvedPath = path.join(getProjectDir(), resolvedPath);
          }
          if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Reference image not found: ${refPath}`);
          }
          const refUpload = await client.uploadImage(resolvedPath, 'input', true);
          referenceImageFilenames.push(refUpload.name);
        }
      }

      // Load and parameterize workflow
      const template = loadWorkflowTemplate(workflowMetadata.filename);
      const workflow = parameterizeWorkflowByName('qwen_edit', template, {
        sceneNumber: params.scene_number,
        prompt: params.edit_prompt,
        negativePrompt: params.negative_prompt,
        aspectRatio: params.aspect_ratio,
        seed: params.seed,
        inputImageFilename: uploadResult.name,
        referenceImageFilenames: referenceImageFilenames.length > 0 ? referenceImageFilenames : undefined,
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

Use this after submitting generate_image, generate_video, edit_image, or generate_all_infographics to check status.
When job completes, returns the artifact ID and file path.
Supports both ComfyUI jobs and Remotion infographic jobs (prefixed with "remotion-").`,
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

    // Handle Remotion infographic jobs
    if (jobId.startsWith('remotion-')) {
      const { RemotionRenderer } = await import('../../services/remotion/index.js');
      const renderer = RemotionRenderer.getInstance();

      const startTime = Date.now();
      const timeoutMs = timeout * 1000;

      while (Date.now() - startTime < timeoutMs) {
        const renderJob = renderer.getJobStatus(jobId);
        if (!renderJob) {
          return { status: 'error', error: `Remotion job not found: ${jobId}` };
        }

        if (renderJob.status === 'completed' || renderJob.status === 'failed') {
          return {
            job_id: renderJob.id,
            type: 'infographic' as const,
            status: renderJob.status,
            progress: renderJob.progress,
            results: renderJob.results,
            error: renderJob.error,
          };
        }

        // Poll every 2 seconds
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      return { status: 'error', error: `Remotion job timed out after ${timeout}s`, job_id: jobId };
    }

    // Handle ComfyUI jobs
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
  const storyboardDir = path.join(getProjectDir(), 'assets', 'storyboard');
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
 * Compose a graphic novel panel by overlaying dialogue/narration text on a shot image.
 * Uses sharp to add a semi-transparent black strip at the bottom with white text.
 */
export const composePanelTool: ToolDefinition = createTool(
  'compose_panel',
  `Overlay dialogue and narration text onto a shot image to create a graphic novel panel.

Adds a translucent black overlay at the bottom of the image with white text on top.
This is fast and free — no expensive image generation calls needed.

Text types and styling:
- **dialogue**: Shown in quotes (use for character speech). Can be a single string or an array of strings for multiple lines of dialogue.
- **narrator**: Shown in italics (use for narration/description). Can be a single string or an array of strings.
- **sfx**: Shown in BOLD UPPERCASE (use for sound effects). Can be a single string or an array of strings.

All text types can be combined. Multiple entries are rendered in order: SFX first, then narration, then dialogue. The overlay covers up to 40% of the image height (~6-8 wrapped lines). Text exceeding this is truncated with "…" — split long text across multiple panels instead.

Use this instead of edit_image or generate_image for adding text to panels. It is instant and deterministic.`,
  {
    type: 'object',
    properties: {
      image_path: {
        type: 'string',
        description: 'Absolute path to the source shot image',
      },
      dialogue: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
        description: 'Character dialogue text (displayed in quotes). String or array of strings for multiple dialogue lines.',
      },
      narrator: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
        description: 'Narration text (displayed in italics). String or array of strings.',
      },
      sfx: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
        description: 'Sound effect text (displayed in bold uppercase). String or array of strings.',
      },
      output_path: {
        type: 'string',
        description: 'Absolute path where the composed panel image will be saved',
      },
    },
    required: ['image_path', 'output_path'],
  },
  async (args) => {
    const imagePath = args['image_path'] as string;
    const outputPath = args['output_path'] as string;

    // Normalize inputs: accept string or array of strings
    const toArray = (val: unknown): string[] => {
      if (!val) return [];
      if (Array.isArray(val)) return val.filter((s): s is string => typeof s === 'string' && s.length > 0);
      if (typeof val === 'string' && val.length > 0) return [val];
      return [];
    };
    const dialogueLines = toArray(args['dialogue']);
    const narratorLines = toArray(args['narrator']);
    const sfxLines = toArray(args['sfx']);

    if (!fs.existsSync(imagePath)) {
      return { status: 'error', error: `Source image not found: ${imagePath}` };
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    try {
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(imagePath).metadata();
      const imgWidth = metadata.width || 1024;
      const imgHeight = metadata.height || 576;

      // Build text lines from all entries (SFX first, then narration, then dialogue)
      const textLines: { text: string; style: string }[] = [];
      for (const s of sfxLines) textLines.push({ text: s.toUpperCase(), style: 'bold' });
      for (const n of narratorLines) textLines.push({ text: n, style: 'italic' });
      for (const d of dialogueLines) textLines.push({ text: `\u201C${d}\u201D`, style: 'normal' });

      if (textLines.length === 0) {
        // No text to overlay — just copy the image
        await sharp(imagePath).toFile(outputPath);
        return {
          status: 'success',
          output_path: outputPath,
          message: 'No text provided — image copied without overlay.',
        };
      }

      // Calculate strip height based on text content
      const lineHeight = Math.max(20, Math.round(imgHeight * 0.035));
      const padding = Math.round(lineHeight * 0.8);

      // Word-wrap helper: break text to fit within image width
      const maxCharsPerLine = Math.floor(imgWidth / (lineHeight * 0.52));
      const wrappedLines: { text: string; style: string }[] = [];
      for (const line of textLines) {
        const words = line.text.split(' ');
        let current = '';
        for (const word of words) {
          if (current.length + word.length + 1 > maxCharsPerLine && current.length > 0) {
            wrappedLines.push({ text: current, style: line.style });
            current = word;
          } else {
            current = current.length > 0 ? `${current} ${word}` : word;
          }
        }
        if (current.length > 0) {
          wrappedLines.push({ text: current, style: line.style });
        }
      }

      // Cap wrapped lines so overlay doesn't exceed 40% of image height
      const interLineGap = Math.round(lineHeight * 0.3);
      const maxOverlayHeight = Math.round(imgHeight * 0.4);
      const maxLines = Math.floor((maxOverlayHeight - padding * 2 + interLineGap) / (lineHeight + interLineGap));
      let truncated = false;
      if (wrappedLines.length > maxLines && maxLines > 0) {
        wrappedLines.length = maxLines;
        // Replace last line's text with truncation indicator
        const lastLine = wrappedLines[maxLines - 1]!;
        wrappedLines[maxLines - 1] = { text: lastLine.text + ' \u2026', style: lastLine.style };
        truncated = true;
      }

      const finalStripHeight = padding * 2 + wrappedLines.length * lineHeight + (wrappedLines.length - 1) * interLineGap;

      // Escape XML special characters for SVG
      const escapeXml = (str: string) =>
        str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      // Build SVG text elements
      const fontSize = Math.round(lineHeight * 0.85);
      const svgTextElements = wrappedLines.map((line, i) => {
        const y = padding + (i + 1) * lineHeight + i * interLineGap;
        const fontStyle = line.style === 'italic' ? ' font-style="italic"' : '';
        const fontWeight = line.style === 'bold' ? ' font-weight="bold"' : '';
        return `<text x="${imgWidth / 2}" y="${y}" text-anchor="middle" fill="white" font-family="sans-serif" font-size="${fontSize}"${fontStyle}${fontWeight}>${escapeXml(line.text)}</text>`;
      }).join('\n    ');

      // Overlay translucent black bar at the bottom of the image (no extension)
      const overlayTop = imgHeight - finalStripHeight;
      const svgOverlay = `<svg width="${imgWidth}" height="${imgHeight}">
    <rect x="0" y="${overlayTop}" width="${imgWidth}" height="${finalStripHeight}" fill="black" opacity="0.7"/>
    <g transform="translate(0, ${overlayTop})">
      ${svgTextElements}
    </g>
  </svg>`;

      await sharp(imagePath)
        .composite([{
          input: Buffer.from(svgOverlay),
          top: 0,
          left: 0,
        }])
        .toFile(outputPath);

      return {
        status: 'success',
        output_path: outputPath,
        dimensions: { width: imgWidth, height: imgHeight },
        text_lines: wrappedLines.length,
        truncated,
        message: truncated
          ? `Panel composed: text truncated to ${wrappedLines.length} line(s) (max 40% of image height). Split long text across multiple panels.`
          : `Panel composed: ${wrappedLines.length} line(s) of text overlaid on image.`,
      };
    } catch (error) {
      return {
        status: 'error',
        error: `Failed to compose panel: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
);

/**
 * Assemble all composed graphic novel panels into ordered output.
 * Collects panel images, sorts by scene/shot number, and outputs
 * as numbered pages or a single vertical webtoon-style image.
 */
export const assembleGraphicNovelTool: ToolDefinition = createTool(
  'assemble_graphic_novel',
  `Assemble composed graphic novel panels into final output.

Collects all composed panel images from the project, orders them by scene and shot number,
and produces either:
- "pages" mode: numbered page files (page-001.png, page-002.png, etc.) in a graphic-novel/ folder
- "webtoon" mode: a single tall vertically-stacked image (webtoon/scroll style)

Run this after all panels have been composed with compose_panel.`,
  {
    type: 'object',
    properties: {
      panels_dir: {
        type: 'string',
        description: 'Directory containing the composed panel images',
      },
      output_dir: {
        type: 'string',
        description: 'Directory where the assembled output will be saved',
      },
      mode: {
        type: 'string',
        enum: ['pages', 'webtoon'],
        description: 'Output mode: "pages" for numbered individual files, "webtoon" for a single vertical image. Defaults to "pages".',
      },
    },
    required: ['panels_dir', 'output_dir'],
  },
  async (args) => {
    const panelsDir = args['panels_dir'] as string;
    const outputDir = args['output_dir'] as string;
    const mode = (args['mode'] as string) || 'pages';

    if (!fs.existsSync(panelsDir)) {
      return { status: 'error', error: `Panels directory not found: ${panelsDir}` };
    }

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    try {
      const sharp = (await import('sharp')).default;

      // Find all panel images and sort by scene/shot number
      // Expected naming: panel-scene-N-shot-M.png or scene-N-shot-M-panel.png
      const files = fs.readdirSync(panelsDir).filter(f =>
        /\.(png|jpg|jpeg|webp)$/i.test(f)
      );

      if (files.length === 0) {
        return { status: 'error', error: `No panel images found in ${panelsDir}` };
      }

      // Extract scene/shot numbers for sorting
      const panelFiles = files.map(f => {
        const sceneMatch = f.match(/scene[_-]?(\d+)/i);
        const shotMatch = f.match(/shot[_-]?(\d+)/i);
        return {
          filename: f,
          filepath: path.join(panelsDir, f),
          sceneNumber: sceneMatch?.[1] != null ? parseInt(sceneMatch[1]!, 10) : 0,
          shotNumber: shotMatch?.[1] != null ? parseInt(shotMatch[1]!, 10) : 0,
        };
      });

      // Sort by scene number, then shot number
      panelFiles.sort((a, b) =>
        a.sceneNumber !== b.sceneNumber
          ? a.sceneNumber - b.sceneNumber
          : a.shotNumber - b.shotNumber
      );

      if (mode === 'webtoon') {
        // Stack all panels vertically into a single tall image
        let maxWidth = 0;

        // Get all dimensions first
        const dimensions: { width: number; height: number }[] = [];
        for (const panel of panelFiles) {
          const meta = await sharp(panel.filepath).metadata();
          const w = meta.width || 1024;
          const h = meta.height || 576;
          dimensions.push({ width: w, height: h });
          if (w > maxWidth) maxWidth = w;
        }

        // Create the stacked image by compositing each panel at its vertical offset
        const compositeInputs: { input: Buffer; top: number; left: number }[] = [];
        let yOffset = 0;
        for (let i = 0; i < panelFiles.length; i++) {
          const panel = panelFiles[i]!;
          const dim = dimensions[i]!;
          // Resize to maxWidth if needed, maintaining aspect ratio
          const resized = await sharp(panel.filepath)
            .resize(maxWidth, null, { fit: 'inside', withoutEnlargement: false })
            .toBuffer();
          compositeInputs.push({
            input: resized,
            top: yOffset,
            left: 0,
          });
          // Use the resized height
          const resizedMeta = await sharp(resized).metadata();
          yOffset += resizedMeta.height || dim.height;
        }

        const webtoonPath = path.join(outputDir, 'graphic-novel-webtoon.png');
        await sharp({
          create: {
            width: maxWidth,
            height: yOffset,
            channels: 3,
            background: { r: 0, g: 0, b: 0 },
          },
        })
          .composite(compositeInputs)
          .png()
          .toFile(webtoonPath);

        return {
          status: 'success',
          mode: 'webtoon',
          output_path: webtoonPath,
          total_panels: panelFiles.length,
          dimensions: { width: maxWidth, height: yOffset },
          message: `Assembled ${panelFiles.length} panels into webtoon format: ${webtoonPath}`,
        };
      } else {
        // Pages mode: copy/rename panels as numbered pages
        const outputPaths: string[] = [];
        for (let i = 0; i < panelFiles.length; i++) {
          const pageNum = String(i + 1).padStart(3, '0');
          const panelFile = panelFiles[i]!;
          const ext = path.extname(panelFile.filename);
          const pagePath = path.join(outputDir, `page-${pageNum}${ext}`);
          await sharp(panelFile.filepath).toFile(pagePath);
          outputPaths.push(pagePath);
        }

        return {
          status: 'success',
          mode: 'pages',
          output_dir: outputDir,
          total_pages: outputPaths.length,
          pages: outputPaths,
          panel_order: panelFiles.map(p => ({
            file: p.filename,
            scene: p.sceneNumber,
            shot: p.shotNumber,
          })),
          message: `Assembled ${outputPaths.length} pages in ${outputDir}`,
        };
      }
    } catch (error) {
      return {
        status: 'error',
        error: `Failed to assemble graphic novel: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
);

/**
 * Get all video generation tools.
 */
export function getVideoGenerationTools(): ToolDefinition[] {
  return [
    generateImageTool,
    generateVideoFromImageTool,
    editImageTool,
    waitForJobTool,
  ];
}

/**
 * Get graphic novel specific tools (compose_panel, assemble_graphic_novel).
 * These are only relevant for the graphic_novel template.
 */
export function getGraphicNovelTools(): ToolDefinition[] {
  return [
    composePanelTool,
    assembleGraphicNovelTool,
  ];
}

/**
 * Register video tools as complex tools.
 * These require user confirmation before execution.
 */
export const VIDEO_COMPLEX_TOOLS = new Set([
  'generate_image',
  'generate_video_from_image',
  'edit_image',
]);
