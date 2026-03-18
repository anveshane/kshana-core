/**
 * Backward Planner
 *
 * The core algorithm that works backwards from user goals to determine
 * the minimal execution path. Uses BFS traversal through the dependency
 * graph and subtracts what already exists.
 */

import type { VideoTemplate, ArtifactTypeDefinition } from '../templates/types.js';
import { computeSegmentBreakdown, computeDurationBudget } from '../../utils/durationUtils.js';
import { ArtifactGraph } from '../artifacts/ArtifactGraph.js';
import type {
  UserGoal,
  AssetRegistry,
  ExecutionPlan,
  PlanStep,
  SkippedArtifact,
  PlannerOptions,
  PlanValidation,
  TimelineHints,
} from './types.js';

/**
 * Backward Planner
 *
 * Works backwards from target artifacts to find all required artifacts,
 * then subtracts what already exists to build a minimal execution plan.
 */
export class BackwardPlanner {
  private template: VideoTemplate;
  private graph: ArtifactGraph;

  constructor(template: VideoTemplate, graph?: ArtifactGraph) {
    this.template = template;
    this.graph = graph || new ArtifactGraph(template);
  }

  /**
   * Given target artifacts, find ALL required artifacts via backward BFS.
   *
   * This traverses the dependency graph backwards from the targets,
   * collecting all artifact types that must exist for the targets to be created.
   */
  findRequiredArtifacts(targets: string[], options: PlannerOptions = {}): Set<string> {
    const { includeOptional = false, maxDepth = 100 } = options;
    const required = new Set<string>();
    const queue: Array<{ typeId: string; depth: number }> = targets.map(t => ({ typeId: t, depth: 0 }));

    while (queue.length > 0) {
      const { typeId, depth } = queue.shift()!;

      // Skip if already processed or max depth exceeded
      if (required.has(typeId) || depth > maxDepth) {
        continue;
      }

      // Verify this artifact type exists in the template
      if (!this.template.artifactTypes[typeId]) {
        continue;
      }

      required.add(typeId);

      // Get all dependencies of this artifact
      const node = this.graph.getNode(typeId);
      if (!node) continue;

      for (const dep of node.dependencies) {
        // Skip optional dependencies unless requested
        if (!dep.required && !includeOptional) {
          continue;
        }

        // Add to queue for processing
        if (!required.has(dep.artifactTypeId)) {
          queue.push({ typeId: dep.artifactTypeId, depth: depth + 1 });
        }
      }
    }

    return required;
  }

  /**
   * Subtract what's already satisfied from the required set.
   *
   * Returns only the artifact types that still need to be created.
   */
  subtractSatisfied(required: Set<string>, registry: AssetRegistry): Set<string> {
    const toCreate = new Set<string>();

    for (const artifactType of required) {
      const satisfaction = registry.satisfiedArtifacts.get(artifactType);

      // Only skip if fully satisfied
      if (satisfaction !== 'full') {
        toCreate.add(artifactType);
      }
    }

    return toCreate;
  }

  /**
   * Topologically sort artifact types for execution order.
   *
   * Ensures dependencies are created before their dependents.
   */
  topologicalSort(toCreate: Set<string>): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (typeId: string) => {
      if (visited.has(typeId) || !toCreate.has(typeId)) {
        return;
      }
      visited.add(typeId);

      // Visit dependencies first
      const deps = this.graph.getDependencies(typeId);
      for (const dep of deps) {
        visit(dep);
      }

      result.push(typeId);
    };

    // Visit all types to create
    for (const typeId of toCreate) {
      visit(typeId);
    }

    return result;
  }

  /**
   * Build a single plan step for an artifact type.
   */
  private buildStep(
    typeId: string,
    toCreate: Set<string>,
    stepIndex: number
  ): PlanStep {
    const typeDef = this.template.artifactTypes[typeId];
    if (!typeDef) {
      throw new Error(`Unknown artifact type: ${typeId}`);
    }

    // Find which dependencies (within toCreate) this step depends on
    const deps = this.graph.getDependencies(typeId);
    const dependsOn = deps.filter(d => toCreate.has(d));

    // Generate reason based on position in graph
    const dependentTypes = this.graph.getDependents(typeId);
    let reason: string;
    if (dependentTypes.length === 0) {
      reason = 'Target artifact requested by user';
    } else if (dependsOn.length === 0) {
      reason = 'Foundation artifact with no dependencies';
    } else {
      const depNames = dependsOn
        .map(d => this.template.artifactTypes[d]?.displayName || d)
        .join(', ');
      reason = `Required by ${dependentTypes
        .filter(d => toCreate.has(d))
        .map(d => this.template.artifactTypes[d]?.displayName || d)
        .join(', ') || 'target artifacts'}`;
    }

    return {
      id: `step_${stepIndex}_${typeId}`,
      artifactTypeId: typeId,
      dependsOn: dependsOn.map((d, i) => {
        // Find the step id for each dependency
        const depIndex = Array.from(toCreate).indexOf(d);
        return `step_${depIndex}_${d}`;
      }),
      reason,
      isExpensive: typeDef.isExpensive,
      displayName: typeDef.displayName,
      estimatedCost: typeDef.isExpensive ? 10 : 1,
    };
  }

  /**
   * Generate human-readable summary of the plan.
   */
  private generateSummary(
    steps: PlanStep[],
    skipped: SkippedArtifact[],
    goal: UserGoal
  ): string {
    const lines: string[] = [];

    // Describe the goal
    const targetNames = goal.targetArtifacts
      .map(t => this.template.artifactTypes[t]?.displayName || t)
      .join(', ');
    lines.push(`Goal: Create ${targetNames}`);

    // Count steps by type
    const expensiveSteps = steps.filter(s => s.isExpensive);
    const regularSteps = steps.filter(s => !s.isExpensive);

    if (steps.length === 0) {
      lines.push('All required artifacts already exist. Nothing to create.');
    } else {
      lines.push(`\nPlan: ${steps.length} step(s) to execute`);

      if (regularSteps.length > 0) {
        lines.push(`  - ${regularSteps.length} content generation step(s)`);
      }
      if (expensiveSteps.length > 0) {
        lines.push(`  - ${expensiveSteps.length} expensive (image/video) step(s)`);
      }
    }

    // Note what's being skipped
    if (skipped.length > 0) {
      lines.push(`\nSkipping ${skipped.length} artifact(s) (already exist):`);
      for (const skip of skipped) {
        const name = this.template.artifactTypes[skip.typeId]?.displayName || skip.typeId;
        lines.push(`  - ${name}: ${skip.reason}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Build the complete execution plan.
   *
   * This is the main entry point for planning:
   * 1. Find all required artifacts by backward traversal
   * 2. Subtract what already exists
   * 3. Topologically sort for execution order
   * 4. Build detailed steps
   */
  buildPlan(
    goal: UserGoal,
    registry: AssetRegistry,
    options: PlannerOptions = {}
  ): ExecutionPlan {
    // 1. Find all required artifacts by backward traversal
    const required = this.findRequiredArtifacts(goal.targetArtifacts, options);

    // 2. Subtract what already exists
    const toCreate = this.subtractSatisfied(required, registry);

    // 3. Determine what's being skipped
    const skippedArtifacts: SkippedArtifact[] = [];
    for (const typeId of required) {
      if (!toCreate.has(typeId)) {
        const satisfaction = registry.satisfiedArtifacts.get(typeId);
        const assets = Array.from(registry.assets.values())
          .filter(a => a.artifactTypeId === typeId);

        skippedArtifacts.push({
          typeId,
          reason: satisfaction === 'full' ? 'Fully satisfied by existing assets' : 'Partially satisfied',
          satisfiedBy: assets.map(a => a.id),
        });
      }
    }

    // 4. Topologically sort for execution order
    const sorted = this.topologicalSort(toCreate);

    // 5. Build steps with dependency info
    const steps: PlanStep[] = sorted.map((typeId, index) =>
      this.buildStep(typeId, toCreate, index)
    );

    // Fix up dependsOn to use actual step IDs after all steps are created
    const typeToStepId = new Map<string, string>();
    for (const step of steps) {
      typeToStepId.set(step.artifactTypeId, step.id);
    }
    for (const step of steps) {
      step.dependsOn = this.graph.getDependencies(step.artifactTypeId)
        .filter(d => typeToStepId.has(d))
        .map(d => typeToStepId.get(d)!);
    }

    // 6. Calculate summary stats
    const expensiveStepCount = steps.filter(s => s.isExpensive).length;
    const requiresApproval = expensiveStepCount > 0;

    return {
      goal,
      steps,
      skippedArtifacts,
      summary: this.generateSummary(steps, skippedArtifacts, goal),
      expensiveStepCount,
      requiresApproval,
    };
  }

  /**
   * Validate an execution plan.
   *
   * Checks for issues like missing dependencies, cycles, etc.
   */
  validatePlan(plan: ExecutionPlan): PlanValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check all artifact types exist
    for (const step of plan.steps) {
      if (!this.template.artifactTypes[step.artifactTypeId]) {
        errors.push(`Unknown artifact type: ${step.artifactTypeId}`);
      }
    }

    // Check for target artifacts exist
    for (const target of plan.goal.targetArtifacts) {
      if (!this.template.artifactTypes[target]) {
        errors.push(`Unknown target artifact type: ${target}`);
      }
    }

    // Check step dependencies are within the plan
    const stepIds = new Set(plan.steps.map(s => s.id));
    for (const step of plan.steps) {
      for (const dep of step.dependsOn) {
        if (!stepIds.has(dep)) {
          // This might be okay if it's skipped
          const isSkipped = plan.skippedArtifacts.some(s =>
            dep.includes(s.typeId)
          );
          if (!isSkipped) {
            warnings.push(`Step ${step.id} depends on ${dep} which is not in the plan`);
          }
        }
      }
    }

    // Warn if there are no steps and no skipped artifacts
    if (plan.steps.length === 0 && plan.skippedArtifacts.length === 0) {
      warnings.push('Plan has no steps and nothing was skipped. Check if target artifacts are valid.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Compute timeline hints based on the goal's duration preference.
   *
   * Returns hints about how many segments are needed and how long each should be,
   * given the target duration and generation constraints.
   */
  computeTimelineHints(goal: UserGoal, maxClipDuration: number = 10): TimelineHints {
    const totalDuration = goal.preferences.duration as number;
    const budget = computeDurationBudget(totalDuration, maxClipDuration);
    const breakdown = computeSegmentBreakdown(totalDuration, maxClipDuration);

    if (!budget || !breakdown) {
      return {
        totalDuration: 0,
        maxClipDuration,
        minTotalShots: 1,
        suggestedSceneRange: { min: 1, max: 1 },
        avgShotDuration: 0,
        reasoning: 'No duration specified in goal preferences.',
        suggestedSegmentCount: 1,
        suggestedSegmentDuration: 0,
      };
    }

    const reasoning =
      `Target duration: ${totalDuration}s. ` +
      `You need at least ${budget.minTotalShots} total clips across all scenes. ` +
      `Aim for ${budget.suggestedSceneRange.min}-${budget.suggestedSceneRange.max} scenes — ` +
      `let the story determine the exact count. ` +
      `Each scene can have 1-3 shots depending on complexity. ` +
      `IMPORTANT: Every shot MUST be at least 4 seconds (video model minimum). Prefer 5-8s shots. ` +
      `After planning scenes AND their shot breakdowns, create the timeline skeleton.`;

    return {
      totalDuration,
      maxClipDuration,
      minTotalShots: budget.minTotalShots,
      suggestedSceneRange: budget.suggestedSceneRange,
      avgShotDuration: budget.avgShotDuration,
      reasoning,
      // Deprecated fields for backward compatibility
      suggestedSegmentCount: breakdown.segmentCount,
      suggestedSegmentDuration: breakdown.segmentDuration,
    };
  }

  /**
   * Get the artifact graph for external use.
   */
  getGraph(): ArtifactGraph {
    return this.graph;
  }

  /**
   * Get the template for external use.
   */
  getTemplate(): VideoTemplate {
    return this.template;
  }
}
