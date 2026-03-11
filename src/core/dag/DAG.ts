/**
 * DAG data structure for the executor.
 *
 * Manages nodes, dependency resolution, ready-node detection,
 * and transitive dependency queries. Supports dynamic expansion
 * (adding nodes at runtime).
 */

import type {
  DAGNode,
  DAGNodeDefinition,
  NodeStatus,
  NodeResult,
  NodeContext,
  UserQuestion,
  ExpansionEvent,
  HandlerRegistry,
  PromptBuilderRegistry,
  QuestionBuilderRegistry,
  ExpanderRegistry,
} from './types.js';

export class DAG {
  private nodes: Map<string, DAGNode> = new Map();
  private expansionLog: ExpansionEvent[] = [];

  // Registries for re-attaching functions on resume
  private handlers: HandlerRegistry = new Map();
  private promptBuilders: PromptBuilderRegistry = new Map();
  private questionBuilders: QuestionBuilderRegistry = new Map();
  private expanders: ExpanderRegistry = new Map();

  // ==========================================================================
  // Node Management
  // ==========================================================================

  /**
   * Add a fully constructed node to the DAG.
   */
  addNode(node: DAGNode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node "${node.id}" already exists in DAG`);
    }
    // Validate dependencies exist (or will be added later for batch additions)
    this.nodes.set(node.id, node);
  }

  /**
   * Add a node from a definition, attaching handlers from registries.
   */
  addNodeFromDefinition(def: DAGNodeDefinition): DAGNode {
    const node: DAGNode = {
      id: def.id,
      type: def.type,
      dependsOn: [...def.dependsOn],
      status: 'pending',
      description: def.description,
      metadata: def.metadata ? { ...def.metadata } : undefined,
      errorPolicy: {
        maxRetries: 2,
        retryStrategy: 'rephrase',
        onExhausted: 'ask_user',
        ...def.errorPolicy,
      },
    };

    // Attach handler based on type and key
    if (def.handlerKey) {
      if (def.type === 'D') {
        node.handler = this.handlers.get(def.handlerKey);
      } else if (def.type === 'S') {
        node.promptBuilder = this.promptBuilders.get(def.handlerKey);
      } else if (def.type === 'U') {
        node.questionBuilder = this.questionBuilders.get(def.handlerKey);
      }
    }

    // Attach expander
    if (def.expanderKey) {
      node.expander = this.expanders.get(def.expanderKey);
    }

    this.addNode(node);
    return node;
  }

  /**
   * Add multiple node definitions in batch (from an expander).
   * Returns the created nodes.
   */
  addNodesFromDefinitions(defs: DAGNodeDefinition[], sourceNodeId?: string): DAGNode[] {
    const created: DAGNode[] = [];
    for (const def of defs) {
      created.push(this.addNodeFromDefinition(def));
    }

    // Log expansion
    if (sourceNodeId) {
      this.expansionLog.push({
        sourceNodeId,
        newNodeIds: created.map(n => n.id),
        timestamp: new Date().toISOString(),
      });
    }

    // Update ready status for new nodes
    this.updateReadyNodes();

    return created;
  }

  /**
   * Get a node by ID.
   */
  getNode(id: string): DAGNode {
    const node = this.nodes.get(id);
    if (!node) {
      throw new Error(`Node "${id}" not found in DAG`);
    }
    return node;
  }

  /**
   * Try to get a node by ID, returns undefined if not found.
   */
  tryGetNode(id: string): DAGNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Check if a node exists.
   */
  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  /**
   * Get all nodes.
   */
  getAllNodes(): DAGNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get the total node count.
   */
  get size(): number {
    return this.nodes.size;
  }

  /**
   * Get the expansion log.
   */
  getExpansionLog(): ExpansionEvent[] {
    return [...this.expansionLog];
  }

  // ==========================================================================
  // Status Queries
  // ==========================================================================

  /**
   * Get all nodes with a given status.
   */
  getNodesByStatus(status: NodeStatus): DAGNode[] {
    return Array.from(this.nodes.values()).filter(n => n.status === status);
  }

  /**
   * Get all ready nodes (pending with all dependencies completed).
   */
  getReadyNodes(): DAGNode[] {
    return this.getNodesByStatus('ready');
  }

  /**
   * Check if the DAG has any remaining work.
   */
  hasWork(): boolean {
    for (const node of this.nodes.values()) {
      if (node.status === 'pending' || node.status === 'ready' || node.status === 'running') {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if the DAG is fully complete (all nodes completed or skipped).
   */
  isComplete(): boolean {
    for (const node of this.nodes.values()) {
      if (node.status !== 'completed' && node.status !== 'skipped') {
        return false;
      }
    }
    return true;
  }

  /**
   * Get execution statistics.
   */
  getStats(): { total: number; completed: number; skipped: number; failed: number; pending: number; ready: number; running: number } {
    const stats = { total: 0, completed: 0, skipped: 0, failed: 0, pending: 0, ready: 0, running: 0 };
    for (const node of this.nodes.values()) {
      stats.total++;
      stats[node.status as keyof typeof stats]++;
    }
    return stats;
  }

  // ==========================================================================
  // Dependency Resolution
  // ==========================================================================

  /**
   * Recompute 'ready' status for all pending nodes.
   * A node becomes ready when all its dependencies are completed.
   */
  updateReadyNodes(): void {
    for (const node of this.nodes.values()) {
      if (node.status !== 'pending') continue;

      const allDepsCompleted = node.dependsOn.every(depId => {
        const dep = this.nodes.get(depId);
        return dep && (dep.status === 'completed' || dep.status === 'skipped');
      });

      if (allDepsCompleted) {
        node.status = 'ready';
      }
    }
  }

  /**
   * Get all transitive dependents of a node (nodes that depend on it, directly or indirectly).
   * Used by micro-LLM to assess skip impact.
   */
  getTransitiveDependents(nodeId: string): DAGNode[] {
    const visited = new Set<string>();
    const queue = [nodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      // Find all nodes that depend on current
      for (const node of this.nodes.values()) {
        if (node.dependsOn.includes(current) && !visited.has(node.id)) {
          queue.push(node.id);
        }
      }
    }

    // Remove the source node itself
    visited.delete(nodeId);
    return Array.from(visited).map(id => this.nodes.get(id)!).filter(Boolean);
  }

  /**
   * Skip a node and all its transitive dependents.
   */
  skipNodeAndDependents(nodeId: string, _reason: string): string[] {
    const skipped: string[] = [];

    const node = this.nodes.get(nodeId);
    if (node && node.status !== 'completed') {
      node.status = 'skipped';
      skipped.push(nodeId);
    }

    const dependents = this.getTransitiveDependents(nodeId);
    for (const dep of dependents) {
      if (dep.status !== 'completed') {
        dep.status = 'skipped';
        skipped.push(dep.id);
      }
    }

    return skipped;
  }

  /**
   * Validate the DAG for cycles and missing dependencies.
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for missing dependencies
    for (const node of this.nodes.values()) {
      for (const depId of node.dependsOn) {
        if (!this.nodes.has(depId)) {
          errors.push(`Node "${node.id}" depends on unknown node "${depId}"`);
        }
      }
    }

    // Check for cycles using DFS
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      if (inStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      inStack.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const depId of node.dependsOn) {
          if (this.nodes.has(depId) && hasCycle(depId)) {
            errors.push(`Cycle detected involving node "${nodeId}"`);
            return true;
          }
        }
      }

      inStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        hasCycle(nodeId);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ==========================================================================
  // Context Building
  // ==========================================================================

  /**
   * Build a NodeContext for a given node, providing access to completed dependency results.
   */
  buildContext(nodeId: string, projectDir: string, templateId: string): NodeContext {
    const node = this.getNode(nodeId);

    return {
      getResult: (id: string): NodeResult => {
        const dep = this.nodes.get(id);
        if (!dep || !dep.result) {
          throw new Error(`No result available for node "${id}"`);
        }
        return dep.result;
      },
      getResultsByPrefix: (prefix: string): Map<string, NodeResult> => {
        const results = new Map<string, NodeResult>();
        for (const [id, n] of this.nodes) {
          if (id.startsWith(prefix) && n.result) {
            results.set(id, n.result);
          }
        }
        return results;
      },
      getAllResults: (): Map<string, NodeResult> => {
        const results = new Map<string, NodeResult>();
        for (const [id, n] of this.nodes) {
          if (n.result) {
            results.set(id, n.result);
          }
        }
        return results;
      },
      projectDir,
      templateId,
      metadata: node.metadata ?? {},
    };
  }

  // ==========================================================================
  // Registry Management
  // ==========================================================================

  registerHandler(key: string, handler: (context: NodeContext) => Promise<NodeResult>): void {
    this.handlers.set(key, handler);
  }

  registerPromptBuilder(key: string, builder: (context: NodeContext) => string): void {
    this.promptBuilders.set(key, builder);
  }

  registerQuestionBuilder(key: string, builder: (context: NodeContext) => UserQuestion): void {
    this.questionBuilders.set(key, builder);
  }

  registerExpander(key: string, expander: (result: NodeResult, context: NodeContext) => DAGNodeDefinition[]): void {
    this.expanders.set(key, expander);
  }

  getHandlerRegistries() {
    return {
      handlers: this.handlers,
      promptBuilders: this.promptBuilders,
      questionBuilders: this.questionBuilders,
      expanders: this.expanders,
    };
  }
}
