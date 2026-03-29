/**
 * WorkflowModeRegistry — discovers and serves workflow modes for both
 * video generation and image processing pipelines.
 *
 * Scans `workflows/` for `*.manifest.json` sidecar files, aggregates them,
 * and generates dynamic prompt sections for LLM injection.
 *
 * For API providers (Google, xAI), returns hardcoded modes since their
 * capabilities are fixed.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { WorkflowManifest, WorkflowManifestFile, WorkflowPipeline } from './types.js';

/** Directories to scan for manifest files */
const WORKFLOW_DIRS = ['workflows/built-in', 'workflows/user', 'workflows'];

/**
 * Hardcoded modes for API providers that don't use ComfyUI workflows.
 * These are static — API providers have fixed capabilities.
 */
const API_PROVIDER_MODES: Record<string, WorkflowManifest[]> = {
  google: [
    {
      id: 'api_i2v',
      displayName: 'Image to Video (API)',
      pipeline: 'video_generation',
      llmDescription: 'Generates video from a single first-frame image using the cloud API. High quality but limited control.',
      selectionCriteria: 'Use for any shot that has a character or setting reference image.',
      outputType: 'video',
      priority: 10,
      inputRequirements: [
        { id: 'first_frame', type: 'image', source: 'shot_image', description: 'First frame image', required: true },
        { id: 'prompt', type: 'text', source: 'shot_motion_directive', description: 'Motion prompt', required: true },
      ],
      workflowFile: '',
      format: 'api',
      parameterMappings: [],
      builtIn: true,
      active: true,
    },
  ],
  xai: [
    {
      id: 'api_i2v',
      displayName: 'Image to Video (API)',
      pipeline: 'video_generation',
      llmDescription: 'Generates video from a single first-frame image using the cloud API.',
      selectionCriteria: 'Use for any shot that has a character or setting reference image.',
      outputType: 'video',
      priority: 10,
      inputRequirements: [
        { id: 'first_frame', type: 'image', source: 'shot_image', description: 'First frame image', required: true },
        { id: 'prompt', type: 'text', source: 'shot_motion_directive', description: 'Motion prompt', required: true },
      ],
      workflowFile: '',
      format: 'api',
      parameterMappings: [],
      builtIn: true,
      active: true,
    },
  ],
};

export class WorkflowModeRegistry {
  private modes = new Map<string, WorkflowManifest>();
  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot || process.cwd();
  }

  /**
   * Scan workflow directories for *.manifest.json files and load all modes.
   * Also loads hardcoded API provider modes.
   */
  refresh(): void {
    this.modes.clear();

    // Scan filesystem for ComfyUI workflow manifests
    for (const dir of WORKFLOW_DIRS) {
      const absDir = join(this.projectRoot, dir);
      if (!existsSync(absDir)) continue;
      try {
        const files = readdirSync(absDir);
        for (const file of files) {
          if (!file.endsWith('.manifest.json')) continue;
          try {
            const content = readFileSync(join(absDir, file), 'utf-8');
            const parsed: WorkflowManifestFile = JSON.parse(content);
            const manifests = Array.isArray(parsed) ? parsed : [parsed];

            for (const manifest of manifests) {
              // Resolve workflow file path relative to manifest directory
              if (manifest.workflowFile && !manifest.workflowFile.startsWith('/')) {
                const workflowAbsPath = join(absDir, manifest.workflowFile);
                if (!existsSync(workflowAbsPath)) {
                  console.warn(`[WorkflowModeRegistry] Workflow file not found: ${workflowAbsPath} (from ${file})`);
                  continue;
                }
              }
              // Store the directory for later workflow path resolution
              (manifest as any)._manifestDir = absDir;
              // Tag built-in vs user
              manifest.builtIn = dir.includes('built-in');
              manifest.active = manifest.active !== false; // default active
              this.modes.set(manifest.id, manifest);
            }
          } catch (err) {
            console.warn(`[WorkflowModeRegistry] Failed to parse ${file}: ${err}`);
          }
        }
      } catch { /* directory not readable */ }
    }

    // Load API provider modes
    for (const [, modes] of Object.entries(API_PROVIDER_MODES)) {
      for (const mode of modes) {
        // Don't overwrite ComfyUI modes with API modes
        if (!this.modes.has(mode.id)) {
          this.modes.set(mode.id, mode);
        }
      }
    }
  }

  /**
   * Get all active modes for a specific pipeline and provider.
   */
  getAvailableModes(pipeline: WorkflowPipeline, providerId?: string): WorkflowManifest[] {
    const results: WorkflowManifest[] = [];
    for (const mode of this.modes.values()) {
      if (mode.pipeline !== pipeline) continue;
      if (mode.active === false) continue;
      // Filter by provider: ComfyUI modes have workflowFile, API modes have format='api'
      if (providerId && providerId !== 'comfyui' && mode.format !== 'api') continue;
      if (providerId && providerId === 'comfyui' && mode.format === 'api') continue;
      results.push(mode);
    }
    return results.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get a specific mode by ID.
   */
  getMode(modeId: string): WorkflowManifest | undefined {
    return this.modes.get(modeId);
  }

  /**
   * Get the active workflow for a pipeline type.
   * If a user has set an override, returns that. Otherwise returns the built-in default.
   * Built-in defaults are always present and cannot be removed.
   */
  getActiveForPipeline(pipeline: WorkflowPipeline, providerId?: string): WorkflowManifest | undefined {
    const modes = this.getAvailableModes(pipeline, providerId);
    // User override takes precedence
    const override = modes.find(m => m.isOverride && !m.builtIn);
    if (override) return override;
    // Fall back to built-in default (highest priority = lowest number)
    return modes.find(m => m.builtIn) || modes[0];
  }

  /**
   * Set a user-uploaded workflow as the active override for its pipeline.
   * Only user workflows can be overrides. Clears any previous override for the same pipeline.
   */
  setOverride(modeId: string): boolean {
    const mode = this.modes.get(modeId);
    if (!mode || mode.builtIn) return false; // can't override with a built-in
    // Clear previous overrides in the same pipeline
    for (const m of this.modes.values()) {
      if (m.pipeline === mode.pipeline && !m.builtIn) m.isOverride = false;
    }
    mode.isOverride = true;
    return true;
  }

  /**
   * Clear override for a pipeline — reverts to built-in default.
   */
  clearOverride(pipeline: WorkflowPipeline): void {
    for (const m of this.modes.values()) {
      if (m.pipeline === pipeline && !m.builtIn) m.isOverride = false;
    }
  }

  /**
   * Remove a user-uploaded workflow. Built-ins cannot be removed.
   */
  removeMode(modeId: string): boolean {
    const mode = this.modes.get(modeId);
    if (!mode || mode.builtIn) return false;
    this.modes.delete(modeId);
    return true;
  }

  /**
   * Get the absolute path to a mode's workflow file.
   */
  getWorkflowPath(mode: WorkflowManifest): string | undefined {
    if (!mode.workflowFile) return undefined;
    // Use stored manifest directory if available
    const manifestDir = (mode as any)._manifestDir;
    if (manifestDir) {
      const absPath = join(manifestDir, mode.workflowFile);
      if (existsSync(absPath)) return absPath;
    }
    // Fallback: scan all directories
    for (const dir of WORKFLOW_DIRS) {
      const absPath = join(this.projectRoot, dir, mode.workflowFile);
      if (existsSync(absPath)) return absPath;
    }
    return undefined;
  }

  /**
   * Generate a markdown section describing available video generation modes.
   * Injected into LLM prompts via {{AVAILABLE_VIDEO_MODES}} placeholder.
   */
  generateVideoModesSection(providerId?: string): string {
    const modes = this.getAvailableModes('video_generation', providerId);
    if (modes.length === 0) {
      return '## Video Generation Mode\n\nNo video generation modes are currently available. Use `"videoGenerationMode": null`.';
    }

    const lines = ['## Video Generation Mode', '', 'Choose a `videoGenerationMode` for each shot:', ''];
    for (const mode of modes) {
      const frameInputs = mode.inputRequirements
        .filter(r => r.type === 'image' && r.source === 'shot_image')
        .map(r => `${r.id} (${r.required ? 'required' : 'optional'})`)
        .join(', ');

      lines.push(`- **\`${mode.id}\`** (${mode.displayName}) — ${mode.llmDescription}`);
      lines.push(`  *Use when:* ${mode.selectionCriteria}`);
      if (frameInputs) {
        lines.push(`  *Required frame images:* ${frameInputs}`);
      } else {
        lines.push(`  *Required frame images:* none`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  /**
   * Generate a markdown section describing available image processing modes.
   * Injected into LLM prompts via {{AVAILABLE_PROCESSING_MODES}} placeholder.
   */
  generateProcessingModesSection(providerId?: string): string {
    const modes = this.getAvailableModes('image_processing', providerId);
    if (modes.length === 0) {
      return '## Image Processing Mode\n\nNo image processing workflows are currently installed. Set `"imageProcessingMode": null` for all shots.';
    }

    const lines = ['## Image Processing Mode', '', 'Optionally choose an `imageProcessingMode` per shot (set to `null` if not needed):', ''];
    for (const mode of modes) {
      lines.push(`- **\`${mode.id}\`** (${mode.displayName}) — ${mode.llmDescription}`);
      lines.push(`  *Use when:* ${mode.selectionCriteria}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  /**
   * Generate frame generation guide for the shot_image_prompt LLM.
   * Tells it how many frame images to generate per video generation mode.
   */
  generateFrameGuideSection(providerId?: string): string {
    const modes = this.getAvailableModes('video_generation', providerId);
    const lines = ['## Frame Images Per Mode', '', 'Generate the required frame images based on the shot\'s `videoGenerationMode`:', ''];

    for (const mode of modes) {
      const frameInputs = mode.inputRequirements
        .filter(r => r.type === 'image' && r.source === 'shot_image');
      if (frameInputs.length === 0) {
        lines.push(`- **\`${mode.id}\`**: No frame images needed (text-only generation)`);
      } else if (frameInputs.length === 1) {
        lines.push(`- **\`${mode.id}\`**: Generate 1 image — ${frameInputs[0]!.description} (\`${frameInputs[0]!.id}\`)`);
      } else {
        const imgs = frameInputs.map(f => `${f.description} (\`${f.id}\`)`).join(', ');
        lines.push(`- **\`${mode.id}\`**: Generate ${frameInputs.length} images — ${imgs}`);
      }
    }
    lines.push('');
    return lines.join('\n');
  }

  /**
   * List all registered modes (for management UI).
   */
  listAll(): WorkflowManifest[] {
    return Array.from(this.modes.values()).sort((a, b) => {
      if (a.pipeline !== b.pipeline) return a.pipeline.localeCompare(b.pipeline);
      return a.priority - b.priority;
    });
  }
}

// Singleton
let _registry: WorkflowModeRegistry | undefined;

export function getWorkflowModeRegistry(): WorkflowModeRegistry {
  if (!_registry) {
    _registry = new WorkflowModeRegistry();
    _registry.refresh();
  }
  return _registry;
}
