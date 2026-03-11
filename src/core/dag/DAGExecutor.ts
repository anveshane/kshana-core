/**
 * DAG Executor.
 *
 * The main execution loop that drives the DAG.
 * Handles node dispatch, parallel execution, validation, retry,
 * dynamic expansion, error recovery, and state persistence.
 *
 * Key design:
 * - D nodes: run handler function directly
 * - S nodes: call LLM with focused prompt (fresh context per node)
 * - U nodes: pause and wait for user input
 * - Expansion: after a node completes, run its expander to add new nodes
 * - Errors: per-node policy → retry → micro-LLM → ask_user
 * - Persistence: save state after every completion/expansion/pause
 */

import type { LLMClient } from '../llm/index.js';
import type {
  DAGNode,
  NodeResult,
  ErrorAttempt,
  DAGEvent,
  DAGEventListener,
  ValidationResult,
} from './types.js';
import { DAG } from './DAG.js';
import { microLLMRecover } from './microLLM.js';
import { saveDAGState, logRecoveryDecision } from './persistence.js';
import { buildAssemblyNodes, isAllScenesExpanded } from './expanders/index.js';

// =============================================================================
// EXECUTOR CONFIG
// =============================================================================

export interface DAGExecutorConfig {
  /** LLM client for S nodes and micro-LLM recovery */
  llm: LLMClient;
  /** Project directory path */
  projectDir: string;
  /** Template ID */
  templateId: string;
  /** Unique DAG run ID */
  dagId: string;
  /** Maximum concurrent node executions (default: 4) */
  maxConcurrency?: number;
  /** Callback for user interaction (U nodes) */
  userInteraction: UserInteractionHandler;
  /** Optional: callback when LLM streams text for an S node */
  onLLMStream?: (nodeId: string, chunk: string, done: boolean) => void;
}

/**
 * Handler for user interaction.
 * Called when a U node needs user input. Must return the user's response.
 */
export type UserInteractionHandler = (
  nodeId: string,
  question: string,
  isConfirmation: boolean,
  options?: Array<{ label: string; description?: string }>,
  context?: string,
  autoApproveTimeoutMs?: number,
) => Promise<string>;

// =============================================================================
// EXECUTOR
// =============================================================================

export class DAGExecutor {
  private dag: DAG;
  private config: DAGExecutorConfig;
  private listeners: DAGEventListener[] = [];
  private aborted = false;
  private paused = false;
  private pauseReason?: string;
  private assemblyNodesAdded = false;

  constructor(dag: DAG, config: DAGExecutorConfig) {
    this.dag = dag;
    this.config = config;
  }

  // ==========================================================================
  // Event System
  // ==========================================================================

  on(listener: DAGEventListener): void {
    this.listeners.push(listener);
  }

  private emit(event: DAGEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors crash the executor
      }
    }
  }

  // ==========================================================================
  // Control
  // ==========================================================================

  /** Abort the executor. Running nodes will complete but no new nodes start. */
  abort(): void {
    this.aborted = true;
  }

  /** Check if the executor is paused (waiting for user at a U node). */
  isPaused(): boolean {
    return this.paused;
  }

  /** Get the DAG for inspection. */
  getDAG(): DAG {
    return this.dag;
  }

  // ==========================================================================
  // Main Loop
  // ==========================================================================

  /**
   * Run the executor until the DAG is complete, paused, or aborted.
   */
  async run(): Promise<DAGExecutorResult> {
    const maxConcurrency = this.config.maxConcurrency ?? 4;

    while (this.dag.hasWork() && !this.aborted) {
      const readyNodes = this.dag.getReadyNodes();

      if (readyNodes.length === 0) {
        // Check if we're stuck (all remaining nodes are pending but none are ready)
        const runningNodes = this.dag.getNodesByStatus('running');
        if (runningNodes.length === 0) {
          // Truly stuck — no ready nodes and nothing running
          break;
        }
        // Wait for running nodes to complete
        await sleep(100);
        continue;
      }

      // Execute ready nodes in parallel, up to concurrency limit
      const batch = readyNodes.slice(0, maxConcurrency);
      const promises = batch.map(node => this.executeNode(node));

      await Promise.all(promises);

      // Check if we should add assembly nodes
      if (!this.assemblyNodesAdded && isAllScenesExpanded(this.dag)) {
        this.addAssemblyNodes();
      }

      // Persist state after batch
      this.persistState();

      if (this.paused) {
        this.emit({ type: 'dag_paused', nodeId: this.pauseReason ?? 'unknown', reason: this.pauseReason ?? 'User interaction required' });
        break;
      }
    }

    const stats = this.dag.getStats();
    const result: DAGExecutorResult = {
      completed: this.dag.isComplete(),
      paused: this.paused,
      aborted: this.aborted,
      stats,
    };

    if (this.dag.isComplete()) {
      this.emit({
        type: 'dag_completed',
        totalNodes: stats.total,
        completedNodes: stats.completed,
        skippedNodes: stats.skipped,
      });
    }

    return result;
  }

  // ==========================================================================
  // Node Execution
  // ==========================================================================

  private async executeNode(node: DAGNode): Promise<void> {
    node.status = 'running';
    node.startedAt = new Date().toISOString();
    this.emit({ type: 'node_started', nodeId: node.id, nodeType: node.type });

    const startTime = Date.now();
    let result: NodeResult | null = null;

    try {
      const context = this.dag.buildContext(node.id, this.config.projectDir, this.config.templateId);

      if (node.type === 'D') {
        result = await this.executeDNode(node, context);
      } else if (node.type === 'S') {
        result = await this.executeSNode(node, context);
      } else if (node.type === 'U') {
        result = await this.executeUNode(node, context);
        if (!result) return; // Paused for user input
      }

      if (!result) {
        throw new Error(`Node "${node.id}" produced no result`);
      }

      // Validate
      if (node.errorPolicy.validation) {
        const check = node.errorPolicy.validation(result);
        if (!check.valid) {
          await this.handleValidationFailure(node, check, result);
          return;
        }
        // Store validated data
        if (check.data !== undefined) {
          result.data = check.data;
        }
      }

      // Success
      node.result = result;
      node.status = 'completed';
      node.completedAt = new Date().toISOString();

      const durationMs = Date.now() - startTime;
      this.emit({ type: 'node_completed', nodeId: node.id, nodeType: node.type, durationMs });

      // Dynamic expansion
      if (node.expander) {
        const newDefs = node.expander(result, context);
        if (newDefs.length > 0) {
          this.dag.addNodesFromDefinitions(newDefs, node.id);
          this.emit({ type: 'expansion', sourceNodeId: node.id, newNodeIds: newDefs.map(d => d.id) });
        }
      }

      // Update ready nodes
      this.dag.updateReadyNodes();

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.handleNodeError(node, errorMsg);
    }
  }

  private async executeDNode(node: DAGNode, context: ReturnType<DAG['buildContext']>): Promise<NodeResult> {
    if (!node.handler) {
      throw new Error(`D node "${node.id}" has no handler`);
    }
    return node.handler(context);
  }

  private async executeSNode(node: DAGNode, context: ReturnType<DAG['buildContext']>): Promise<NodeResult> {
    if (!node.promptBuilder) {
      throw new Error(`S node "${node.id}" has no prompt builder`);
    }

    const prompt = node.promptBuilder(context);

    // Call LLM with focused prompt (fresh context — no conversation history)
    const response = await this.config.llm.generate({
      messages: [
        { role: 'system', content: 'You are a creative AI assistant working on a video production pipeline. Follow the instructions precisely and return the requested output.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      responseFormat: prompt.includes('Return ONLY valid JSON') || prompt.includes('Return JSON')
        ? { type: 'json_object' }
        : undefined,
    });

    return {
      content: response.content ?? undefined,
    };
  }

  private async executeUNode(node: DAGNode, context: ReturnType<DAG['buildContext']>): Promise<NodeResult | null> {
    if (!node.questionBuilder) {
      throw new Error(`U node "${node.id}" has no question builder`);
    }

    const question = node.questionBuilder(context);
    this.emit({ type: 'user_gate', nodeId: node.id, question });

    try {
      const userResponse = await this.config.userInteraction(
        node.id,
        question.question,
        question.isConfirmation,
        question.options,
        question.context,
        question.autoApproveTimeoutMs,
      );

      return {
        userResponse,
        content: userResponse,
      };
    } catch {
      // User interaction was interrupted or unavailable
      this.paused = true;
      this.pauseReason = node.id;
      node.status = 'ready'; // Reset so it can be retried on resume
      return null;
    }
  }

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  private async handleValidationFailure(
    node: DAGNode,
    check: ValidationResult,
    lastResult: NodeResult,
  ): Promise<void> {
    const attempt: ErrorAttempt = {
      strategy: 'rephrase',
      error: check.error ?? 'Validation failed',
      timestamp: new Date().toISOString(),
    };
    node.attempts = node.attempts ?? [];
    node.attempts.push(attempt);

    this.emit({ type: 'node_failed', nodeId: node.id, nodeType: node.type, error: check.error ?? 'Validation failed', attempt: node.attempts.length });

    if (node.attempts.length < node.errorPolicy.maxRetries) {
      // Retry
      await this.retryNode(node, check.error, lastResult);
    } else {
      // Exhausted
      await this.handleExhausted(node, check.error ?? 'Validation failed');
    }
  }

  private async handleNodeError(node: DAGNode, error: string): Promise<void> {
    const attempt: ErrorAttempt = {
      strategy: node.errorPolicy.retryStrategy,
      error,
      timestamp: new Date().toISOString(),
    };
    node.attempts = node.attempts ?? [];
    node.attempts.push(attempt);

    this.emit({ type: 'node_failed', nodeId: node.id, nodeType: node.type, error, attempt: node.attempts.length });

    if (node.attempts.length < node.errorPolicy.maxRetries) {
      // Retry with delay
      if (node.errorPolicy.retryDelayMs) {
        await sleep(node.errorPolicy.retryDelayMs);
      }
      // Reset to ready for next iteration
      node.status = 'ready';
      this.emit({ type: 'retry', nodeId: node.id, attempt: node.attempts.length, strategy: node.errorPolicy.retryStrategy });
    } else {
      await this.handleExhausted(node, error);
    }
  }

  private async retryNode(node: DAGNode, error: string | undefined, lastResult: NodeResult): Promise<void> {
    this.emit({ type: 'retry', nodeId: node.id, attempt: (node.attempts?.length ?? 0), strategy: 'rephrase' });

    if (node.type === 'S' && node.promptBuilder && node.errorPolicy.retryStrategy === 'rephrase') {
      // Re-call LLM with error feedback
      const context = this.dag.buildContext(node.id, this.config.projectDir, this.config.templateId);
      const originalPrompt = node.promptBuilder(context);

      const response = await this.config.llm.generate({
        messages: [
          { role: 'system', content: 'You are a creative AI assistant. Your previous response was invalid. Fix the specific error and try again.' },
          { role: 'user', content: originalPrompt },
          { role: 'assistant', content: lastResult.content ?? '' },
          { role: 'user', content: `Your previous response was invalid.\nError: ${error}\n\nPlease fix the issue and return the corrected output.` },
        ],
        temperature: 0.5,
        responseFormat: originalPrompt.includes('Return ONLY valid JSON') || originalPrompt.includes('Return JSON')
          ? { type: 'json_object' }
          : undefined,
      });

      const result: NodeResult = { content: response.content ?? undefined };

      // Validate again
      if (node.errorPolicy.validation) {
        const check = node.errorPolicy.validation(result);
        if (!check.valid) {
          if ((node.attempts?.length ?? 0) >= node.errorPolicy.maxRetries) {
            await this.handleExhausted(node, check.error ?? 'Validation still failing');
          } else {
            await this.handleValidationFailure(node, check, result);
          }
          return;
        }
        if (check.data !== undefined) {
          result.data = check.data;
        }
      }

      // Success on retry
      node.result = result;
      node.status = 'completed';
      node.completedAt = new Date().toISOString();
      this.emit({ type: 'node_completed', nodeId: node.id, nodeType: node.type, durationMs: 0 });

      // Expand if needed
      if (node.expander) {
        const ctx = this.dag.buildContext(node.id, this.config.projectDir, this.config.templateId);
        const newDefs = node.expander(result, ctx);
        if (newDefs.length > 0) {
          this.dag.addNodesFromDefinitions(newDefs, node.id);
          this.emit({ type: 'expansion', sourceNodeId: node.id, newNodeIds: newDefs.map(d => d.id) });
        }
      }

      this.dag.updateReadyNodes();
    } else {
      // Non-rephrase retry — just reset to ready
      node.status = 'ready';
    }
  }

  private async handleExhausted(node: DAGNode, error: string): Promise<void> {
    switch (node.errorPolicy.onExhausted) {
      case 'ask_user': {
        // Pause for user
        this.paused = true;
        this.pauseReason = node.id;
        node.status = 'failed';

        try {
          const response = await this.config.userInteraction(
            node.id,
            `Node "${node.id}" failed after ${node.attempts?.length ?? 0} retries.\nError: ${error}\n\nWhat would you like to do?`,
            false,
            [
              { label: 'Retry', description: 'Try again' },
              { label: 'Skip', description: 'Skip this node and dependents' },
              { label: 'Stop', description: 'Stop the pipeline' },
            ],
          );

          if (response.toLowerCase() === 'retry') {
            node.status = 'ready';
            node.attempts = []; // Reset attempts
            this.paused = false;
          } else if (response.toLowerCase() === 'skip') {
            const skipped = this.dag.skipNodeAndDependents(node.id, error);
            for (const id of skipped) {
              this.emit({ type: 'node_skipped', nodeId: id, reason: `Skipped due to failure in ${node.id}` });
            }
            this.paused = false;
            this.dag.updateReadyNodes();
          } else {
            this.aborted = true;
          }
        } catch {
          node.status = 'failed';
          this.paused = true;
        }
        break;
      }

      case 'skip': {
        const skipped = this.dag.skipNodeAndDependents(node.id, error);
        for (const id of skipped) {
          this.emit({ type: 'node_skipped', nodeId: id, reason: `Skipped due to failure in ${node.id}` });
        }
        this.dag.updateReadyNodes();
        break;
      }

      case 'micro_llm': {
        const decision = await microLLMRecover(
          node,
          error,
          node.attempts ?? [],
          this.dag,
          this.config.llm,
        );

        this.emit({ type: 'micro_llm_recovery', nodeId: node.id, decision });
        logRecoveryDecision(this.config.projectDir, node.id, decision);

        node.recoveryDecisions = node.recoveryDecisions ?? [];
        node.recoveryDecisions.push(decision);

        switch (decision.action) {
          case 'retry_modified':
            // One more attempt with modified input
            node.status = 'ready';
            if (decision.modifiedInput) {
              node.metadata = node.metadata ?? {};
              node.metadata['modifiedInput'] = decision.modifiedInput;
            }
            break;

          case 'skip': {
            const skipped = this.dag.skipNodeAndDependents(node.id, error);
            for (const id of skipped) {
              this.emit({ type: 'node_skipped', nodeId: id, reason: decision.skipImpact ?? `Micro-LLM decided to skip` });
            }
            this.dag.updateReadyNodes();
            break;
          }

          case 'ask_user':
            // Escalate to user
            node.status = 'failed';
            this.paused = true;
            this.pauseReason = node.id;
            break;
        }
        break;
      }
    }
  }

  // ==========================================================================
  // Assembly Nodes
  // ==========================================================================

  private addAssemblyNodes(): void {
    const assemblyDefs = buildAssemblyNodes(this.dag);
    if (assemblyDefs.length > 0) {
      this.dag.addNodesFromDefinitions(assemblyDefs, 'expand_scenes');
      this.assemblyNodesAdded = true;
      this.emit({ type: 'expansion', sourceNodeId: 'assembly_gate', newNodeIds: assemblyDefs.map(d => d.id) });
      this.dag.updateReadyNodes();
    }
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  private persistState(): void {
    try {
      const path = saveDAGState(
        this.dag,
        this.config.dagId,
        this.config.templateId,
        this.config.projectDir,
      );
      this.emit({ type: 'dag_state_saved', path });
    } catch {
      // Best-effort persistence
    }
  }
}

// =============================================================================
// RESULT TYPE
// =============================================================================

export interface DAGExecutorResult {
  completed: boolean;
  paused: boolean;
  aborted: boolean;
  stats: {
    total: number;
    completed: number;
    skipped: number;
    failed: number;
    pending: number;
    ready: number;
    running: number;
  };
}

// =============================================================================
// UTILITIES
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
