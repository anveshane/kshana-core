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
import type { ImageInfo } from '../../comfyui/ComfyUIClient.js';
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
      seed: inputSeed,
      outputDir,
      filenamePrefix = 'image',
      referenceImages = [],
    } = input;
    // Randomize seed if not provided — prevents user workflows from reusing the template's fixed seed
    const seed = inputSeed ?? Math.floor(Math.random() * 2 ** 32);

    const registry = getRegistry();
    const client = new ComfyUIClient({ outputDir });

    // Determine workflow: check registry for user override, fall back to built-in defaults
    const useQwenEdit = referenceImages.length > 0;
    let workflowName = useQwenEdit ? 'qwen_edit' : 'zimage';
    let modeManifest: any = null;

    try {
      const { getWorkflowModeRegistry } = await import('../WorkflowModeRegistry.js');
      const modeRegistry = getWorkflowModeRegistry();
      const pipeline = useQwenEdit ? 'image_editing' as const : 'image_generation' as const;
      const activeMode = modeRegistry.getActiveForPipeline(pipeline, 'comfyui');
      if (activeMode) {
        modeManifest = activeMode;
        workflowName = activeMode.id;
        debugLog(`Using ${pipeline} workflow: ${activeMode.displayName} (${activeMode.id})${activeMode.isOverride ? ' [user override]' : ''}`);
      }
    } catch { /* registry not available, use defaults */ }

    const hasManifestWorkflow = modeManifest && modeManifest.workflowFile && modeManifest.parameterMappings?.length > 0;

    let inputImageFilename: string | undefined;
    const referenceImageFilenames: string[] = [];

    // Upload reference images if using editing workflow
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
    onProgress?.({ percentage: 0, message: `Loading workflow: ${modeManifest?.displayName ?? workflowName}...`, done: false });

    let workflow: Record<string, unknown>;

    if (hasManifestWorkflow) {
      // User workflow: load from manifest path, use generic parameterizer
      const { getWorkflowModeRegistry } = await import('../WorkflowModeRegistry.js');
      const modeRegistry = getWorkflowModeRegistry();
      const manifestDir = modeRegistry.getManifestDir(modeManifest.id);
      const workflowPath = manifestDir
        ? path.join(manifestDir, modeManifest.workflowFile)
        : path.join(process.cwd(), 'workflows', 'user', modeManifest.workflowFile);

      if (!fs.existsSync(workflowPath)) {
        throw new Error(`User workflow file not found: ${workflowPath}`);
      }

      debugLog(`Loading user image workflow from: ${workflowPath}`);
      const template = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
      const genParams: Record<string, unknown> = {
        prompt,
        negative_prompt: negativePrompt,
        seed,
        base_image: inputImageFilename ?? '',
        filenamePrefix,
        width: overrideWidth,
        height: overrideHeight,
      };
      // Fill all reference slots — unused ones get the base image
      for (let i = 0; i < 4; i++) {
        genParams[`reference_image_${i + 1}`] = referenceImageFilenames[i] ?? inputImageFilename ?? '';
      }
      workflow = parameterizeGeneric(template, modeManifest, genParams) as Record<string, unknown>;

      // Safety: replace any remaining LoadImage placeholders
      for (const [, wfNode] of Object.entries(workflow)) {
        const n = wfNode as { class_type?: string; inputs?: Record<string, unknown> };
        if (n.class_type === 'LoadImage' && typeof n.inputs?.['image'] === 'string') {
          if ((n.inputs['image'] as string).startsWith('ref_image_')) {
            n.inputs['image'] = inputImageFilename ?? '';
          }
        }
      }
    } else {
      // Built-in workflow: use old registry + named parameterizer
      const workflowMetadata = registry.get(workflowName);
      if (!workflowMetadata) {
        throw new Error(`Workflow '${workflowName}' not found`);
      }
      const template = loadWorkflowTemplate(workflowMetadata.filename);
      workflow = parameterizeWorkflowByName(workflowName, template, {
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
      }) as Record<string, unknown>;
    }

    // Queue and wait (WS connects first, then submits — prevents missing cloud events)
    onProgress?.({ percentage: 0, message: 'Queueing prompt...', done: false });
    const { promptId, outputs: wsOutputs } = await this.queueAndWait(client, workflow as Record<string, unknown>, onProgress);

    // Download result (use WS-collected outputs for cloud, /history for local)
    return this.downloadFirstOutput(client, promptId, outputDir, 'image/png', wsOutputs);
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
      seed: inputSeed,
      outputDir,
      filenamePrefix = 'edit',
    } = input;
    const seed = inputSeed ?? Math.floor(Math.random() * 2 ** 32);

    const registry = getRegistry();

    // Check for active image_editing workflow (FLUX Klein is the default)
    let workflowName = 'flux2_klein_edit';
    let modeManifest: any = null;
    try {
      const { getWorkflowModeRegistry } = await import('../WorkflowModeRegistry.js');
      const modeRegistry = getWorkflowModeRegistry();
      modeRegistry.refresh(); // Ensure manifests are loaded
      const activeMode = modeRegistry.getActiveForPipeline('image_editing', 'comfyui');
      if (activeMode) {
        modeManifest = activeMode;
        workflowName = activeMode.id;
        debugLog(`Using image_editing workflow: ${activeMode.displayName} (${activeMode.id})${activeMode.isOverride ? ' [user override]' : ''}`);
      } else {
        debugLog(`No active image_editing workflow found — using default: ${workflowName}`);
      }
    } catch (err) {
      debugLog(`WorkflowModeRegistry error: ${(err as Error).message} — using default: ${workflowName}`);
    }

    const hasManifestWorkflow = modeManifest && modeManifest.workflowFile && modeManifest.parameterMappings?.length > 0;

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
    onProgress?.({ percentage: 0, message: `Loading workflow: ${modeManifest?.displayName ?? workflowName}...`, done: false });

    let workflow: Record<string, unknown>;

    if (hasManifestWorkflow) {
      const { getWorkflowModeRegistry } = await import('../WorkflowModeRegistry.js');
      const modeRegistry = getWorkflowModeRegistry();
      const manifestDir = modeRegistry.getManifestDir(modeManifest.id);
      const workflowPath = manifestDir
        ? path.join(manifestDir, modeManifest.workflowFile)
        : path.join(process.cwd(), 'workflows', 'user', modeManifest.workflowFile);

      if (!fs.existsSync(workflowPath)) {
        throw new Error(`User workflow file not found: ${workflowPath}`);
      }

      debugLog(`Loading user edit workflow from: ${workflowPath}`);
      const template = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));

      // Build params — unused reference slots fall back to base image
      const editParams: Record<string, unknown> = {
        prompt: editPrompt,
        edit_prompt: editPrompt,
        negative_prompt: negativePrompt ?? '',
        base_image: uploadResult.name,
        seed,
        filenamePrefix,
      };
      // Fill reference slots — unused ones get the base image so ComfyUI doesn't reject
      for (let i = 0; i < 4; i++) {
        editParams[`reference_image_${i + 1}`] = referenceImageFilenames[i] ?? uploadResult.name;
      }

      workflow = parameterizeGeneric(template, modeManifest, editParams) as Record<string, unknown>;

      // Safety: set any remaining LoadImage nodes that still have placeholder filenames
      let placeholderCount = 0;
      for (const [nid, node] of Object.entries(workflow)) {
        const n = node as { class_type?: string; inputs?: Record<string, unknown> };
        if (n.class_type === 'LoadImage' && typeof n.inputs?.image === 'string') {
          if (n.inputs.image.startsWith('ref_image_')) {
            console.log(`[FLUX Klein] Replacing placeholder on node ${nid}: ${n.inputs.image} → ${uploadResult.name}`);
            n.inputs.image = uploadResult.name;
            placeholderCount++;
          }
        }
      }
      console.log(`[FLUX Klein] hasManifestWorkflow=true, refs=${referenceImageFilenames.length}, placeholders_fixed=${placeholderCount}, nodes=${Object.keys(workflow).length}`);
    } else {
      console.log(`[FLUX Klein] hasManifestWorkflow=FALSE, falling back to old registry: ${workflowName}`);
      const workflowMetadata = registry.get(workflowName);
      if (!workflowMetadata) {
        throw new Error(`Workflow '${workflowName}' not found`);
      }
      const template = loadWorkflowTemplate(workflowMetadata.filename);
      workflow = parameterizeWorkflowByName(workflowName, template, {
        sceneNumber: 0,
        prompt: editPrompt,
        negativePrompt,
        aspectRatio,
        seed,
        inputImageFilename: uploadResult.name,
        referenceImageFilenames: referenceImageFilenames.length > 0 ? referenceImageFilenames : undefined,
        filenamePrefix,
      }) as Record<string, unknown>;
    }

    // Queue and wait
    onProgress?.({ percentage: 0, message: 'Queueing prompt...', done: false });
    const { promptId, outputs: wsOutputs } = await this.queueAndWait(client, workflow as Record<string, unknown>, onProgress);

    return this.downloadFirstOutput(client, promptId, outputDir, 'image/png', wsOutputs);
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
      seed: inputSeed,
      outputDir,
      filenamePrefix = 'video',
    } = input;
    const seed = inputSeed ?? Math.floor(Math.random() * 2 ** 32);

    const isT2V = !sourceImagePath || !fs.existsSync(sourceImagePath);

    if (!isT2V && !fs.existsSync(sourceImagePath)) {
      throw new Error(`Source image not found: ${sourceImagePath}`);
    }

    const registry = getRegistry();

    // Strategy-aware workflow routing:
    // 1. The executor passes modeId = generation strategy (i2v, t2v, flfv, fmlfv)
    // 2. Find the best workflow that supports this strategy (user override > built-in)
    // 3. If no strategy specified, fall back to pipeline default
    let workflowName = 'ltx23';
    let modeManifest = null as any;
    const strategy = input.modeId || 'i2v';
    try {
      const { getWorkflowModeRegistry } = await import('../WorkflowModeRegistry.js');
      const modeRegistry = getWorkflowModeRegistry();

      modeManifest = modeRegistry.getWorkflowForStrategy(strategy, 'comfyui');
      if (modeManifest) {
        const isOverride = modeManifest.isOverride && !modeManifest.builtIn;
        debugLog(`Strategy "${strategy}" → workflow: ${modeManifest.displayName} (${modeManifest.id})${isOverride ? ' [user override]' : ' [built-in]'}`);
      }
    } catch { /* registry not available, use default */ }

    // Determine if this is a user-uploaded workflow or a built-in
    const hasManifestWorkflow = modeManifest && modeManifest.workflowFile && modeManifest.parameterMappings?.length > 0;

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

    // Upload additional frame images (last_frame, mid_frame, etc.) for FLFV workflows
    const uploadedFrames: Record<string, string> = {};
    if (input.frameImages) {
      for (const [frameId, framePath] of Object.entries(input.frameImages)) {
        if (fs.existsSync(framePath)) {
          onProgress?.({ percentage: 0, message: `Uploading ${frameId}...`, done: false });
          const frameUpload = await client.uploadImage(framePath, 'input', true);
          uploadedFrames[frameId] = frameUpload.name;
          debugLog(`Uploaded ${frameId}: ${framePath} → ${frameUpload.name}`);
        } else {
          debugLog(`Frame image not found, skipping: ${frameId} → ${framePath}`);
        }
      }
    }

    // Load and parameterize workflow
    onProgress?.({ percentage: 0, message: `Loading workflow: ${modeManifest?.displayName ?? 'ltx23'}...`, done: false });

    let workflow: Record<string, unknown>;

    if (hasManifestWorkflow) {
      // User-uploaded workflow: load from manifest path, use generic parameterizer
      const { getWorkflowModeRegistry } = await import('../WorkflowModeRegistry.js');
      const modeRegistry = getWorkflowModeRegistry();
      const manifestDir = modeRegistry.getManifestDir(modeManifest.id);

      let workflowPath: string;
      if (manifestDir) {
        workflowPath = path.join(manifestDir, modeManifest.workflowFile);
      } else {
        workflowPath = path.join(process.cwd(), 'workflows', 'user', modeManifest.workflowFile);
      }

      if (!fs.existsSync(workflowPath)) {
        throw new Error(`User workflow file not found: ${workflowPath}`);
      }

      debugLog(`Loading user workflow from: ${workflowPath} (isT2V=${isT2V}, frames=${Object.keys(uploadedFrames).join(',') || 'none'})`);
      const template = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
      const genericParams: Record<string, unknown> = {
        prompt,
        negative_prompt: '',
        seed,
        filenamePrefix,
        width,
        height,
      };
      // Set first_frame (uploaded source image)
      if (!isT2V && uploadResult?.name) {
        genericParams['first_frame'] = uploadResult.name;
      }
      // Set additional frame images (last_frame, mid_frame, etc.)
      for (const [frameId, uploadedName] of Object.entries(uploadedFrames)) {
        genericParams[frameId] = uploadedName;
      }

      workflow = parameterizeGeneric(template, modeManifest, genericParams) as Record<string, unknown>;

      // Boolean toggle nodes (PrimitiveBoolean) for i2v/t2v switching:
      // These are handled by parameterizeGeneric via defaultValue from the manifest.
      // The manifest's defaultValue defines the correct state (e.g., false = i2v mode).
      // When no image is provided (t2v), the default kicks in via parameterizeGeneric.
      // We do NOT override booleans here — the manifest defines the semantics.
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
    const { promptId, outputs: wsOutputs } = await this.queueAndWait(client, workflow as Record<string, unknown>, onProgress);

    const result = await this.downloadFirstOutput(client, promptId, outputDir, 'video/mp4', wsOutputs);
    // Inject workflow name into metadata for upstream logging
    const workflowDisplayName = modeManifest?.displayName ?? 'LTX-2.3 (built-in)';
    result.metadata = { ...result.metadata, workflowName: workflowDisplayName, workflowId: modeManifest?.id ?? 'ltx23' };
    return result;
  }

  // ── Shared helpers ──────────────────────────────────────────────────────────

  private async queueAndWait(
    client: ComfyUIClient,
    workflow: Record<string, unknown>,
    onProgress?: ProviderProgressCallback,
  ): Promise<{ promptId: string; clientId: string; outputs: ImageInfo[] }> {
    const progressHandler = (info: { percentage: number; message: string; step?: number; maxSteps?: number; currentNode?: string }) => {
      onProgress?.({
        percentage: info.percentage,
        message: info.message,
        done: info.percentage >= 100,
        step: info.step,
        maxSteps: info.maxSteps,
      });
    };

    // Use queueAndWaitWS: connects WS first, submits prompt inside onOpen,
    // prevents missing fast execution events on cloud
    const { result, promptId, clientId, outputs: wsOutputs } = await client.queueAndWaitWS(workflow, (info) => {
      progressHandler({
        percentage: info.percentage,
        message: info.message,
        step: info.step,
        maxSteps: info.maxSteps,
        currentNode: info.currentNode,
      });
    });

    if (result.status !== 'completed' && result.status !== 'completed_with_timeout') {
      throw new Error(`ComfyUI job did not complete (status: ${result.status})`);
    }

    return { promptId, clientId, outputs: wsOutputs };
  }

  private async downloadFirstOutput(
    client: ComfyUIClient,
    promptId: string,
    _outputDir: string,
    mimeType: string,
    preCollectedOutputs?: ImageInfo[],
  ): Promise<GenerationResult> {
    // Use pre-collected outputs from WS (needed for cloud where /history is blocked)
    // Fall back to HTTP history for local mode
    const images = preCollectedOutputs?.length ? preCollectedOutputs : await client.getOutputImages(promptId);
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
