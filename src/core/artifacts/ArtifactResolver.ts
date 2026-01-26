/**
 * Artifact Resolver
 *
 * Resolves user intents to artifact operations.
 * Handles dependency checking, action suggestions, and user prompts.
 */

import type {
  VideoTemplate,
  ArtifactTypeDefinition,
  ArtifactInstance,
  GenericProjectFile,
  ArtifactRequest,
  ArtifactRequestResolution,
  ArtifactDependencyInfo,
  ArtifactAffectedInfo,
  SuggestedAction,
} from '../templates/types.js';
import { ArtifactGraph } from './ArtifactGraph.js';
import type { CanCreateResult, RippleEffect, MissingDependency, ArtifactImpact } from './ArtifactGraph.js';

/**
 * Intent extracted from user input
 */
export interface UserIntent {
  /** Type of intent */
  type: 'create' | 'update' | 'regenerate' | 'delete' | 'approve' | 'reject' | 'view' | 'list';

  /** Target artifact type (if specified) */
  artifactType?: string;

  /** Specific item (for collections) */
  itemId?: string;

  /** Additional content or parameters */
  content?: string;

  /** Confidence score (0-1) */
  confidence: number;

  /** Original user input */
  originalInput: string;
}

/**
 * Pattern for detecting intents
 */
interface IntentPattern {
  /** Regex or keywords to match */
  patterns: RegExp[];

  /** Resulting intent type */
  intentType: UserIntent['type'];

  /** Function to extract artifact type from match */
  extractArtifactType?: (match: RegExpMatchArray, template: VideoTemplate) => string | undefined;

  /** Function to extract item ID from match */
  extractItemId?: (match: RegExpMatchArray) => string | undefined;

  /** Base confidence for this pattern */
  confidence: number;
}

/**
 * Next action recommendation
 */
export interface NextActionRecommendation {
  /** What to do next */
  action: 'create' | 'approve' | 'regenerate' | 'continue' | 'complete';

  /** Target artifact type */
  artifactType?: string;

  /** For collections: specific items */
  itemIds?: string[];

  /** Human-readable description */
  description: string;

  /** Priority (lower = more urgent) */
  priority: number;

  /** Reason for this recommendation */
  reason: string;
}

/**
 * Artifact Resolver
 */
export class ArtifactResolver {
  private template: VideoTemplate;
  private graph: ArtifactGraph;
  private intentPatterns: IntentPattern[];

  constructor(template: VideoTemplate, graph?: ArtifactGraph) {
    this.template = template;
    this.graph = graph || new ArtifactGraph(template);
    this.intentPatterns = this.buildIntentPatterns();
  }

  /**
   * Build intent detection patterns
   */
  private buildIntentPatterns(): IntentPattern[] {
    const patterns: IntentPattern[] = [];

    // Create patterns
    patterns.push({
      patterns: [
        /(?:create|generate|make|write|add)\s+(?:a\s+)?(?:new\s+)?(\w+)/i,
        /(?:let's|let me|i want to)\s+(?:create|generate|make|write)\s+(?:the\s+)?(\w+)/i,
      ],
      intentType: 'create',
      extractArtifactType: (match, template) => this.matchArtifactType(match[1] ?? '', template),
      confidence: 0.8,
    });

    // Update patterns
    patterns.push({
      patterns: [
        /(?:update|edit|modify|change)\s+(?:the\s+)?(\w+)/i,
        /(?:revise|refine)\s+(?:the\s+)?(\w+)/i,
      ],
      intentType: 'update',
      extractArtifactType: (match, template) => this.matchArtifactType(match[1] ?? '', template),
      confidence: 0.8,
    });

    // Regenerate patterns
    patterns.push({
      patterns: [
        /(?:regenerate|redo|recreate)\s+(?:the\s+)?(\w+)/i,
        /(?:try again|another attempt)\s+(?:at|on|for)?\s+(?:the\s+)?(\w+)/i,
      ],
      intentType: 'regenerate',
      extractArtifactType: (match, template) =>
        this.matchArtifactType(match[1] ?? match[2] ?? '', template),
      confidence: 0.85,
    });

    // Delete patterns
    patterns.push({
      patterns: [
        /(?:delete|remove|discard)\s+(?:the\s+)?(\w+)/i,
        /(?:get rid of)\s+(?:the\s+)?(\w+)/i,
      ],
      intentType: 'delete',
      extractArtifactType: (match, template) => this.matchArtifactType(match[1] ?? '', template),
      confidence: 0.9,
    });

    // Approve patterns
    patterns.push({
      patterns: [
        /(?:approve|accept|confirm|looks? good|lgtm)/i,
        /(?:yes|yeah|ok|okay|sure),?\s*(?:approve|accept)?/i,
      ],
      intentType: 'approve',
      confidence: 0.75,
    });

    // Reject patterns
    patterns.push({
      patterns: [
        /(?:reject|decline|don't like|not good)/i,
        /(?:no|nope),?\s*(?:reject|try again)?/i,
      ],
      intentType: 'reject',
      confidence: 0.75,
    });

    // View patterns
    patterns.push({
      patterns: [
        /(?:show|view|display|see)\s+(?:the\s+)?(\w+)/i,
        /(?:what is|what's)\s+(?:the\s+)?(\w+)/i,
      ],
      intentType: 'view',
      extractArtifactType: (match, template) => this.matchArtifactType(match[1] ?? '', template),
      confidence: 0.7,
    });

    // List patterns
    patterns.push({
      patterns: [
        /(?:list|show all|what)\s+(\w+)s?/i,
        /(?:how many)\s+(\w+)s?\s+(?:do we have|are there)/i,
      ],
      intentType: 'list',
      extractArtifactType: (match, template) => this.matchArtifactType(match[1] ?? '', template),
      confidence: 0.7,
    });

    return patterns;
  }

  /**
   * Match user input to an artifact type
   */
  private matchArtifactType(input: string, template: VideoTemplate): string | undefined {
    if (!input) return undefined;

    const normalizedInput = input.toLowerCase().trim();

    // Direct match on ID
    if (template.artifactTypes[normalizedInput]) {
      return normalizedInput;
    }

    // Match on display name
    for (const [typeId, typeDef] of Object.entries(template.artifactTypes) as [string, ArtifactTypeDefinition][]) {
      if (typeDef.displayName.toLowerCase() === normalizedInput) {
        return typeId;
      }
      // Match on item name for collections
      if (typeDef.itemName?.toLowerCase() === normalizedInput) {
        return typeId;
      }
    }

    // Fuzzy match on display name
    for (const [typeId, typeDef] of Object.entries(template.artifactTypes) as [string, ArtifactTypeDefinition][]) {
      if (
        typeDef.displayName.toLowerCase().includes(normalizedInput) ||
        normalizedInput.includes(typeDef.displayName.toLowerCase())
      ) {
        return typeId;
      }
    }

    return undefined;
  }

  /**
   * Parse user input to extract intent
   */
  parseIntent(input: string): UserIntent {
    const normalizedInput = input.trim();

    for (const pattern of this.intentPatterns) {
      for (const regex of pattern.patterns) {
        const match = normalizedInput.match(regex);
        if (match) {
          const artifactType = pattern.extractArtifactType?.(match, this.template);
          const itemId = pattern.extractItemId?.(match);

          return {
            type: pattern.intentType,
            artifactType,
            itemId,
            confidence: artifactType ? pattern.confidence : pattern.confidence * 0.7,
            originalInput: input,
          };
        }
      }
    }

    // Default to unknown intent
    return {
      type: 'view',
      confidence: 0.3,
      originalInput: input,
    };
  }

  /**
   * Resolve an artifact request to determine if it can proceed
   */
  resolveRequest(request: ArtifactRequest, project: GenericProjectFile): ArtifactRequestResolution {
    const typeDef = this.template.artifactTypes[request.typeId];

    if (!typeDef) {
      return {
        canProceed: false,
        missingDependencies: [],
        affectedArtifacts: [],
        suggestedActions: [],
        explanation: `Unknown artifact type: ${request.typeId}`,
      };
    }

    switch (request.action) {
      case 'create':
        return this.resolveCreateRequest(request, project, typeDef);

      case 'update':
        return this.resolveUpdateRequest(request, project, typeDef);

      case 'regenerate':
        return this.resolveRegenerateRequest(request, project, typeDef);

      case 'delete':
        return this.resolveDeleteRequest(request, project, typeDef);

      default:
        return {
          canProceed: false,
          missingDependencies: [],
          affectedArtifacts: [],
          suggestedActions: [],
          explanation: `Unknown action: ${request.action}`,
        };
    }
  }

  /**
   * Resolve a create request
   */
  private resolveCreateRequest(
    request: ArtifactRequest,
    project: GenericProjectFile,
    typeDef: ArtifactTypeDefinition
  ): ArtifactRequestResolution {
    const canCreateResult = this.graph.canCreate(request.typeId, project);

    const missingDependencies: ArtifactDependencyInfo[] = [
      ...canCreateResult.missingRequired.map((m: MissingDependency) => ({
        typeId: m.typeId,
        itemIds: m.missingItems,
        reason: m.reason,
        canAutoCreate: this.canAutoCreate(m.typeId, project),
      })),
    ];

    const suggestedActions: SuggestedAction[] = [];

    if (!canCreateResult.canCreate) {
      // Suggest creating missing dependencies
      for (const missing of canCreateResult.missingRequired as MissingDependency[]) {
        const depTypeDef = this.template.artifactTypes[missing.typeId] as ArtifactTypeDefinition | undefined;
        if (this.canAutoCreate(missing.typeId, project)) {
          suggestedActions.push({
            type: 'create',
            artifactTypeId: missing.typeId,
            description: `Create ${depTypeDef?.displayName || missing.typeId} first`,
            priority: 1,
          });
        }
      }
    }

    // Add the main create action
    if (canCreateResult.canCreate) {
      suggestedActions.push({
        type: 'create',
        artifactTypeId: request.typeId,
        itemIds: request.itemId ? [request.itemId] : undefined,
        description: `Create ${typeDef.displayName}`,
        priority: 0,
      });
    }

    return {
      canProceed: canCreateResult.canCreate,
      missingDependencies,
      affectedArtifacts: [],
      suggestedActions,
      explanation: canCreateResult.canCreate
        ? `Ready to create ${typeDef.displayName}`
        : `Cannot create ${typeDef.displayName}: ${canCreateResult.missingRequired.map((m) => m.reason).join(', ')}`,
    };
  }

  /**
   * Resolve an update request
   */
  private resolveUpdateRequest(
    request: ArtifactRequest,
    project: GenericProjectFile,
    typeDef: ArtifactTypeDefinition
  ): ArtifactRequestResolution {
    // Check if artifact exists
    const artifacts = project.artifacts[request.typeId];
    if (!artifacts || Object.keys(artifacts).length === 0) {
      return {
        canProceed: false,
        missingDependencies: [],
        affectedArtifacts: [],
        suggestedActions: [
          {
            type: 'create',
            artifactTypeId: request.typeId,
            description: `Create ${typeDef.displayName} first`,
            priority: 1,
          },
        ],
        explanation: `No ${typeDef.displayName} exists to update`,
      };
    }

    // Calculate ripple effects
    const ripple = this.graph.calculateRippleEffect(request.typeId, project, request.itemId);

    const affectedArtifacts: ArtifactAffectedInfo[] = [
      ...ripple.invalidated.map((i: ArtifactImpact) => ({
        instanceId: i.instanceId,
        impact: 'invalidated' as const,
        explanation: i.reason,
      })),
      ...ripple.needsUpdate.map((i: ArtifactImpact) => ({
        instanceId: i.instanceId,
        impact: 'requires_update' as const,
        explanation: i.reason,
      })),
    ];

    return {
      canProceed: true,
      missingDependencies: [],
      affectedArtifacts,
      suggestedActions: [
        {
          type: 'regenerate',
          artifactTypeId: request.typeId,
          description: `Update ${typeDef.displayName}`,
          priority: 0,
        },
      ],
      explanation:
        affectedArtifacts.length > 0
          ? `Updating ${typeDef.displayName} will affect ${affectedArtifacts.length} downstream artifact(s)`
          : `Ready to update ${typeDef.displayName}`,
    };
  }

  /**
   * Resolve a regenerate request
   */
  private resolveRegenerateRequest(
    request: ArtifactRequest,
    project: GenericProjectFile,
    typeDef: ArtifactTypeDefinition
  ): ArtifactRequestResolution {
    // Similar to update but with different messaging
    const updateResult = this.resolveUpdateRequest(request, project, typeDef);

    return {
      ...updateResult,
      explanation: updateResult.canProceed
        ? `Ready to regenerate ${typeDef.displayName}${updateResult.affectedArtifacts.length > 0 ? ` (will affect ${updateResult.affectedArtifacts.length} downstream artifacts)` : ''}`
        : updateResult.explanation,
    };
  }

  /**
   * Resolve a delete request
   */
  private resolveDeleteRequest(
    request: ArtifactRequest,
    project: GenericProjectFile,
    typeDef: ArtifactTypeDefinition
  ): ArtifactRequestResolution {
    // Check if artifact exists
    const artifacts = project.artifacts[request.typeId];
    if (!artifacts || Object.keys(artifacts).length === 0) {
      return {
        canProceed: false,
        missingDependencies: [],
        affectedArtifacts: [],
        suggestedActions: [],
        explanation: `No ${typeDef.displayName} exists to delete`,
      };
    }

    // Calculate what would be affected
    const ripple = this.graph.calculateRippleEffect(request.typeId, project, request.itemId);

    const affectedArtifacts: ArtifactAffectedInfo[] = ripple.invalidated.map((i: ArtifactImpact) => ({
      instanceId: i.instanceId,
      impact: 'will_be_deleted' as const,
      explanation: i.reason,
    }));

    return {
      canProceed: true,
      missingDependencies: [],
      affectedArtifacts,
      suggestedActions: [],
      explanation:
        affectedArtifacts.length > 0
          ? `Deleting ${typeDef.displayName} will also delete ${affectedArtifacts.length} dependent artifact(s)`
          : `Ready to delete ${typeDef.displayName}`,
    };
  }

  /**
   * Check if an artifact type can be auto-created
   */
  private canAutoCreate(typeId: string, project: GenericProjectFile): boolean {
    const canCreate = this.graph.canCreate(typeId, project);
    return canCreate.canCreate;
  }

  /**
   * Get recommended next actions based on current project state
   */
  getNextActions(project: GenericProjectFile): NextActionRecommendation[] {
    const recommendations: NextActionRecommendation[] = [];
    const creationOrder = this.graph.getCreationOrder();

    for (const typeId of creationOrder) {
      const typeDef = this.template.artifactTypes[typeId] as ArtifactTypeDefinition;
      const artifacts = (project.artifacts[typeId] || {}) as Record<string, ArtifactInstance>;
      const artifactList = Object.values(artifacts) as ArtifactInstance[];

      // Check for pending approvals
      const pendingApprovals = artifactList.filter(
        (a: ArtifactInstance) => a.status === 'pending' || a.status === 'in_review'
      );
      if (pendingApprovals.length > 0) {
        recommendations.push({
          action: 'approve',
          artifactType: typeId,
          itemIds: pendingApprovals.map((a: ArtifactInstance) => a.id),
          description: `Review and approve ${typeDef.displayName}`,
          priority: 1,
          reason: `${pendingApprovals.length} ${typeDef.itemName || 'item'}(s) awaiting approval`,
        });
      }

      // Check for rejected items needing regeneration
      const rejected = artifactList.filter((a: ArtifactInstance) => a.status === 'rejected');
      if (rejected.length > 0) {
        recommendations.push({
          action: 'regenerate',
          artifactType: typeId,
          itemIds: rejected.map((a: ArtifactInstance) => a.id),
          description: `Regenerate rejected ${typeDef.displayName}`,
          priority: 2,
          reason: `${rejected.length} ${typeDef.itemName || 'item'}(s) were rejected`,
        });
      }

      // Check if this type can be created
      const canCreate = this.graph.canCreate(typeId, project);
      if (canCreate.canCreate && artifactList.length === 0) {
        recommendations.push({
          action: 'create',
          artifactType: typeId,
          description: `Create ${typeDef.displayName}`,
          priority: 3,
          reason: 'All dependencies are met',
        });
      }
    }

    // Check if everything is complete
    const allComplete = creationOrder.every((typeId: string) => {
      const artifacts = (project.artifacts[typeId] || {}) as Record<string, ArtifactInstance>;
      const artifactList = Object.values(artifacts) as ArtifactInstance[];

      if (artifactList.length === 0) return false;
      return artifactList.every((a: ArtifactInstance) => a.status === 'approved');
    });

    if (allComplete) {
      recommendations.push({
        action: 'complete',
        description: 'Project is complete!',
        priority: 0,
        reason: 'All artifacts have been created and approved',
      });
    }

    // Sort by priority
    return recommendations.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Generate a prompt for the user about missing dependencies
   */
  generateDependencyPrompt(missingDeps: ArtifactDependencyInfo[]): string {
    if (missingDeps.length === 0) {
      return '';
    }

    const lines: string[] = ['Before I can proceed, we need:'];

    for (const dep of missingDeps) {
      const typeDef = this.template.artifactTypes[dep.typeId];
      const displayName = typeDef?.displayName || dep.typeId;

      if (dep.itemIds && dep.itemIds.length > 0) {
        lines.push(`- ${displayName}: ${dep.itemIds.join(', ')} (${dep.reason})`);
      } else {
        lines.push(`- ${displayName} (${dep.reason})`);
      }
    }

    const autoCreatable = missingDeps.filter((d) => d.canAutoCreate);
    if (autoCreatable.length > 0) {
      lines.push('');
      lines.push('I can help you create:');
      for (const dep of autoCreatable) {
        const typeDef = this.template.artifactTypes[dep.typeId];
        lines.push(`- ${typeDef?.displayName || dep.typeId}`);
      }
      lines.push('');
      lines.push('Would you like me to help with these first?');
    }

    return lines.join('\n');
  }

  /**
   * Generate a prompt about affected artifacts
   */
  generateRipplePrompt(affected: ArtifactAffectedInfo[]): string {
    if (affected.length === 0) {
      return '';
    }

    const invalidated = affected.filter((a) => a.impact === 'invalidated');
    const needsUpdate = affected.filter((a) => a.impact === 'requires_update');
    const willDelete = affected.filter((a) => a.impact === 'will_be_deleted');

    const lines: string[] = ['This change will affect other artifacts:'];

    if (invalidated.length > 0) {
      lines.push('');
      lines.push('**Will be invalidated (need regeneration):**');
      for (const item of invalidated) {
        lines.push(`- ${item.instanceId}: ${item.explanation}`);
      }
    }

    if (needsUpdate.length > 0) {
      lines.push('');
      lines.push('**May need review:**');
      for (const item of needsUpdate) {
        lines.push(`- ${item.instanceId}: ${item.explanation}`);
      }
    }

    if (willDelete.length > 0) {
      lines.push('');
      lines.push('**Will be deleted:**');
      for (const item of willDelete) {
        lines.push(`- ${item.instanceId}: ${item.explanation}`);
      }
    }

    lines.push('');
    lines.push('Do you want to proceed?');

    return lines.join('\n');
  }

  /**
   * Get a summary of current project progress
   */
  getProgressSummary(project: GenericProjectFile): {
    totalArtifactTypes: number;
    completedTypes: number;
    inProgressTypes: number;
    pendingTypes: number;
    byType: Record<
      string,
      {
        displayName: string;
        total: number;
        approved: number;
        pending: number;
        rejected: number;
      }
    >;
  } {
    const byType: Record<
      string,
      {
        displayName: string;
        total: number;
        approved: number;
        pending: number;
        rejected: number;
      }
    > = {};

    let completedTypes = 0;
    let inProgressTypes = 0;
    let pendingTypes = 0;

    for (const [typeId, typeDef] of Object.entries(this.template.artifactTypes) as [string, ArtifactTypeDefinition][]) {
      const artifacts = Object.values((project.artifacts[typeId] || {}) as Record<string, ArtifactInstance>) as ArtifactInstance[];

      const approved = artifacts.filter((a: ArtifactInstance) => a.status === 'approved').length;
      const pending = artifacts.filter(
        (a: ArtifactInstance) => a.status === 'pending' || a.status === 'in_review'
      ).length;
      const rejected = artifacts.filter((a: ArtifactInstance) => a.status === 'rejected').length;

      byType[typeId] = {
        displayName: typeDef.displayName,
        total: artifacts.length,
        approved,
        pending,
        rejected,
      };

      if (artifacts.length > 0 && approved === artifacts.length) {
        completedTypes++;
      } else if (artifacts.length > 0) {
        inProgressTypes++;
      } else {
        pendingTypes++;
      }
    }

    return {
      totalArtifactTypes: Object.keys(this.template.artifactTypes).length,
      completedTypes,
      inProgressTypes,
      pendingTypes,
      byType,
    };
  }
}
