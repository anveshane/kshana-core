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
  | 'asset_added'      // Asset added to manifest
  | 'background_generation' // Background generation batch lifecycle event
  | 'error';           // Error message

/**
 * Message types sent from client to server.
 */
export type ClientMessageType =
  | 'start_task'       // Start a new task
  | 'user_response'    // Response to agent question
  | 'cancel'           // Cancel current task
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
  agentName?: string;
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
}

/**
 * Asset added message data.
 */
export interface AssetAddedData {
  assetId: string;
  assetType: 'scene_image' | 'scene_video' | 'scene_infographic' | 'character_ref' | 'setting_ref' | 'final_video';
  placementNumber?: number;
  sceneNumber?: number;
  path: string;
  version: number;
}

/**
 * Background generation lifecycle event data.
 */
export interface BackgroundGenerationData {
  batchId: string;
  kind: 'image' | 'video';
  status: 'queued' | 'running' | 'completed' | 'failed';
  phase: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  projectDirectory: string;
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
