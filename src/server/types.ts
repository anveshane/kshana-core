/**
 * WebSocket message types for kshana-ink server.
 * Follows the same pattern as the Python kshana project.
 */

/**
 * Message types sent from server to client.
 */
export type ServerMessageType =
  | 'status'           // Connection/session status
  | 'progress'         // Agent progress updates
  | 'agent_response'   // Final agent response
  | 'agent_question'   // Agent asking user a question
  | 'tool_call'        // Tool execution notification
  | 'todo_update'      // Todo list changes
  | 'stream_chunk'     // Streaming text chunk
  | 'stream_end'       // End of streaming
  | 'context_usage'    // Context window usage stats
  | 'phase_transition' // Workflow phase change
  | 'notification'     // User-facing notification
  | 'error';           // Error message

/**
 * Message types sent from client to server.
 */
export type ClientMessageType =
  | 'start_task'       // Start a new task
  | 'user_response'    // Response to agent question
  | 'cancel'           // Cancel current task
  | 'select_project'   // Select active project
  | 'create_project'   // Create a new project
  | 'ping';            // Keep-alive ping

/**
 * Base message structure for server messages.
 */
export interface ServerMessage<T = unknown> {
  type: ServerMessageType;
  sessionId: string;
  timestamp: number;
  data: T;
}

/**
 * Base message structure for client messages.
 */
export interface ClientMessage<T = unknown> {
  type: ClientMessageType;
  sessionId?: string;  // Optional for new sessions
  data: T;
}

/**
 * Status message data.
 */
export interface StatusData {
  status: 'connected' | 'ready' | 'busy' | 'completed' | 'error';
  message?: string;
}

/**
 * Progress message data.
 */
export interface ProgressData {
  iteration: number;
  maxIterations: number;
  status: string;
}

/**
 * Agent response message data.
 */
export interface AgentResponseData {
  output: string;
  status: 'completed' | 'awaiting_input' | 'error' | 'max_iterations';
}

/**
 * Agent question message data.
 */
export interface AgentQuestionData {
  question: string;
  toolCallId: string;
  options?: Array<{ label: string; description?: string }>;
  isConfirmation?: boolean;
  autoApproveTimeoutMs?: number;
}

/**
 * Tool call message data.
 */
export interface ToolCallData {
  toolName: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
  status: 'started' | 'completed' | 'error';
  result?: unknown;
  error?: string;
  agentName?: string;  // Which agent made this call (e.g., "Content Agent", "Orchestrator")
}

/**
 * Todo update message data.
 */
export interface TodoUpdateData {
  todos: Array<{
    id: string;
    task: string;
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    depth: number;
    hasSubtasks: boolean;
    parentId?: string;
  }>;
}

/**
 * Stream chunk message data.
 */
export interface StreamChunkData {
  content: string;
  done: boolean;
  agentName?: string;  // Which agent is streaming (e.g., "Content Agent", "Orchestrator")
  toolCallId?: string; // For tool streaming, the associated tool call
  toolName?: string;   // For tool streaming, the tool name
  reset?: boolean;     // Reset streaming content before appending
}

/**
 * Error message data.
 */
export interface ErrorData {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Context usage message data.
 */
export interface ContextUsageData {
  promptTokens: number;
  maxTokens: number;
  percentage: number;
  wasCompressed: boolean;
  iteration: number;
}

/**
 * Phase transition message data.
 */
export interface PhaseTransitionData {
  fromPhase: string;
  toPhase: string;
  displayName?: string;
  description?: string;
}

/**
 * Notification message data.
 */
export interface NotificationData {
  level: 'info' | 'warning' | 'error';
  message: string;
}

/**
 * Select project client message data.
 */
export interface SelectProjectData {
  projectName: string;
}

/**
 * Create project client message data.
 */
export interface CreateProjectData {
  title: string;
  templateId: string;
  style: string;
  duration: number;
  content: string;
}

/**
 * Start task client message data.
 */
export interface StartTaskData {
  task: string;
  options?: {
    maxIterations?: number;
    temperature?: number;
  };
}

/**
 * User response client message data.
 */
export interface UserResponseData {
  response: string;
  toolCallId?: string;
}

/**
 * Session state for tracking active conversations.
 */
export interface SessionState {
  id: string;
  createdAt: number;
  lastActivity: number;
  status: 'idle' | 'running' | 'awaiting_input' | 'completed' | 'error';
  taskHistory: string[];
}

/**
 * Helper type guards.
 */
export function isStartTaskMessage(msg: ClientMessage): msg is ClientMessage<StartTaskData> {
  return msg.type === 'start_task';
}

export function isUserResponseMessage(msg: ClientMessage): msg is ClientMessage<UserResponseData> {
  return msg.type === 'user_response';
}

export function isCancelMessage(msg: ClientMessage): msg is ClientMessage<void> {
  return msg.type === 'cancel';
}

export function isPingMessage(msg: ClientMessage): msg is ClientMessage<void> {
  return msg.type === 'ping';
}

export function isSelectProjectMessage(msg: ClientMessage): msg is ClientMessage<SelectProjectData> {
  return msg.type === 'select_project';
}

export function isCreateProjectMessage(msg: ClientMessage): msg is ClientMessage<CreateProjectData> {
  return msg.type === 'create_project';
}

/**
 * Create a server message.
 */
export function createServerMessage<T>(
  type: ServerMessageType,
  sessionId: string,
  data: T
): ServerMessage<T> {
  return {
    type,
    sessionId,
    timestamp: Date.now(),
    data,
  };
}
