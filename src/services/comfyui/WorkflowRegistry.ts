/**
 * Workflow Registry - Central system for managing multiple ComfyUI workflows.
 *
 * Provides workflow discovery, selection, and metadata management
 * to enable agents to choose the right workflow for each task.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { WorkflowManifest } from './WorkflowAnalyzer.js';
import { BUILTIN_MANIFESTS } from './builtinManifests.js';

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

  // Custom workflow fields (only set for user-imported workflows)
  custom?: boolean;
  manifestPath?: string;
  apiWorkflowPath?: string;
}

/**
 * Registry for managing multiple ComfyUI workflows.
 */
class WorkflowRegistry {
  private workflows: Map<string, WorkflowMetadata> = new Map();
  private manifests: Map<string, WorkflowManifest> = new Map();

  constructor() {
    this.registerBuiltinWorkflows();
  }

  private registerBuiltinWorkflows(): void {
    // 1. Z-Image Turbo - Fast high-quality image generation (default)
    this.register({
      name: 'zimage',
      filename: 'zimage_standard_api.json',
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

    // 3. FireRed Edit Lightning - Fast image editing with up to 3 reference images (default)
    this.register({
      name: 'qwen_edit',
      filename: 'qwen_edit-lightning.json',
      workflowType: WorkflowType.IMAGE_EDITING,
      description: 'Fast intelligent image editing using FireRed Image Edit 1.1 with Lightning acceleration. Supports 1-3 input images for editing, combining, or transforming visuals based on text instructions. Use for scene generation with character/setting references.',
      capabilities: [
        'image-to-image',
        'multi-image-input',
        'intelligent-editing',
        'scene-variation',
        'visual-modification',
        'consistency-preservation',
        'reference-based-generation',
      ],
      displayName: 'FireRed Image Editor (Lightning)',
      requiresBaseImage: true,
      supportsTextPrompts: true,
      supportsImageToImage: true,
      outputFormat: 'image',
      estimatedTimeSeconds: 15,
      qualityLevel: 'high',
    });

    // 3b. Qwen Edit Simple - Slower but higher quality variant
    this.register({
      name: 'qwen_edit_hq',
      filename: 'qwen_edit-simple.json',
      workflowType: WorkflowType.IMAGE_EDITING,
      description: 'High-quality image editing using Qwen model (slower). Supports 1-3 input images. Use when quality is more important than speed.',
      capabilities: [
        'image-to-image',
        'multi-image-input',
        'intelligent-editing',
        'scene-variation',
        'visual-modification',
        'consistency-preservation',
        'reference-based-generation',
      ],
      displayName: 'Qwen Image Editor (HQ)',
      requiresBaseImage: true,
      supportsTextPrompts: true,
      supportsImageToImage: true,
      outputFormat: 'image',
      estimatedTimeSeconds: 60,
      qualityLevel: 'ultra',
    });

    // 3c. FLUX 2 Klein Edit - Multi-reference image editing (default image editing workflow)
    this.register({
      name: 'flux2_klein_edit',
      filename: 'flux2_klein_edit.json',
      workflowType: WorkflowType.IMAGE_EDITING,
      description: 'Multi-reference image editing using FLUX 2 Klein 9B. Supports 1-4 reference images for consistent scene generation with character and setting references.',
      capabilities: [
        'image-to-image',
        'multi-image-input',
        'intelligent-editing',
        'scene-variation',
        'consistency-preservation',
        'reference-based-generation',
      ],
      displayName: 'FLUX 2 Klein Edit',
      requiresBaseImage: true,
      supportsTextPrompts: true,
      supportsImageToImage: true,
      outputFormat: 'image',
      estimatedTimeSeconds: 15,
      qualityLevel: 'high',
    });

    // 4. LTX-2.3 GGUF - Video generation (supports both I2V and T2V via toggle)
    this.register({
      name: 'ltx23',
      filename: 'video_ltx23_gguf.json',
      workflowType: WorkflowType.VIDEO_GENERATION,
      description: 'Generate video using LTX-2.3 GGUF model. Supports both image-to-video and text-to-video modes via a toggle. Duration in seconds (1-20). Uses GGUF quantized models for efficient generation.',
      capabilities: [
        'single-image-to-video',
        'text-to-video',
        'motion-from-prompt',
        'fast-generation',
        'camera-movement',
        'character-animation',
        'configurable-duration',
      ],
      displayName: 'LTX-2.3 Video (GGUF)',
      requiresBaseImage: false,
      supportsTextPrompts: true,
      supportsImageToImage: true,
      outputFormat: 'video',
      estimatedTimeSeconds: 60,
      qualityLevel: 'standard',
    });

    // Register built-in manifests
    for (const [name, manifest] of Object.entries(BUILTIN_MANIFESTS)) {
      this.manifests.set(name, manifest);
    }
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
   * Get the manifest for a workflow (built-in or custom).
   * For custom workflows, loads from the manifest file on disk.
   * For built-in workflows still in LiteGraph format, auto-analyzes
   * the workflow file on first access and caches the result.
   */
  getManifest(name: string): WorkflowManifest | undefined {
    // Check in-memory cache first
    const cached = this.manifests.get(name);
    if (cached) return cached;

    // For custom workflows, load from disk
    const metadata = this.workflows.get(name);
    if (!metadata) return undefined;

    if (metadata.custom && metadata.manifestPath) {
      try {
        const content = fs.readFileSync(metadata.manifestPath, 'utf-8');
        const manifest: WorkflowManifest = JSON.parse(content);
        this.manifests.set(name, manifest);
        return manifest;
      } catch {
        return undefined;
      }
    }

    // For built-in workflows without a pre-defined manifest,
    // auto-analyze the workflow file and cache the result
    try {
      const { analyzeWorkflow } = require('./WorkflowAnalyzer.js') as typeof import('./WorkflowAnalyzer.js');
      const { loadWorkflowTemplate } = require('./WorkflowLoader.js') as typeof import('./WorkflowLoader.js');
      const template = loadWorkflowTemplate(metadata.filename);
      const analyzed = analyzeWorkflow(template, name, metadata.displayName, metadata.description);

      // Merge with any built-in manifest overrides (postProcess, extra mappings)
      const builtinOverride = BUILTIN_MANIFESTS[name];
      if (builtinOverride) {
        analyzed.postProcess = builtinOverride.postProcess;
        if (builtinOverride.parameterMap.extra) {
          analyzed.parameterMap.extra = builtinOverride.parameterMap.extra;
        }
      }

      this.manifests.set(name, analyzed);
      return analyzed;
    } catch {
      return undefined;
    }
  }

  /**
   * Set/override a manifest for a workflow.
   */
  setManifest(name: string, manifest: WorkflowManifest): void {
    this.manifests.set(name, manifest);
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
    // Look up the configured image editing workflow, falling back to the first registered editing workflow
    if (preferConsistency && hasPreviousScene) {
      const editingWorkflow = this.listAll().find(wf => wf.workflowType === WorkflowType.IMAGE_EDITING);
      return editingWorkflow ?? this.get('zimage')!;
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
        custom: wf.custom || false,
      })),
    };
  }

  /**
   * Load custom workflows from a project's .kshana/workflows/ directory.
   * Scans for *.manifest.json files, reads the manifest, and registers each.
   */
  loadCustomWorkflows(projectDir: string): void {
    const workflowsDir = path.join(projectDir, 'workflows');
    if (!fs.existsSync(workflowsDir)) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(workflowsDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.manifest.json')) continue;

      const manifestPath = path.join(workflowsDir, entry.name);
      const baseName = entry.name.replace('.manifest.json', '');
      const apiWorkflowPath = path.join(workflowsDir, `${baseName}.api.json`);

      try {
        const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
        const manifest: WorkflowManifest = JSON.parse(manifestContent);

        if (!fs.existsSync(apiWorkflowPath)) {
          continue; // Skip if the API workflow file is missing
        }

        // Convert manifest workflowType to registry WorkflowType
        const workflowType = manifest.workflowType === 'video_generation'
          ? WorkflowType.VIDEO_GENERATION
          : manifest.workflowType === 'image_editing'
            ? WorkflowType.IMAGE_EDITING
            : WorkflowType.IMAGE_GENERATION;

        const hasInputImages = (manifest.parameterMap.inputImages?.length ?? 0) > 0;

        this.register({
          name: manifest.name,
          filename: `${baseName}.api.json`,
          workflowType,
          description: manifest.description,
          capabilities: [`custom-${manifest.workflowType}`],
          displayName: manifest.displayName,
          requiresBaseImage: hasInputImages,
          supportsTextPrompts: !!manifest.parameterMap.positivePrompt,
          supportsImageToImage: hasInputImages,
          outputFormat: manifest.outputFormat,
          estimatedTimeSeconds: manifest.estimatedTimeSeconds ?? 30,
          qualityLevel: manifest.qualityLevel ?? 'standard',
          custom: true,
          manifestPath,
          apiWorkflowPath,
        });

        // Cache the manifest
        this.manifests.set(manifest.name, manifest);
      } catch {
        // Skip invalid manifest files
      }
    }
  }
}

/**
 * Save a custom workflow and its manifest to the project's workflows directory.
 */
export function saveCustomWorkflow(
  projectDir: string,
  name: string,
  apiJson: Record<string, unknown>,
  manifest: WorkflowManifest,
): { apiWorkflowPath: string; manifestPath: string } {
  const workflowsDir = path.join(projectDir, 'workflows');
  if (!fs.existsSync(workflowsDir)) {
    fs.mkdirSync(workflowsDir, { recursive: true });
  }

  const apiWorkflowPath = path.join(workflowsDir, `${name}.api.json`);
  const manifestPath = path.join(workflowsDir, `${name}.manifest.json`);

  fs.writeFileSync(apiWorkflowPath, JSON.stringify(apiJson, null, 2), 'utf-8');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return { apiWorkflowPath, manifestPath };
}

// Global singleton registry
const registry = new WorkflowRegistry();

export function getRegistry(): WorkflowRegistry {
  return registry;
}

export { WorkflowRegistry };
