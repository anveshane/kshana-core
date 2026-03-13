/**
 * Artifact Manager
 *
 * Handles CRUD operations for artifacts within a project.
 * Manages artifact lifecycle, persistence, and state transitions.
 */

import type {
  VideoTemplate,
  ArtifactTypeDefinition,
  ArtifactInstance,
  ArtifactApprovalStatus,
  GenericProjectFile,
  ContextStoreEntry,
} from '../templates/types.js';
import {
  generateArtifactId,
  getArtifactFilePath,
} from '../templates/types.js';
import { ArtifactGraph } from './ArtifactGraph.js';
import type { RippleEffect, ArtifactImpact, MissingDependency } from './ArtifactGraph.js';
import { getPhaseLogger } from '../../utils/phaseLogger.js';

/**
 * Options for creating an artifact
 */
export interface CreateArtifactOptions {
  /** Name for the artifact (required for collections) */
  name: string;

  /** Initial content (for markdown/json artifacts) */
  content?: string;

  /** Path to asset (for image/video artifacts) */
  assetPath?: string;

  /** Initial status (defaults to 'pending') */
  status?: ArtifactApprovalStatus;

  /** Additional metadata */
  metadata?: Record<string, unknown>;

  /** For collections: item identifier */
  itemId?: string;
}

/**
 * Options for updating an artifact
 */
export interface UpdateArtifactOptions {
  /** New name */
  name?: string;

  /** New content */
  content?: string;

  /** New asset path */
  assetPath?: string;

  /** New status */
  status?: ArtifactApprovalStatus;

  /** Metadata to merge */
  metadata?: Record<string, unknown>;

  /** Whether to increment version */
  incrementVersion?: boolean;
}

/**
 * Result of an artifact operation
 */
export interface ArtifactOperationResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** The affected artifact (if successful) */
  artifact?: ArtifactInstance;

  /** Error message (if failed) */
  error?: string;

  /** Ripple effects from the operation */
  rippleEffect?: RippleEffect;
}

/**
 * Query options for finding artifacts
 */
export interface ArtifactQuery {
  /** Filter by type ID */
  typeId?: string;

  /** Filter by status */
  status?: ArtifactApprovalStatus | ArtifactApprovalStatus[];

  /** Filter by category */
  category?: string;

  /** Filter by name (partial match) */
  nameContains?: string;

  /** Only return expensive (image/video) artifacts */
  expensiveOnly?: boolean;

  /** Sort by field */
  sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'status';

  /** Sort direction */
  sortDirection?: 'asc' | 'desc';

  /** Limit results */
  limit?: number;
}

/**
 * Artifact Manager
 */
export class ArtifactManager {
  private template: VideoTemplate;
  private graph: ArtifactGraph;
  private project: GenericProjectFile;

  constructor(template: VideoTemplate, project: GenericProjectFile, graph?: ArtifactGraph) {
    this.template = template;
    this.project = project;
    this.graph = graph || new ArtifactGraph(template);
  }

  /**
   * Get the current project state
   */
  getProject(): GenericProjectFile {
    return this.project;
  }

  /**
   * Create a new artifact
   */
  create(typeId: string, options: CreateArtifactOptions): ArtifactOperationResult {
    const typeDef = this.template.artifactTypes[typeId];
    if (!typeDef) {
      return { success: false, error: `Unknown artifact type: ${typeId}` };
    }

    // For collections, require a name/itemId
    if (typeDef.isCollection && !options.name && !options.itemId) {
      return {
        success: false,
        error: `Collection artifact type '${typeId}' requires a name or itemId`,
      };
    }

    // Check dependencies
    const canCreate = this.graph.canCreate(typeId, this.project);
    if (!canCreate.canCreate) {
      const missingNames = canCreate.missingRequired
        .map((m: MissingDependency) => m.displayName)
        .join(', ');
      return {
        success: false,
        error: `Missing required dependencies: ${missingNames}`,
      };
    }

    // Generate artifact ID
    const itemId = options.itemId || (typeDef.isCollection ? sanitizeId(options.name) : typeId);
    const artifactId = generateArtifactId(typeId, typeDef.isCollection ? itemId : undefined);

    // Calculate file path
    const filePath = getArtifactFilePath(
      typeDef,
      options.name,
      typeDef.isCollection ? this.getNextIndex(typeId) : undefined
    );

    // Get dependency instance IDs
    const dependsOn = this.getDependencyInstanceIds(typeId);

    // Create the artifact instance
    const artifact: ArtifactInstance = {
      id: artifactId,
      typeId,
      itemId: typeDef.isCollection ? itemId : undefined,
      name: options.name,
      status: options.status || 'pending',
      filePath,
      assetPath: options.assetPath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      dependsOn,
      dependedBy: [],
      metadata: options.metadata || {},
    };

    // Add to project
    if (!this.project.artifacts[typeId]) {
      this.project.artifacts[typeId] = {};
    }
    this.project.artifacts[typeId][artifactId] = artifact;

    // Update dependedBy for dependencies
    this.updateDependedBy(artifact);

    // Update project timestamp
    this.project.updatedAt = Date.now();

    // Update context store if this artifact provides context
    if (options.content) {
      this.updateContextStore(typeId, options.content, artifactId);
    }

    return { success: true, artifact };
  }

  /**
   * Update an existing artifact
   */
  update(instanceId: string, options: UpdateArtifactOptions): ArtifactOperationResult {
    const artifact = this.findById(instanceId);
    if (!artifact) {
      return { success: false, error: `Artifact not found: ${instanceId}` };
    }

    const typeDef = this.template.artifactTypes[artifact.typeId];

    // Calculate ripple effects before updating
    const rippleEffect =
      options.content || options.status === 'approved'
        ? this.graph.calculateRippleEffect(artifact.typeId, this.project, instanceId)
        : undefined;

    // Update fields
    if (options.name !== undefined) {
      artifact.name = options.name;
    }
    if (options.assetPath !== undefined) {
      artifact.assetPath = options.assetPath;
    }
    if (options.status !== undefined) {
      artifact.status = options.status;
    }
    if (options.metadata) {
      artifact.metadata = { ...artifact.metadata, ...options.metadata };
    }
    if (options.incrementVersion) {
      artifact.version++;
    }

    artifact.updatedAt = Date.now();
    this.project.updatedAt = Date.now();

    // Update context store if content changed
    if (options.content) {
      this.updateContextStore(artifact.typeId, options.content, instanceId);
    }

    return { success: true, artifact, rippleEffect };
  }

  /**
   * Delete an artifact
   */
  delete(instanceId: string, cascade: boolean = false): ArtifactOperationResult {
    const artifact = this.findById(instanceId);
    if (!artifact) {
      return { success: false, error: `Artifact not found: ${instanceId}` };
    }

    // Calculate ripple effect
    const rippleEffect = this.graph.calculateRippleEffect(
      artifact.typeId,
      this.project,
      instanceId
    );

    // If there are dependents and cascade is false, fail
    if (rippleEffect.invalidated.length > 0 && !cascade) {
      return {
        success: false,
        error: `Cannot delete: ${rippleEffect.invalidated.length} artifacts depend on this`,
        rippleEffect,
      };
    }

    // Delete dependents if cascading
    if (cascade) {
      for (const affected of rippleEffect.invalidated) {
        this.deleteInternal(affected.instanceId);
      }
    }

    // Delete the artifact
    this.deleteInternal(instanceId);

    this.project.updatedAt = Date.now();

    return { success: true, artifact, rippleEffect };
  }

  /**
   * Internal delete without checks
   */
  private deleteInternal(instanceId: string): void {
    for (const [typeId, artifacts] of Object.entries(this.project.artifacts) as [string, Record<string, ArtifactInstance>][]) {
      if (artifacts[instanceId]) {
        // Remove from dependedBy of dependencies
        const artifact = artifacts[instanceId];
        for (const depId of artifact.dependsOn) {
          const depArtifact = this.findById(depId);
          if (depArtifact) {
            depArtifact.dependedBy = depArtifact.dependedBy.filter((id: string) => id !== instanceId);
          }
        }

        delete artifacts[instanceId];
        break;
      }
    }
  }

  /**
   * Change artifact status
   */
  setStatus(instanceId: string, status: ArtifactApprovalStatus): ArtifactOperationResult {
    return this.update(instanceId, { status });
  }

  /**
   * Approve an artifact
   */
  approve(instanceId: string): ArtifactOperationResult {
    return this.setStatus(instanceId, 'approved');
  }

  /**
   * Reject an artifact
   */
  reject(instanceId: string): ArtifactOperationResult {
    return this.setStatus(instanceId, 'rejected');
  }

  /**
   * Mark artifact for regeneration, then cascade-invalidate all downstream artifacts.
   */
  markForRegeneration(instanceId: string): ArtifactOperationResult {
    const result = this.update(instanceId, { status: 'regenerating', incrementVersion: true });
    if (result.success) {
      this.cascadeInvalidation(instanceId);
    }
    return result;
  }

  /**
   * Cascade invalidation: mark all downstream artifacts as 'stale' when an
   * upstream artifact is regenerated. Uses the dependency graph's ripple
   * effect calculation to find all affected artifacts.
   */
  cascadeInvalidation(instanceId: string): ArtifactImpact[] {
    const artifact = this.findById(instanceId);
    if (!artifact) return [];

    const phaseLogger = getPhaseLogger();
    const ripple = this.graph.calculateRippleEffect(artifact.typeId, this.project, instanceId);
    const staled: ArtifactImpact[] = [];

    for (const impact of ripple.invalidated) {
      const downstream = this.findById(impact.instanceId);
      if (downstream && (downstream.status === 'approved' || downstream.status === 'in_review')) {
        downstream.status = 'stale';
        downstream.metadata['staleReason'] = `Upstream artifact ${instanceId} (${artifact.typeId}) was regenerated`;
        downstream.updatedAt = Date.now();
        staled.push(impact);
        phaseLogger.info('ArtifactManager', 'cascade_invalidation', `Marked ${impact.typeId}/${impact.name} as stale`, {
          staledInstanceId: impact.instanceId,
          staledTypeId: impact.typeId,
          sourceInstanceId: instanceId,
          sourceTypeId: artifact.typeId,
        });
      }
    }

    if (staled.length > 0) {
      phaseLogger.info('ArtifactManager', 'cascade_invalidation', `Invalidated ${staled.length} downstream artifacts`, {
        sourceInstanceId: instanceId,
        staledCount: staled.length,
      });
    }

    return staled;
  }

  /**
   * Import an external artifact (e.g., user-provided content)
   */
  import(typeId: string, options: CreateArtifactOptions): ArtifactOperationResult {
    // Create with 'approved' status since it's user-provided
    return this.create(typeId, { ...options, status: 'approved' });
  }

  /**
   * Find artifact by instance ID
   */
  findById(instanceId: string): ArtifactInstance | undefined {
    for (const artifacts of Object.values(this.project.artifacts)) {
      if (artifacts[instanceId]) {
        return artifacts[instanceId];
      }
    }
    return undefined;
  }

  /**
   * Get all artifacts of a type
   */
  getByType(typeId: string): ArtifactInstance[] {
    return Object.values(this.project.artifacts[typeId] || {});
  }

  /**
   * Get artifact by type and item ID (for collections)
   */
  getByTypeAndItem(typeId: string, itemId: string): ArtifactInstance | undefined {
    const artifacts = this.project.artifacts[typeId] || {};
    return Object.values(artifacts).find((a) => a.itemId === itemId);
  }

  /**
   * Query artifacts with filters
   */
  query(options: ArtifactQuery): ArtifactInstance[] {
    let results: ArtifactInstance[] = [];

    // Collect all artifacts or filter by type
    if (options.typeId) {
      results = this.getByType(options.typeId);
    } else {
      for (const artifacts of Object.values(this.project.artifacts) as Record<string, ArtifactInstance>[]) {
        results.push(...(Object.values(artifacts) as ArtifactInstance[]));
      }
    }

    // Filter by status
    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      results = results.filter((a) => statuses.includes(a.status));
    }

    // Filter by category
    if (options.category) {
      results = results.filter((a) => {
        const typeDef = this.template.artifactTypes[a.typeId];
        return typeDef?.category === options.category;
      });
    }

    // Filter by name
    if (options.nameContains) {
      const search = options.nameContains.toLowerCase();
      results = results.filter((a) => a.name.toLowerCase().includes(search));
    }

    // Filter expensive only
    if (options.expensiveOnly) {
      results = results.filter((a) => {
        const typeDef = this.template.artifactTypes[a.typeId];
        return typeDef?.isExpensive;
      });
    }

    // Sort
    if (options.sortBy) {
      const direction = options.sortDirection === 'desc' ? -1 : 1;
      results.sort((a, b) => {
        let aVal: string | number;
        let bVal: string | number;

        switch (options.sortBy) {
          case 'createdAt':
            aVal = a.createdAt;
            bVal = b.createdAt;
            break;
          case 'updatedAt':
            aVal = a.updatedAt;
            bVal = b.updatedAt;
            break;
          case 'name':
            aVal = a.name.toLowerCase();
            bVal = b.name.toLowerCase();
            break;
          case 'status':
            aVal = a.status;
            bVal = b.status;
            break;
          default:
            return 0;
        }

        if (aVal < bVal) return -1 * direction;
        if (aVal > bVal) return 1 * direction;
        return 0;
      });
    }

    // Limit
    if (options.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get pending artifacts (need approval)
   */
  getPending(): ArtifactInstance[] {
    return this.query({ status: ['pending', 'in_review'] });
  }

  /**
   * Get rejected artifacts (need regeneration)
   */
  getRejected(): ArtifactInstance[] {
    return this.query({ status: 'rejected' });
  }

  /**
   * Get approved artifacts
   */
  getApproved(): ArtifactInstance[] {
    return this.query({ status: 'approved' });
  }

  /**
   * Get stale artifacts (invalidated by upstream regeneration)
   */
  getStale(): ArtifactInstance[] {
    return this.query({ status: 'stale' });
  }

  /**
   * Check if all artifacts of a type are approved
   */
  isTypeComplete(typeId: string): boolean {
    const artifacts = this.getByType(typeId);
    if (artifacts.length === 0) return false;
    return artifacts.every((a) => a.status === 'approved');
  }

  /**
   * Get the next index for a collection type
   */
  private getNextIndex(typeId: string): number {
    const artifacts = this.getByType(typeId);
    return artifacts.length + 1;
  }

  /**
   * Get dependency instance IDs for a new artifact
   */
  private getDependencyInstanceIds(typeId: string): string[] {
    const node = this.graph.getNode(typeId);
    if (!node) return [];

    const dependencyIds: string[] = [];

    for (const dep of node.dependencies) {
      const depArtifacts = this.getByType(dep.artifactTypeId);
      const approvedDeps = depArtifacts.filter((a: ArtifactInstance) => a.status === 'approved');
      const scope = dep.scope ?? 'all';

      if (scope === 'all') {
        dependencyIds.push(...approvedDeps.map((a: ArtifactInstance) => a.id));
      } else if (scope === 'any' && approvedDeps.length > 0 && approvedDeps[0]) {
        dependencyIds.push(approvedDeps[0].id);
      } else {
        dependencyIds.push(...approvedDeps.map((a: ArtifactInstance) => a.id));
      }
    }

    return dependencyIds;
  }

  /**
   * Update dependedBy for dependency artifacts
   */
  private updateDependedBy(artifact: ArtifactInstance): void {
    for (const depId of artifact.dependsOn) {
      const depArtifact = this.findById(depId);
      if (depArtifact && !depArtifact.dependedBy.includes(artifact.id)) {
        depArtifact.dependedBy.push(artifact.id);
      }
    }
  }

  /**
   * Update context store with artifact content
   */
  private updateContextStore(typeId: string, content: string, artifactId: string): void {
    // Find the context variable name for this type
    const varName = Object.entries(this.template.contextVariables).find(
      ([, t]) => t === typeId
    )?.[0];

    if (varName) {
      this.project.contextStore[varName] = {
        content,
        updatedAt: Date.now(),
        sourceArtifactId: artifactId,
      };
    }
  }

  /**
   * Get content from context store
   */
  getContext(varName: string): string | undefined {
    const entry = this.project.contextStore[varName];
    return entry?.content;
  }

  /**
   * Set content in context store
   */
  setContext(varName: string, content: string, sourceArtifactId?: string): void {
    this.project.contextStore[varName] = {
      content,
      updatedAt: Date.now(),
      sourceArtifactId,
    };
  }

  /**
   * Get all context for a target artifact type
   */
  getContextForType(typeId: string): Record<string, string> {
    const context: Record<string, string> = {};
    const node = this.graph.getNode(typeId);
    if (!node) return context;

    for (const dep of node.dependencies) {
      if (dep.usage === 'context') {
        // Find the context variable for this dependency
        const varName = Object.entries(this.template.contextVariables).find(
          ([, t]) => t === dep.artifactTypeId
        )?.[0];

        if (varName) {
          const content = this.getContext(varName);
          if (content) {
            context[varName] = content;
          }
        }
      }
    }

    return context;
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    total: number;
    byStatus: Record<ArtifactApprovalStatus, number>;
    byType: Record<string, number>;
    byCategory: Record<string, number>;
  } {
    const allArtifacts = this.query({});

    const byStatus: Record<ArtifactApprovalStatus, number> = {
      pending: 0,
      in_review: 0,
      approved: 0,
      rejected: 0,
      regenerating: 0,
      stale: 0,
    };

    const byType: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const artifact of allArtifacts) {
      byStatus[artifact.status]++;

      byType[artifact.typeId] = (byType[artifact.typeId] || 0) + 1;

      const typeDef = this.template.artifactTypes[artifact.typeId] as ArtifactTypeDefinition | undefined;
      if (typeDef) {
        byCategory[typeDef.category] = (byCategory[typeDef.category] || 0) + 1;
      }
    }

    return {
      total: allArtifacts.length,
      byStatus,
      byType,
      byCategory,
    };
  }

  /**
   * Validate project consistency
   */
  validate(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check for orphaned artifacts (dependencies that no longer exist)
    for (const artifacts of Object.values(this.project.artifacts) as Record<string, ArtifactInstance>[]) {
      for (const artifact of Object.values(artifacts) as ArtifactInstance[]) {
        for (const depId of artifact.dependsOn) {
          if (!this.findById(depId)) {
            issues.push(`Artifact ${artifact.id} references non-existent dependency ${depId}`);
          }
        }
      }
    }

    // Check for unknown artifact types
    for (const typeId of Object.keys(this.project.artifacts)) {
      if (!this.template.artifactTypes[typeId]) {
        issues.push(`Unknown artifact type: ${typeId}`);
      }
    }

    // Check context store references
    for (const [varName, entry] of Object.entries(this.project.contextStore) as [string, ContextStoreEntry][]) {
      if (entry.sourceArtifactId && !this.findById(entry.sourceArtifactId)) {
        issues.push(`Context ${varName} references non-existent artifact ${entry.sourceArtifactId}`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}

/**
 * Sanitize a string for use as an ID
 */
function sanitizeId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
