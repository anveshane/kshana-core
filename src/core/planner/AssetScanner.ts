/**
 * Asset Scanner
 *
 * Scans project directories and state to find what assets already exist.
 * Builds an AssetRegistry that can be used by the backward planner
 * to determine what can be skipped.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  VideoTemplate,
  ArtifactTypeDefinition,
  ArtifactInstance,
  GenericProjectFile,
} from '../templates/types.js';
import type {
  AssetRegistry,
  ProvidedAsset,
  AssetSource,
  SatisfactionLevel,
  ScanResult,
  ScanIssue,
} from './types.js';

/**
 * File extension to artifact type mapping for auto-detection
 */
const EXTENSION_TO_TYPE: Record<string, string[]> = {
  '.md': ['plot', 'story', 'scene', 'character', 'setting'],
  '.txt': ['plot', 'story'],
  '.png': ['character_image', 'setting_image', 'scene_image'],
  '.jpg': ['character_image', 'setting_image', 'scene_image'],
  '.jpeg': ['character_image', 'setting_image', 'scene_image'],
  '.webp': ['character_image', 'setting_image', 'scene_image'],
  '.mp4': ['scene_video', 'final_video'],
  '.mov': ['scene_video', 'final_video'],
  '.webm': ['scene_video', 'final_video'],
};

/**
 * Directory names that suggest specific artifact types
 */
const DIRECTORY_TO_TYPE: Record<string, string> = {
  characters: 'character_image',
  settings: 'setting_image',
  scenes: 'scene_image',
  'scene_images': 'scene_image',
  'character_images': 'character_image',
  'setting_images': 'setting_image',
  videos: 'scene_video',
  'scene_videos': 'scene_video',
};

/**
 * Asset Scanner
 *
 * Scans project state and directories to discover existing assets.
 */
export class AssetScanner {
  private template: VideoTemplate;

  constructor(template: VideoTemplate) {
    this.template = template;
  }

  /**
   * Create an empty asset registry.
   */
  createEmptyRegistry(): AssetRegistry {
    return {
      assets: new Map(),
      satisfiedArtifacts: new Map(),
      lastScanAt: Date.now(),
    };
  }

  /**
   * Scan project to build registry of existing assets.
   *
   * This examines:
   * 1. The project.json for approved artifacts
   * 2. User-provided file paths
   * 3. Known artifact directories
   */
  scan(projectDir: string, project: GenericProjectFile): ScanResult {
    const registry = this.createEmptyRegistry();
    const issues: ScanIssue[] = [];

    // 1. Check project.json for approved artifacts
    this.scanProjectState(project, registry, issues);

    // 2. Scan artifact directories for files
    this.scanArtifactDirectories(projectDir, registry, issues);

    // 3. Scan prompt directories for existing prompt files
    this.scanPromptDirectories(projectDir, registry);

    // 4. Check for critical project files
    this.checkCriticalFiles(projectDir, issues);

    return {
      registry,
      assetCount: registry.assets.size,
      issues,
    };
  }

  /**
   * Scan project state (project.json) for approved artifacts.
   */
  private scanProjectState(
    project: GenericProjectFile,
    registry: AssetRegistry,
    issues: ScanIssue[]
  ): void {
    if (!project.artifacts) {
      issues.push({
        type: 'warning',
        message: 'Project has no artifacts field — skipping artifact scan',
      });
      return;
    }
    for (const [typeId, instances] of Object.entries(project.artifacts)) {
      if (!instances || typeof instances !== 'object') {
        continue;
      }

      const typeDef = this.template.artifactTypes[typeId];
      if (!typeDef) {
        issues.push({
          type: 'warning',
          message: `Unknown artifact type in project: ${typeId}`,
        });
        continue;
      }

      const approved: ArtifactInstance[] = [];
      const total: ArtifactInstance[] = [];

      for (const instance of Object.values(instances) as ArtifactInstance[]) {
        total.push(instance);

        if (instance.status === 'approved') {
          approved.push(instance);

          // Register as asset
          const asset: ProvidedAsset = {
            id: instance.id,
            artifactTypeId: typeId,
            itemId: instance.itemId,
            path: instance.assetPath || instance.filePath,
            source: 'previously_generated',
            registeredAt: instance.updatedAt,
            metadata: instance.metadata,
          };
          registry.assets.set(asset.id, asset);
        }
      }

      // Determine satisfaction level
      if (approved.length > 0) {
        const satisfaction = this.determineSatisfaction(typeDef, approved, total);
        registry.satisfiedArtifacts.set(typeId, satisfaction);
      }
    }
  }

  /**
   * Determine if an artifact type is fully or partially satisfied.
   */
  private determineSatisfaction(
    typeDef: ArtifactTypeDefinition,
    approved: ArtifactInstance[],
    total: ArtifactInstance[]
  ): SatisfactionLevel {
    // For non-collections, any approved instance means full satisfaction
    if (!typeDef.isCollection) {
      return approved.length > 0 ? 'full' : 'partial';
    }

    // For collections, check if all items are approved
    if (approved.length === total.length && total.length > 0) {
      return 'full';
    }

    return 'partial';
  }

  /**
   * Scan artifact directories for user-provided files.
   */
  private scanArtifactDirectories(
    projectDir: string,
    registry: AssetRegistry,
    issues: ScanIssue[]
  ): void {
    // Check for common artifact directories
    for (const [dirName, artifactType] of Object.entries(DIRECTORY_TO_TYPE)) {
      const dirPath = path.join(projectDir, dirName);

      if (!fs.existsSync(dirPath)) {
        continue;
      }

      try {
        const stats = fs.statSync(dirPath);
        if (!stats.isDirectory()) {
          continue;
        }

        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const fileStats = fs.statSync(filePath);

          if (!fileStats.isFile()) {
            continue;
          }

          // Check if this type exists in template
          if (!this.template.artifactTypes[artifactType]) {
            continue;
          }

          // Check if extension matches artifact type
          const ext = path.extname(file).toLowerCase();
          const possibleTypes = EXTENSION_TO_TYPE[ext];
          if (!possibleTypes?.includes(artifactType)) {
            continue;
          }

          // Only add if not already in registry
          const existingAsset = Array.from(registry.assets.values()).find(
            a => a.path === filePath
          );
          if (existingAsset) {
            continue;
          }

          // Register as detected asset
          const itemId = path.basename(file, ext);
          const asset: ProvidedAsset = {
            id: `detected_${artifactType}_${itemId}`,
            artifactTypeId: artifactType,
            itemId,
            path: filePath,
            source: 'detected',
            registeredAt: Date.now(),
          };
          registry.assets.set(asset.id, asset);

          // Update satisfaction
          this.updateSatisfaction(artifactType, registry);
        }
      } catch (error) {
        issues.push({
          type: 'warning',
          message: `Error scanning directory: ${error instanceof Error ? error.message : String(error)}`,
          location: dirPath,
        });
      }
    }
  }

  /**
   * Scan prompts/ directory tree for existing prompt files (.prompt.md, .motion.md).
   * Registers them as assets so the planner knows they exist and can skip regeneration.
   */
  private scanPromptDirectories(projectDir: string, registry: AssetRegistry): void {
    const promptsDir = path.join(projectDir, 'prompts');
    if (!fs.existsSync(promptsDir)) {
      return;
    }

    // Map filename patterns to artifact types
    const PROMPT_FILE_PATTERNS: Array<{ suffix: string; artifactType: string }> = [
      { suffix: '.prompt.md', artifactType: 'scene_image_prompt' },
      { suffix: '.motion.json', artifactType: 'scene_video_prompt' },
      { suffix: '.motion.md', artifactType: 'scene_video_prompt' },
      { suffix: '.profile.md', artifactType: 'character' },
    ];

    // Recursively walk prompts/ directory
    const walkDir = (dir: string): void => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath);
          } else if (entry.isFile()) {
            for (const pattern of PROMPT_FILE_PATTERNS) {
              if (entry.name.endsWith(pattern.suffix)) {
                const itemId = entry.name.replace(pattern.suffix, '');
                const assetId = `detected_${pattern.artifactType}_${itemId}`;

                // Only add if not already in registry
                if (!registry.assets.has(assetId)) {
                  registry.assets.set(assetId, {
                    id: assetId,
                    artifactTypeId: pattern.artifactType,
                    itemId,
                    path: fullPath,
                    source: 'detected',
                    registeredAt: Date.now(),
                  });
                }
                break;
              }
            }
          }
        }
      } catch {
        // Ignore errors reading prompt directories
      }
    };

    walkDir(promptsDir);
  }

  /**
   * Check for critical project-level files that must exist for the workflow to complete.
   */
  private checkCriticalFiles(projectDir: string, issues: ScanIssue[]): void {
    const timelinePath = path.join(projectDir, 'timeline.json');
    if (!fs.existsSync(timelinePath)) {
      issues.push({
        type: 'error',
        message: 'CRITICAL: timeline.json is missing. This file is required for video assembly. Call manage_timeline with action "create_skeleton" to create it from your segments before proceeding to video assembly.',
        location: timelinePath,
      });
      return;
    }

    // Validate timeline.json contents
    try {
      const raw = fs.readFileSync(timelinePath, 'utf-8').trim();
      if (!raw || raw === '{}' || raw === '[]') {
        issues.push({
          type: 'error',
          message: 'CRITICAL: timeline.json is empty or contains a blank object. Call manage_timeline with action "create_skeleton" to recreate it.',
          location: timelinePath,
        });
        return;
      }

      const timeline = JSON.parse(raw);

      if (!timeline.version) {
        issues.push({
          type: 'error',
          message: 'CRITICAL: timeline.json is corrupted (missing version). Call manage_timeline with action "create_skeleton" to recreate it.',
          location: timelinePath,
        });
        return;
      }

      if (!timeline.totalDuration || timeline.totalDuration <= 0) {
        issues.push({
          type: 'error',
          message: 'CRITICAL: timeline.json has no totalDuration. Call manage_timeline with action "create_skeleton" to recreate it with the correct duration.',
          location: timelinePath,
        });
        return;
      }

      if (!Array.isArray(timeline.segments) || timeline.segments.length === 0) {
        issues.push({
          type: 'error',
          message: 'CRITICAL: timeline.json has no segments. Call manage_timeline with action "create_skeleton" to recreate it from your project segments.',
          location: timelinePath,
        });
        return;
      }

      // Check for segments with no content (all empty)
      const filledCount = timeline.segments.filter(
        (s: { fillStatus?: string }) => s.fillStatus === 'filled'
      ).length;
      const emptyCount = timeline.segments.length - filledCount;

      if (emptyCount > 0) {
        issues.push({
          type: 'warning',
          message: `timeline.json has ${emptyCount}/${timeline.segments.length} segments without content. Use manage_timeline with action "update_segment" to fill them with visual assets before assembly.`,
          location: timelinePath,
        });
      }
    } catch {
      issues.push({
        type: 'error',
        message: 'CRITICAL: timeline.json contains invalid JSON. Call manage_timeline with action "create_skeleton" to recreate it.',
        location: timelinePath,
      });
    }
  }

  /**
   * Register user-provided assets from explicit paths.
   */
  registerUserAssets(paths: string[], registry: AssetRegistry): void {
    for (const assetPath of paths) {
      const asset = this.classifyAsset(assetPath);
      if (asset) {
        registry.assets.set(asset.id, asset);
        this.updateSatisfaction(asset.artifactTypeId, registry);
      }
    }
  }

  /**
   * Classify an asset based on its path and content.
   */
  classifyAsset(assetPath: string): ProvidedAsset | null {
    if (!fs.existsSync(assetPath)) {
      return null;
    }

    const ext = path.extname(assetPath).toLowerCase();
    const possibleTypes = EXTENSION_TO_TYPE[ext];

    if (!possibleTypes || possibleTypes.length === 0) {
      return null;
    }

    // Try to determine more specific type from directory
    const dirName = path.basename(path.dirname(assetPath)).toLowerCase();
    let artifactType = DIRECTORY_TO_TYPE[dirName];

    if (!artifactType || !possibleTypes.includes(artifactType)) {
      // Fall back to first matching type
      artifactType = possibleTypes[0];
    }

    // Check if this type exists in template
    if (!artifactType || !this.template.artifactTypes[artifactType]) {
      // Try to find any matching type in template
      artifactType = possibleTypes.find(t => this.template.artifactTypes[t]) || '';
      if (!artifactType) {
        return null;
      }
    }

    const itemId = path.basename(assetPath, ext);

    return {
      id: `user_${artifactType}_${itemId}_${Date.now()}`,
      artifactTypeId: artifactType,
      itemId,
      path: assetPath,
      source: 'user_provided',
      registeredAt: Date.now(),
    };
  }

  /**
   * Register inline content as an asset (e.g., user-pasted story).
   */
  registerContent(
    content: string,
    artifactTypeId: string,
    itemId?: string
  ): ProvidedAsset | null {
    if (!this.template.artifactTypes[artifactTypeId]) {
      return null;
    }

    return {
      id: `content_${artifactTypeId}_${itemId || 'main'}_${Date.now()}`,
      artifactTypeId,
      itemId,
      content,
      source: 'user_provided',
      registeredAt: Date.now(),
    };
  }

  /**
   * Update the satisfaction level for an artifact type based on current assets.
   */
  private updateSatisfaction(artifactTypeId: string, registry: AssetRegistry): void {
    const typeDef = this.template.artifactTypes[artifactTypeId];
    if (!typeDef) {
      return;
    }

    const assets = Array.from(registry.assets.values()).filter(
      a => a.artifactTypeId === artifactTypeId
    );

    if (assets.length === 0) {
      registry.satisfiedArtifacts.delete(artifactTypeId);
      return;
    }

    // For non-collections, any asset means full satisfaction
    if (!typeDef.isCollection) {
      registry.satisfiedArtifacts.set(artifactTypeId, 'full');
      return;
    }

    // For collections, we can't know if it's complete without more context
    // Default to partial, let the planner or orchestrator determine full satisfaction
    registry.satisfiedArtifacts.set(artifactTypeId, 'partial');
  }

  /**
   * Mark an artifact type as fully satisfied.
   * Used when the orchestrator confirms all items are present.
   */
  markFullySatisfied(artifactTypeId: string, registry: AssetRegistry): void {
    if (registry.satisfiedArtifacts.has(artifactTypeId)) {
      registry.satisfiedArtifacts.set(artifactTypeId, 'full');
    }
  }

  /**
   * Get summary of what's in the registry.
   */
  getSummary(registry: AssetRegistry): string {
    const lines: string[] = [];

    lines.push(`Asset Registry Summary (${registry.assets.size} assets):`);

    // Group by artifact type
    const byType = new Map<string, ProvidedAsset[]>();
    for (const asset of registry.assets.values()) {
      const list = byType.get(asset.artifactTypeId) || [];
      list.push(asset);
      byType.set(asset.artifactTypeId, list);
    }

    for (const [typeId, assets] of byType) {
      const typeDef = this.template.artifactTypes[typeId];
      const name = typeDef?.displayName || typeId;
      const satisfaction = registry.satisfiedArtifacts.get(typeId) || 'none';

      lines.push(`\n  ${name} (${satisfaction}):`);
      for (const asset of assets) {
        const source = asset.source === 'user_provided' ? '[user]' :
                       asset.source === 'detected' ? '[detected]' :
                       asset.source === 'previously_generated' ? '[generated]' : '[imported]';
        const location = asset.path || (asset.content ? '[inline content]' : '[no content]');
        lines.push(`    - ${asset.itemId || 'main'} ${source}: ${location}`);
      }
    }

    return lines.join('\n');
  }
}
