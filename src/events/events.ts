/**
 * Event types for agent progress and state changes.
 */
import type { ExpandableTodoItem } from '../core/todo/index.js';

/**
 * Progress event for long-running operations.
 */
export interface ProgressEvent {
  type: 'progress';
  percentage: number;
  message: string;
  iteration?: number;
  maxIterations?: number;
}

/**
 * Tool call event when agent calls a tool.
 */
export interface ToolCallEvent {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  agentName?: string;
}

/**
 * Tool result event after tool execution.
 */
export interface ToolResultEvent {
  type: 'tool_result';
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
  agentName?: string;
}

/**
 * Todo update event when todo list changes.
 */
export interface TodoUpdateEvent {
  type: 'todo_update';
  todos: ExpandableTodoItem[];
  agentName?: string;
}

/**
 * Agent text event for streaming LLM output.
 */
export interface AgentTextEvent {
  type: 'agent_text';
  text: string;
  isFinal: boolean;
}

/**
 * Streaming text chunk event for real-time LLM output.
 */
export interface StreamingTextEvent {
  type: 'streaming_text';
  /** The text chunk to append */
  chunk: string;
  /** Whether this is the final chunk */
  done: boolean;
  /** If true, don't add to history when done (e.g., for plans shown elsewhere) */
  skipHistory?: boolean;
}

/**
 * Tool streaming event for streaming content within a tool call display.
 * Used for sub-agent loops (content, image prompt, plan) that generate content
 * which should be displayed inside the tool's UI box.
 */
export interface ToolStreamingEvent {
  type: 'tool_streaming';
  /** ID of the tool call this streaming belongs to */
  toolCallId: string;
  /** The text chunk to append */
  chunk: string;
  /** Whether this is the final chunk */
  done: boolean;
  /** Name of the agent */
  agentName?: string;
  /** Tool name (for resuming display after feedback) */
  toolName?: string;
  /** Tool arguments (for resuming display after feedback) */
  toolArgs?: Record<string, unknown>;
  /** If true, reset streaming content before appending (used when regenerating after feedback) */
  reset?: boolean;
}

/**
 * Notification event for user-facing messages.
 */
export interface NotificationEvent {
  type: 'notification';
  level: 'info' | 'warning' | 'error';
  message: string;
}

/**
 * Option for multiple choice questions.
 */
export interface QuestionOption {
  label: string;
  description?: string;
}

/**
 * Question event when agent asks user for input.
 */
export interface QuestionEvent {
  type: 'question';
  question: string;
  isConfirmation: boolean;
  /** Options for multiple choice questions (max 4, last should allow custom input) */
  options?: QuestionOption[];
  data?: Record<string, unknown>;
  /** Auto-approve timeout in milliseconds (for countdown display) */
  autoApproveTimeoutMs?: number;
  /** Context content to display with the question (e.g., image prompt being approved) */
  context?: string;
}

/**
 * Agent status event for lifecycle changes.
 */
export interface AgentStatusEvent {
  type: 'agent_status';
  status: 'started' | 'thinking' | 'waiting' | 'completed' | 'error' | 'interrupted';
  agentName?: string;
}

/**
 * User input injected event when user provides input during execution.
 */
export interface UserInputInjectedEvent {
  type: 'user_input_injected';
  input: string;
  agentName?: string;
}

/**
 * Phase transition event when workflow transitions to a new phase.
 */
export interface PhaseTransitionEvent {
  type: 'phase_transition';
  fromPhase: string;
  toPhase: string;
  displayName?: string;
  description?: string;
}

/**
 * Union of all agent events.
 */
export type AgentEvent =
  | ProgressEvent
  | ToolCallEvent
  | ToolResultEvent
  | TodoUpdateEvent
  | AgentTextEvent
  | StreamingTextEvent
  | ToolStreamingEvent
  | NotificationEvent
  | QuestionEvent
  | AgentStatusEvent
  | UserInputInjectedEvent
  | PhaseTransitionEvent;

/**
 * Event type names for type-safe event handling.
 */
export type AgentEventType = AgentEvent['type'];
