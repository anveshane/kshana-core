/**
 * ComfyUI provider — wraps the existing ComfyUI service to implement GenerationProvider.
 *
 * All workflows (built-in and custom) go through the same manifest-based
 * parameterization path. No workflow-specific hardcoding.
 */
import * as fs from 'fs';
import * as path from 'path';
import { nanoid } from 'nanoid';
import {
  ComfyUIClient,
  loadWorkflowTemplate,
  parameterizeCustomWorkflow,
  getRegistry,
} from '../../comfyui/index.js';
import { ensureApiFormat } from '../../comfyui/WorkflowAnalyzer.js';
import type { WorkflowManifest } from '../../comfyui/WorkflowAnalyzer.js';
import type {
  GenerationProvider,
  GenerationCapability,
  GenerationResult,
  ImageGenerationInput,
  ImageEditInput,
  VideoGenerationInput,
  ProviderProgressCallback,
} from '../types.js';

const DEBUG_LOG_PATH = path.join(process.cwd(), 'logs', 'debug.log');
function debugLog(message: string): void {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] [ComfyUIProvider] ${message}\n`);
  } catch {
    // Ignore logging errors
  }
}

export class ComfyUIProvider implements GenerationProvider {
  readonly id = 'comfyui';
  readonly displayName = 'ComfyUI (Local)';
  readonly capabilities: GenerationCapability[] = [
    'image_generation',
    'image_editing',
    'video_generation',
  ];

  isAvailable(): boolean {
    const url = process.env['COMFYUI_BASE_URL'] || 'http://localhost:8188';
    return !!url;
  }

  async generateImage(
    input: ImageGenerationInput,
    onProgress?: ProviderProgressCallback,
  ): Promise<GenerationResult> {
    const {
      prompt,
      negativePrompt = '',
      aspectRatio = '16:9',
      seed,
      outputDir,
      filenamePrefix = 'image',
      referenceImages = [],
      workflowName: requestedWorkflow,
    } = input;
    const abortSignal = input.abortSignal;

    const registry = getRegistry();
    const client = new ComfyUIClient({ outputDir });

    // Determine workflow: explicit override > caller-specified > default for text-to-image
    // The caller (tools.ts) resolves the correct workflow via getDefaultWorkflowForCapability()
    // When reference images are provided, a workflow MUST be explicitly specified — no silent fallback
    if (!requestedWorkflow && referenceImages.length > 0) {
      throw new Error(
        'Reference images provided but no workflow specified. ' +
        'Image editing requires an explicit workflow (e.g., flux2_klein_edit). ' +
        'This is a bug — the caller should resolve the workflow before calling generateImage.'
      );
    }
    const workflowName = requestedWorkflow || 'zimage';
    const workflowMetadata = registry.get(workflowName);

    if (!workflowMetadata) {
      throw new Error(`Workflow '${workflowName}' not found`);
    }

    let inputImageFilename: string | undefined;
    const referenceImageFilenames: string[] = [];

    // Upload reference images if needed
    if (referenceImages.length > 0) {
      const imagesToUpload = referenceImages.slice(0, 3);
      for (let i = 0; i < imagesToUpload.length; i++) {
        const refImage = imagesToUpload[i]!;
        if (!fs.existsSync(refImage.filePath)) {
          console.warn(`[ComfyUIProvider] Reference image not found: ${refImage.filePath}`);
          continue;
        }
        const uploadResult = await client.uploadImage(refImage.filePath);
        if (i === 0) {
          inputImageFilename = uploadResult.name;
        } else {
          referenceImageFilenames.push(uploadResult.name);
        }
      }

      if (!inputImageFilename && workflowMetadata.requiresBaseImage) {
        throw new Error('No reference images could be uploaded for image+text generation mode.');
      }
    }

    // Resolve dimensions from aspect ratio
    const [width, height] = aspectRatioToDimensions(aspectRatio);

    // Load, convert to API format, and parameterize via manifest
    onProgress?.({ percentage: 0, message: 'Loading workflow...', done: false });
    const workflow = this.loadAndParameterize(workflowName, {
      prompt,
      negativePrompt,
      seed,
      width,
      height,
      filenamePrefix,
      inputImageFilenames: inputImageFilename
        ? [inputImageFilename, ...referenceImageFilenames]
        : undefined,
    });

    // Queue and wait
    onProgress?.({ percentage: 0, message: 'Queueing prompt...', done: false });
    const queueResult = await client.queueWorkflow(workflow, undefined, true);
    const promptId = queueResult.promptId;

    debugLog(`Queued image generation (prompt=${promptId}, workflow=${workflowName})`);
    onProgress?.({ percentage: 0, message: 'Waiting for ComfyUI...', done: false });

    await this.waitForCompletion(client, promptId, queueResult.clientId, onProgress, abortSignal);
    return this.downloadFirstOutput(client, promptId, outputDir, 'image/png');
  }

  async editImage(
    input: ImageEditInput,
    onProgress?: ProviderProgressCallback,
  ): Promise<GenerationResult> {
    const {
      editPrompt,
      baseImagePath,
      referenceImages = [],
      negativePrompt,
      aspectRatio,
      seed,
      outputDir,
      filenamePrefix = 'edit',
    } = input;
    const abortSignal = input.abortSignal;

    const registry = getRegistry();
    const workflowName = input.workflowName || 'flux2_klein_edit';
    const workflowMetadata = registry.get(workflowName);
    if (!workflowMetadata) {
      throw new Error(`Workflow '${workflowName}' not found`);
    }

    if (!fs.existsSync(baseImagePath)) {
      throw new Error(`Base image not found: ${baseImagePath}`);
    }

    const client = new ComfyUIClient({ outputDir });

    // Upload base image
    onProgress?.({ percentage: 0, message: 'Uploading base image...', done: false });
    const uploadResult = await client.uploadImage(baseImagePath, 'input', true);

    // Upload reference images (up to 4)
    const referenceImageFilenames: string[] = [];
    for (const refPath of referenceImages.slice(0, 4)) {
      if (!fs.existsSync(refPath)) {
        throw new Error(`Reference image not found: ${refPath}`);
      }
      onProgress?.({ percentage: 0, message: 'Uploading reference image...', done: false });
      const refUpload = await client.uploadImage(refPath, 'input', true);
      referenceImageFilenames.push(refUpload.name);
    }

    // Resolve dimensions
    const [width, height] = aspectRatio ? aspectRatioToDimensions(aspectRatio) : [undefined, undefined];

    // Load and parameterize via manifest
    onProgress?.({ percentage: 0, message: 'Loading workflow...', done: false });
    const workflow = this.loadAndParameterize(workflowName, {
      prompt: editPrompt,
      negativePrompt,
      seed,
      width,
      height,
      filenamePrefix,
      inputImageFilenames: [uploadResult.name, ...referenceImageFilenames],
    });

    // Queue and wait
    onProgress?.({ percentage: 0, message: 'Queueing prompt...', done: false });
    const queueResult = await client.queueWorkflow(workflow, undefined, true);

    debugLog(`Queued image edit (prompt=${queueResult.promptId})`);
    onProgress?.({ percentage: 0, message: 'Waiting for ComfyUI...', done: false });

    await this.waitForCompletion(client, queueResult.promptId, queueResult.clientId, onProgress, abortSignal);
    return this.downloadFirstOutput(client, queueResult.promptId, outputDir, 'image/png');
  }

  async generateVideo(
    input: VideoGenerationInput,
    onProgress?: ProviderProgressCallback,
  ): Promise<GenerationResult> {
    const {
      sourceImagePath,
      prompt,
      durationSeconds,
      width,
      height,
      seed,
      outputDir,
      filenamePrefix = 'video',
      workflowName: requestedWorkflow,
    } = input;
    const abortSignal = input.abortSignal;

    if (!fs.existsSync(sourceImagePath)) {
      throw new Error(`Source image not found: ${sourceImagePath}`);
    }

    const registry = getRegistry();
    const workflowName = requestedWorkflow || 'ltx23';
    const workflowMetadata = registry.get(workflowName);
    if (!workflowMetadata) {
      throw new Error(`Workflow '${workflowName}' not found`);
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const client = new ComfyUIClient({ outputDir });

    // Upload source image
    onProgress?.({ percentage: 0, message: 'Uploading source image...', done: false });
    const uploadResult = await client.uploadImage(sourceImagePath, 'input', true);

    // Build extra params for video-specific mappings (t2v toggle, duration)
    const t2vMode = !uploadResult.name; // false for I2V since we have an image
    const duration = Math.min(Math.max(durationSeconds ?? 10, 1), 20);
    const extra: Record<string, unknown> = {
      t2vMode,
      durationSeconds: duration,
    };

    // Load and parameterize via manifest
    onProgress?.({ percentage: 0, message: 'Loading workflow...', done: false });
    const workflow = this.loadAndParameterize(workflowName, {
      prompt,
      seed,
      width,
      height,
      filenamePrefix: filenamePrefix ? `video/${filenamePrefix}` : 'video/LTX23',
      inputImageFilenames: [uploadResult.name],
      extra,
    });

    // Queue and wait
    onProgress?.({ percentage: 0, message: 'Queueing prompt...', done: false });
    const queueResult = await client.queueWorkflow(workflow, undefined, true);

    debugLog(`Queued video generation (prompt=${queueResult.promptId}, workflow=${workflowName})`);
    onProgress?.({ percentage: 0, message: 'Waiting for ComfyUI...', done: false });

    await this.waitForCompletion(client, queueResult.promptId, queueResult.clientId, onProgress, abortSignal);
    return this.downloadFirstOutput(client, queueResult.promptId, outputDir, 'video/mp4');
  }

  // ── Core: unified workflow loading + parameterization ────────────────────────

  /**
   * Load any workflow (built-in or custom), convert to API format if needed,
   * resolve its manifest, and parameterize via the generic engine.
   */
  private loadAndParameterize(
    workflowName: string,
    params: {
      prompt?: string;
      negativePrompt?: string;
      seed?: number;
      width?: number;
      height?: number;
      filenamePrefix?: string;
      inputImageFilenames?: string[];
      extra?: Record<string, unknown>;
    },
  ): Record<string, unknown> {
    const registry = getRegistry();
    const metadata = registry.get(workflowName);
    if (!metadata) {
      throw new Error(`Workflow '${workflowName}' not found in registry`);
    }

    // Get or auto-generate the manifest
    const manifest = registry.getManifest(workflowName);
    if (!manifest) {
      throw new Error(`No manifest available for workflow '${workflowName}'`);
    }

    // Load the workflow JSON
    let apiWorkflow: Record<string, unknown>;
    if (metadata.custom && metadata.apiWorkflowPath) {
      // Custom workflow: load from project directory
      const content = fs.readFileSync(metadata.apiWorkflowPath, 'utf-8');
      apiWorkflow = JSON.parse(content);
    } else {
      // Built-in workflow: load from workflows directory, convert if LiteGraph
      const template = loadWorkflowTemplate(metadata.filename);
      apiWorkflow = ensureApiFormat(template);
    }

    // Parameterize using the manifest — same path for all workflows
    return parameterizeCustomWorkflow(apiWorkflow, manifest, params);
  }

  // ── Shared helpers ──────────────────────────────────────────────────────────

  private async waitForCompletion(
    client: ComfyUIClient,
    promptId: string,
    clientId: string | undefined,
    onProgress?: ProviderProgressCallback,
    signal?: AbortSignal,
  ): Promise<void> {
    const progressHandler = (info: { percentage: number; message: string; step?: number; maxSteps?: number; currentNode?: string }) => {
      onProgress?.({
        percentage: info.percentage,
        message: info.message,
        done: info.percentage >= 100,
        step: info.step,
        maxSteps: info.maxSteps,
      });
    };

    let result;
    if (clientId) {
      result = await client.waitForCompletionWS(promptId, clientId, (info) => {
        progressHandler({
          percentage: info.percentage,
          message: info.message,
          step: info.step,
          maxSteps: info.maxSteps,
          currentNode: info.currentNode,
        });
      }, signal);
    } else {
      result = await client.waitForCompletion(promptId, (pct, msg) => {
        progressHandler({ percentage: pct, message: msg });
      }, undefined, signal);
    }

    if (result.status !== 'completed' && result.status !== 'completed_with_timeout') {
      throw new Error(`ComfyUI job did not complete (status: ${result.status})`);
    }
  }

  private async downloadFirstOutput(
    client: ComfyUIClient,
    promptId: string,
    _outputDir: string,
    mimeType: string,
  ): Promise<GenerationResult> {
    const images = await client.getOutputImages(promptId);
    if (!images.length) {
      throw new Error('No output files from ComfyUI');
    }

    const first = images[0]!;
    const outputFilename = `${nanoid(8)}_${first.filename}`;
    debugLog(`Downloading ${first.filename} → ${_outputDir}/${outputFilename}`);

    const savedPath = await client.downloadImage(
      first.filename,
      first.subfolder,
      first.type,
      outputFilename,
    );

    return {
      filePath: savedPath,
      mimeType,
      metadata: { promptId, comfyuiFilename: first.filename },
    };
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

function aspectRatioToDimensions(aspectRatio: string): [number, number] {
  switch (aspectRatio) {
    case '16:9': return [1536, 864];
    case '9:16': return [864, 1536];
    case '4:3': return [1366, 1024];
    case '3:4': return [1024, 1366];
    default: return [1024, 1024];
  }
}
