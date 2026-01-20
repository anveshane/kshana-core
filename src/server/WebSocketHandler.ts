/**
 * WebSocket handler for real-time agent communication.
 */
import type { WebSocket } from '@fastify/websocket';
import { ConversationManager, type ConversationEvents } from './ConversationManager.js';
import type { ExpandableTodoItem } from '../core/todo/index.js';
import type { AgentStatus } from '../core/agent/index.js';
import {
  type ClientMessage,
  type ServerMessage,
  type StatusData,
  type ProgressData,
  type AgentResponseData,
  type AgentQuestionData,
  type ToolCallData,
  type TodoUpdateData,
  type StreamChunkData,
  type ErrorData,
  type StartTaskData,
  type UserResponseData,
  createServerMessage,
  isStartTaskMessage,
  isUserResponseMessage,
  isCancelMessage,
  isPingMessage,
} from './types.js';

interface ConnectionState {
  socket: WebSocket;
  sessionId: string;
  isAlive: boolean;
}

/**
 * Map AgentStatus to the response status type.
 */
function mapAgentStatus(status: AgentStatus): AgentResponseData['status'] {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'waiting_for_user':
      return 'awaiting_input';
    case 'error':
    case 'interrupted':
      return 'error';
    default:
      return 'error';
  }
}

export class WebSocketHandler {
  private conversationManager: ConversationManager;
  private connections = new Map<string, ConnectionState>();
  private heartbeatInterval?: ReturnType<typeof setInterval>;

  constructor(conversationManager: ConversationManager) {
    this.conversationManager = conversationManager;

    // Start heartbeat interval
    this.heartbeatInterval = setInterval(() => this.checkHeartbeats(), 30000);
  }

  /**
   * Handle a new WebSocket connection.
   * @param socket - The WebSocket connection
   * @param request - The Fastify request object (for accessing query parameters)
   */
  async handleConnection(socket: WebSocket, request?: { query?: { project_dir?: string } }): Promise<void> {
    // Extract project_dir from query parameters if available
    const projectDir = request?.query?.project_dir;
    
    console.log('[WebSocketHandler] New connection:', {
      hasRequest: !!request,
      hasQuery: !!request?.query,
      projectDir,
      queryKeys: request?.query ? Object.keys(request.query) : [],
    });
    
    // Create a new session for this connection with project directory
    const session = await this.conversationManager.createSession(projectDir);
    const sessionId = session.id;

    const connectionState: ConnectionState = {
      socket,
      sessionId,
      isAlive: true,
    };

    this.connections.set(sessionId, connectionState);

    // Send connected status
    this.sendMessage(socket, createServerMessage<StatusData>('status', sessionId, {
      status: 'connected',
      message: 'Session created successfully',
    }));

    // Set up message handler
    socket.on('message', async (data) => {
      connectionState.isAlive = true;
      await this.handleMessage(sessionId, socket, data.toString());
    });

    // Set up close handler
    socket.on('close', () => {
      this.handleDisconnection(sessionId);
    });

    // Set up error handler
    socket.on('error', (error) => {
      console.error(`WebSocket error for session ${sessionId}:`, error);
      this.sendError(socket, sessionId, 'websocket_error', error.message);
    });

    // Set up pong handler for heartbeat
    socket.on('pong', () => {
      connectionState.isAlive = true;
    });
  }

  /**
   * Handle an incoming message.
   */
  private async handleMessage(
    sessionId: string,
    socket: WebSocket,
    rawData: string
  ): Promise<void> {
    let message: ClientMessage;

    try {
      message = JSON.parse(rawData) as ClientMessage;
    } catch {
      this.sendError(socket, sessionId, 'invalid_json', 'Could not parse message as JSON');
      return;
    }

    // Handle different message types
    if (isPingMessage(message)) {
      // Respond with pong (status message)
      this.sendMessage(socket, createServerMessage<StatusData>('status', sessionId, {
        status: 'ready',
        message: 'pong',
      }));
      return;
    }

    if (isStartTaskMessage(message)) {
      await this.handleStartTask(sessionId, socket, message.data);
      return;
    }

    if (isUserResponseMessage(message)) {
      await this.handleUserResponse(sessionId, socket, message.data);
      return;
    }

    if (isCancelMessage(message)) {
      this.handleCancel(sessionId, socket);
      return;
    }

    this.sendError(socket, sessionId, 'unknown_message_type', `Unknown message type: ${message.type}`);
  }

  /**
   * Handle start_task message.
   */
  private async handleStartTask(
    sessionId: string,
    socket: WebSocket,
    data: StartTaskData
  ): Promise<void> {
    // Send busy status
    this.sendMessage(socket, createServerMessage<StatusData>('status', sessionId, {
      status: 'busy',
      message: 'Processing task...',
    }));

    // Create event handlers
    const events = this.createEventHandlers(sessionId, socket);

    try {
      const result = await this.conversationManager.runTask(sessionId, data.task, events);

      // Send final response
      this.sendMessage(socket, createServerMessage<AgentResponseData>('agent_response', sessionId, {
        output: result.output,
        status: mapAgentStatus(result.status),
      }));

      // Send completed status if not awaiting input
      if (result.status !== 'waiting_for_user') {
        this.sendMessage(socket, createServerMessage<StatusData>('status', sessionId, {
          status: 'completed',
          message: 'Task completed',
        }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendError(socket, sessionId, 'task_error', errorMessage);
    }
  }

  /**
   * Handle user_response message.
   */
  private async handleUserResponse(
    sessionId: string,
    socket: WebSocket,
    data: UserResponseData
  ): Promise<void> {
    // Send busy status
    this.sendMessage(socket, createServerMessage<StatusData>('status', sessionId, {
      status: 'busy',
      message: 'Processing response...',
    }));

    // Create event handlers
    const events = this.createEventHandlers(sessionId, socket);

    try {
      const result = await this.conversationManager.sendResponse(sessionId, data.response, events);

      // Send final response
      this.sendMessage(socket, createServerMessage<AgentResponseData>('agent_response', sessionId, {
        output: result.output,
        status: mapAgentStatus(result.status),
      }));

      // Send completed status if not awaiting input
      if (result.status !== 'waiting_for_user') {
        this.sendMessage(socket, createServerMessage<StatusData>('status', sessionId, {
          status: 'completed',
          message: 'Task completed',
        }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendError(socket, sessionId, 'response_error', errorMessage);
    }
  }

  /**
   * Handle cancel message.
   */
  private handleCancel(sessionId: string, socket: WebSocket): void {
    const cancelled = this.conversationManager.cancelTask(sessionId);

    if (cancelled) {
      this.sendMessage(socket, createServerMessage<StatusData>('status', sessionId, {
        status: 'ready',
        message: 'Task cancelled',
      }));
    } else {
      this.sendError(socket, sessionId, 'cancel_failed', 'No running task to cancel');
    }
  }

  /**
   * Handle disconnection.
   */
  private handleDisconnection(sessionId: string): void {
    // Cancel any running tasks and clean up
    this.conversationManager.deleteSession(sessionId);
    this.connections.delete(sessionId);
  }

  /**
   * Create event handlers for agent events.
   */
  private createEventHandlers(sessionId: string, socket: WebSocket): ConversationEvents {
    return {
      onProgress: (sid, percentage, message) => {
        this.sendMessage(socket, createServerMessage<ProgressData>('progress', sid, {
          iteration: Math.round(percentage),
          maxIterations: 100,
          status: message,
        }));
      },

      onToolCall: (sid, toolName, args) => {
        this.sendMessage(socket, createServerMessage<ToolCallData>('tool_call', sid, {
          toolName,
          toolCallId: '',
          arguments: args,
          status: 'started',
        }));
      },

      onToolResult: (sid, toolName, result) => {
        this.sendMessage(socket, createServerMessage<ToolCallData>('tool_call', sid, {
          toolName,
          toolCallId: '',
          arguments: {},
          status: 'completed',
          result,
        }));
      },

      onTodoUpdate: (sid, todos: ExpandableTodoItem[]) => {
        this.sendMessage(socket, createServerMessage<TodoUpdateData>('todo_update', sid, {
          todos: todos.map((t) => ({
            id: t.id,
            task: t.content, // ExpandableTodoItem uses 'content' not 'task'
            status: t.status === 'expanded' ? 'completed' : t.status as 'pending' | 'in_progress' | 'completed' | 'cancelled',
            depth: t.depth,
            hasSubtasks: false, // Current implementation doesn't track subtasks as property
          })),
        }));
      },

      onAgentText: (sid, text, isFinal) => {
        console.log('[WebSocketHandler] onAgentText called:', { sessionId: sid, textLength: text?.length ?? 0, isFinal });
        this.sendMessage(socket, createServerMessage<StreamChunkData>('stream_chunk', sid, {
          content: text,
          done: isFinal ?? false,
        }));
      },

      onQuestion: (sid, question, isConfirmation) => {
        this.sendMessage(socket, createServerMessage<AgentQuestionData>('agent_question', sid, {
          question,
          toolCallId: isConfirmation ? 'confirmation' : '',
        }));
      },

      onAgentStatus: (sid, status, agentName) => {
        // Map agent status to status message format
        let statusType: StatusData['status'];
        let message: string;
        
        switch (status) {
          case 'started':
          case 'thinking':
            statusType = 'busy';
            message = status === 'started' ? 'Starting...' : 'Thinking...';
            break;
          case 'waiting':
          case 'waiting_for_user':
            statusType = 'ready';
            message = 'Waiting for input...';
            break;
          case 'completed':
            statusType = 'completed';
            message = 'Task completed';
            break;
          case 'error':
          case 'interrupted':
            statusType = 'error';
            message = status === 'interrupted' ? 'Interrupted' : 'Error occurred';
            break;
          default:
            statusType = 'busy';
            message = 'Processing...';
        }
        
        this.sendMessage(socket, createServerMessage<StatusData>('status', sid, {
          status: statusType,
          message,
          agentName, // Include agent name if available
        }));
      },
    };
  }

  /**
   * Send a message to a WebSocket.
   */
  private sendMessage<T>(socket: WebSocket, message: ServerMessage<T>): void {
    if (socket.readyState === 1) { // WebSocket.OPEN
      socket.send(JSON.stringify(message));
    }
  }

  /**
   * Send an error message.
   */
  private sendError(
    socket: WebSocket,
    sessionId: string,
    code: string,
    message: string,
    details?: unknown
  ): void {
    this.sendMessage(socket, createServerMessage<ErrorData>('error', sessionId, {
      code,
      message,
      details,
    }));
  }

  /**
   * Check heartbeats and terminate dead connections.
   */
  private checkHeartbeats(): void {
    for (const [sessionId, state] of this.connections) {
      if (!state.isAlive) {
        // Connection is dead, terminate it
        state.socket.terminate();
        this.handleDisconnection(sessionId);
      } else {
        // Mark as not alive and send ping
        state.isAlive = false;
        state.socket.ping();
      }
    }
  }

  /**
   * Shutdown the handler.
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all connections
    for (const [sessionId, state] of this.connections) {
      state.socket.close(1001, 'Server shutting down');
      this.handleDisconnection(sessionId);
    }
  }
}
