/**
 * ArtifactManager - Manages individual artifacts with fine-grained control.
 * Handles CRUD operations, versioning, and external asset imports.
 */

import {
  type ProjectFile,
  type ArtifactState,
  type ArtifactType,
  type ArtifactStatus,
  type PromptVersion,
  type PromptRefinement,
  type PromptComparison,
  PROJECT_FILE,
} from './types.js';
import { getActiveProjectDir } from './activeProject.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, basename, extname } from 'path';
import { loadProject, saveProject } from './ProjectManager.js';

export class ArtifactManager {
  private project: ProjectFile;
  private basePath: string;

  constructor(project: ProjectFile, basePath: string = process.cwd()) {
    this.project = project;
    this.basePath = basePath;
    this.initializeArtifacts();
  }

  private initializeArtifacts(): void {
    if (!this.project.artifacts) {
      this.project.artifacts = {};
    }
  }

  private save(): void {
    this.project.updatedAt = Date.now();
    saveProject(this.project, this.basePath);
  }

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  get(id: string): ArtifactState | undefined {
    return this.project.artifacts?.[id];
  }

  exists(id: string): boolean {
    return id in (this.project.artifacts || {});
  }

  create(
    state: Omit<ArtifactState, 'createdAt' | 'updatedAt' | 'promptVersion' | 'promptHistory'>
  ): string {
    const now = Date.now();
    const artifact: ArtifactState = {
      ...state,
      promptVersion: 1,
      promptHistory: [
        {
          version: 1,
          prompt: state.prompt,
          createdAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    if (!this.project.artifacts) {
      this.project.artifacts = {};
    }
    this.project.artifacts[state.id] = artifact;
    this.save();
    return state.id;
  }

  update(id: string, changes: Partial<ArtifactState>): void {
    const artifact = this.get(id);
    if (!artifact) {
      throw new Error(`Artifact not found: ${id}`);
    }

    Object.assign(artifact, changes, { updatedAt: Date.now() });
    this.save();
  }

  delete(id: string): void {
    if (!this.project.artifacts) return;
    delete this.project.artifacts[id];
    this.save();
  }

  // ============================================================================
  // Versioning
  // ============================================================================

  addPromptVersion(id: string, prompt: string, feedback?: string): number {
    const artifact = this.get(id);
    if (!artifact) {
      throw new Error(`Artifact not found: ${id}`);
    }

    const nextVersion = artifact.promptVersion + 1;
    const newEntry: PromptVersion = {
      version: nextVersion,
      prompt,
      feedback,
      createdAt: Date.now(),
    };

    artifact.promptHistory.push(newEntry);
    artifact.prompt = prompt;
    artifact.promptVersion = nextVersion;
    artifact.updatedAt = Date.now();

    this.save();
    return nextVersion;
  }

  getPromptHistory(id: string): PromptVersion[] {
    const artifact = this.get(id);
    if (!artifact) {
      throw new Error(`Artifact not found: ${id}`);
    }
    return artifact.promptHistory;
  }

  getVersion(id: string, version: number): PromptVersion | undefined {
    const artifact = this.get(id);
    if (!artifact) {
      throw new Error(`Artifact not found: ${id}`);
    }
    return artifact.promptHistory.find(v => v.version === version);
  }

  restoreVersion(id: string, version: number): void {
    const artifact = this.get(id);
    if (!artifact) {
      throw new Error(`Artifact not found: ${id}`);
    }

    const targetVersion = this.getVersion(id, version);
    if (!targetVersion) {
      throw new Error(`Version ${version} not found for artifact ${id}`);
    }

    artifact.prompt = targetVersion.prompt;
    artifact.promptVersion = version;
    artifact.updatedAt = Date.now();

    this.save();
  }

  // ============================================================================
  // History Management
  // ============================================================================

  pruneHistory(id: string, keepLast: number = 5): void {
    const artifact = this.get(id);
    if (!artifact) return;

    const history = artifact.promptHistory;
    if (history.length <= keepLast) return;

    const approvedVersions = history.filter(v => v.approvedAt);
    const pendingVersions = history.filter(v => !v.approvedAt);

    pendingVersions.sort((a, b) => b.createdAt - a.createdAt);
    const toKeep = pendingVersions.slice(0, keepLast - approvedVersions.length);

    const toRemove = pendingVersions.slice(keepLast - approvedVersions.length);

    artifact.promptHistory = [...approvedVersions, ...toKeep];
    this.save();
  }

  // ============================================================================
  // Operations
  // ============================================================================

  async replaceWithExternal(
    id: string,
    filePath: string,
    assetType: 'image' | 'video' | 'audio' | 'overlay'
  ): Promise<void> {
    const artifact = this.get(id);
    if (!artifact) {
      throw new Error(`Artifact not found: ${id}`);
    }

    const ext = extname(filePath);
    const subdir = assetType === 'overlay' ? 'overlays' : `${assetType}s`;
    const destDir = join(this.basePath, getActiveProjectDir(), 'assets', 'external', subdir);
    const destPath = join(destDir, `${id}${ext}`);

    mkdirSync(destDir, { recursive: true });
    copyFileSync(filePath, destPath);

    artifact.source = 'external';
    artifact.assetPath = destPath;
    artifact.status = 'complete';
    artifact.updatedAt = Date.now();

    this.save();
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  getNeedsReview(): ArtifactState[] {
    const artifacts = this.project.artifacts || {};
    return Object.values(artifacts).filter(a => a.status === 'needs_review');
  }

  getByType(type: ArtifactType): ArtifactState[] {
    const artifacts = this.project.artifacts || {};
    return Object.values(artifacts).filter(a => a.type === type);
  }

  getAll(): ArtifactState[] {
    const artifacts = this.project.artifacts || {};
    return Object.values(artifacts);
  }

  getProject(): ProjectFile {
    return this.project;
  }

  // ============================================================================
  // Factory Methods
  // ============================================================================

  static createScene(
    project: ProjectFile,
    sceneNumber: number,
    prompt: string,
    basePath: string = process.cwd()
  ): string {
    const manager = new ArtifactManager(project, basePath);
    return manager.create({
      id: `scene-${sceneNumber}`,
      type: 'scene',
      status: 'pending',
      prompt,
      source: 'generated',
      dependsOn: [],
    });
  }

  static createCharacter(
    project: ProjectFile,
    name: string,
    prompt: string,
    basePath: string = process.cwd()
  ): string {
    const manager = new ArtifactManager(project, basePath);
    const id = `char-${name.toLowerCase().replace(/\s+/g, '_')}`;
    return manager.create({
      id,
      type: 'character',
      status: 'pending',
      prompt,
      source: 'generated',
      dependsOn: [],
    });
  }

  static createSetting(
    project: ProjectFile,
    name: string,
    prompt: string,
    basePath: string = process.cwd()
  ): string {
    const manager = new ArtifactManager(project, basePath);
    const id = `setting-${name.toLowerCase().replace(/\s+/g, '_')}`;
    return manager.create({
      id,
      type: 'setting',
      status: 'pending',
      prompt,
      source: 'generated',
      dependsOn: [],
    });
  }

  static createImage(
    project: ProjectFile,
    parentId: string,
    prompt: string,
    basePath: string = process.cwd()
  ): string {
    const manager = new ArtifactManager(project, basePath);
    const id = `image-${Date.now()}`;
    return manager.create({
      id,
      type: 'image',
      status: 'pending',
      prompt,
      source: 'generated',
      dependsOn: [parentId],
    });
  }

  static createVideo(
    project: ProjectFile,
    parentId: string,
    prompt: string,
    basePath: string = process.cwd()
  ): string {
    const manager = new ArtifactManager(project, basePath);
    const id = `video-${Date.now()}`;
    return manager.create({
      id,
      type: 'video',
      status: 'pending',
      prompt,
      source: 'generated',
      dependsOn: [parentId],
    });
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

export function getArtifactManager(basePath: string = process.cwd()): ArtifactManager {
  const project = loadProject(basePath);
  if (!project) {
    throw new Error('No project found. Please create or load a project first.');
  }
  return new ArtifactManager(project, basePath);
}

export function createArtifactManager(
  project: ProjectFile,
  basePath: string = process.cwd()
): ArtifactManager {
  return new ArtifactManager(project, basePath);
}

// ============================================================================
// Artifact Initialization from Existing Files
// ============================================================================

export function initializeArtifactsFromFiles(
  project: ProjectFile,
  basePath: string = process.cwd()
): void {
  const manager = new ArtifactManager(project, basePath);

  const fileTypeToArtifactType: Record<string, ArtifactType> = {
    character: 'character',
    setting: 'setting',
    scene: 'scene',
    character_image: 'image',
    setting_image: 'image',
    scene_image: 'image',
    scene_video: 'video',
  };

  for (const file of project.files || []) {
    if (manager.exists(file.path)) continue;

    const artifactType = fileTypeToArtifactType[file.type];
    if (!artifactType) continue;

    const id = file.name
      ? `${artifactType}-${file.name.toLowerCase().replace(/\s+/g, '_')}`
      : file.path
          .replace(/\.(profile|prompt|motion|story)\.md$/, '')
          .replace(/[\/\-]/g, '_')
          .replace(/^_/, '');

    let dependsOn: string[] = [];

    if ((artifactType === 'image' || artifactType === 'video') && file.name) {
      if (file.type === 'character_image') {
        dependsOn = [`char_${file.name.toLowerCase().replace(/\s+/g, '_')}`];
      }
    }

    manager.create({
      id,
      type: artifactType,
      status: 'complete',
      prompt: file.summary || '',
      source: 'generated',
      dependsOn,
    });
  }
}

export function createArtifactFromFile(
  project: ProjectFile,
  filePath: string,
  fileType: string,
  name: string | undefined,
  summary: string | undefined,
  basePath: string = process.cwd()
): void {
  const manager = new ArtifactManager(project, basePath);

  if (manager.exists(filePath)) return;

  const fileTypeToArtifactType: Record<string, ArtifactType> = {
    character: 'character',
    setting: 'setting',
    scene: 'scene',
    character_image: 'image',
    setting_image: 'image',
    scene_image: 'image',
    scene_video: 'video',
  };

  const artifactType = fileTypeToArtifactType[fileType];
  if (!artifactType) return;

  const id = name
    ? `${artifactType}-${name.toLowerCase().replace(/\s+/g, '_')}`
    : filePath
        .replace(/\.(profile|prompt|motion|story)\.md$/, '')
        .replace(/[\/\-]/g, '_')
        .replace(/^_/, '');

  let dependsOn: string[] = [];

  if ((artifactType === 'image' || artifactType === 'video') && name) {
    if (fileType === 'character_image') {
      dependsOn = [`char_${name.toLowerCase().replace(/\s+/g, '_')}`];
    }
  }

  manager.create({
    id,
    type: artifactType,
    status: 'complete',
    prompt: summary || '',
    source: 'generated',
    dependsOn,
  });
}
