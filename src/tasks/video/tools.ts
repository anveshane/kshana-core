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
  getProjectStyleConfig,
  STYLE_CONFIGS,
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
  reference_images?: string[];
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
    required: ['scene_number'],
  },
  async (args) => {
    let params = args as unknown as ImageGenerationParams;

    // If prompt_file is provided, read and parse the prompt from the file
    const promptFile = args['prompt_file'] as string | undefined;
    if (promptFile) {
      const fullPath = path.join(process.cwd(), PROJECT_DIR, promptFile);
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
  // Format: "- Character: Name (ref_id: xxx)" or "- Setting: Name (ref_id: xxx)"
  const refSection = content.match(/\*\*Reference Images:\*\*\s*\n([\s\S]*?)(?=\n\*\*[A-Z]|\n##|\n$)/i);
  if (refSection && refSection[1]) {
    const refLines = refSection[1].split('\n');
    for (const line of refLines) {
      // Match various formats:
      //   "- Character: Name"
      //   "- Character: Name (ref_id: xxx)"
      //   "- Character: Name (assets/images/path.png)"
      //   "- image1: Name (character) - assets/images/path.png"
      const charMatch = line.match(/^-\s*(?:image\d+:\s*)?(?:Character:\s*)([^(-]+?)(?:\s*\(.*?\))?(?:\s*-\s*.*)?$/i);
      if (charMatch && charMatch[1] && /character/i.test(line)) {
        result.references.push({
          type: 'character',
          name: charMatch[1].trim(),
        });
        continue;
      }

      // Match setting references in various formats
      const settingMatch = line.match(/^-\s*(?:image\d+:\s*)?(?:Setting:\s*)([^(-]+?)(?:\s*\(.*?\))?(?:\s*-\s*.*)?$/i);
      if (settingMatch && settingMatch[1] && /setting/i.test(line)) {
        result.references.push({
          type: 'setting',
          name: settingMatch[1].trim(),
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

  const resolved: Array<{ image_id: string; type: 'character' | 'setting'; name: string }> = [];

  for (const ref of references) {
    if (ref.type === 'character') {
      // Find character by name (case-insensitive partial match)
      const character = project.characters.find(
        c => c.name.toLowerCase().includes(ref.name.toLowerCase()) ||
             ref.name.toLowerCase().includes(c.name.toLowerCase())
      );
      if (character?.referenceImagePath) {
        resolved.push({
          image_id: path.join(process.cwd(), PROJECT_DIR, character.referenceImagePath),
          type: 'character',
          name: character.name,
        });
      } else if (character?.referenceImageId) {
        // Try to resolve from content.images
        const imagePath = project.content?.images?.itemFiles?.[character.referenceImageId];
        if (imagePath) {
          resolved.push({
            image_id: path.join(process.cwd(), PROJECT_DIR, imagePath),
            type: 'character',
            name: character.name,
          });
        }
      }
    } else if (ref.type === 'setting') {
      // Find setting by name (case-insensitive partial match)
      const setting = project.settings.find(
        s => s.name.toLowerCase().includes(ref.name.toLowerCase()) ||
             ref.name.toLowerCase().includes(s.name.toLowerCase())
      );
      if (setting?.referenceImagePath) {
        resolved.push({
          image_id: path.join(process.cwd(), PROJECT_DIR, setting.referenceImagePath),
          type: 'setting',
          name: setting.name,
        });
      } else if (setting?.referenceImageId) {
        // Try to resolve from content.images
        const imagePath = project.content?.images?.itemFiles?.[setting.referenceImageId];
        if (imagePath) {
          resolved.push({
            image_id: path.join(process.cwd(), PROJECT_DIR, imagePath),
            type: 'setting',
            name: setting.name,
          });
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
  const project = loadProject();
  if (!project) return undefined;

  // Check project assets manifest
  const assetsDir = path.join(process.cwd(), PROJECT_DIR, 'assets');
  const manifestPath = path.join(assetsDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const asset = manifest.assets?.find((a: { id: string }) => a.id === artifactId);
    if (asset) {
      return path.join(process.cwd(), PROJECT_DIR, asset.path);
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
          return path.join(process.cwd(), PROJECT_DIR, asset.path);
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

Returns a job ID. Use wait_for_job to check completion.

**Motion prompt source**: Provide EITHER \`motion_prompt\` (inline text) OR \`motion_prompt_file\` (path to .motion.md file). Using \`motion_prompt_file\` is preferred as it reads from approved prompt files.`,
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
        description: 'Description of the motion/animation to apply (use motion_prompt_file instead if prompt exists in a file)',
      },
      motion_prompt_file: {
        type: 'string',
        description: 'Path to motion prompt file (e.g., "prompts/videos/scenes/scene-1.motion.md"). Reads the prompt from this file instead of requiring inline text.',
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
    required: ['scene_image_artifact_id', 'scene_number'],
  },
  async (args) => {
    const sceneImageArtifactId = args['scene_image_artifact_id'] as string;
    const sceneNumber = args['scene_number'] as number;
    let motionPrompt = args['motion_prompt'] as string | undefined;

    // If motion_prompt_file is provided, read the prompt from the file
    const motionPromptFile = args['motion_prompt_file'] as string | undefined;
    if (motionPromptFile) {
      const fullPath = path.join(process.cwd(), PROJECT_DIR, motionPromptFile);
      if (!fs.existsSync(fullPath)) {
        return {
          status: 'error',
          error: `Motion prompt file not found: ${motionPromptFile}`,
          suggestion: 'Check that the motion prompt file path is correct and the file exists.',
        };
      }
      const promptContent = fs.readFileSync(fullPath, 'utf-8');
      motionPrompt = extractPromptFromMarkdown(promptContent);
    }

    // Validate that we have a motion prompt from either source
    if (!motionPrompt) {
      return {
        status: 'error',
        error: 'No motion prompt provided. Supply either "motion_prompt" (inline text) or "motion_prompt_file" (path to prompt file).',
      };
    }
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

      const assetsDir = path.join(process.cwd(), PROJECT_DIR, 'assets', 'videos');
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
  `Edit or compose an image using ComfyUI's Qwen Edit workflow. Supports up to 3 input images.

The base image becomes "image1" in the prompt. Additional reference_images become "image2" and "image3".
To reference characters/settings, use natural phrasing like "Parvati from image1" or "the setting from image3".

IMPORTANT: The order of images matters. Match your prompt references to the image order:
- image1 = base_image_path (primary/base image)
- image2 = reference_images[0] (e.g. first character reference)
- image3 = reference_images[1] (e.g. second character or setting reference)

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
        imagePath = path.join(process.cwd(), PROJECT_DIR, imagePath);
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
            resolvedPath = path.join(process.cwd(), PROJECT_DIR, resolvedPath);
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
  const storyboardDir = path.join(process.cwd(), PROJECT_DIR, 'assets', 'storyboard');
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
 * Get all video generation tools.
 */
export function getVideoGenerationTools(): ToolDefinition[] {
  return [
    generateImageTool,
    generateVideoFromImageTool,
    generateVideoFromFramesTool,
    editImageTool,
    generateStoryboardTool,
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
]);
