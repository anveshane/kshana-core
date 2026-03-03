/**
 * Generic Project Manager
 *
 * Template-aware project management that supports any video template type.
 * This is the v3.0 implementation that works with the generic artifact system.
 */

import * as fs from 'fs';
import * as path from 'path';

import type {
  VideoTemplate,
  GenericProjectFile,
  ArtifactInstance,
  ArtifactApprovalStatus,
  PhaseInfo,
  ContextStoreEntry,
  PhaseDefinition,
  ChapterInfo,
} from '../../../core/templates/types.js';
import {
  generateArtifactId,
  getArtifactFilePath,
} from '../../../core/templates/types.js';
import { TemplateRegistry } from '../../../core/templates/TemplateRegistry.js';
import { ArtifactGraph } from '../../../core/artifacts/ArtifactGraph.js';
import type { CreateArtifactOptions } from '../../../core/artifacts/ArtifactManager.js';
import { ArtifactManager } from '../../../core/artifacts/ArtifactManager.js';
import { ArtifactResolver } from '../../../core/artifacts/ArtifactResolver.js';
import { getActiveProjectDir } from './activeProject.js';

/**
 * Project file name
 */
export const PROJECT_FILE = 'project.json';

/**
 * Project version for v3.0 format
 */
export const PROJECT_VERSION = '3.0';

/**
 * Options for creating a new project
 */
export interface CreateProjectOptions {
  /** Project title */
  title: string;

  /** Template ID to use */
  templateId: string;

  /** Visual style ID */
  style?: string;

  /** Input type ID */
  inputType?: string;

  /** Initial input content */
  inputContent?: string;
}

/**
 * Generic Project Manager
 *
 * Handles project lifecycle for any template type.
 */
export class GenericProjectManager {
  private projectPath: string;
  private project: GenericProjectFile | null = null;
  private template: VideoTemplate | null = null;
  private graph: ArtifactGraph | null = null;
  private artifactManager: ArtifactManager | null = null;
  private resolver: ArtifactResolver | null = null;

  constructor(basePath: string) {
    this.projectPath = path.join(basePath, getActiveProjectDir());
  }

  /**
   * Check if a project exists at the current path
   */
  projectExists(): boolean {
    const projectFile = path.join(this.projectPath, PROJECT_FILE);
    return fs.existsSync(projectFile);
  }

  /**
   * Create a new project
   */
  async createProject(options: CreateProjectOptions): Promise<GenericProjectFile> {
    if (this.projectExists()) {
      throw new Error('Project already exists at this location');
    }

    // Get template
    const registry = TemplateRegistry.getInstance();
    const template = registry.get(options.templateId);
    if (!template) {
      throw new Error(`Template not found: ${options.templateId}`);
    }

    // Validate style
    const style = options.style || template.defaultStyle;
    if (!template.styles.some((s: { id: string }) => s.id === style)) {
      throw new Error(`Invalid style: ${style}`);
    }

    // Determine input type
    let inputType = options.inputType;
    if (!inputType && options.inputContent) {
      // Auto-detect input type
      inputType = registry.detectInputType(template, options.inputContent) || template.inputTypes[0]?.id;
    }
    inputType = inputType || template.inputTypes[0]?.id;

    if (!template.inputTypes.some((it: { id: string }) => it.id === inputType)) {
      throw new Error(`Invalid input type: ${inputType}`);
    }

    // Create project structure
    await this.createProjectStructure(template);

    // Create project file
    const projectId = generateProjectId();
    const now = Date.now();

    const project: GenericProjectFile = {
      version: '3.0',
      id: projectId,
      title: options.title,
      templateId: options.templateId,
      templateVersion: template.version,
      style,
      inputType: inputType!,
      createdAt: now,
      updatedAt: now,
      artifacts: {},
      phases: this.initializePhases(template),
      assets: [],
      contextStore: {},
    };

    // Set initial phase if template has phases
    if (template.phases && template.phases.length > 0 && template.phases[0]) {
      project.currentPhase = template.phases[0].id;
    }

    // Save original input if provided
    if (options.inputContent) {
      const inputFile = 'original_input.md';
      const inputPath = path.join(this.projectPath, inputFile);
      fs.writeFileSync(inputPath, options.inputContent, 'utf-8');

      // Store in context
      project.contextStore['$original_input'] = {
        filePath: inputFile,
        updatedAt: now,
      };
    }

    // Save project
    this.project = project;
    this.template = template;
    await this.saveProject();

    // Initialize managers
    this.initializeManagers();

    return project;
  }

  /**
   * Load an existing project
   */
  async loadProject(): Promise<GenericProjectFile> {
    if (!this.projectExists()) {
      throw new Error('No project found at this location');
    }

    const projectFile = path.join(this.projectPath, PROJECT_FILE);
    const content = fs.readFileSync(projectFile, 'utf-8');
    const project = JSON.parse(content) as GenericProjectFile;

    // Validate version
    if (project.version !== '3.0') {
      throw new Error(`Incompatible project version: ${project.version}. Expected: 3.0`);
    }

    // Load template
    const registry = TemplateRegistry.getInstance();
    const template = registry.get(project.templateId);
    if (!template) {
      throw new Error(`Template not found: ${project.templateId}`);
    }

    this.project = project;
    this.template = template;

    // Initialize managers
    this.initializeManagers();

    // Sync content from disk
    await this.syncFromDisk();

    return project;
  }

  /**
   * Save the current project state
   */
  async saveProject(): Promise<void> {
    if (!this.project) {
      throw new Error('No project loaded');
    }

    this.project.updatedAt = Date.now();

    const projectFile = path.join(this.projectPath, PROJECT_FILE);
    fs.writeFileSync(projectFile, JSON.stringify(this.project, null, 2), 'utf-8');
  }

  /**
   * Get the current project
   */
  getProject(): GenericProjectFile | null {
    return this.project;
  }

  /**
   * Get the current template
   */
  getTemplate(): VideoTemplate | null {
    return this.template;
  }

  /**
   * Get the artifact manager
   */
  getArtifactManager(): ArtifactManager | null {
    return this.artifactManager;
  }

  /**
   * Get the artifact resolver
   */
  getResolver(): ArtifactResolver | null {
    return this.resolver;
  }

  /**
   * Get the artifact graph
   */
  getGraph(): ArtifactGraph | null {
    return this.graph;
  }

  /**
   * Create project directory structure
   */
  private async createProjectStructure(template: VideoTemplate): Promise<void> {
    // Create main project directory
    fs.mkdirSync(this.projectPath, { recursive: true });

    // Create standard directories
    const dirs = ['plans', 'assets', 'assets/images', 'assets/videos'];

    // Add directories from artifact file patterns
    for (const [, artifactType] of Object.entries(template.artifactTypes) as [string, { filePattern: string }][]) {
      const dir = path.dirname(artifactType.filePattern);
      if (dir && dir !== '.' && !dirs.includes(dir)) {
        dirs.push(dir);
      }
    }

    for (const dir of dirs) {
      const fullPath = path.join(this.projectPath, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }
  }

  /**
   * Initialize phase tracking
   */
  private initializePhases(template: VideoTemplate): Record<string, PhaseInfo> | undefined {
    if (!template.phases || template.phases.length === 0) {
      return undefined;
    }

    const phases: Record<string, PhaseInfo> = {};
    for (const phase of template.phases) {
      phases[phase.id] = {
        id: phase.id,
        status: 'pending',
      };
    }

    return phases;
  }

  /**
   * Initialize artifact managers
   */
  private initializeManagers(): void {
    if (!this.project || !this.template) return;

    this.graph = new ArtifactGraph(this.template);
    this.artifactManager = new ArtifactManager(this.template, this.project, this.graph);
    this.resolver = new ArtifactResolver(this.template, this.graph);
  }

  /**
   * Sync project state from disk
   */
  private async syncFromDisk(): Promise<void> {
    if (!this.project || !this.template) return;

    // Sync context store files
    for (const [, entry] of Object.entries(this.project.contextStore) as [string, ContextStoreEntry][]) {
      if (entry.filePath) {
        const fullPath = path.join(this.projectPath, entry.filePath);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          entry.content = content;
        }
      }
    }

    // Sync artifact files
    for (const [, artifacts] of Object.entries(this.project.artifacts) as [string, Record<string, ArtifactInstance>][]) {
      for (const [, artifact] of Object.entries(artifacts) as [string, ArtifactInstance][]) {
        if (artifact.filePath) {
          const fullPath = path.join(this.projectPath, artifact.filePath);
          if (!fs.existsSync(fullPath)) {
            // File missing - mark artifact as needing attention
            artifact.error = {
              code: 'FILE_MISSING',
              message: `Artifact file not found: ${artifact.filePath}`,
              timestamp: Date.now(),
              recoverable: true,
            };
          }
        }
      }
    }
  }

  // ==========================================================================
  // ARTIFACT OPERATIONS
  // ==========================================================================

  /**
   * Create an artifact
   */
  async createArtifact(
    typeId: string,
    options: CreateArtifactOptions
  ): Promise<ArtifactInstance | null> {
    if (!this.artifactManager) {
      throw new Error('Project not loaded');
    }

    const result = this.artifactManager.create(typeId, options);
    if (result.success && result.artifact) {
      await this.saveProject();
      return result.artifact;
    }

    throw new Error(result.error || 'Failed to create artifact');
  }

  /**
   * Update an artifact
   */
  async updateArtifact(
    instanceId: string,
    updates: {
      name?: string;
      status?: ArtifactApprovalStatus;
      content?: string;
      assetPath?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<ArtifactInstance | null> {
    if (!this.artifactManager) {
      throw new Error('Project not loaded');
    }

    const result = this.artifactManager.update(instanceId, updates);
    if (result.success && result.artifact) {
      await this.saveProject();
      return result.artifact;
    }

    throw new Error(result.error || 'Failed to update artifact');
  }

  /**
   * Approve an artifact
   */
  async approveArtifact(instanceId: string): Promise<ArtifactInstance | null> {
    if (!this.artifactManager) {
      throw new Error('Project not loaded');
    }

    const result = this.artifactManager.approve(instanceId);
    if (result.success && result.artifact) {
      await this.saveProject();
      return result.artifact;
    }

    throw new Error(result.error || 'Failed to approve artifact');
  }

  /**
   * Reject an artifact
   */
  async rejectArtifact(instanceId: string): Promise<ArtifactInstance | null> {
    if (!this.artifactManager) {
      throw new Error('Project not loaded');
    }

    const result = this.artifactManager.reject(instanceId);
    if (result.success && result.artifact) {
      await this.saveProject();
      return result.artifact;
    }

    throw new Error(result.error || 'Failed to reject artifact');
  }

  /**
   * Delete an artifact
   */
  async deleteArtifact(instanceId: string, cascade: boolean = false): Promise<void> {
    if (!this.artifactManager) {
      throw new Error('Project not loaded');
    }

    const result = this.artifactManager.delete(instanceId, cascade);
    if (result.success) {
      await this.saveProject();
      return;
    }

    throw new Error(result.error || 'Failed to delete artifact');
  }

  /**
   * Get artifacts by type
   */
  getArtifactsByType(typeId: string): ArtifactInstance[] {
    return this.artifactManager?.getByType(typeId) || [];
  }

  /**
   * Get pending artifacts
   */
  getPendingArtifacts(): ArtifactInstance[] {
    return this.artifactManager?.getPending() || [];
  }

  // ==========================================================================
  // PHASE OPERATIONS
  // ==========================================================================

  /**
   * Get current phase
   */
  getCurrentPhase(): string | undefined {
    return this.project?.currentPhase;
  }

  /**
   * Update phase status
   */
  async updatePhaseStatus(
    phaseId: string,
    status: 'pending' | 'in_progress' | 'completed' | 'skipped'
  ): Promise<void> {
    if (!this.project?.phases) {
      throw new Error('Project has no phases');
    }

    if (!this.project.phases[phaseId]) {
      throw new Error(`Unknown phase: ${phaseId}`);
    }

    this.project.phases[phaseId].status = status;
    if (status === 'completed') {
      this.project.phases[phaseId].completedAt = Date.now();
    }

    await this.saveProject();
  }

  /**
   * Transition to next phase
   */
  async transitionToNextPhase(): Promise<string | null> {
    if (!this.project || !this.template?.phases) {
      return null;
    }

    const currentPhaseId = this.project.currentPhase;
    if (!currentPhaseId) return null;

    const phases = this.template.phases;
    const currentIndex = phases.findIndex((p: PhaseDefinition) => p.id === currentPhaseId);

    if (currentIndex < 0 || currentIndex >= phases.length - 1) {
      return null;
    }

    const nextPhase = phases[currentIndex + 1];
    if (!nextPhase) {
      return null;
    }

    this.project.currentPhase = nextPhase.id;

    // Mark current phase as completed if not already
    const currentPhaseInfo = this.project.phases?.[currentPhaseId];
    if (currentPhaseInfo && currentPhaseInfo.status !== 'completed') {
      currentPhaseInfo.status = 'completed';
      currentPhaseInfo.completedAt = Date.now();
    }

    // Mark next phase as in_progress
    const nextPhaseInfo = this.project.phases?.[nextPhase.id];
    if (nextPhaseInfo) {
      nextPhaseInfo.status = 'in_progress';
      nextPhaseInfo.startedAt = Date.now();
    }

    await this.saveProject();
    return nextPhase.id;
  }

  /**
   * Check if current phase is complete
   */
  isCurrentPhaseComplete(): boolean {
    if (!this.project || !this.template?.phases) {
      return false;
    }

    const currentPhaseId = this.project.currentPhase;
    if (!currentPhaseId) return false;

    const phase = this.template.phases.find((p: PhaseDefinition) => p.id === currentPhaseId);
    if (!phase) return false;

    // Check all artifact types in this phase are complete
    for (const typeId of phase.artifactTypes) {
      if (!this.artifactManager?.isTypeComplete(typeId)) {
        return false;
      }
    }

    return true;
  }

  // ==========================================================================
  // CONTEXT OPERATIONS
  // ==========================================================================

  /**
   * Get context content by variable name
   */
  getContext(varName: string): string | undefined {
    return this.artifactManager?.getContext(varName);
  }

  /**
   * Set context content
   */
  async setContext(
    varName: string,
    content: string,
    saveToFile?: string
  ): Promise<void> {
    if (!this.project) {
      throw new Error('Project not loaded');
    }

    this.artifactManager?.setContext(varName, content);

    if (saveToFile) {
      const fullPath = path.join(this.projectPath, saveToFile);
      fs.writeFileSync(fullPath, content, 'utf-8');
      this.project.contextStore[varName] = {
        content,
        filePath: saveToFile,
        updatedAt: Date.now(),
      };
    }

    await this.saveProject();
  }

  /**
   * Get all context for generating an artifact type
   */
  getContextForType(typeId: string): Record<string, string> {
    return this.artifactManager?.getContextForType(typeId) || {};
  }

  // ==========================================================================
  // FILE OPERATIONS
  // ==========================================================================

  /**
   * Read a file from the project
   */
  readFile(relativePath: string): string | null {
    const fullPath = path.join(this.projectPath, relativePath);
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    return fs.readFileSync(fullPath, 'utf-8');
  }

  /**
   * Write a file to the project
   */
  writeFile(relativePath: string, content: string): void {
    const fullPath = path.join(this.projectPath, relativePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  /**
   * Check if a file exists
   */
  fileExists(relativePath: string): boolean {
    const fullPath = path.join(this.projectPath, relativePath);
    return fs.existsSync(fullPath);
  }

  /**
   * Get the full path for a relative path
   */
  getFullPath(relativePath: string): string {
    return path.join(this.projectPath, relativePath);
  }

  /**
   * Get the project directory path
   */
  getProjectPath(): string {
    return this.projectPath;
  }

  /**
   * Synchronously load the project without auto-discovering content.
   * Used by planner tools that need quick access to project state.
   */
  loadProjectSync(): GenericProjectFile {
    const projectFile = path.join(this.projectPath, PROJECT_FILE);
    if (!fs.existsSync(projectFile)) {
      throw new Error('No project found at this location');
    }

    const content = fs.readFileSync(projectFile, 'utf-8');
    const project = JSON.parse(content) as GenericProjectFile;

    return project;
  }

  /**
   * Create an empty project for planning (doesn't save to disk).
   * Used when no project exists but we need a project structure for the planner.
   */
  createEmptyProject(templateId: string): GenericProjectFile {
    const registry = TemplateRegistry.getInstance();
    const template = registry.get(templateId);

    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const projectId = generateProjectId();
    const now = Date.now();

    const project: GenericProjectFile = {
      version: '3.0',
      id: projectId,
      title: 'Planning Project',
      templateId,
      templateVersion: template.version,
      style: template.defaultStyle,
      inputType: template.inputTypes[0]?.id || 'idea',
      createdAt: now,
      updatedAt: now,
      artifacts: {},
      phases: {},
      assets: [],
      contextStore: {},
    };

    return project;
  }

  // ==========================================================================
  // STATUS & PROGRESS
  // ==========================================================================

  /**
   * Get project progress summary
   */
  getProgressSummary(): {
    totalArtifactTypes: number;
    completedTypes: number;
    inProgressTypes: number;
    pendingTypes: number;
    currentPhase: string | undefined;
    phaseProgress: Record<string, { status: string; completedAt?: number }>;
  } | null {
    if (!this.resolver || !this.project) {
      return null;
    }

    const progress = this.resolver.getProgressSummary(this.project);
    const phaseProgress: Record<string, { status: string; completedAt?: number }> = {};

    if (this.project.phases) {
      for (const [id, info] of Object.entries(this.project.phases) as [string, PhaseInfo][]) {
        phaseProgress[id] = {
          status: info.status,
          completedAt: info.completedAt,
        };
      }
    }

    return {
      ...progress,
      currentPhase: this.project.currentPhase,
      phaseProgress,
    };
  }

  /**
   * Get next recommended actions
   */
  getNextActions(): Array<{
    action: string;
    artifactType?: string;
    description: string;
    priority: number;
  }> {
    if (!this.resolver || !this.project) {
      return [];
    }

    return this.resolver.getNextActions(this.project);
  }

  // ==========================================================================
  // CHAPTER OPERATIONS
  // ==========================================================================

  /**
   * Create a new chapter
   */
  async createChapter(title: string, description?: string): Promise<ChapterInfo> {
    if (!this.project) {
      throw new Error('Project not loaded');
    }

    // Initialize chapters if needed
    if (!this.project.chapters) {
      this.project.chapters = {};
    }

    // Generate chapter ID
    const chapterId = generateChapterId();
    const now = Date.now();

    // Calculate order (1-based)
    const existingChapters = Object.values(this.project.chapters);
    const order = existingChapters.length + 1;

    // Create chapter info
    const chapter: ChapterInfo = {
      id: chapterId,
      title,
      order,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      description,
    };

    // Add to project
    this.project.chapters[chapterId] = chapter;

    // Set as current chapter if first chapter
    if (order === 1) {
      this.project.currentChapter = chapterId;
    }

    // Create chapter directory structure
    await this.createChapterStructure(chapterId);

    // Save project
    await this.saveProject();

    return chapter;
  }

  /**
   * Switch to a different chapter
   */
  async switchChapter(chapterId: string): Promise<void> {
    if (!this.project) {
      throw new Error('Project not loaded');
    }

    if (!this.project.chapters?.[chapterId]) {
      throw new Error(`Chapter not found: ${chapterId}`);
    }

    // Update current chapter status if switching away
    const currentChapterId = this.project.currentChapter;
    if (currentChapterId && currentChapterId !== chapterId) {
      const currentChapter = this.project.chapters[currentChapterId];
      if (currentChapter && currentChapter.status === 'in_progress') {
        // Keep it as in_progress, just switching
      }
    }

    // Set new current chapter
    this.project.currentChapter = chapterId;

    // Mark new chapter as in_progress if pending
    const newChapter = this.project.chapters[chapterId];
    if (newChapter && newChapter.status === 'pending') {
      newChapter.status = 'in_progress';
      newChapter.updatedAt = Date.now();
    }

    await this.saveProject();
  }

  /**
   * List all chapters
   */
  listChapters(): ChapterInfo[] {
    if (!this.project?.chapters) {
      return [];
    }

    return Object.values(this.project.chapters).sort((a, b) => a.order - b.order);
  }

  /**
   * Get current chapter
   */
  getCurrentChapter(): ChapterInfo | null {
    if (!this.project?.currentChapter || !this.project.chapters) {
      return null;
    }

    return this.project.chapters[this.project.currentChapter] || null;
  }

  /**
   * Update chapter status
   */
  async updateChapterStatus(
    chapterId: string,
    status: 'pending' | 'in_progress' | 'completed'
  ): Promise<void> {
    if (!this.project?.chapters?.[chapterId]) {
      throw new Error(`Chapter not found: ${chapterId}`);
    }

    this.project.chapters[chapterId].status = status;
    this.project.chapters[chapterId].updatedAt = Date.now();

    await this.saveProject();
  }

  /**
   * Get chapter by ID
   */
  getChapter(chapterId: string): ChapterInfo | null {
    return this.project?.chapters?.[chapterId] || null;
  }

  /**
   * Check if project has chapters
   */
  hasChapters(): boolean {
    return Object.keys(this.project?.chapters || {}).length > 0;
  }

  /**
   * Get artifacts for current chapter
   */
  getChapterArtifacts(chapterId?: string): ArtifactInstance[] {
    const targetChapterId = chapterId || this.project?.currentChapter;
    if (!targetChapterId || !this.project) {
      return [];
    }

    const artifacts: ArtifactInstance[] = [];

    for (const typeArtifacts of Object.values(this.project.artifacts)) {
      for (const artifact of Object.values(typeArtifacts)) {
        // Include if chapter-scoped and matches, or if project-scoped (no chapterId)
        if (artifact.chapterId === targetChapterId || !artifact.chapterId) {
          artifacts.push(artifact);
        }
      }
    }

    return artifacts;
  }

  /**
   * Create directory structure for a chapter
   */
  private async createChapterStructure(chapterId: string): Promise<void> {
    const chapterDir = path.join(this.projectPath, 'chapters', chapterId);

    const dirs = [
      chapterDir,
      path.join(chapterDir, 'plans'),
      path.join(chapterDir, 'scenes'),
      path.join(chapterDir, 'assets'),
      path.join(chapterDir, 'assets', 'images'),
      path.join(chapterDir, 'assets', 'images', 'scenes'),
      path.join(chapterDir, 'assets', 'videos'),
      path.join(chapterDir, 'assets', 'videos', 'scenes'),
      path.join(chapterDir, 'assets', 'videos', 'final'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Get project-scoped artifacts (shared across chapters)
   */
  getProjectScopedArtifacts(): ArtifactInstance[] {
    if (!this.project || !this.template) {
      return [];
    }

    const artifacts: ArtifactInstance[] = [];

    for (const [typeId, typeArtifacts] of Object.entries(this.project.artifacts)) {
      const artifactType = this.template.artifactTypes[typeId];
      // Project-scoped or no scope specified (defaults to project for compatibility)
      if (artifactType?.scope === 'project' || !artifactType?.scope) {
        for (const artifact of Object.values(typeArtifacts)) {
          if (!artifact.chapterId) {
            artifacts.push(artifact);
          }
        }
      }
    }

    return artifacts;
  }

  /**
   * Resolve file pattern for chapter-scoped artifacts
   */
  resolveChapterFilePath(
    filePattern: string,
    name: string,
    chapterId?: string
  ): string {
    let resolved = filePattern;

    // Replace chapter placeholder
    if (chapterId) {
      resolved = resolved.replace(/\{\{chapter\}\}/g, chapterId);
    } else if (this.project?.currentChapter) {
      resolved = resolved.replace(/\{\{chapter\}\}/g, this.project.currentChapter);
    }

    // Replace name placeholder
    resolved = resolved.replace(/\{\{name\}\}/g, sanitizeFileName(name));

    return resolved;
  }
}

/**
 * Generate a unique chapter ID
 */
function generateChapterId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ch_${timestamp}_${random}`;
}

/**
 * Sanitize a string for use in file names
 */
function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Generate a unique project ID
 */
function generateProjectId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `proj_${timestamp}_${random}`;
}

/**
 * Create a project manager for the current working directory
 */
export function createProjectManager(basePath?: string): GenericProjectManager {
  return new GenericProjectManager(basePath || process.cwd());
}

export default GenericProjectManager;
