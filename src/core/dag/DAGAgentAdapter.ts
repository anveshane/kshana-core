/**
 * DAGAgentAdapter — bridges DAGExecutor to GenericAgent's interface.
 *
 * Extends TypedEventEmitter so it can be used anywhere GenericAgent is expected.
 * Maps DAG events → Agent events and uses a Promise-based user interaction
 * bridge to support GenericAgent's "return when waiting" protocol.
 */

import { TypedEventEmitter } from '../../events/EventEmitter.js';
import type { GenericAgentResult } from '../agent/AgentResult.js';
import type { ExpandableTodoItem } from '../todo/index.js';
import { LLMClient, type LLMClientConfig } from '../llm/index.js';
import type { DAGEvent, NodeType } from './types.js';
import { DAG } from './DAG.js';
import { DAGExecutor, type DAGExecutorConfig, type DAGExecutorResult, type UserInteractionHandler } from './DAGExecutor.js';
import { buildNarrativeDAG, rebuildDAGFromState } from './DAGBuilder.js';
import { dagStateExists, loadDAGState, prepareStateForResume } from './persistence.js';

// =============================================================================
// ADAPTER
// =============================================================================

export interface DAGAgentAdapterConfig {
  llmConfig: LLMClientConfig;
  templateId: string;
  /** Project directory path (resolved by caller, e.g., getProjectDir(basePath)) */
  projectDir: string;
  maxConcurrency?: number;
  skipPlanning?: boolean;
}

export class DAGAgentAdapter extends TypedEventEmitter {
  private config: DAGAgentAdapterConfig;
  private executor: DAGExecutor | null = null;
  private dag: DAG | null = null;
  private running = false;
  private waiting = false;
  private autonomousMode = false;
  private userTask = '';

  /** Pending user interaction — set when a U node fires, resolved when respond() is called. */
  private pendingResolve: ((response: string) => void) | null = null;
  /** The question currently being asked (for GenericAgentResult). */
  private pendingQuestion: string | undefined;
  private pendingIsConfirmation = false;
  private pendingOptions: Array<{ label: string; description?: string }> | undefined;
  private pendingAutoApproveMs: number | undefined;
  private pendingQuestionContext: string | undefined;

  /** Resolve/reject for the adapter.run() Promise that the caller awaits. */
  private runResolve: ((result: GenericAgentResult) => void) | null = null;

  constructor(config: DAGAgentAdapterConfig) {
    super();
    this.config = config;
  }

  // ==========================================================================
  // GenericAgent-compatible interface
  // ==========================================================================

  /** No-op — DAG doesn't need async init like LLM context length queries. */
  async initialize(): Promise<void> {
    this.emit({ type: 'agent_status', status: 'started', agentName: 'kshana-dag' });
  }

  /**
   * Run the DAG executor.
   *
   * On first call (task != ''), creates and starts the executor.
   * On subsequent calls (userResponse provided), resolves the pending
   * Promise so the executor's U node continues.
   */
  async run(task: string, userResponse?: string): Promise<GenericAgentResult> {
    // --- Resume path: user is responding to a question ---
    if (userResponse !== undefined && this.pendingResolve) {
      this.waiting = false;
      this.running = true;
      this.emit({ type: 'agent_status', status: 'thinking', agentName: 'kshana-dag' });

      // Resolve the pending U-node handler Promise → executor continues
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingQuestion = undefined;
      resolve(userResponse);

      // Wait for the executor to pause again or finish
      return new Promise<GenericAgentResult>(res => {
        this.runResolve = res;
      });
    }

    // --- Start path: kick off the DAG ---
    this.running = true;
    this.userTask = task;
    this.emit({ type: 'agent_status', status: 'thinking', agentName: 'kshana-dag' });

    // Build the user interaction handler — the Promise bridge
    const userInteraction: UserInteractionHandler = (
      _nodeId, question, isConfirmation, options, context, autoApproveTimeoutMs,
    ) => {
      // In autonomous mode, auto-approve confirmation gates
      if (this.autonomousMode && isConfirmation) {
        return Promise.resolve('Yes');
      }

      return new Promise<string>((resolve) => {
        // Store the resolve so respond() can unblock us
        this.pendingResolve = resolve;
        this.pendingQuestion = question;
        this.pendingIsConfirmation = isConfirmation;
        this.pendingOptions = options;
        this.pendingAutoApproveMs = autoApproveTimeoutMs;
        this.pendingQuestionContext = context;
        this.waiting = true;
        this.running = false;

        // Emit question event for the UI
        this.emit({
          type: 'question',
          question,
          isConfirmation,
          options,
          autoApproveTimeoutMs,
          context,
        });

        // Resolve the outer run() Promise with waiting_for_user
        if (this.runResolve) {
          const r = this.runResolve;
          this.runResolve = null;
          r(this.buildWaitingResult());
        }
      });
    };

    // Create DAG (new or resumed from persisted state)
    const { templateId, projectDir, skipPlanning } = this.config;
    let dag;
    let dagId: string;

    if (dagStateExists(projectDir)) {
      const state = loadDAGState(projectDir);
      if (state) {
        const resumeState = prepareStateForResume(state);
        dag = rebuildDAGFromState(resumeState);
        dagId = state.dagId;
      } else {
        dag = buildNarrativeDAG({ templateId, projectDir, skipPlanning });
        dagId = `dag_${Date.now().toString(36)}`;
      }
    } else {
      dag = buildNarrativeDAG({ templateId, projectDir, skipPlanning });
      dagId = `dag_${Date.now().toString(36)}`;
    }

    // Store DAG ref for event mapping lookups
    this.dag = dag;

    // Pass user task into set_goal node metadata
    if (this.userTask) {
      const goalNode = dag.tryGetNode('set_goal');
      if (goalNode) {
        goalNode.metadata = { ...goalNode.metadata, userTask: this.userTask };
      }
    }

    // Create executor — force sequential execution (maxConcurrency: 1)
    const llm = new LLMClient(this.config.llmConfig);
    const executorConfig: DAGExecutorConfig = {
      llm,
      projectDir,
      templateId,
      dagId,
      maxConcurrency: 1,
      userInteraction,
    };

    this.executor = new DAGExecutor(dag, executorConfig);

    // Wire DAG events → Agent events
    this.executor.on(this.mapDAGEvent.bind(this));

    // Start executor in background — we return to caller via runResolve
    const executorPromise = this.executor.run();

    return new Promise<GenericAgentResult>((resolve) => {
      this.runResolve = resolve;

      // When executor finishes (without going through a U-node pause),
      // resolve run() directly.
      executorPromise.then((dagResult) => {
        this.running = false;
        const agentResult = this.mapResult(dagResult);

        // Emit final status
        if (agentResult.status === 'completed') {
          this.emit({ type: 'agent_status', status: 'completed', agentName: 'kshana-dag' });
        } else if (agentResult.status === 'interrupted') {
          this.emit({ type: 'agent_status', status: 'interrupted', agentName: 'kshana-dag' });
        } else if (agentResult.status === 'error') {
          this.emit({ type: 'agent_status', status: 'error', agentName: 'kshana-dag' });
        }

        // If runResolve is still set, the executor finished without pausing
        if (this.runResolve) {
          const r = this.runResolve;
          this.runResolve = null;
          r(agentResult);
        }
      }).catch((err) => {
        this.running = false;
        const errorResult: GenericAgentResult = {
          status: 'error',
          output: '',
          todos: [],
          error: err instanceof Error ? err.message : String(err),
        };
        this.emit({ type: 'agent_status', status: 'error', agentName: 'kshana-dag' });
        if (this.runResolve) {
          const r = this.runResolve;
          this.runResolve = null;
          r(errorResult);
        }
      });
    });
  }

  stop(): void {
    this.executor?.abort();
    this.running = false;
    this.emit({ type: 'agent_status', status: 'interrupted', agentName: 'kshana-dag' });
  }

  isRunning(): boolean {
    return this.running;
  }

  isWaiting(): boolean {
    return this.waiting;
  }

  getTodos(): ExpandableTodoItem[] {
    return [];
  }

  getToolNames(): string[] {
    return ['dag-executor'];
  }

  injectInput(_input: string): void {
    // Not supported for DAG mode
  }

  setAutonomousMode(enabled: boolean): void {
    this.autonomousMode = enabled;
  }

  // ==========================================================================
  // Event Mapping
  // ==========================================================================

  /**
   * Map a DAG node ID to a legacy tool name + structured args for rich UI rendering.
   * Returns null to suppress the event (e.g., auto-approved U nodes).
   */
  private mapNodeToLegacyTool(
    nodeId: string,
    nodeType: NodeType,
    description?: string,
  ): { toolName: string; args: Record<string, unknown> } | null {
    const node = this.dag?.tryGetNode(nodeId);
    const meta = node?.metadata ?? {};

    // Suppress ALL U nodes — they're handled via the question event flow
    if (nodeType === 'U') {
      return null;
    }

    // --- D nodes ---

    // Internal setup operations → think
    if (nodeId === 'set_goal' || nodeId === 'scan_assets' || nodeId === 'register_content') {
      return { toolName: 'think', args: { thought: description ?? nodeId } };
    }

    // create_plan → dispatch_agent (shows as plan box in CLI)
    if (nodeId === 'create_plan') {
      return { toolName: 'dispatch_agent', args: { task: 'Create execution plan', context: description ?? '' } };
    }

    // Other D nodes → think (internal operations)
    if (nodeType === 'D') {
      return { toolName: 'think', args: { thought: description ?? nodeId } };
    }

    // --- S nodes: match specific patterns for rich gen-card rendering ---

    // Plot / Story
    if (nodeId === 'generate_plot') {
      return { toolName: 'generate_content', args: { content_type: 'Plot Outline' } };
    }
    if (nodeId === 'generate_story') {
      return { toolName: 'generate_content', args: { content_type: 'Full Story' } };
    }

    // Entity extraction
    if (nodeId === 'extract_entities') {
      return { toolName: 'generate_content', args: { content_type: 'Entity Extraction' } };
    }

    // Character pipeline
    const charGenMatch = nodeId.match(/^char_(.+)_generate$/);
    if (charGenMatch) {
      return { toolName: 'generate_content', args: { character_name: meta['characterName'] ?? charGenMatch[1], content_type: 'Character' } };
    }
    const charImgPromptMatch = nodeId.match(/^char_(.+)_img_prompt$/);
    if (charImgPromptMatch) {
      return { toolName: 'generate_content', args: { character_name: meta['characterName'] ?? charImgPromptMatch[1], content_type: 'Image Prompt' } };
    }
    const charImgMatch = nodeId.match(/^char_(.+)_img$/);
    if (charImgMatch) {
      return { toolName: 'generate_image', args: { character_name: meta['characterName'] ?? charImgMatch[1], image_type: 'character_ref' } };
    }

    // Setting pipeline
    const settingGenMatch = nodeId.match(/^setting_(.+)_generate$/);
    if (settingGenMatch) {
      return { toolName: 'generate_content', args: { setting_name: meta['settingName'] ?? settingGenMatch[1], content_type: 'Setting' } };
    }
    const settingImgPromptMatch = nodeId.match(/^setting_(.+)_img_prompt$/);
    if (settingImgPromptMatch) {
      return { toolName: 'generate_content', args: { setting_name: meta['settingName'] ?? settingImgPromptMatch[1], content_type: 'Image Prompt' } };
    }
    const settingImgMatch = nodeId.match(/^setting_(.+)_img$/);
    if (settingImgMatch) {
      return { toolName: 'generate_image', args: { setting_name: meta['settingName'] ?? settingImgMatch[1], image_type: 'setting_ref' } };
    }

    // Scene generation
    if (nodeId === 'generate_scenes') {
      return { toolName: 'generate_content', args: { content_type: 'Scenes' } };
    }

    // Shot breakdown
    const shotBreakdownMatch = nodeId.match(/^scene_(\d+)_shot_breakdown$/);
    if (shotBreakdownMatch) {
      return { toolName: 'generate_content', args: { scene_number: shotBreakdownMatch[1], content_type: 'Shot Breakdown' } };
    }

    // Shot image prompt
    const shotImgPromptMatch = nodeId.match(/^scene_(\d+)_shot_(\d+)_img_prompt$/);
    if (shotImgPromptMatch) {
      return { toolName: 'generate_content', args: { scene_number: shotImgPromptMatch[1], shot_number: shotImgPromptMatch[2], content_type: 'Shot Image Prompt' } };
    }

    // Shot image
    const shotImgMatch = nodeId.match(/^scene_(\d+)_shot_(\d+)_img$/);
    if (shotImgMatch) {
      return { toolName: 'generate_image', args: { scene_number: shotImgMatch[1], shot_number: shotImgMatch[2], image_type: 'scene_image' } };
    }

    // Shot video
    const shotVideoMatch = nodeId.match(/^scene_(\d+)_shot_(\d+)_video$/);
    if (shotVideoMatch) {
      return { toolName: 'generate_video', args: { scene_number: shotVideoMatch[1], shot_number: shotVideoMatch[2] } };
    }

    // Fallback for any other S nodes
    return { toolName: 'generate_content', args: { content_type: description ?? nodeId } };
  }

  private mapDAGEvent(event: DAGEvent): void {
    switch (event.type) {
      case 'node_started': {
        const mapped = this.mapNodeToLegacyTool(event.nodeId, event.nodeType, event.description);
        if (!mapped) break; // Suppressed (e.g., U nodes)

        this.emit({
          type: 'tool_call',
          toolCallId: event.nodeId,
          toolName: mapped.toolName,
          arguments: mapped.args,
          agentName: 'kshana-dag',
        });
        break;
      }

      case 'node_completed': {
        const mapped = this.mapNodeToLegacyTool(event.nodeId, event.nodeType);
        if (!mapped) break; // Suppressed

        // Look up result content from the DAG node
        const completedNode = this.dag?.tryGetNode(event.nodeId);
        const content = completedNode?.result?.content;

        // Build result payload — include content for renderToolResult to display as markdown
        let resultPayload: string;
        if (mapped.toolName === 'dispatch_agent' && content) {
          resultPayload = JSON.stringify({ plan: content, duration: `${event.durationMs}ms` });
        } else if (content) {
          resultPayload = content;
        } else {
          resultPayload = `Completed in ${event.durationMs}ms`;
        }

        this.emit({
          type: 'tool_result',
          toolCallId: event.nodeId,
          toolName: mapped.toolName,
          result: resultPayload,
          agentName: 'kshana-dag',
        });
        break;
      }

      case 'node_failed':
        this.emit({
          type: 'tool_result',
          toolCallId: event.nodeId,
          toolName: event.nodeId,
          result: `Error (attempt ${event.attempt}): ${event.error}`,
          isError: true,
          agentName: 'kshana-dag',
        });
        break;

      case 'node_skipped':
        this.emit({
          type: 'notification',
          level: 'info',
          message: `Skipped ${event.nodeId}: ${event.reason}`,
        });
        break;

      case 'expansion':
        this.emit({
          type: 'notification',
          level: 'info',
          message: `Expanded ${event.sourceNodeId} → ${event.newNodeIds.length} new nodes`,
        });
        break;

      case 'retry':
        this.emit({
          type: 'notification',
          level: 'info',
          message: `Retrying ${event.nodeId} (attempt ${event.attempt}, strategy: ${event.strategy})`,
        });
        break;

      case 'micro_llm_recovery':
        this.emit({
          type: 'notification',
          level: 'info',
          message: `Micro-LLM recovery for ${event.nodeId}: ${event.decision.action}`,
        });
        break;

      case 'dag_completed':
        this.emit({
          type: 'agent_status',
          status: 'completed',
          agentName: 'kshana-dag',
        });
        break;

      case 'llm_streaming':
        this.emit({
          type: 'tool_streaming',
          toolCallId: event.nodeId,
          chunk: event.chunk,
          done: event.done,
          agentName: 'kshana-dag',
        });
        break;

      // user_gate is handled via the UserInteractionHandler → question event
      // dag_paused and dag_state_saved are internal — no UI mapping needed
      default:
        break;
    }
  }

  // ==========================================================================
  // Result Mapping
  // ==========================================================================

  private mapResult(dagResult: DAGExecutorResult): GenericAgentResult {
    if (dagResult.completed) {
      return {
        status: 'completed',
        output: `DAG completed: ${dagResult.stats.completed}/${dagResult.stats.total} nodes`,
        todos: [],
      };
    }
    if (dagResult.paused) {
      return this.buildWaitingResult();
    }
    if (dagResult.aborted) {
      return {
        status: 'interrupted',
        output: '',
        todos: [],
      };
    }
    // Fallback — should not happen
    return {
      status: 'error',
      output: '',
      todos: [],
      error: `Unexpected DAG state: ${JSON.stringify(dagResult.stats)}`,
    };
  }

  private buildWaitingResult(): GenericAgentResult {
    return {
      status: 'waiting_for_user',
      output: '',
      todos: [],
      pendingQuestion: this.pendingQuestion,
      isConfirmation: this.pendingIsConfirmation,
      options: this.pendingOptions,
      autoApproveTimeoutMs: this.pendingAutoApproveMs,
      questionContext: this.pendingQuestionContext,
    };
  }
}
