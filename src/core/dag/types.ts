/**
 * Core types for the DAG Executor.
 *
 * The DAG executor replaces LLM-as-router with deterministic graph traversal.
 * LLMs are used only at S (Stochastic) nodes for content generation
 * and in micro-LLM recovery for error handling.
 */

// =============================================================================
// NODE TYPES
// =============================================================================

/**
 * Node type determines how the node is executed:
 * - D: Deterministic — runs a handler function, no LLM needed
 * - S: Stochastic — calls LLM with a focused prompt
 * - U: User-gate — pauses execution to ask user for input/approval
 */
export type NodeType = 'D' | 'S' | 'U';

/**
 * Node execution status.
 */
export type NodeStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Context available to node handlers and prompt builders.
 * Provides access to completed node results and project state.
 */
export interface NodeContext {
  /** Get the result of a completed dependency node */
  getResult(nodeId: string): NodeResult;
  /** Get results of all completed nodes matching a prefix */
  getResultsByPrefix(prefix: string): Map<string, NodeResult>;
  /** Get all completed results */
  getAllResults(): Map<string, NodeResult>;
  /** Project directory path */
  projectDir: string;
  /** Template ID */
  templateId: string;
  /** Additional metadata passed through from the DAG builder */
  metadata: Record<string, unknown>;
}

/**
 * Result produced by a node after execution.
 */
export interface NodeResult {
  /** Text content (for S nodes — LLM output) */
  content?: string;
  /** File path (for D nodes that produce files) */
  artifactPath?: string;
  /** User's response (for U nodes) */
  userResponse?: string;
  /** Structured data parsed from content */
  data?: unknown;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Validation result from an error policy's validation function.
 */
export interface ValidationResult {
  valid: boolean;
  /** Error message when invalid */
  error?: string;
  /** Parsed/validated data to store on the result */
  data?: unknown;
}

/**
 * User question definition for U nodes.
 */
export interface UserQuestion {
  /** The question text to display */
  question: string;
  /** Whether this is a simple yes/no confirmation */
  isConfirmation: boolean;
  /** Optional choices */
  options?: Array<{ label: string; description?: string }>;
  /** Context to display with the question (e.g., content being approved) */
  context?: string;
  /** Auto-approve timeout in milliseconds */
  autoApproveTimeoutMs?: number;
}

// =============================================================================
// ERROR HANDLING
// =============================================================================

/**
 * Per-node error policy controlling retry and recovery behavior.
 */
export interface ErrorPolicy {
  /** Maximum retry attempts before escalating */
  maxRetries: number;
  /** How to retry: 'same' repeats input, 'rephrase' adds error feedback */
  retryStrategy: 'same' | 'rephrase';
  /** Optional validation function to check node output */
  validation?: (result: NodeResult) => ValidationResult;
  /** What to do when all retries are exhausted */
  onExhausted: 'ask_user' | 'skip' | 'micro_llm';
  /** Optional delay between retries in milliseconds */
  retryDelayMs?: number;
}

/**
 * Record of a single error attempt for audit trail.
 */
export interface ErrorAttempt {
  /** Which retry strategy was used */
  strategy: 'same' | 'rephrase' | 'micro_llm_modified';
  /** The error that occurred */
  error: string;
  /** Timestamp */
  timestamp: string;
}

/**
 * Decision made by the micro-LLM recovery agent.
 */
export interface MicroLLMDecision {
  action: 'retry_modified' | 'skip' | 'ask_user';
  reason: string;
  /** Modified input for retry_modified */
  modifiedInput?: string;
  /** Impact description for skip */
  skipImpact?: string;
}

// =============================================================================
// DAG NODE
// =============================================================================

/**
 * A single node in the execution DAG.
 */
export interface DAGNode {
  /** Unique node identifier (e.g., "generate_story", "char_alice_img") */
  id: string;
  /** Node type: Deterministic, Stochastic, or User-gate */
  type: NodeType;
  /** IDs of nodes that must complete before this node can run */
  dependsOn: string[];
  /** Current execution status */
  status: NodeStatus;
  /** Human-readable description of what this node does */
  description?: string;

  // --- Handlers (mutually exclusive based on type) ---

  /** Handler for D nodes — deterministic execution */
  handler?: (context: NodeContext) => Promise<NodeResult>;
  /** Prompt builder for S nodes — builds LLM prompt from context */
  promptBuilder?: (context: NodeContext) => string;
  /** Question builder for U nodes — builds user question from context */
  questionBuilder?: (context: NodeContext) => UserQuestion;

  // --- Dynamic expansion ---

  /** Expander function — spawns new nodes from this node's result */
  expander?: (result: NodeResult, context: NodeContext) => DAGNodeDefinition[];

  /** Output format hint — 'json' triggers structured JSON response from LLM */
  outputFormat?: 'json' | 'text';

  // --- Error handling ---

  /** Error policy for this node */
  errorPolicy: ErrorPolicy;

  // --- Output ---

  /** Result after successful completion */
  result?: NodeResult;

  // --- Metadata ---

  /** Arbitrary metadata for downstream nodes to use */
  metadata?: Record<string, unknown>;

  // --- Timing ---

  /** When execution started */
  startedAt?: string;
  /** When execution completed */
  completedAt?: string;
  /** Error attempts history */
  attempts?: ErrorAttempt[];
  /** Recovery decisions history */
  recoveryDecisions?: MicroLLMDecision[];
}

/**
 * Serializable node definition used by expanders to create new nodes.
 * Does not include handler functions (those are attached by the builder).
 */
export interface DAGNodeDefinition {
  id: string;
  type: NodeType;
  dependsOn: string[];
  description?: string;
  metadata?: Record<string, unknown>;
  errorPolicy?: Partial<ErrorPolicy>;
  /** Handler key — maps to a registered handler function */
  handlerKey?: string;
  /** Whether this node has an expander */
  expanderKey?: string;
  /** Output format hint — 'json' triggers structured JSON response from LLM */
  outputFormat?: 'json' | 'text';
}

// =============================================================================
// PERSISTENCE
// =============================================================================

/**
 * Persisted state of the entire DAG for resume capability.
 */
export interface PersistedDAGState {
  /** Unique run identifier */
  dagId: string;
  /** Template ID (e.g., 'narrative', 'documentary') */
  templateId: string;
  /** When the DAG was created */
  createdAt: string;
  /** Last state update time */
  lastUpdatedAt: string;
  /** All node states */
  nodes: Record<string, PersistedNodeState>;
  /** Log of dynamic expansions */
  expansionLog: ExpansionEvent[];
}

/**
 * Persisted state of a single node.
 */
export interface PersistedNodeState {
  id: string;
  type: NodeType;
  status: NodeStatus;
  dependsOn: string[];
  description?: string;
  metadata?: Record<string, unknown>;

  /** Result (only for completed nodes) */
  result?: {
    content?: string;
    artifactPath?: string;
    userResponse?: string;
    data?: unknown;
    metadata?: Record<string, unknown>;
  };

  /** Error tracking */
  attempts?: ErrorAttempt[];
  recoveryDecisions?: MicroLLMDecision[];

  /** Timing */
  startedAt?: string;
  completedAt?: string;

  /** Handler/expander keys for re-attaching on resume */
  handlerKey?: string;
  expanderKey?: string;
  /** Output format hint */
  outputFormat?: 'json' | 'text';
}

/**
 * Record of a dynamic expansion event.
 */
export interface ExpansionEvent {
  /** Node that triggered the expansion */
  sourceNodeId: string;
  /** IDs of newly created nodes */
  newNodeIds: string[];
  /** When the expansion occurred */
  timestamp: string;
}

// =============================================================================
// EXECUTOR EVENTS
// =============================================================================

/**
 * Events emitted by the DAG executor for UI/logging.
 */
export type DAGEvent =
  | { type: 'node_ready'; nodeId: string; nodeType: NodeType }
  | { type: 'node_started'; nodeId: string; nodeType: NodeType; description?: string }
  | { type: 'node_completed'; nodeId: string; nodeType: NodeType; durationMs: number }
  | { type: 'node_failed'; nodeId: string; nodeType: NodeType; error: string; attempt: number }
  | { type: 'node_skipped'; nodeId: string; reason: string }
  | { type: 'expansion'; sourceNodeId: string; newNodeIds: string[] }
  | { type: 'retry'; nodeId: string; attempt: number; strategy: string }
  | { type: 'micro_llm_recovery'; nodeId: string; decision: MicroLLMDecision }
  | { type: 'user_gate'; nodeId: string; question: UserQuestion }
  | { type: 'dag_completed'; totalNodes: number; completedNodes: number; skippedNodes: number }
  | { type: 'dag_paused'; nodeId: string; reason: string }
  | { type: 'dag_state_saved'; path: string }
  | { type: 'llm_streaming'; nodeId: string; chunk: string; done: boolean };

/**
 * Callback type for DAG event listeners.
 */
export type DAGEventListener = (event: DAGEvent) => void;

// =============================================================================
// HANDLER / EXPANDER REGISTRY
// =============================================================================

/**
 * Registry of named handler functions that can be attached to D nodes.
 */
export type HandlerRegistry = Map<string, (context: NodeContext) => Promise<NodeResult>>;

/**
 * Registry of named prompt builder functions for S nodes.
 */
export type PromptBuilderRegistry = Map<string, (context: NodeContext) => string>;

/**
 * Registry of named question builder functions for U nodes.
 */
export type QuestionBuilderRegistry = Map<string, (context: NodeContext) => UserQuestion>;

/**
 * Registry of named expander functions.
 */
export type ExpanderRegistry = Map<string, (result: NodeResult, context: NodeContext) => DAGNodeDefinition[]>;
