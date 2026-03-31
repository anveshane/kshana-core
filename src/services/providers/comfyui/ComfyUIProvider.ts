/**
 * ComfyUI provider — wraps the existing ComfyUI service to implement GenerationProvider.
 *
 * Delegates to ComfyUIClient, WorkflowRegistry, and WorkflowLoader.
 * Does NOT modify any existing ComfyUI service code.
 */
import * as fs from 'fs';
import * as path from 'path';
import { nanoid } from 'nanoid';
import {
  ComfyUIClient,
  loadWorkflowTemplate,
  parameterizeWorkflowByName,
  getRegistry,
} from '../../comfyui/index.js';
import { parameterizeGeneric } from '../../comfyui/WorkflowLoader.js';
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
    // ComfyUI is available if the server URL is set (defaults to localhost:8188)
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
      width: overrideWidth,
      height: overrideHeight,
      seed,
      outputDir,
      filenamePrefix = 'image',
      referenceImages = [],
    } = input;

    const registry = getRegistry();
    const client = new ComfyUIClient({ outputDir });

    // Determine workflow: check registry for user override, fall back to built-in defaults
    const useQwenEdit = referenceImages.length > 0;
    let workflowName = useQwenEdit ? 'qwen_edit' : 'zimage';

    try {
      const { getWorkflowModeRegistry } = await import('../WorkflowModeRegistry.js');
      const modeRegistry = getWorkflowModeRegistry();
      const pipeline = useQwenEdit ? 'image_editing' as const : 'image_generation' as const;
      const activeMode = modeRegistry.getActiveForPipeline(pipeline, 'comfyui');
      if (activeMode) {
        workflowName = activeMode.id;
        debugLog(`Using ${pipeline} workflow: ${activeMode.displayName} (${activeMode.id})`);
      }
    } catch { /* registry not available, use defaults */ }

    const workflowMetadata = registry.get(workflowName);
    if (!workflowMetadata) {
      throw new Error(`Workflow '${workflowName}' not found`);
    }

    let inputImageFilename: string | undefined;
    const referenceImageFilenames: string[] = [];

    // Upload reference images if using qwen_edit
    if (useQwenEdit) {
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

      if (!inputImageFilename) {
        throw new Error('No reference images could be uploaded for image+text generation mode.');
      }
    }

    // Load and parameterize workflow
    onProgress?.({ percentage: 0, message: 'Loading workflow...', done: false });
    const template = loadWorkflowTemplate(workflowMetadata.filename);
    const workflow = parameterizeWorkflowByName(workflowName, template, {
      sceneNumber: 0,
      prompt,
      negativePrompt,
      aspectRatio,
      width: overrideWidth,
      height: overrideHeight,
      seed,
      filenamePrefix,
      inputImageFilename,
      referenceImageFilenames: referenceImageFilenames.length > 0 ? referenceImageFilenames : undefined,
    });

    // Queue and wait
    onProgress?.({ percentage: 0, message: 'Queueing prompt...', done: false });
    const queueResult = await client.queueWorkflow(workflow as Record<string, unknown>, undefined, true);
    const promptId = queueResult.promptId;

    debugLog(`Queued image generation (prompt=${promptId})`);
    onProgress?.({ percentage: 0, message: 'Waiting for ComfyUI...', done: false });

    // Wait for completion with progress
    await this.waitForCompletion(client, promptId, queueResult.clientId, onProgress);

    // Download result
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

    const registry = getRegistry();
    const workflowMetadata = registry.get('qwen_edit');
    if (!workflowMetadata) {
      throw new Error("Workflow 'qwen_edit' not found");
    }

    if (!fs.existsSync(baseImagePath)) {
      throw new Error(`Base image not found: ${baseImagePath}`);
    }

    const client = new ComfyUIClient({ outputDir });

    // Upload base image
    onProgress?.({ percentage: 0, message: 'Uploading base image...', done: false });
    const uploadResult = await client.uploadImage(baseImagePath, 'input', true);

    // Upload reference images (up to 2)
    const referenceImageFilenames: string[] = [];
    for (const refPath of referenceImages.slice(0, 2)) {
      if (!fs.existsSync(refPath)) {
        throw new Error(`Reference image not found: ${refPath}`);
      }
      onProgress?.({ percentage: 0, message: 'Uploading reference image...', done: false });
      const refUpload = await client.uploadImage(refPath, 'input', true);
      referenceImageFilenames.push(refUpload.name);
    }

    // Load and parameterize workflow
    onProgress?.({ percentage: 0, message: 'Loading workflow...', done: false });
    const template = loadWorkflowTemplate(workflowMetadata.filename);
    const workflow = parameterizeWorkflowByName('qwen_edit', template, {
      sceneNumber: 0,
      prompt: editPrompt,
      negativePrompt,
      aspectRatio,
      seed,
      inputImageFilename: uploadResult.name,
      referenceImageFilenames: referenceImageFilenames.length > 0 ? referenceImageFilenames : undefined,
      filenamePrefix,
    });

    // Queue and wait
    onProgress?.({ percentage: 0, message: 'Queueing prompt...', done: false });
    const queueResult = await client.queueWorkflow(workflow as Record<string, unknown>, undefined, true);

    debugLog(`Queued image edit (prompt=${queueResult.promptId})`);
    onProgress?.({ percentage: 0, message: 'Waiting for ComfyUI...', done: false });

    await this.waitForCompletion(client, queueResult.promptId, queueResult.clientId, onProgress);

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
    } = input;

    const isT2V = !sourceImagePath || !fs.existsSync(sourceImagePath);

    if (!isT2V && !fs.existsSync(sourceImagePath)) {
      throw new Error(`Source image not found: ${sourceImagePath}`);
    }

    const registry = getRegistry();

    // Determine workflow: check for user override first, then modeId, fall back to built-in 'ltx23'
    let workflowName = 'ltx23';
    let modeManifest = null as any;
    try {
      const { getWorkflowModeRegistry } = await import('../WorkflowModeRegistry.js');
      const modeRegistry = getWorkflowModeRegistry();

      // Check for user override first — this takes priority over built-in modes
      const override = modeRegistry.getActiveForPipeline('video_generation', 'comfyui');
      if (override && override.isOverride && !override.builtIn) {
        modeManifest = override;
        debugLog(`Using user override workflow: ${override.displayName} (${override.id})`);
      } else {
        // No user override — use modeId from generation strategy, or fall back to active built-in
        if (input.modeId) {
          modeManifest = modeRegistry.getMode(input.modeId);
        }
        if (!modeManifest) {
          modeManifest = override; // active built-in
        }
        if (modeManifest) {
          debugLog(`Using video mode: ${modeManifest.displayName} (${modeManifest.id})`);
        }
      }
    } catch { /* registry not available, use default */ }

    // Determine if this is a user-uploaded workflow or a built-in
    const isUserWorkflow = modeManifest && !modeManifest.builtIn && modeManifest.isOverride;

    // Ensure output dir exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const client = new ComfyUIClient({ outputDir });

    // Upload source image (skip for t2v)
    let uploadResult: { name: string } | null = null;
    if (!isT2V) {
      onProgress?.({ percentage: 0, message: 'Uploading source image...', done: false });
      uploadResult = await client.uploadImage(sourceImagePath, 'input', true);
    } else {
      onProgress?.({ percentage: 0, message: 'Text-to-video mode...', done: false });
    }

    // Load and parameterize workflow
    onProgress?.({ percentage: 0, message: `Loading workflow: ${modeManifest?.displayName ?? 'ltx23'}...`, done: false });

    let workflow: Record<string, unknown>;

    if (isUserWorkflow && modeManifest.workflowFile && modeManifest.parameterMappings?.length > 0) {
      // User-uploaded workflow: load from manifest path, use generic parameterizer
      const { getWorkflowModeRegistry } = await import('../WorkflowModeRegistry.js');
      const modeRegistry = getWorkflowModeRegistry();
      const manifestDir = modeRegistry.getManifestDir(modeManifest.id);

      let workflowPath: string;
      if (manifestDir) {
        // Resolve workflow file relative to manifest directory
        workflowPath = path.join(manifestDir, modeManifest.workflowFile);
      } else {
        // Fall back: try workflows/user/ directory
        workflowPath = path.join(process.cwd(), 'workflows', 'user', modeManifest.workflowFile);
      }

      if (!fs.existsSync(workflowPath)) {
        throw new Error(`User workflow file not found: ${workflowPath}`);
      }

      debugLog(`Loading user workflow from: ${workflowPath} (isT2V=${isT2V})`);
      const template = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
      const genericParams: Record<string, unknown> = {
        prompt,
        negative_prompt: '',
        seed,
        filenamePrefix,
        width,
        height,
      };
      if (!isT2V && uploadResult?.name) {
        genericParams['first_frame'] = uploadResult.name;
      }
      workflow = parameterizeGeneric(template, modeManifest, genericParams) as Record<string, unknown>;

      // For i2v: ensure boolean toggle nodes for first_frame are set to true
      // For t2v: ensure they are set to false (workflow default)
      // This handles workflows that use a PrimitiveBoolean to switch between i2v/t2v modes
      for (const mapping of modeManifest.parameterMappings) {
        if (mapping.input === 'first_frame') {
          const node = (workflow as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>)[mapping.nodeId];
          if (node?.class_type === 'PrimitiveBoolean') {
            node.inputs = node.inputs || {};
            node.inputs[mapping.field] = !isT2V;
            debugLog(`Set boolean node ${mapping.nodeId}.${mapping.field} = ${!isT2V} (${isT2V ? 't2v' : 'i2v'} mode)`);
          }
        }
      }
    } else {
      // Built-in workflow: use the old registry + named parameterizer
      const workflowMetadata = registry.get(workflowName);
      if (!workflowMetadata) {
        throw new Error(`Workflow '${workflowName}' not found`);
      }
      const template = loadWorkflowTemplate(workflowMetadata.filename);
      workflow = parameterizeWorkflowByName(workflowName, template, {
        sceneNumber: 0,
        prompt,
        seed,
        inputImageFilename: uploadResult?.name,
        filenamePrefix,
        durationSeconds,
        width,
        height,
      } as Parameters<typeof parameterizeWorkflowByName>[2]) as Record<string, unknown>;
    }

    // Queue and wait
    onProgress?.({ percentage: 0, message: 'Queueing prompt...', done: false });
    const queueResult = await client.queueWorkflow(workflow as Record<string, unknown>, undefined, true);

    debugLog(`Queued video generation (prompt=${queueResult.promptId})`);
    onProgress?.({ percentage: 0, message: 'Waiting for ComfyUI...', done: false });

    await this.waitForCompletion(client, queueResult.promptId, queueResult.clientId, onProgress);

    const result = await this.downloadFirstOutput(client, queueResult.promptId, outputDir, 'video/mp4');
    // Inject workflow name into metadata for upstream logging
    const workflowDisplayName = modeManifest?.displayName ?? 'LTX-2.3 (built-in)';
    result.metadata = { ...result.metadata, workflowName: workflowDisplayName, workflowId: modeManifest?.id ?? 'ltx23' };
    return result;
  }

  // ── Shared helpers ──────────────────────────────────────────────────────────

  private async waitForCompletion(
    client: ComfyUIClient,
    promptId: string,
    clientId: string | undefined,
    onProgress?: ProviderProgressCallback,
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
      });
    } else {
      result = await client.waitForCompletion(promptId, (pct, msg) => {
        progressHandler({ percentage: pct, message: msg });
      });
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
