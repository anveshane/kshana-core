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
    this.scanProjectState(projectDir, project, registry, issues);

    // 2. Prefer project metadata before falling back to raw directory discovery
    this.scanProjectMetadata(projectDir, project, registry);

    // 3. Scan artifact directories for files
    this.scanArtifactDirectories(projectDir, registry, issues);

    // 4. Scan prompt directories for existing prompt files
    this.scanPromptDirectories(projectDir, registry);

    // 5. Check for critical project files
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
    projectDir: string,
    project: GenericProjectFile,
    registry: AssetRegistry,
    issues: ScanIssue[]
  ): void {
    const artifactState = (project as { artifacts?: unknown }).artifacts;
    if (!artifactState || typeof artifactState !== 'object') {
      return;
    }

    for (const [typeId, instances] of Object.entries(artifactState as Record<string, unknown>)) {
      if (!instances || typeof instances !== 'object') {
        continue;
      }

      if (this.isLegacyArtifactInstance(instances)) {
        this.scanLegacyArtifact(projectDir, typeId, instances, registry, issues);
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
            path: this.normalizeProjectPath(projectDir, instance.assetPath || instance.filePath),
            source: 'previously_generated',
            registeredAt: instance.updatedAt,
            metadata: instance.metadata,
          };
          this.registerAsset(registry, asset);
        }
      }

      // Determine satisfaction level
      if (approved.length > 0) {
        const satisfaction = this.determineSatisfaction(typeDef, approved, total);
        registry.satisfiedArtifacts.set(typeId, satisfaction);
      }
    }
  }

  private isLegacyArtifactInstance(value: object): boolean {
    return (
      'status' in value &&
      (('type' in value && typeof (value as { type?: unknown }).type === 'string') ||
        ('typeId' in value && typeof (value as { typeId?: unknown }).typeId === 'string'))
    );
  }

  private scanLegacyArtifact(
    projectDir: string,
    artifactId: string,
    rawArtifact: object,
    registry: AssetRegistry,
    issues: ScanIssue[]
  ): void {
    const artifact = rawArtifact as Record<string, unknown>;
    const typeId =
      typeof artifact['typeId'] === 'string'
        ? artifact['typeId']
        : typeof artifact['type'] === 'string'
          ? artifact['type']
          : undefined;

    if (!typeId) {
      return;
    }

    const typeDef = this.template.artifactTypes[typeId];
    if (!typeDef) {
      issues.push({
        type: 'warning',
        message: `Unknown artifact type in project: ${typeId}`,
      });
      return;
    }

    const status = artifact['status'];
    if (status !== 'approved' && status !== 'complete') {
      return;
    }

    const asset: ProvidedAsset = {
      id: typeof artifact['id'] === 'string' ? artifact['id'] : artifactId,
      artifactTypeId: typeId,
      itemId: typeof artifact['itemId'] === 'string' ? artifact['itemId'] : undefined,
      path: this.normalizeProjectPath(
        projectDir,
        typeof artifact['assetPath'] === 'string'
          ? artifact['assetPath']
          : typeof artifact['filePath'] === 'string'
            ? artifact['filePath']
            : undefined
      ),
      source: 'previously_generated',
      registeredAt:
        typeof artifact['updatedAt'] === 'number' ? artifact['updatedAt'] : Date.now(),
      metadata:
        artifact['metadata'] && typeof artifact['metadata'] === 'object'
          ? (artifact['metadata'] as Record<string, unknown>)
          : undefined,
    };

    this.registerAsset(registry, asset);
    this.updateSatisfaction(typeId, registry);
  }

  /**
   * Scan workflow metadata already tracked in project.json.
   * This is the primary source of truth for desktop projects.
   */
  private scanProjectMetadata(
    projectDir: string,
    project: GenericProjectFile,
    registry: AssetRegistry
  ): void {
    const workflowProject = project as GenericProjectFile & Record<string, unknown>;

    this.scanTrackedFiles(
      projectDir,
      Array.isArray(workflowProject.files)
        ? (workflowProject.files as Array<Record<string, unknown>>)
        : [],
      registry
    );

    this.scanPromptMetadata(
      projectDir,
      Array.isArray(workflowProject.characters)
        ? (workflowProject.characters as Array<Record<string, unknown>>)
        : [],
      'character',
      registry
    );
    this.scanPromptMetadata(
      projectDir,
      Array.isArray(workflowProject.settings)
        ? (workflowProject.settings as Array<Record<string, unknown>>)
        : [],
      'setting',
      registry
    );

    const content = workflowProject.content;
    if (content && typeof content === 'object') {
      const images = (content as Record<string, unknown>)['images'];
      const videos = (content as Record<string, unknown>)['videos'];

      if (images && typeof images === 'object') {
        this.scanGeneratedAssetMap(
          projectDir,
          workflowProject,
          (images as Record<string, unknown>)['itemFiles'],
          'image',
          registry
        );
      }

      if (videos && typeof videos === 'object') {
        this.scanGeneratedAssetMap(
          projectDir,
          workflowProject,
          (videos as Record<string, unknown>)['itemFiles'],
          'video',
          registry
        );
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
            a =>
              a.artifactTypeId === artifactType &&
              a.path === this.normalizeProjectPath(projectDir, filePath)
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
            path: this.normalizeProjectPath(projectDir, filePath),
            source: 'detected',
            registeredAt: Date.now(),
          };
          this.registerAsset(registry, asset);

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

    // Recursively walk prompts/ directory
    const walkDir = (dir: string): void => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath);
          } else if (entry.isFile()) {
            const relativePath = this.normalizeProjectPath(projectDir, fullPath);
            if (!relativePath) {
              continue;
            }
            const artifactType = this.inferTrackedArtifactType(relativePath);
            if (!artifactType || !this.template.artifactTypes[artifactType]) {
              continue;
            }

            const itemId = this.itemIdFromPath(relativePath);
            this.registerAsset(registry, {
              id: `detected_${artifactType}_${itemId}`,
              artifactTypeId: artifactType,
              itemId,
              path: relativePath,
              source: 'detected',
              registeredAt: Date.now(),
            });
            this.updateSatisfaction(artifactType, registry);
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
        location: this.normalizeProjectPath(projectDir, timelinePath),
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
          location: this.normalizeProjectPath(projectDir, timelinePath),
        });
        return;
      }

      const timeline = JSON.parse(raw);

      if (!timeline.version) {
        issues.push({
          type: 'error',
          message: 'CRITICAL: timeline.json is corrupted (missing version). Call manage_timeline with action "create_skeleton" to recreate it.',
          location: this.normalizeProjectPath(projectDir, timelinePath),
        });
        return;
      }

      if (!timeline.totalDuration || timeline.totalDuration <= 0) {
        issues.push({
          type: 'error',
          message: 'CRITICAL: timeline.json has no totalDuration. Call manage_timeline with action "create_skeleton" to recreate it with the correct duration.',
          location: this.normalizeProjectPath(projectDir, timelinePath),
        });
        return;
      }

      if (!Array.isArray(timeline.segments) || timeline.segments.length === 0) {
        issues.push({
          type: 'error',
          message: 'CRITICAL: timeline.json has no segments. Call manage_timeline with action "create_skeleton" to recreate it from your project segments.',
          location: this.normalizeProjectPath(projectDir, timelinePath),
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
          location: this.normalizeProjectPath(projectDir, timelinePath),
        });
      }
    } catch {
      issues.push({
        type: 'error',
        message: 'CRITICAL: timeline.json contains invalid JSON. Call manage_timeline with action "create_skeleton" to recreate it.',
        location: this.normalizeProjectPath(projectDir, timelinePath),
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

  private scanTrackedFiles(
    projectDir: string,
    files: Array<Record<string, unknown>>,
    registry: AssetRegistry
  ): void {
    for (const file of files) {
      const filePath = typeof file['path'] === 'string' ? file['path'] : undefined;
      if (!filePath) {
        continue;
      }

      const relativePath = this.normalizeProjectPath(projectDir, filePath);
      if (!relativePath) {
        continue;
      }
      const artifactType =
        this.inferTrackedArtifactType(relativePath, typeof file['type'] === 'string' ? file['type'] : undefined);
      if (!artifactType || !this.template.artifactTypes[artifactType]) {
        continue;
      }

      const itemId =
        typeof file['name'] === 'string' && file['name'].trim().length > 0
          ? file['name']
          : this.itemIdFromPath(relativePath);

      this.registerAsset(registry, {
        id: `tracked_${artifactType}_${this.sanitizeAssetKey(itemId)}`,
        artifactTypeId: artifactType,
        itemId,
        path: relativePath,
        source: 'detected',
        registeredAt: Date.now(),
      });
      this.updateSatisfaction(artifactType, registry);
    }
  }

  private scanPromptMetadata(
    projectDir: string,
    items: Array<Record<string, unknown>>,
    kind: 'character' | 'setting',
    registry: AssetRegistry
  ): void {
    for (const item of items) {
      const promptPath = typeof item['imagePromptPath'] === 'string' ? item['imagePromptPath'] : undefined;
      if (!promptPath) {
        continue;
      }

      const relativePath = this.normalizeProjectPath(projectDir, promptPath);
      if (!relativePath) {
        continue;
      }
      const artifactType = this.inferTrackedArtifactType(relativePath);
      if (!artifactType || !this.template.artifactTypes[artifactType]) {
        continue;
      }

      this.registerAsset(registry, {
        id: `tracked_${artifactType}_${this.sanitizeAssetKey(
          typeof item['name'] === 'string' ? item['name'] : kind
        )}`,
        artifactTypeId: artifactType,
        itemId: typeof item['name'] === 'string' ? item['name'] : kind,
        path: relativePath,
        source: 'detected',
        registeredAt: Date.now(),
      });
      this.updateSatisfaction(artifactType, registry);
    }
  }

  private scanGeneratedAssetMap(
    projectDir: string,
    project: GenericProjectFile & Record<string, unknown>,
    itemFiles: unknown,
    kind: 'image' | 'video',
    registry: AssetRegistry
  ): void {
    if (!itemFiles || typeof itemFiles !== 'object') {
      return;
    }

    for (const [assetId, rawPath] of Object.entries(itemFiles as Record<string, unknown>)) {
      if (typeof rawPath !== 'string') {
        continue;
      }

      const relativePath = this.normalizeProjectPath(projectDir, rawPath);
      if (!relativePath) {
        continue;
      }
      const artifactType = this.inferGeneratedAssetType(project, assetId, relativePath, kind);
      if (!artifactType || !this.template.artifactTypes[artifactType]) {
        continue;
      }

      this.registerAsset(registry, {
        id: assetId,
        artifactTypeId: artifactType,
        itemId: this.itemIdFromPath(relativePath),
        path: relativePath,
        source: 'previously_generated',
        registeredAt: Date.now(),
      });
      this.updateSatisfaction(artifactType, registry);
    }
  }

  private inferGeneratedAssetType(
    project: GenericProjectFile & Record<string, unknown>,
    assetId: string,
    relativePath: string,
    kind: 'image' | 'video'
  ): string | null {
    if (kind === 'image') {
      const characters = Array.isArray(project.characters)
        ? (project.characters as Array<Record<string, unknown>>)
        : [];
      for (const character of characters) {
        if (
          character['referenceImageId'] === assetId ||
          character['referenceImagePath'] === relativePath
        ) {
          return 'character_image';
        }
      }

      const settings = Array.isArray(project.settings)
        ? (project.settings as Array<Record<string, unknown>>)
        : [];
      for (const setting of settings) {
        if (
          setting['referenceImageId'] === assetId ||
          setting['referenceImagePath'] === relativePath
        ) {
          return 'setting_image';
        }
      }

      const scenes = Array.isArray(project.scenes)
        ? (project.scenes as Array<Record<string, unknown>>)
        : [];
      for (const scene of scenes) {
        if (scene['imageArtifactId'] === assetId || scene['imagePath'] === relativePath) {
          return 'scene_image';
        }
      }

      const filename = path.basename(relativePath).toLowerCase();
      if (filename.includes('charref')) return 'character_image';
      if (filename.includes('settingref')) return 'setting_image';
      return 'scene_image';
    }

    const scenes = Array.isArray(project.scenes)
      ? (project.scenes as Array<Record<string, unknown>>)
      : [];
    for (const scene of scenes) {
      if (scene['videoArtifactId'] === assetId || scene['videoPath'] === relativePath) {
        return 'scene_video';
      }
    }

    return path.basename(relativePath).toLowerCase().includes('final')
      ? 'final_video'
      : 'scene_video';
  }

  private inferTrackedArtifactType(relativePath: string, explicitType?: string): string | null {
    const normalized = relativePath.replace(/\\/g, '/');

    if (explicitType) {
      switch (explicitType) {
        case 'plot':
        case 'story':
        case 'scene':
        case 'character':
        case 'setting':
        case 'scene_image_prompt':
        case 'scene_video_prompt':
        case 'shot_image_prompt':
          return explicitType;
        case 'character_image_prompt':
        case 'setting_image_prompt':
          return null;
      }
    }

    if (/^prompts\/images\/shots\/.+\.prompt\.md$/i.test(normalized)) {
      return 'shot_image_prompt';
    }
    if (/^prompts\/images\/scenes\/.+\.prompt\.md$/i.test(normalized)) {
      return 'scene_image_prompt';
    }
    if (/^prompts\/videos\/scenes\/.+\.motion\.(json|md)$/i.test(normalized)) {
      return 'scene_video_prompt';
    }
    if (/^prompts\/images\/(characters|settings)\/.+\.prompt\.md$/i.test(normalized)) {
      return null;
    }
    if (/^characters\/.+\.profile\.md$/i.test(normalized)) {
      return 'character';
    }
    if (/^settings\/.+\.profile\.md$/i.test(normalized)) {
      return 'setting';
    }
    if (/^plans\/plot\.md$/i.test(normalized)) {
      return 'plot';
    }
    if (/^plans\/story\.md$/i.test(normalized) || /^plans\/chapters\/.+\.story\.md$/i.test(normalized)) {
      return 'story';
    }
    if (/^plans\/scenes\/.+\.md$/i.test(normalized) || /^scenes\/.+\.md$/i.test(normalized)) {
      return 'scene';
    }

    return null;
  }

  private registerAsset(registry: AssetRegistry, asset: ProvidedAsset): void {
    const duplicate = Array.from(registry.assets.values()).find(
      existing =>
        existing.artifactTypeId === asset.artifactTypeId &&
        existing.path &&
        asset.path &&
        existing.path === asset.path
    );
    if (duplicate) {
      return;
    }
    registry.assets.set(asset.id, asset);
  }

  private normalizeProjectPath(projectDir: string, candidate?: string): string | undefined {
    if (!candidate) {
      return undefined;
    }

    const root = path.resolve(projectDir);
    const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
    const relative = path.relative(root, resolved);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/');
    }
    return candidate;
  }

  private itemIdFromPath(filePath: string): string {
    const filename = path.basename(filePath);
    return filename
      .replace(/\.motion\.(json|md)$/i, '')
      .replace(/\.prompt\.md$/i, '')
      .replace(/\.profile\.md$/i, '')
      .replace(/\.[^.]+$/i, '');
  }

  private sanitizeAssetKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'main';
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
