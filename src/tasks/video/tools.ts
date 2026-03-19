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
  comfyProgressBus,
  analyzeWorkflow,
  ensureApiFormat,
  isLiteGraphFormat,
  saveCustomWorkflow,
  getRegistry,
} from '../../services/comfyui/index.js';
import { getProviderRegistry } from '../../services/providers/index.js';
import type { ProviderProgressCallback } from '../../services/providers/types.js';
import { getDefaultWorkflowForCapability } from '../../core/prompts/index.js';

import { getPhaseLogger } from '../../utils/phaseLogger.js';

const DEBUG_LOG_PATH = path.join(process.cwd(), 'logs', 'debug.log');
function debugLog(message: string): void {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${message}\n`);
  } catch {
    // Ignore logging errors
  }
}
import { loadTimeline, updateSegmentLayers, saveTimeline } from '../../core/timeline/TimelineManager.js';
import type { TimelineLayerEntry } from '../../core/timeline/types.js';
import {
  getProjectDir,
  addAsset,
  loadProject,
  updateCharacter,
  updateSetting,
  updateScene,
  getProjectStyleConfig,
} from './workflow/index.js';

/**
 * A single shot within a multi-shot scene breakdown.
 */
export interface ShotPrompt {
  shotNumber: number;
  shotType: string; // By distance: extreme_wide, wide, medium_wide, medium, medium_close_up, close_up, extreme_close_up. By angle: low_angle, high_angle, dutch_angle, birds_eye. By purpose: establishing, reaction, over_the_shoulder, two_shot, pov, insert, cutaway, tracking.
  duration: number; // 4-8 seconds
  prompt: string; // single flowing paragraph for this shot only
  dialogue: string | null; // character dialogue for LTX-2 audio, null if none
  cameraWork: string; // e.g. "slow push-in", "static close-up with subtle drift"
  referenceImages: string[]; // character/setting ref paths relevant to this shot
  useEstablishingAsFirstFrame?: boolean; // for continuous mode: use establishing image directly as LTX-2 input
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
  referenceImages: string[]; // all ref images for the scene
  sceneMode: 'multi_shot' | 'continuous'; // multi_shot (2-4 shots) or continuous (single long shot)
  spatialLayout: string; // description of how elements are arranged in the establishing shot
  establishingImagePath?: string; // path to the establishing image for this scene
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
              useEstablishingAsFirstFrame: { type: 'boolean' },
            },
            required: [
              'shotNumber',
              'shotType',
              'duration',
              'prompt',
              'dialogue',
              'cameraWork',
              'referenceImages',
            ],
            additionalProperties: false,
          },
        },
        totalSceneDuration: { type: 'number' },
        referenceImages: { type: 'array', items: { type: 'string' } },
        sceneMode: { type: 'string', enum: ['multi_shot', 'continuous'] },
        spatialLayout: { type: 'string' },
        establishingImagePath: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['sceneNumber', 'sceneTitle', 'shots', 'totalSceneDuration', 'referenceImages', 'sceneMode', 'spatialLayout'],
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
  const phaseLogger = getPhaseLogger();

  if (parsed.shots && Array.isArray(parsed.shots)) {
    // Validate sceneMode enum
    const validSceneModes = ['multi_shot', 'continuous'];
    const sceneMode = parsed.sceneMode ?? 'multi_shot';
    if (!validSceneModes.includes(sceneMode)) {
      throw new Error(
        `Invalid sceneMode "${sceneMode}" — must be one of: ${validSceneModes.join(', ')}`
      );
    }

    const spatialLayout = parsed.spatialLayout ?? '';

    // Warn if multi_shot mode is missing establishing image or spatial layout
    if (sceneMode === 'multi_shot') {
      if (!parsed.establishingImagePath) {
        phaseLogger.warn('MotionPrompt', 'missing_establishing', `Scene ${parsed.sceneNumber} uses multi_shot mode but has no establishingImagePath — shots will lack spatial anchor`);
      }
      if (!spatialLayout) {
        phaseLogger.warn('MotionPrompt', 'missing_spatial_layout', `Scene ${parsed.sceneNumber} uses multi_shot mode but has empty spatialLayout`);
      }
    }

    if (sceneMode === 'continuous') {
      phaseLogger.info('MotionPrompt', 'continuous_mode', `Scene ${parsed.sceneNumber} using continuous mode — shot images will be skipped`, {
        sceneNumber: parsed.sceneNumber,
        sceneTitle: parsed.sceneTitle,
      });
    }

    return {
      sceneNumber: parsed.sceneNumber,
      sceneTitle: parsed.sceneTitle,
      shots: parsed.shots,
      totalSceneDuration: parsed.totalSceneDuration,
      referenceImages: parsed.referenceImages ?? [],
      sceneMode,
      spatialLayout,
      establishingImagePath: parsed.establishingImagePath,
    };
  }
  // Legacy single-prompt format
  return {
    sceneNumber: 0,
    sceneTitle: 'Untitled',
    shots: [
      {
        shotNumber: 1,
        shotType: 'full_scene',
        duration: 6,
        prompt: parsed.prompt,
        dialogue: null,
        cameraWork: 'as described',
        referenceImages: parsed.referenceImages ?? [],
      },
    ],
    totalSceneDuration: 6,
    referenceImages: parsed.referenceImages ?? [],
    sceneMode: 'multi_shot',
    spatialLayout: '',
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
  clientId?: string; // ComfyUI client ID for WebSocket progress
  /** Context for linking artifact to project */
  context?: ArtifactContext;
}

/**
 * Reference image for consistency in scene generation.
 */
export interface ReferenceImage {
  /** Artifact ID or path to the reference image */
  image_id: string;
  /** Type of reference: character, setting, or establishing */
  type: 'character' | 'setting' | 'establishing';
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
  image_type?: 'scene' | 'character_ref' | 'setting_ref' | 'establishing';
  character_name?: string;
  setting_name?: string;
  /** Reference images for consistency (used for scene generation) */
  reference_images?: ReferenceImage[];
  /** Generation mode: text-to-image or image+text-to-image */
  generation_mode?: 'text_to_image' | 'image_text_to_image';
  /** Current pass number (for multi-pass establishing image generation with 3+ characters) */
  pass?: number;
  /** Total number of passes planned */
  totalPasses?: number;
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
export const jobs = new Map<string, GenerationJob>();

// Mutex for sequential video generation — only one video job at a time
let videoGenerationLock: Promise<unknown> = Promise.resolve();
function withVideoLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = videoGenerationLock;
  let resolve: () => void;
  videoGenerationLock = new Promise<void>(r => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

// Get the project assets directory
export function getAssetsDir(): string {
  const assetsDir = path.join(getProjectDir(), 'assets', 'images');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  return assetsDir;
}

/**
 * Submit an image generation job.
 * Uses the provider registry to route to the configured provider (ComfyUI, Google, xAI).
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

  const phaseLogger = getPhaseLogger();

  // Determine filename prefix based on image type
  let filenamePrefix: string;

  if (image_type === 'character_ref' && character_name) {
    const cleanName = character_name.replace(/[^a-zA-Z0-9]/g, '');
    filenamePrefix = `CharRef_${cleanName}`;
  } else if (image_type === 'setting_ref' && setting_name) {
    const cleanName = setting_name.replace(/[^a-zA-Z0-9]/g, '');
    filenamePrefix = `SettingRef_${cleanName}`;
  } else if (image_type === 'establishing') {
    // Multi-pass: intermediate passes get a pass suffix; final pass uses clean name
    if (params.pass && params.totalPasses && params.pass < params.totalPasses) {
      filenamePrefix = `Establishing_Scene${scene_number}_pass${params.pass}`;
    } else {
      filenamePrefix = `Establishing_Scene${scene_number}`;
    }
  } else {
    filenamePrefix = `Scene${scene_number}`;
  }

  // Determine context for linking artifact to project
  let context: ArtifactContext;
  if (image_type === 'character_ref' && character_name) {
    context = { entityType: 'character', characterName: character_name, artifactType: 'image' };
  } else if (image_type === 'setting_ref' && setting_name) {
    context = { entityType: 'setting', settingName: setting_name, artifactType: 'image' };
  } else if (image_type === 'establishing') {
    context = { entityType: 'scene', sceneNumber: scene_number, artifactType: 'image' };
  } else {
    context = { entityType: 'scene', sceneNumber: scene_number, artifactType: 'image' };
  }

  // Structured logging for establishing image generation
  if (image_type === 'establishing') {
    phaseLogger.info('ImageGen', 'establishing_start', `Generating establishing image for scene ${scene_number}`, {
      sceneNumber: scene_number,
      characterCount: reference_images.filter(r => r.type === 'character').length,
      generationMode: generation_mode,
      ...(params.pass ? { pass: params.pass, totalPasses: params.totalPasses } : {}),
    });
    if (params.pass) {
      phaseLogger.info('ImageGen', 'multi_pass', `Multi-pass establishing: pass ${params.pass}/${params.totalPasses}`, {
        pass: params.pass,
        totalPasses: params.totalPasses,
        intermediate: params.pass < (params.totalPasses ?? params.pass),
      });
    }
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

  // Fail early if image_text_to_image mode is requested but no reference images are provided
  if (generation_mode === 'image_text_to_image' && reference_images.length === 0) {
    job.status = 'failed';
    job.error =
      'generation_mode is image_text_to_image but no reference images were provided or could be resolved.';
    job.updatedAt = Date.now();
    return {
      jobId,
      status: 'error',
      error: job.error,
      suggestion:
        'Ensure reference images are specified with actual file paths in the prompt file, or provide reference_images in the tool call.',
    };
  }

  try {
    // Get the configured image generation provider
    const provider = getProviderRegistry().getImageGenerator();
    if (!provider) {
      throw new Error('No image generation provider available');
    }

    // Get the project style configuration and enhance the prompt
    const styleConfig = getProjectStyleConfig();

    // Resolve reference images to file paths first, so useImageEditing is based on actual resolved refs
    const resolvedRefImages = reference_images
      .map(ref => {
        const refPath = findImagePathFromArtifactId(ref.image_id);
        if (!refPath || !fs.existsSync(refPath)) {
          console.warn(
            `[generate_image] Failed to resolve ref image: id="${ref.image_id}" type=${ref.type} name="${ref.name}" → path: ${refPath ?? 'null'}`
          );
          return null;
        }
        return { filePath: refPath, type: ref.type as 'character' | 'setting' | 'establishing', name: ref.name };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Determine image editing mode based on whether resolved references actually exist
    const useImageEditing = resolvedRefImages.length > 0;

    // If image editing mode with references, prepend image mapping context
    let basePrompt = prompt;
    if (useImageEditing) {
      const imageContext = reference_images
        .map((ref, i) => `image ${i + 1} is a ${ref.type} reference for "${ref.name}"`)
        .join('. ');
      basePrompt = `${imageContext}. ${prompt}`;
    }

    const enhancedPrompt = `${basePrompt}, ${styleConfig.promptModifier}`;
    const enhancedNegativePrompt = negative_prompt
      ? `${negative_prompt}, ${styleConfig.negativePromptModifier}`
      : styleConfig.negativePromptModifier;

    // Fail if agent explicitly requested image editing but no references resolved
    if (generation_mode === 'image_text_to_image' && resolvedRefImages.length === 0) {
      job.status = 'failed';
      job.error = 'No reference images could be resolved or uploaded for image_text_to_image mode.';
      job.updatedAt = Date.now();
      return {
        jobId,
        status: 'error',
        error: job.error,
        suggestion:
          'Ensure character/setting reference images exist and referenceImagePath is set in project.json.',
        failedReferences: reference_images.map(r => ({
          image_id: r.image_id,
          type: r.type,
          name: r.name,
        })),
      };
    }

    job.status = 'processing';
    job.updatedAt = Date.now();

    // Use provider to generate image
    const progressCallback: ProviderProgressCallback = (info) => {
      job.progress = info.percentage;
      job.updatedAt = Date.now();
      comfyProgressBus.emitProgress({
        jobId,
        percentage: info.percentage,
        message: info.message,
        done: info.done,
      });
    };

    // Resolve workflow: if editing with references, use the configured imageEditing workflow
    const workflowName = useImageEditing
      ? getDefaultWorkflowForCapability('imageEditing')
      : undefined;

    // Guard: image editing mode MUST have a valid workflow — never silently fall back to text-to-image
    if (useImageEditing && !workflowName) {
      job.status = 'failed';
      job.error = 'No image editing workflow configured. Cannot fall back to text-to-image when editing was requested.';
      job.updatedAt = Date.now();
      return {
        jobId,
        status: 'error',
        error: job.error,
        suggestion: 'Ensure an imageEditing capability is configured in the provider registry (e.g., flux2_klein_edit).',
      };
    }

    const result = await provider.generateImage!(
      {
        prompt: enhancedPrompt,
        negativePrompt: enhancedNegativePrompt,
        aspectRatio: aspect_ratio,
        seed,
        outputDir: getAssetsDir(),
        filenamePrefix,
        referenceImages: resolvedRefImages.length > 0 ? resolvedRefImages : undefined,
        workflowName,
      },
      progressCallback,
    );

    // Register artifact
    const artifactId = `img_${nanoid(8)}`;
    const projectDir = getProjectDir();
    let relativePath: string;
    try {
      relativePath = path.relative(projectDir, result.filePath);
    } catch {
      relativePath = result.filePath;
    }

    // Store in manifest
    let assetType: 'character_ref' | 'setting_ref' | 'scene_image' | 'establishing_image' = 'scene_image';
    if (context.entityType === 'character') assetType = 'character_ref';
    else if (context.entityType === 'setting') assetType = 'setting_ref';
    else if (image_type === 'establishing') assetType = 'establishing_image';

    try {
      const assetMetadata: Record<string, unknown> = { jobId, provider: provider.id };
      if (image_type === 'establishing' && params.pass) {
        assetMetadata['pass'] = params.pass;
        assetMetadata['totalPasses'] = params.totalPasses;
        assetMetadata['intermediate'] = params.pass < (params.totalPasses ?? params.pass);
      }
      addAsset({
        id: artifactId,
        type: assetType,
        path: relativePath,
        createdAt: Date.now(),
        metadata: assetMetadata,
      });
    } catch {
      // Project may not exist yet
    }

    // Link artifact to project entity
    linkArtifactToProject(context, artifactId, relativePath);

    // Update job as completed
    job.status = 'completed';
    job.progress = 100;
    job.result = { artifactId, path: relativePath };
    job.updatedAt = Date.now();

    return { jobId, status: 'completed' };
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
 * Link an artifact to its project entity (character, setting, or scene).
 */
function linkArtifactToProject(context: ArtifactContext, artifactId: string, relativePath: string): void {
  try {
    if (context.entityType === 'character' && context.characterName) {
      updateCharacter(context.characterName, {
        referenceImageId: artifactId,
        referenceImagePath: relativePath,
      });
    } else if (context.entityType === 'setting' && context.settingName) {
      updateSetting(context.settingName, {
        referenceImageId: artifactId,
        referenceImagePath: relativePath,
      });
    } else if (context.entityType === 'scene' && context.sceneNumber !== undefined) {
      if (context.artifactType === 'video') {
        updateScene(context.sceneNumber, { videoArtifactId: artifactId });
      } else {
        updateScene(context.sceneNumber, { imageArtifactId: artifactId });
      }
    }
  } catch (e) {
    console.warn(`Failed to link artifact to project entity: ${e}`);
  }
}

/**
 * Wait for a ComfyUI job to complete and download the result.
 */
async function waitForComfyUIJob(
  jobId: string,
  _timeout?: number
): Promise<{
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
    // Use correct output directory based on job type
    const isVideo = job.type === 'video' || job.context?.artifactType === 'video';
    const assetsDir = isVideo
      ? path.join(getProjectDir(), 'assets', 'videos')
      : getAssetsDir();
    if (isVideo && !fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    const client = new ComfyUIClient({
      outputDir: assetsDir,
    });

    // Wait for completion — prefer WebSocket for real-time progress, fall back to HTTP polling
    let completionResult;
    if (job.clientId) {
      completionResult = await client.waitForCompletionWS(job.promptId, job.clientId, (info: { percentage: number; message: string; step?: number; maxSteps?: number; currentNode?: string }) => {
        job.progress = info.percentage;
        job.updatedAt = Date.now();
        comfyProgressBus.emitProgress({
          jobId,
          percentage: info.percentage,
          message: info.message,
          step: info.step,
          maxSteps: info.maxSteps,
          currentNode: info.currentNode,
          done: info.percentage >= 100,
        });
      });
    } else {
      completionResult = await client.waitForCompletion(job.promptId, (pct: number, msg: string) => {
        job.progress = pct;
        job.updatedAt = Date.now();
        comfyProgressBus.emitProgress({
          jobId,
          percentage: pct,
          message: msg,
          done: pct >= 100,
        });
      });
    }

    if (
      completionResult.status !== 'completed' &&
      completionResult.status !== 'completed_with_timeout'
    ) {
      job.status = 'failed';
      job.error = 'Job did not complete';
      job.updatedAt = Date.now();
      return { status: 'failed', error: 'Job did not complete' };
    }

    // Get output files (images or videos)
    debugLog(`[waitForComfyUIJob] Job ${jobId} (type=${job.type}, isVideo=${isVideo}) completed. Getting outputs...`);
    const images = await client.getOutputImages(job.promptId);
    debugLog(`[waitForComfyUIJob] Got ${images.length} output(s) for job ${jobId}: ${JSON.stringify(images.map((i: { filename: string; subfolder: string; type: string; node_id?: string }) => ({ filename: i.filename, subfolder: i.subfolder, type: i.type, node_id: i.node_id })))}`);
    if (!images.length) {
      job.status = 'failed';
      job.error = `No output ${isVideo ? 'videos' : 'images'} found`;
      job.updatedAt = Date.now();
      return { status: 'failed', error: `No output ${isVideo ? 'videos' : 'images'} found` };
    }

    // Download first output file
    const firstImage = images[0]!;
    const outputFilename = `${nanoid(8)}_${firstImage.filename}`;
    debugLog(`[waitForComfyUIJob] Downloading ${firstImage.filename} (subfolder=${firstImage.subfolder}, type=${firstImage.type}) to ${assetsDir}/${outputFilename}`);
    const savedPath = await client.downloadImage(
      firstImage.filename,
      firstImage.subfolder,
      firstImage.type,
      outputFilename
    );

    // Create artifact ID
    const artifactId = `${isVideo ? 'vid' : 'img'}_${nanoid(8)}`;

    // Get relative path for storage
    const projectDir = getProjectDir();
    let relativePath: string;
    try {
      relativePath = path.relative(projectDir, savedPath);
    } catch {
      relativePath = savedPath;
    }

    // Determine asset type based on context
    let assetType: 'character_ref' | 'setting_ref' | 'scene_image' | 'scene_video' | 'establishing_image' = 'scene_image';
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
  `Generate an image using ComfyUI. The generation mode is automatically determined by image_type:

- **character_ref / setting_ref**: Generates a standalone reference image from the prompt alone.
- **establishing / scene**: Generates using reference images for visual consistency. You MUST provide reference_images — the tool will reject the call without them.

This tool blocks until generation is complete and returns the result directly (artifact_id and file_path). No need to call wait_for_job separately.

**Prompt source**: Provide EITHER \`prompt\` (inline text) OR \`prompt_file\` (path to .prompt.md file). Using \`prompt_file\` is preferred as it reads from approved prompt files.

**IMPORTANT**: Establishing and scene images always require reference_images. Do not attempt to generate them without references.`,
  {
    type: 'object',
    properties: {
      scene_number: {
        type: 'number',
        description: 'Scene number (for scene images) or sequence number for reference images',
      },
      prompt: {
        type: 'string',
        description:
          'Detailed image generation prompt describing the visual (use prompt_file instead if prompt exists in a file)',
      },
      prompt_file: {
        type: 'string',
        description:
          'Path to prompt file (e.g., "prompts/images/characters/alice.prompt.md"). Reads the prompt from this file instead of requiring inline prompt text.',
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
        enum: ['scene', 'character_ref', 'setting_ref', 'establishing'],
      },
      character_name: {
        type: 'string',
        description: 'Character name (required for character_ref type)',
      },
      setting_name: {
        type: 'string',
        description: 'Setting name (required for setting_ref type)',
      },
      reference_images: {
        type: 'array',
        description:
          'Character and setting reference images for visual consistency. REQUIRED for establishing and scene image types. Use read_project() to get artifact IDs for character_ref and setting_ref images.',
        items: {
          type: 'object',
          properties: {
            image_id: {
              type: 'string',
              description: 'Artifact ID or path to the reference image',
            },
            type: {
              type: 'string',
              enum: ['character', 'setting', 'establishing'],
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
      pass: {
        type: 'number',
        description: 'Current pass number for multi-pass establishing image generation (3+ characters). Pass 1 result is used as image1 in Pass 2.',
      },
      totalPasses: {
        type: 'number',
        description: 'Total number of passes planned for multi-pass establishing image generation.',
      },
    },
    required: ['scene_number'],
  },
  async args => {
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

      // Apply generation mode from prompt file (prompt file metadata is authoritative over LLM default)
      if (parsed.generationMode) {
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
          params.generation_mode = 'image_text_to_image';
        } else if (parsed.generationMode === 'image_text_to_image') {
          // Prompt file specifies image_text_to_image but references couldn't be resolved
          return {
            status: 'error',
            error: `Prompt file specifies image_text_to_image mode with references (${parsed.references.map(r => r.name).join(', ')}), but reference images could not be found in project state.`,
            suggestion:
              'Ensure character/setting reference images have been generated and are tracked in project.json.',
            requested_references: parsed.references,
          };
        }
      }
    }

    // Validate that we have a prompt from either source
    if (!params.prompt) {
      return {
        status: 'error',
        error:
          'No prompt provided. Supply either "prompt" (inline text) or "prompt_file" (path to prompt file).',
      };
    }

    // Establishing and scene images MUST use reference images — never allow text-to-image fallback
    // This prevents the agent from "helpfully" dropping references after an error
    if (['establishing', 'scene'].includes(params.image_type ?? '') &&
        (!params.reference_images || params.reference_images.length === 0)) {
      return {
        status: 'error',
        error:
          `${params.image_type} images REQUIRE reference images for visual consistency. ` +
          'Text-to-image fallback is not allowed for this image type.',
        suggestion:
          'Ensure character and setting reference images exist in the project (use read_project() to check). ' +
          'Pass them in the reference_images array. Do NOT attempt to generate establishing/scene images without references.',
      };
    }

    // Determine generation mode based on image_type and reference_images
    const generationMode =
      params.generation_mode ??
      ((['scene', 'establishing'].includes(params.image_type ?? '') && params.reference_images?.length)
        ? 'image_text_to_image'
        : 'text_to_image');

    // Validate reference images for image_text_to_image mode
    if (
      generationMode === 'image_text_to_image' &&
      (!params.reference_images || params.reference_images.length === 0)
    ) {
      return {
        status: 'error',
        error:
          'Reference images are required for image_text_to_image mode. Please generate character and setting reference images first.',
        suggestion:
          'Use dispatch_image_agent with image_type "character_ref" or "setting_ref" to create reference images first.',
      };
    }

    // Ensure the resolved generation mode is passed to submitImageGeneration
    // (the agent may pass reference_images without explicitly setting generation_mode)
    params.generation_mode = generationMode;

    // Submit and wait for generation (provider handles the full lifecycle)
    const submitResult = await submitImageGeneration(params);

    if (submitResult.status === 'error') {
      return {
        status: 'error',
        error: submitResult.error,
        job_id: submitResult.jobId,
      };
    }

    // Get the completed job info
    const job = jobs.get(submitResult.jobId);

    return {
      job_id: submitResult.jobId,
      type: 'image',
      status: job?.status ?? submitResult.status,
      artifact_id: job?.result?.artifactId,
      file_path: job?.result?.path,
      error: job?.error,
      generation_mode: generationMode,
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
    type: 'character' | 'setting' | 'establishing';
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
  const motionMatch = content.match(
    /\*\*Motion Prompt:\*\*\s*\n([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n$)/i
  );
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
  const imagePromptMatch = content.match(
    /\*\*Image Prompt:\*\*\s*\n([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n$)/i
  );
  if (imagePromptMatch && imagePromptMatch[1]) {
    result.prompt = imagePromptMatch[1].trim();
  } else {
    // Fall back to simple extraction
    result.prompt = extractPromptFromMarkdown(content);
  }

  // Parse generation mode
  const modeMatch = content.match(
    /\*\*Generation Mode:\*\*\s*\n\s*(text_to_image|image_text_to_image)/i
  );
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
  const refSection = content.match(
    /\*\*Reference Images:\*\*\s*\n([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n$)/i
  );
  if (refSection && refSection[1]) {
    const refLines = refSection[1].split('\n');
    for (const line of refLines) {
      // Extract inline path from [path] brackets or trailing "- path" format
      const bracketPathMatch = line.match(/\[([^\]]+\.(?:png|jpg|jpeg|webp))\]/i);
      const trailingPathMatch = line.match(
        /[-–]\s*((?:assets|characters|settings)\/[^\s]+\.(?:png|jpg|jpeg|webp))\s*$/i
      );
      const inlinePath = bracketPathMatch?.[1] || trailingPathMatch?.[1] || undefined;

      // Match character references
      const charMatch = line.match(
        /^-\s*(?:image\d+:\s*)?(?:Character:\s*)([^(\[-]+?)(?:\s*[\[(-].*)?$/i
      );
      if (charMatch && charMatch[1] && /character/i.test(line)) {
        result.references.push({
          type: 'character',
          name: charMatch[1].trim(),
          path: inlinePath,
        });
        continue;
      }

      // Match setting references
      const settingMatch = line.match(
        /^-\s*(?:image\d+:\s*)?(?:Setting:\s*)([^(\[-]+?)(?:\s*[\[(-].*)?$/i
      );
      if (settingMatch && settingMatch[1] && /setting/i.test(line)) {
        result.references.push({
          type: 'setting',
          name: settingMatch[1].trim(),
          path: inlinePath,
        });
        continue;
      }

      // Match establishing references
      const establishingMatch = line.match(
        /^-\s*(?:image\d+:\s*)?(?:Establishing:\s*)([^(\[-]+?)(?:\s*[\[(-].*)?$/i
      );
      if (establishingMatch && establishingMatch[1] && /establishing/i.test(line)) {
        result.references.push({
          type: 'establishing',
          name: establishingMatch[1].trim(),
          path: inlinePath,
        });
        continue;
      }

      // Fallback: match "- imageN: Name (type)" format
      const imageNMatch = line.match(/^-\s*image\d+:\s*([^(]+?)\s*\((\w+)\)/i);
      if (imageNMatch && imageNMatch[1] && imageNMatch[2]) {
        const type = imageNMatch[2].toLowerCase();
        if (type === 'character' || type === 'setting' || type === 'establishing') {
          result.references.push({
            type: type as 'character' | 'setting' | 'establishing',
            name: imageNMatch[1].trim(),
            path: inlinePath,
          });
        }
      }
    }
  }

  // Parse negative prompt
  const negativeMatch = content.match(
    /\*\*Negative Prompt:\*\*\s*\n([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n$)/i
  );
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
): Array<{ image_id: string; type: 'character' | 'setting' | 'establishing'; name: string }> | null {
  const project = loadProject();
  if (!project) {
    return null;
  }

  const projectDir = getProjectDir();
  const resolved: Array<{ image_id: string; type: 'character' | 'setting' | 'establishing'; name: string }> = [];

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
      console.warn(
        `[resolveReferencesToPaths] Direct path not found: ${fullPath} (ref: ${ref.type}:${ref.name})`
      );
    }

    // Priority 2: Lookup from project.characters / project.settings arrays
    if (ref.type === 'character') {
      const character = project.characters.find(
        c =>
          c.name.toLowerCase().includes(ref.name.toLowerCase()) ||
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
    } else if (ref.type === 'establishing') {
      // Establishing images are resolved via direct path (Priority 1 above) or filename scan (Priority 3 below)
      // No project entity lookup for establishing images — they don't have a dedicated project array
    } else if (ref.type === 'setting') {
      const setting = project.settings.find(
        s =>
          s.name.toLowerCase().includes(ref.name.toLowerCase()) ||
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
      const refPrefix = ref.type === 'character' ? 'CharRef' : ref.type === 'establishing' ? 'Establishing' : 'SettingRef';
      const searchName = ref.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      for (const [_imgId, imgPath] of Object.entries(itemFiles)) {
        const filename = path
          .basename(imgPath as string)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');
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

// Track video generation failures per shot to enforce retry limits
const videoFailureTracker = new Map<string, number>();
const MAX_VIDEO_RETRIES = 2;

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

**Retry limit:** If video generation fails twice for the same shot, this tool will refuse further attempts and return a skip recommendation. Move on to the next shot.

**Input:** Single shot image artifact ID + motion prompt
**Output:** Video clip of that shot with motion

**Example motion prompts:**
- "camera slowly pans across the scene"
- "the character gestures while speaking"
- "wind blows through the trees, clouds drift"
- "subtle breathing motion, eyes blinking"

This tool blocks until video generation is complete and returns the result directly (artifact_id and file_path). No need to call wait_for_job separately. Generate videos one at a time.

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
        description:
          'Description of the motion/animation to apply (use motion_prompt_file instead if prompt exists in a file)',
      },
      motion_prompt_file: {
        type: 'string',
        description:
          'Path to motion prompt file. If JSON with multiple shots, shot_number is used to select the correct prompt.',
      },
      duration: {
        type: 'number',
        description: 'Video duration in seconds (4-20, default 10). Minimum 4s — shorter clips produce unreliable output. Values below 4 are automatically clamped to 4.',
      },
      width: {
        type: 'number',
        description: 'Video width in pixels (default: source image width or 1280)',
      },
      height: {
        type: 'number',
        description: 'Video height in pixels (default: source image height or 720)',
      },
      seed: {
        type: 'number',
        description: 'Random seed for reproducibility (optional)',
      },
      segment_id: {
        type: 'string',
        description: 'Timeline segment ID to auto-update with this video (e.g. "segment_0_shot_1"). When provided, the timeline segment layers are automatically updated after successful generation — no separate update_segment call needed.',
      },
    },
    required: ['shot_image_artifact_id', 'scene_number', 'shot_number'],
  },
  async args => {
    // Acquire lock — only one video generation at a time
    return withVideoLock(async () => {
    const shotImageArtifactId = args['shot_image_artifact_id'] as string;
    const sceneNumber = args['scene_number'] as number;
    const shotNumber = args['shot_number'] as number;

    // Enforce retry limit — prevent wasting time on stuck shots
    const shotKey = `scene${sceneNumber}_shot${shotNumber}`;
    const previousFailures = videoFailureTracker.get(shotKey) ?? 0;
    if (previousFailures >= MAX_VIDEO_RETRIES) {
      debugLog(`[generate_video_from_image] Skipping ${shotKey} — already failed ${previousFailures} times (max ${MAX_VIDEO_RETRIES})`);
      return {
        status: 'skipped',
        error: `Video generation for scene ${sceneNumber}, shot ${shotNumber} has failed ${previousFailures} times. Skipping to avoid wasting pipeline time.`,
        suggestion: 'Move on to the next shot. This shot can be retried manually later or with different parameters (e.g., longer duration, simpler motion prompt).',
        failures: previousFailures,
      };
    }

    let motionPrompt = args['motion_prompt'] as string | undefined;
    const seed = args['seed'] as number | undefined;
    const rawDuration = args['duration'] as number | undefined;
    // Enforce minimum clip duration — LTX-2.3 produces unreliable output below 4s
    const MIN_CLIP_DURATION = 4;
    const duration = rawDuration !== undefined ? Math.max(rawDuration, MIN_CLIP_DURATION) : undefined;
    if (rawDuration !== undefined && rawDuration < MIN_CLIP_DURATION) {
      debugLog(`[generate_video_from_image] Clamped duration from ${rawDuration}s to ${MIN_CLIP_DURATION}s (minimum for reliable output)`);
    }
    const videoWidth = args['width'] as number | undefined;
    const videoHeight = args['height'] as number | undefined;
    const segmentId = args['segment_id'] as string | undefined;

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
        error:
          'No motion prompt provided. Supply either "motion_prompt" (inline text) or "motion_prompt_file" (path to prompt file).',
      };
    }

    // Resolve the single shot image
    const imagePath = findImagePathFromArtifactId(shotImageArtifactId);
    if (!imagePath || !fs.existsSync(imagePath)) {
      return { status: 'error', error: `Image not found for artifact: ${shotImageArtifactId}` };
    }

    const assetsDir = path.join(getProjectDir(), 'assets', 'videos');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    // Create job for tracking
    const jobId = `vid-${Date.now()}-${nanoid(6)}`;
    const context: ArtifactContext = {
      entityType: 'scene',
      sceneNumber,
      shotNumber,
      artifactType: 'video',
    };
    const job: GenerationJob = {
      id: jobId,
      type: 'video',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      context,
    };
    jobs.set(jobId, job);

    try {
      // Get the configured video generation provider
      const provider = getProviderRegistry().getVideoGenerator();
      if (!provider || !provider.generateVideo) {
        throw new Error('No video generation provider available');
      }

      job.status = 'processing';
      job.updatedAt = Date.now();

      const progressCallback: ProviderProgressCallback = (info) => {
        job.progress = info.percentage;
        job.updatedAt = Date.now();
        comfyProgressBus.emitProgress({
          jobId,
          percentage: info.percentage,
          message: info.message,
          done: info.done,
        });
      };

      debugLog(`[generate_video_from_image] Starting job ${jobId} via provider ${provider.id}`);

      const result = await provider.generateVideo(
        {
          sourceImagePath: imagePath,
          prompt: motionPrompt,
          durationSeconds: duration,
          width: videoWidth,
          height: videoHeight,
          seed,
          outputDir: assetsDir,
          filenamePrefix: `Scene${sceneNumber}_shot${shotNumber}_video`,
        },
        progressCallback,
      );

      // Register artifact
      const artifactId = `vid_${nanoid(8)}`;
      const projectDir = getProjectDir();
      let relativePath: string;
      try {
        relativePath = path.relative(projectDir, result.filePath);
      } catch {
        relativePath = result.filePath;
      }

      try {
        addAsset({
          id: artifactId,
          type: 'scene_video',
          path: relativePath,
          createdAt: Date.now(),
          metadata: { jobId, provider: provider.id },
        });
      } catch {
        // Project may not exist yet
      }

      // Link artifact to project
      linkArtifactToProject(context, artifactId, relativePath);

      // Auto-update timeline segment if segment_id was provided
      if (segmentId) {
        try {
          const timeline = loadTimeline(projectDir);
          if (timeline) {
            const layer: TimelineLayerEntry = {
              type: 'visual',
              artifactId,
              filePath: relativePath,
              label: `Scene ${sceneNumber} Shot ${shotNumber} video`,
              source: 'generated',
            };
            const updated = updateSegmentLayers(timeline, segmentId, [layer], undefined, motionPrompt);
            saveTimeline(projectDir, updated);
            debugLog(`[generate_video_from_image] Auto-updated timeline segment ${segmentId} with artifact ${artifactId}`);
          }
        } catch (e) {
          // Non-fatal — log but don't fail the video generation
          debugLog(`[generate_video_from_image] Timeline auto-update failed for ${segmentId}: ${e}`);
        }
      }

      // Update job
      job.status = 'completed';
      job.progress = 100;
      job.result = { artifactId, path: relativePath };
      job.updatedAt = Date.now();

      return {
        job_id: jobId,
        type: 'video',
        status: 'completed',
        artifact_id: artifactId,
        file_path: relativePath,
        segment_id: segmentId,
        timeline_updated: !!segmentId,
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

      // Track failure for retry limiting
      const failCount = (videoFailureTracker.get(shotKey) ?? 0) + 1;
      videoFailureTracker.set(shotKey, failCount);
      debugLog(`[generate_video_from_image] ${shotKey} failure #${failCount}/${MAX_VIDEO_RETRIES}: ${String(error)}`);

      const retriesRemaining = MAX_VIDEO_RETRIES - failCount;
      return {
        status: 'error',
        job_id: jobId,
        error: String(error),
        failures: failCount,
        retries_remaining: retriesRemaining,
        suggestion: retriesRemaining <= 0
          ? `This shot has failed ${failCount} times. Skip it and move on to the next shot.`
          : `${retriesRemaining} retry(s) remaining. Consider using a longer duration or simpler motion prompt.`,
      };
    }
    }); // end withVideoLock
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

Blocks until video generation is complete and returns the result directly.`,
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
  async args => {
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
  `Edit or compose an image using FLUX Klein 9B. Supports up to 5 input images (1 base + 4 references).

The base image becomes "image 1" in the prompt. Additional reference_images become "image 2", "image 3", etc.
To reference characters/settings, use natural phrasing like "Parvati from image 1" or "the setting from image 3".

IMPORTANT: The order of images matters. Match your prompt references to the image order:
- image 1 = base_image_path (primary/base image)
- image 2 = reference_images[0] (e.g. first character reference)
- image 3 = reference_images[1] (e.g. second character or setting reference)
- image 4 = reference_images[2] (e.g. third reference)
- image 5 = reference_images[3] (e.g. fourth reference)

DO NOT use this tool for adding text, subtitles, or dialogue overlays to images. Use compose_panel instead — it is instant, free, and produces better text rendering.

This tool blocks until generation is complete and returns the result directly (artifact_id and file_path). No need to call wait_for_job separately.`,
  {
    type: 'object',
    properties: {
      scene_number: {
        type: 'number',
        description: 'Scene number for the edited image',
      },
      edit_prompt: {
        type: 'string',
        description:
          'Description of the edit/composition. Reference input images as "image1", "image2", "image3" matching their order.',
      },
      base_image_path: {
        type: 'string',
        description: 'Path to the primary image (becomes image1 in prompt)',
      },
      reference_images: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Up to 4 additional reference image paths (become image 2, image 3, etc.). Use for character refs, setting refs, or style references.',
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
  async args => {
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
      // Resolve the base image path
      let imagePath = params.base_image_path;
      if (!path.isAbsolute(imagePath) && !imagePath.startsWith('.')) {
        imagePath = path.join(getProjectDir(), imagePath);
      }

      if (!fs.existsSync(imagePath)) {
        throw new Error(`Base image not found: ${params.base_image_path}`);
      }

      // Resolve reference image paths
      const resolvedRefs: string[] = [];
      if (params.reference_images) {
        for (const refPath of params.reference_images.slice(0, 4)) {
          let resolvedPath = refPath;
          if (!path.isAbsolute(resolvedPath) && !resolvedPath.startsWith('.')) {
            resolvedPath = path.join(getProjectDir(), resolvedPath);
          }
          if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Reference image not found: ${refPath}`);
          }
          resolvedRefs.push(resolvedPath);
        }
      }

      // Get the configured image editing provider
      const provider = getProviderRegistry().getImageEditor();
      if (!provider || !provider.editImage) {
        throw new Error('No image editing provider available');
      }

      job.status = 'processing';
      job.updatedAt = Date.now();

      const progressCallback: ProviderProgressCallback = (info) => {
        job.progress = info.percentage;
        job.updatedAt = Date.now();
        comfyProgressBus.emitProgress({
          jobId,
          percentage: info.percentage,
          message: info.message,
          done: info.done,
        });
      };

      debugLog(`[edit_image] Starting job ${jobId} via provider ${provider.id}`);

      const assetsDir = getAssetsDir();
      const result = await provider.editImage(
        {
          editPrompt: params.edit_prompt,
          baseImagePath: imagePath,
          referenceImages: resolvedRefs.length > 0 ? resolvedRefs : undefined,
          negativePrompt: params.negative_prompt,
          aspectRatio: params.aspect_ratio,
          seed: params.seed,
          outputDir: assetsDir,
          filenamePrefix: `Scene${params.scene_number}_edit`,
        },
        progressCallback,
      );

      // Register artifact
      const artifactId = `img_${nanoid(8)}`;
      const projectDir = getProjectDir();
      let relativePath: string;
      try {
        relativePath = path.relative(projectDir, result.filePath);
      } catch {
        relativePath = result.filePath;
      }

      try {
        addAsset({
          id: artifactId,
          type: 'scene_image',
          path: relativePath,
          createdAt: Date.now(),
          metadata: { jobId, provider: provider.id },
        });
      } catch {
        // Project may not exist yet
      }

      // Link artifact to project
      const context: ArtifactContext = {
        entityType: 'scene',
        sceneNumber: params.scene_number,
        artifactType: 'image',
      };
      linkArtifactToProject(context, artifactId, relativePath);

      // Update job
      job.status = 'completed';
      job.progress = 100;
      job.result = { artifactId, path: relativePath };
      job.updatedAt = Date.now();

      return {
        job_id: jobId,
        type: 'image',
        status: 'completed',
        artifact_id: artifactId,
        file_path: relativePath,
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
        description: 'Timeout in seconds for Remotion jobs only (default: 300). ComfyUI jobs poll indefinitely.',
      },
    },
    required: ['job_id'],
  },
  async args => {
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
        await new Promise(resolve => setTimeout(resolve, 2000));
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
        const result = await waitForComfyUIJob(jobId);
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
  async args => {
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
    const selectedScenes = sceneSummaries
      .filter((_, index) => index % step === 0)
      .slice(0, maxImages);

    const jobIds: string[] = [];
    const storyboardDir = getStoryboardDir();

    console.log(
      `[Storyboard] Generating ${selectedScenes.length} preview images for Act ${actNumber}`
    );

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

        if ((result.status === 'submitted' || result.status === 'completed') && result.jobId) {
          jobIds.push(result.jobId);
          console.log(`[Storyboard] Queued scene ${scene.scene_number}: ${result.jobId}`);
        } else {
          console.error(
            `[Storyboard] Failed to queue scene ${scene.scene_number}: ${result.error}`
          );
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
        description: 'Path to the source shot image (absolute or relative to project root)',
      },
      dialogue: {
        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
        description:
          'Character dialogue text (displayed in quotes). String or array of strings for multiple dialogue lines.',
      },
      narrator: {
        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
        description: 'Narration text (displayed in italics). String or array of strings.',
      },
      sfx: {
        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
        description: 'Sound effect text (displayed in bold uppercase). String or array of strings.',
      },
      output_path: {
        type: 'string',
        description:
          'Path where the composed panel image will be saved (absolute or relative to project root)',
      },
    },
    required: ['image_path', 'output_path'],
  },
  async args => {
    let imagePath = args['image_path'] as string;
    let outputPath = args['output_path'] as string;

    // Resolve relative paths to absolute paths (similar to editImageTool)
    if (!path.isAbsolute(imagePath) && !imagePath.startsWith('.')) {
      imagePath = path.join(getProjectDir(), imagePath);
    }
    if (!path.isAbsolute(outputPath) && !outputPath.startsWith('.')) {
      outputPath = path.join(getProjectDir(), outputPath);
    }

    // Normalize inputs: accept string or array of strings
    const toArray = (val: unknown): string[] => {
      if (!val) return [];
      if (Array.isArray(val))
        return val.filter((s): s is string => typeof s === 'string' && s.length > 0);
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
      const maxLines = Math.floor(
        (maxOverlayHeight - padding * 2 + interLineGap) / (lineHeight + interLineGap)
      );
      let truncated = false;
      if (wrappedLines.length > maxLines && maxLines > 0) {
        wrappedLines.length = maxLines;
        // Replace last line's text with truncation indicator
        const lastLine = wrappedLines[maxLines - 1]!;
        wrappedLines[maxLines - 1] = { text: lastLine.text + ' \u2026', style: lastLine.style };
        truncated = true;
      }

      const finalStripHeight =
        padding * 2 + wrappedLines.length * lineHeight + (wrappedLines.length - 1) * interLineGap;

      // Escape XML special characters for SVG
      const escapeXml = (str: string) =>
        str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

      // Build SVG text elements
      const fontSize = Math.round(lineHeight * 0.85);
      const svgTextElements = wrappedLines
        .map((line, i) => {
          const y = padding + (i + 1) * lineHeight + i * interLineGap;
          const fontStyle = line.style === 'italic' ? ' font-style="italic"' : '';
          const fontWeight = line.style === 'bold' ? ' font-weight="bold"' : '';
          return `<text x="${imgWidth / 2}" y="${y}" text-anchor="middle" fill="white" font-family="sans-serif" font-size="${fontSize}"${fontStyle}${fontWeight}>${escapeXml(line.text)}</text>`;
        })
        .join('\n    ');

      // Overlay translucent black bar at the bottom of the image (no extension)
      const overlayTop = imgHeight - finalStripHeight;
      const svgOverlay = `<svg width="${imgWidth}" height="${imgHeight}">
    <rect x="0" y="${overlayTop}" width="${imgWidth}" height="${finalStripHeight}" fill="black" opacity="0.7"/>
    <g transform="translate(0, ${overlayTop})">
      ${svgTextElements}
    </g>
  </svg>`;

      await sharp(imagePath)
        .composite([
          {
            input: Buffer.from(svgOverlay),
            top: 0,
            left: 0,
          },
        ])
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
        description:
          'Output mode: "pages" for numbered individual files, "webtoon" for a single vertical image. Defaults to "pages".',
      },
    },
    required: ['panels_dir', 'output_dir'],
  },
  async args => {
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
      const files = fs.readdirSync(panelsDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));

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
 * Import a custom ComfyUI workflow into the project.
 * Analyzes the workflow JSON, auto-detects parameter mappings, and registers it.
 */
export const importWorkflowTool: ToolDefinition = createTool(
  'import_workflow',
  `Import a custom ComfyUI workflow into this project. The workflow will be analyzed to auto-detect
prompt, seed, dimension, and image input nodes. Both ComfyUI API format and LiteGraph UI format are supported.

The imported workflow will appear alongside built-in workflows for image/video generation.
After import, the auto-detected parameter mapping (manifest) can be manually edited at the reported path.

Returns the detected manifest with confidence levels for review.`,
  {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the ComfyUI workflow JSON file',
      },
      name: {
        type: 'string',
        description: 'Slug name for the workflow (e.g., "my-anime-workflow"). Must be unique. If not provided, derived from filename.',
      },
      display_name: {
        type: 'string',
        description: 'Human-readable display name for the workflow',
      },
      description: {
        type: 'string',
        description: 'Description of what this workflow does',
      },
    },
    required: ['file_path'],
  },
  async args => {
    const params = args as {
      file_path: string;
      name?: string;
      display_name?: string;
      description?: string;
    };

    const filePath = params.file_path;

    // Validate file exists
    if (!fs.existsSync(filePath)) {
      return { error: `Workflow file not found: ${filePath}` };
    }

    // Read and parse the workflow JSON
    let rawWorkflow: unknown;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      rawWorkflow = JSON.parse(content);
    } catch (e) {
      return { error: `Failed to parse workflow JSON: ${e instanceof Error ? e.message : String(e)}` };
    }

    // Detect format and convert if needed
    const wasLiteGraph = isLiteGraphFormat(rawWorkflow);
    const apiWorkflow = ensureApiFormat(rawWorkflow);

    // Derive name from filename if not provided
    const baseName = path.basename(filePath, '.json')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .toLowerCase();
    const workflowName = params.name || baseName;

    // Check for name collision with existing workflows
    const registry = getRegistry();
    const existing = registry.get(workflowName);
    if (existing && !existing.custom) {
      return { error: `Workflow name '${workflowName}' conflicts with a built-in workflow. Choose a different name.` };
    }

    // Analyze the workflow
    const manifest = analyzeWorkflow(
      apiWorkflow,
      workflowName,
      params.display_name,
      params.description,
    );

    // Save to project's .kshana/workflows/ directory
    let projectDir: string;
    try {
      projectDir = getProjectDir();
    } catch {
      return { error: 'No active project. Create a project first before importing workflows.' };
    }

    const { apiWorkflowPath, manifestPath } = saveCustomWorkflow(
      projectDir,
      workflowName,
      apiWorkflow,
      manifest,
    );

    // Register in the workflow registry
    registry.loadCustomWorkflows(projectDir);

    debugLog(`Imported custom workflow '${workflowName}' from ${filePath}`);

    return {
      success: true,
      name: workflowName,
      displayName: manifest.displayName,
      workflowType: manifest.workflowType,
      outputFormat: manifest.outputFormat,
      convertedFromLiteGraph: wasLiteGraph,
      apiWorkflowPath,
      manifestPath,
      parameterMap: manifest.parameterMap,
      confidence: manifest.confidence,
      message: `Workflow '${workflowName}' imported successfully. ` +
        `Type: ${manifest.workflowType}, Output: ${manifest.outputFormat}. ` +
        (manifest.confidence.notes.length > 0
          ? `Notes: ${manifest.confidence.notes.join('; ')}. `
          : '') +
        `Manifest saved to ${manifestPath} — edit this file to adjust parameter mappings.`,
    };
  },
);

/**
 * Get all video generation tools.
 */
export function getVideoGenerationTools(): ToolDefinition[] {
  return [generateImageTool, generateVideoFromImageTool, editImageTool, importWorkflowTool];
}

/**
 * Get graphic novel specific tools (compose_panel, assemble_graphic_novel).
 * These are only relevant for the graphic_novel template.
 */
export function getGraphicNovelTools(): ToolDefinition[] {
  return [composePanelTool, assembleGraphicNovelTool];
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
