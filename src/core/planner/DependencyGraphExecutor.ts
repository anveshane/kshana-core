/**
 * Dependency Graph Executor
 *
 * A deterministic, code-driven execution engine that walks a dependency graph
 * node by node. The LLM is called as a pure content generator — no tools,
 * no file I/O, no navigation decisions. All dependency resolution, file reading,
 * file writing, and progress tracking lives here in deterministic code.
 */

import type {
  VideoTemplate,
  ArtifactDependency,
} from '../templates/types.js';
import type {
  ExecutionPlan,
  ExecutionNode,
  ExecutorState,
  ExecutorProgress,
} from './types.js';
import { ArtifactGraph } from '../artifacts/ArtifactGraph.js';

/**
 * Dependency Graph Executor
 *
 * Owns the execution loop. Deterministically resolves dependencies,
 * dispatches LLM calls, writes outputs, and tracks progress.
 */
export class DependencyGraphExecutor {
  private nodes: Map<string, ExecutionNode>;
  private targetArtifacts: string[];
  private goalDescription: string;
  private template: VideoTemplate;
  private graph: ArtifactGraph;
  private createdAt: number;
  private updatedAt: number;
  private completedAt?: number;

  private constructor(
    template: VideoTemplate,
    nodes: Map<string, ExecutionNode>,
    targetArtifacts: string[],
    goalDescription: string,
    createdAt?: number,
  ) {
    this.template = template;
    this.graph = new ArtifactGraph(template);
    this.nodes = nodes;
    this.targetArtifacts = targetArtifacts;
    this.goalDescription = goalDescription;
    this.createdAt = createdAt ?? Date.now();
    this.updatedAt = Date.now();
  }

  // ===========================================================================
  // Factory methods
  // ===========================================================================

  /**
   * Build an executor from a BackwardPlanner execution plan.
   * Creates nodes for each plan step and marks skipped artifacts.
   */
  static fromPlan(
    plan: ExecutionPlan,
    template: VideoTemplate,
  ): DependencyGraphExecutor {
    const nodes = new Map<string, ExecutionNode>();
    const graph = new ArtifactGraph(template);

    // Create nodes for each step in the plan
    for (const step of plan.steps) {
      const typeDef = template.artifactTypes[step.artifactTypeId];
      if (!typeDef) continue;

      const nodeId = step.artifactTypeId;
      const deps = graph.getDependencies(step.artifactTypeId);

      // Only include dependencies that are in the plan (not skipped)
      const planTypeIds = new Set(plan.steps.map(s => s.artifactTypeId));
      const activeDeps = deps.filter(d => planTypeIds.has(d));

      nodes.set(nodeId, {
        id: nodeId,
        typeId: step.artifactTypeId,
        status: 'pending',
        displayName: typeDef.displayName,
        isExpensive: typeDef.isExpensive,
        isCollection: typeDef.isCollection,
        dependencies: activeDeps,
        dependents: [],
      });
    }

    // Build reverse edges (dependents)
    for (const [nodeId, node] of nodes) {
      for (const depId of node.dependencies) {
        const depNode = nodes.get(depId);
        if (depNode) {
          depNode.dependents.push(nodeId);
        }
      }
    }

    return new DependencyGraphExecutor(
      template,
      nodes,
      plan.goal.targetArtifacts,
      plan.goal.description,
    );
  }

  /**
   * Restore an executor from persisted state (session resume).
   */
  static fromState(
    state: ExecutorState,
    template: VideoTemplate,
  ): DependencyGraphExecutor {
    const nodes = new Map<string, ExecutionNode>();
    for (const [id, node] of Object.entries(state.nodes)) {
      nodes.set(id, { ...node });
    }

    const executor = new DependencyGraphExecutor(
      template,
      nodes,
      state.targetArtifacts,
      state.goalDescription,
      state.createdAt,
    );
    executor.completedAt = state.completedAt;
    return executor;
  }

  // ===========================================================================
  // Graph navigation (deterministic)
  // ===========================================================================

  /**
   * Get all nodes whose dependencies are ALL completed or skipped.
   * These nodes are ready to be processed.
   */
  getNextReady(): ExecutionNode[] {
    const ready: ExecutionNode[] = [];

    for (const node of this.nodes.values()) {
      if (node.status !== 'pending') continue;

      // Type-level collection nodes (isCollection=true, no itemId) must be expanded
      // into per-item nodes before execution — never generate directly.
      // This prevents monolithic LLM calls for all scenes/shots at once.
      if (node.isCollection && !node.itemId) continue;

      const allDepsSatisfied = node.dependencies.every(depId => {
        const dep = this.nodes.get(depId);
        return dep && (dep.status === 'completed' || dep.status === 'skipped');
      });

      if (allDepsSatisfied) {
        ready.push(node);
      }
    }

    return ready;
  }

  /**
   * Mark a node as started (in_progress).
   */
  markStarted(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Unknown node: ${nodeId}`);
    node.status = 'in_progress';
    node.startedAt = Date.now();
    this.updatedAt = Date.now();
  }

  /**
   * Mark a node as completed. Returns newly ready dependent nodes.
   */
  markCompleted(nodeId: string, outputPath?: string, artifactId?: string): ExecutionNode[] {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Unknown node: ${nodeId}`);

    node.status = 'completed';
    node.completedAt = Date.now();
    if (outputPath) node.outputPath = outputPath;
    if (artifactId) node.artifactId = artifactId;
    this.updatedAt = Date.now();

    // Check if all targets are now complete
    if (this.isComplete()) {
      this.completedAt = Date.now();
    }

    // Return newly ready dependents
    return this.getNewlyReady(node.dependents);
  }

  /**
   * Mark a node as failed.
   */
  markFailed(nodeId: string, error: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Unknown node: ${nodeId}`);
    node.status = 'failed';
    node.error = error;
    this.updatedAt = Date.now();
  }

  /**
   * Invalidate a node and cascade to all its dependents (for redo).
   * Returns the list of all nodes that were reset.
   */
  invalidateNode(nodeId: string): ExecutionNode[] {
    const invalidated: ExecutionNode[] = [];
    const queue = [nodeId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = this.nodes.get(currentId);
      if (!node) continue;

      // Reset the node
      node.status = 'pending';
      node.completedAt = undefined;
      node.startedAt = undefined;
      node.outputPath = undefined;
      node.artifactId = undefined;
      node.error = undefined;
      invalidated.push(node);

      // Cascade to dependents
      for (const depId of node.dependents) {
        queue.push(depId);
      }
    }

    this.completedAt = undefined;
    this.updatedAt = Date.now();
    return invalidated;
  }

  /**
   * Expand a collection node into per-item nodes.
   * Works with both type-level nodes ("character") and item-level nodes ("shot_image_prompt:scene_1").
   * Rewires dependency and dependent edges appropriately.
   *
   * For example, expanding "character" with items ["alice", "bob"] creates:
   *   character:alice, character:bob
   * And rewires dependents like character_image to create:
   *   character_image:alice → depends on character:alice
   *   character_image:bob → depends on character:bob
   */
  expandCollection(
    nodeId: string,
    items: Array<{ itemId: string; name: string }>,
  ): ExecutionNode[] {
    const existingNode = this.nodes.get(nodeId);
    if (!existingNode) return [];

    // Resolve the base typeId (strip item suffix) for template lookup
    const baseTypeId = existingNode.typeId;
    const typeDef = this.template.artifactTypes[baseTypeId];
    if (!typeDef) return [];

    // Create per-item nodes
    const newNodes: ExecutionNode[] = [];
    for (const item of items) {
      const itemNodeId = `${baseTypeId}:${item.itemId}`;
      const itemNode: ExecutionNode = {
        id: itemNodeId,
        typeId: baseTypeId,
        itemId: item.itemId,
        status: 'pending',
        displayName: `${typeDef.displayName}: ${item.name}`,
        isExpensive: typeDef.isExpensive,
        isCollection: false,
        dependencies: [...existingNode.dependencies],
        dependents: [],
      };
      newNodes.push(itemNode);
      this.nodes.set(itemNodeId, itemNode);
    }

    // Rewire dependents of the old type-level node
    for (const dependentId of existingNode.dependents) {
      const dependent = this.nodes.get(dependentId);
      if (!dependent) continue;

      const dependentTypeDef = this.template.artifactTypes[dependent.typeId];
      if (!dependentTypeDef) continue;

      // Find the dependency relationship (check both base type and node id)
      const depRelation = dependentTypeDef.dependencies.find(
        (d: ArtifactDependency) => d.artifactTypeId === baseTypeId,
      );

      if (!depRelation) continue;

      if (depRelation.scope === 'matching' && dependent.isCollection) {
        // For matching scope on a collection dependent: expand that dependent too
        this.expandMatchingDependent(dependent, baseTypeId, items, depRelation);
      } else if (depRelation.scope === 'all' || !depRelation.scope) {
        // For 'all' scope: the dependent depends on ALL item nodes
        dependent.dependencies = dependent.dependencies.filter(d => d !== nodeId);
        for (const itemNode of newNodes) {
          dependent.dependencies.push(itemNode.id);
          itemNode.dependents.push(dependentId);
        }
      } else if (depRelation.scope === 'any') {
        dependent.dependencies = dependent.dependencies.filter(d => d !== nodeId);
        if (newNodes.length > 0) {
          for (const itemNode of newNodes) {
            dependent.dependencies.push(itemNode.id);
            itemNode.dependents.push(dependentId);
          }
        }
      }
    }

    // Remove the old node
    this.nodes.delete(nodeId);
    this.updatedAt = Date.now();

    return newNodes;
  }

  /**
   * Expand a dependent collection node that has 'matching' scope on the source collection.
   * Creates per-item dependent nodes wired to their matching source items.
   */
  private expandMatchingDependent(
    dependent: ExecutionNode,
    sourceTypeId: string,
    items: Array<{ itemId: string; name: string }>,
    _depRelation: ArtifactDependency,
  ): void {
    const depTypeDef = this.template.artifactTypes[dependent.typeId];
    if (!depTypeDef) return;

    // Create per-item nodes for the dependent
    const newDepNodes: ExecutionNode[] = [];
    for (const item of items) {
      const itemNodeId = `${dependent.typeId}:${item.itemId}`;
      const sourceItemId = `${sourceTypeId}:${item.itemId}`;

      // Replace the source type dep with the matching item dep
      const otherDeps = dependent.dependencies.filter(d => d !== dependent.typeId && d !== sourceTypeId);
      const itemDeps = [...otherDeps, sourceItemId];

      // Preserve isCollection from type def — allows further sub-expansion
      // (e.g., shot_image_prompt per-scene → per-shot)
      const itemNode: ExecutionNode = {
        id: itemNodeId,
        typeId: dependent.typeId,
        itemId: item.itemId,
        status: 'pending',
        displayName: `${depTypeDef.displayName}: ${item.name}`,
        isExpensive: depTypeDef.isExpensive,
        isCollection: depTypeDef.isCollection,  // preserve from type def for further expansion
        dependencies: itemDeps,
        dependents: [...dependent.dependents],
      };
      newDepNodes.push(itemNode);
      this.nodes.set(itemNodeId, itemNode);

      // Wire the source item's dependent list
      const sourceItem = this.nodes.get(sourceItemId);
      if (sourceItem) {
        sourceItem.dependents.push(itemNodeId);
      }
    }

    // Update any nodes that depended on the old type-level dependent
    // Collect downstream nodes before modifying to avoid mutation during iteration
    const downstreamIds = [...dependent.dependents];
    const downstreamCollections: ExecutionNode[] = [];

    for (const downstreamId of downstreamIds) {
      const downstream = this.nodes.get(downstreamId);
      if (!downstream) continue;

      // Replace the old dependent reference with all new item nodes
      downstream.dependencies = downstream.dependencies.filter(d => d !== dependent.id);
      for (const newDep of newDepNodes) {
        downstream.dependencies.push(newDep.id);
        newDep.dependents.push(downstreamId);
      }

      // Track collection dependents for recursive cascade
      if (downstream.isCollection) {
        downstreamCollections.push(downstream);
      }
    }

    // Remove the old type-level dependent node
    this.nodes.delete(dependent.id);

    // Recursive cascade: expand any downstream collection nodes that have
    // matching scope on the type we just expanded
    for (const downstream of downstreamCollections) {
      const downstreamTypeDef = this.template.artifactTypes[downstream.typeId];
      if (!downstreamTypeDef) continue;

      const downstreamDep = downstreamTypeDef.dependencies.find(
        (d: ArtifactDependency) => d.artifactTypeId === dependent.typeId,
      );

      if (downstreamDep?.scope === 'matching') {
        this.expandMatchingDependent(downstream, dependent.typeId, items, downstreamDep);
      }
    }
  }

  // ===========================================================================
  // Status queries
  // ===========================================================================

  /**
   * Check if all target artifacts are completed or skipped.
   */
  isComplete(): boolean {
    // Check all nodes — the executor is complete when no pending/in_progress/ready remain
    for (const node of this.nodes.values()) {
      if (node.status === 'pending' || node.status === 'in_progress' || node.status === 'ready') {
        return false;
      }
    }
    return true;
  }

  /**
   * Get progress summary.
   */
  getProgress(): ExecutorProgress {
    const progress: ExecutorProgress = {
      total: 0,
      completed: 0,
      inProgress: 0,
      pending: 0,
      failed: 0,
      skipped: 0,
    };

    for (const node of this.nodes.values()) {
      progress.total++;
      switch (node.status) {
        case 'completed': progress.completed++; break;
        case 'in_progress': case 'ready': progress.inProgress++; break;
        case 'pending': progress.pending++; break;
        case 'failed': progress.failed++; break;
        case 'skipped': progress.skipped++; break;
      }
    }

    return progress;
  }

  /**
   * Get a specific node by ID.
   */
  getNode(nodeId: string): ExecutionNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Add a node to the graph. Used for repairing missing nodes on session restore.
   */
  addNode(node: ExecutionNode): void {
    this.nodes.set(node.id, node);
    this.updatedAt = Date.now();
  }

  /**
   * Get all nodes.
   */
  getAllNodes(): ExecutionNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get the template.
   */
  getTemplate(): VideoTemplate {
    return this.template;
  }

  /**
   * Get the artifact graph.
   */
  getGraph(): ArtifactGraph {
    return this.graph;
  }

  /**
   * Check if a node type produces collection items that need expansion.
   * For example, 'story' produces characters/settings/scenes.
   */
  producesCollectionItems(node: ExecutionNode): boolean {
    // A node produces collection items if any of its dependents are
    // collection nodes that haven't been expanded yet
    for (const depId of node.dependents) {
      const dep = this.nodes.get(depId);
      if (dep && dep.isCollection) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get collection type IDs of dependents that need expansion after this node.
   */
  getCollectionDependents(node: ExecutionNode): string[] {
    const result: string[] = [];
    for (const depId of node.dependents) {
      const dep = this.nodes.get(depId);
      if (dep && dep.isCollection) {
        result.push(dep.typeId);
      }
    }
    return result;
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================

  /**
   * Get serializable state for persistence to project.json.
   */
  getState(): ExecutorState {
    const nodes: Record<string, ExecutionNode> = {};
    for (const [id, node] of this.nodes) {
      nodes[id] = { ...node };
    }

    return {
      nodes,
      targetArtifacts: this.targetArtifacts,
      goalDescription: this.goalDescription,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      completedAt: this.completedAt,
    };
  }

  /**
   * Get a human-readable summary of the current state.
   */
  getSummary(): string {
    const progress = this.getProgress();
    const lines: string[] = [];

    lines.push(`Goal: ${this.goalDescription}`);
    lines.push(`Progress: ${progress.completed}/${progress.total} nodes completed`);

    if (progress.failed > 0) {
      lines.push(`Failed: ${progress.failed} node(s)`);
    }

    const ready = this.getNextReady();
    if (ready.length > 0) {
      lines.push(`Next: ${ready.map(n => n.displayName).join(', ')}`);
    } else if (this.isComplete()) {
      lines.push('Status: Complete');
    } else {
      lines.push('Status: Blocked (dependencies have failures)');
    }

    return lines.join('\n');
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * From a list of node IDs, return those that are now ready
   * (all their dependencies are completed/skipped).
   */
  private getNewlyReady(candidateIds: string[]): ExecutionNode[] {
    const ready: ExecutionNode[] = [];

    for (const id of candidateIds) {
      const node = this.nodes.get(id);
      if (!node || node.status !== 'pending') continue;

      const allDepsSatisfied = node.dependencies.every(depId => {
        const dep = this.nodes.get(depId);
        return dep && (dep.status === 'completed' || dep.status === 'skipped');
      });

      if (allDepsSatisfied) {
        ready.push(node);
      }
    }

    return ready;
  }
}
