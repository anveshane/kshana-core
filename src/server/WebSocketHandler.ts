/**
 * WebSocket handler for real-time agent communication.
 */
import type { WebSocket } from '@fastify/websocket';
import { join } from 'path';
import { ConversationManager, type ConversationEvents } from './ConversationManager.js';
import { LocalFileSystem } from '../core/fs/LocalFileSystem.js';
import { RemoteClientFileSystem } from '../core/fs/RemoteClientFileSystem.js';
import { ProjectStateCache, type ProjectSnapshot } from '../core/fs/ProjectStateCache.js';
import { ApiKeyAuth, shouldSkipAuth } from './auth.js';
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
  type ContextUsageData,
  type UsageFactData,
  type PhaseTransitionData,
  type NotificationData,
  type SessionTimerData,
  type ErrorData,
  type StartTaskData,
  type UserResponseData,
  createServerMessage,
  isStartTaskMessage,
  isUserResponseMessage,
  isCancelMessage,
  isPingMessage,
  isConfigureProjectMessage,
  isSelectProjectMessage,
  isCreateProjectMessage,
  isTimelineAssemblyProgressMessage,
  isTimelineAssemblyResultMessage,
  type ConfigureProjectData,
  type CreateProjectData,
} from './types.js';
import {
  getDisconnectionCategory,
  getConnectionStatusMessage,
  shouldRemoveTrackedConnection,
} from './webSocketHandlerUtils.js';
import {
  desktopAssemblyBroker,
  type DesktopSessionCapabilities,
} from '../core/remote/DesktopAssemblyBroker.js';

interface ConnectionState {
  socket: WebSocket;
  sessionId: string;
  isAlive: boolean;
  mode: 'local' | 'remote';
  clientId?: string;
  remoteFs?: RemoteClientFileSystem;
  projectCache?: ProjectStateCache;
}

export type ServerMode = 'local' | 'remote' | 'auto';

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
  private serverMode: ServerMode;
  private auth: ApiKeyAuth | null;

  constructor(
    conversationManager: ConversationManager,
    options?: { serverMode?: ServerMode; auth?: ApiKeyAuth },
  ) {
    this.conversationManager = conversationManager;
    this.serverMode = options?.serverMode ?? 'auto';
    this.auth = options?.auth ?? null;

    // Start heartbeat interval
    this.heartbeatInterval = setInterval(() => this.checkHeartbeats(), 30000);
  }

  /**
   * Handle a new WebSocket connection.
   * Optionally authenticates via API key and determines connection mode.
   */
  handleConnection(
    socket: WebSocket,
    remoteAddress?: string,
    apiKey?: string,
    resumeSessionId?: string,
    desktopCapabilities?: DesktopSessionCapabilities,
  ): void {
    // Determine connection mode
    const skipAuth = shouldSkipAuth(remoteAddress, this.serverMode);
    let connectionMode: 'local' | 'remote' = 'local';
    let clientId: string | undefined;

    if (!skipAuth) {
      // Remote mode: require authentication
      if (this.auth && this.auth.isConfigured()) {
        if (!apiKey) {
          socket.close(4001, 'API key required');
          return;
        }
        const entry = this.auth.validate(apiKey);
        if (!entry) {
          socket.close(4003, 'Invalid API key');
          return;
        }
        clientId = entry.clientId;
      }
      connectionMode = 'remote';
    }

    let projectCache: ProjectStateCache | undefined;
    let remoteFs: RemoteClientFileSystem | undefined;
    if (connectionMode === 'remote') {
      projectCache = new ProjectStateCache();
      remoteFs = new RemoteClientFileSystem(socket, projectCache);
    }

    // Try to resume an existing session (e.g. after browser reconnect)
    let sessionId: string;
    let resumedSession = false;
    if (resumeSessionId && this.conversationManager.getSession(resumeSessionId)) {
      sessionId = resumeSessionId;
      resumedSession = true;
      this.conversationManager.touchSession(sessionId);
      // Close any stale connection for this session
      const oldConn = this.connections.get(sessionId);
      if (oldConn) {
        console.info(`[WebSocketHandler] Replacing stale socket for resumed session ${sessionId}`);
        try { oldConn.socket.close(1000, 'session_resumed_elsewhere'); } catch { /* ignore */ }
        this.connections.delete(sessionId);
      }
    } else {
      // Create new session
      const session = this.conversationManager.createSession(connectionMode, remoteFs);
      sessionId = session.id;
    }

    const connectionState: ConnectionState = {
      socket,
      sessionId,
      isAlive: true,
      mode: connectionMode,
      clientId,
    };

    // For remote connections, set up the remote filesystem
    if (connectionMode === 'remote' && remoteFs && projectCache) {
      connectionState.remoteFs = remoteFs;
      connectionState.projectCache = projectCache;
      this.conversationManager.setRemoteFileSystem(sessionId, remoteFs);
      if (desktopCapabilities) {
        this.conversationManager.setDesktopCapabilities(sessionId, desktopCapabilities);
        desktopAssemblyBroker.setCapabilities(sessionId, desktopCapabilities);
      }
      desktopAssemblyBroker.attachSender(sessionId, (type, data) => {
        this.sendMessage(socket, createServerMessage(type, sessionId, data));
      });
    }

    this.connections.set(sessionId, connectionState);

    // Send connected status
    this.sendMessage(socket, createServerMessage<StatusData>('status', sessionId, {
      status: 'connected',
      message: getConnectionStatusMessage(connectionMode, resumedSession),
    }));

    // Set up message handler
    socket.on('message', async (data) => {
      connectionState.isAlive = true;
      this.conversationManager.touchSession(sessionId);
      await this.handleMessage(sessionId, socket, data.toString());
    });

    // Set up close handler
    socket.on('close', (code, reasonBuffer) => {
      const reason = reasonBuffer.toString();
      this.handleDisconnection(
        sessionId,
        socket,
        `socket_close:${code}${reason ? `:${reason}` : ''}`,
      );
    });

    // Set up error handler
    socket.on('error', (error) => {
      console.error(`WebSocket error for session ${sessionId}:`, error);
      this.sendError(socket, sessionId, 'websocket_error', error.message);
    });

    // Set up pong handler for heartbeat
    socket.on('pong', () => {
      connectionState.isAlive = true;
      this.conversationManager.touchSession(sessionId);
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

    if (isConfigureProjectMessage(message)) {
      await this.handleConfigureProject(sessionId, socket, message.data);
      return;
    }

    if (isSelectProjectMessage(message)) {
      await this.handleSelectProject(sessionId, socket, message.data.projectName);
      return;
    }

    if (isCreateProjectMessage(message)) {
      await this.handleCreateProject(sessionId, socket, message.data);
      return;
    }

    if (isTimelineAssemblyProgressMessage(message)) {
      desktopAssemblyBroker.handleTimelineAssemblyProgress(sessionId, message.data);
      return;
    }

    if (isTimelineAssemblyResultMessage(message)) {
      desktopAssemblyBroker.handleTimelineAssemblyResult(sessionId, message.data);
      return;
    }

    // Handle autonomous mode toggle
    if (message.type === 'set_autonomous') {
      const enabled = (message.data as { enabled: boolean }).enabled;
      this.conversationManager.setAutonomousMode(sessionId, enabled);
      return;
    }

    // Handle project_state_sync from remote clients
    if (message.type === 'project_state_sync') {
      this.handleProjectStateSync(sessionId, message.data as import('./types.js').ProjectStateSyncData);
      return;
    }

    // File response messages from remote clients are handled by RemoteClientFileSystem
    // (via its socket.on('message') listener), so we don't process them here.
    const fileResponseTypes = [
      'file_read_response', 'file_write_ack', 'file_list_response',
      'file_exists_response', 'file_stat_response', 'file_buffer_response',
    ];
    if (fileResponseTypes.includes(message.type)) {
      // Already handled by RemoteClientFileSystem's message listener
      return;
    }

    this.sendError(socket, sessionId, 'unknown_message_type', `Unknown message type: ${message.type}`);
  }

  /**
   * Handle configure_project message.
   */
  private async handleConfigureProject(
    sessionId: string,
    socket: WebSocket,
    data: ConfigureProjectData,
  ): Promise<void> {
    this.conversationManager.configureSessionForProject(
      sessionId,
      data.templateId,
      data.style,
      data.duration,
      data.projectDir,
      undefined,
      data.autonomousMode,
    );
    await this.conversationManager.ensureRemoteProjectJsonCached(sessionId);
    this.conversationManager.persistProjectConfiguration(sessionId, {
      templateId: data.templateId,
      style: data.style,
      duration: data.duration,
      autonomousMode: data.autonomousMode,
    });

    const toolNames = this.conversationManager.getSessionToolNames(sessionId);
    this.sendMessage(socket, createServerMessage<StatusData>('status', sessionId, {
      status: 'ready',
      message: `Project configured: ${data.projectName ?? data.projectDir}`,
      tools: toolNames,
      projectName: data.projectName,
    }));
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

    // Notify UI that timer is running
    this.sendTimerUpdate(socket, sessionId, true);

    try {
      const result = await this.conversationManager.runTask(sessionId, data.task, events);

      // Notify UI that timer stopped
      this.sendTimerUpdate(socket, sessionId, false);

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
      // Notify UI that timer stopped on error
      this.sendTimerUpdate(socket, sessionId, false);
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

    // Notify UI that timer is running
    this.sendTimerUpdate(socket, sessionId, true);

    try {
      const result = await this.conversationManager.sendResponse(sessionId, data.response, events);

      // Notify UI that timer stopped
      this.sendTimerUpdate(socket, sessionId, false);

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
      // Notify UI that timer stopped on error
      this.sendTimerUpdate(socket, sessionId, false);
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
   * Handle select_project message.
   * Reads project.json using LocalFileSystem (async) and configures the session.
   */
  private async handleSelectProject(
    sessionId: string,
    socket: WebSocket,
    projectName: string,
  ): Promise<void> {
    const projectDirName = `${projectName}.kshana`;
    const projectFile = join(process.cwd(), projectDirName, 'project.json');

    // Read project.json to get templateId, style, duration, and timing
    let templateId = 'narrative';
    let style = 'anime';
    let duration = 60;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let projectData: any = null;

    const localFs = new LocalFileSystem();
    if (await localFs.exists(projectFile)) {
      try {
        const content = await localFs.readFile(projectFile);
        projectData = JSON.parse(content);
        templateId = projectData.templateId || templateId;
        style = projectData.style || style;
        duration =
          typeof projectData.targetDuration === 'number'
            ? projectData.targetDuration
            : projectData.duration || duration;
      } catch {
        // Use defaults if project.json is unreadable
      }
    }

    // Reconfigure agent with correct tools and prompt for this project
    this.conversationManager.configureSessionForProject(
      sessionId,
      templateId,
      style,
      duration,
      projectDirName,
    );

    // Include the list of tools the agent was initialized with
    const toolNames = this.conversationManager.getSessionToolNames(sessionId);

    this.sendMessage(socket, createServerMessage<StatusData>('status', sessionId, {
      status: 'ready',
      message: `Project set to ${projectName}`,
      tools: toolNames,
    }));

    // Send session timer — recover elapsed time from project
    if (projectData) {
      try {
        const { recoverTimer } = await import('../tasks/video/workflow/ProjectManager.js');
        const elapsedMs = recoverTimer();
        this.sendMessage(socket, createServerMessage<SessionTimerData>('session_timer', sessionId, {
          elapsedMs,
          running: false,
          completed: !!projectData.productionCompletedAt,
        }));
      } catch { /* ignore */ }
    }
  }

  /**
   * Handle project_state_sync from a remote client.
   * Loads the project snapshot into the session's cache.
   */
  private handleProjectStateSync(
    sessionId: string,
    data: import('./types.js').ProjectStateSyncData,
  ): void {
    const connection = this.connections.get(sessionId);
    if (!connection || connection.mode !== 'remote') {
      return;
    }

    if (connection.projectCache) {
      connection.projectCache.loadSnapshot({
        files: data.files,
        directories: data.directories,
        assetHashes: data.assetHashes,
        projectRoot: data.projectRoot,
      });
    }
  }

  /**
   * Handle create_project message.
   */
  private async handleCreateProject(
    sessionId: string,
    socket: WebSocket,
    data: CreateProjectData
  ): Promise<void> {
    try {
      // Dynamically import to avoid circular deps
      const { createProject, inferProjectDirName } = await import('../tasks/video/workflow/index.js');

      // Infer the dir name the same way createProject does
      const projectDirName = inferProjectDirName(data.content);

      // Create the project on disk
      createProject(data.content, data.style, undefined, data.duration, data.templateId);

      // Configure the session agent for this project
      this.conversationManager.configureSessionForProject(
        sessionId,
        data.templateId,
        data.style,
        data.duration,
        projectDirName,
        (data as { providerConfig?: Record<string, string> }).providerConfig,
        data.autonomousMode,
      );

      this.conversationManager.persistProjectConfiguration(sessionId, {
        templateId: data.templateId,
        style: data.style,
        duration: data.duration,
        autonomousMode: data.autonomousMode,
      });

      const toolNames = this.conversationManager.getSessionToolNames(sessionId);
      const projectName = projectDirName.replace('.kshana', '');
      this.sendMessage(socket, createServerMessage<StatusData>('status', sessionId, {
        status: 'ready',
        message: `Project "${data.title}" created`,
        tools: toolNames,
        projectName,
      }));

      // Send session timer — new project starts at 0
      this.sendMessage(socket, createServerMessage<SessionTimerData>('session_timer', sessionId, {
        elapsedMs: 0,
        running: false,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendError(socket, sessionId, 'create_project_error', errorMessage);
    }
  }

  /**
   * Handle disconnection.
   * Only removes the WebSocket connection — the session is kept alive
   * so the browser can reconnect and resume (e.g. after network blips).
   * The session will be cleaned up by the ConversationManager's stale-session timer.
   */
  private handleDisconnection(sessionId: string, socket: WebSocket, reason: string): void {
    const tracked = this.connections.get(sessionId);
    const category = getDisconnectionCategory(reason);
    if (!shouldRemoveTrackedConnection(tracked?.socket, socket)) {
      console.info(
        `[WebSocketHandler] Ignoring disconnection for stale socket session=${sessionId} category=${category} reason=${reason}`,
      );
      return;
    }

    console.info(
      `[WebSocketHandler] Removing connection session=${sessionId} category=${category} reason=${reason}`,
    );
    this.connections.delete(sessionId);
    desktopAssemblyBroker.detachSession(sessionId);
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

      onToolCall: (sid, toolCallId, toolName, args, agentName) => {
        this.sendMessage(socket, createServerMessage<ToolCallData>('tool_call', sid, {
          toolName,
          toolCallId,
          arguments: args,
          status: 'started',
          agentName,
        }));
      },

      onToolResult: (sid, toolCallId, toolName, result, isError, agentName) => {
        const errorMessage =
          typeof result === 'string'
            ? result
            : (
              typeof result === 'object' &&
              result !== null &&
              'error' in result &&
              typeof (result as { error?: unknown }).error === 'string'
            )
              ? (result as { error: string }).error
              : String(result);
        this.sendMessage(socket, createServerMessage<ToolCallData>('tool_call', sid, {
          toolName,
          toolCallId,
          arguments: {},
          status: isError ? 'error' : 'completed',
          ...(isError
            ? { error: errorMessage }
            : { result }),
          agentName,
        }));

        // When set_goal completes, send timer update (accumulated time, agent still running)
        if (toolName === 'set_goal') {
          try {
            import('../tasks/video/workflow/ProjectManager.js').then(({ getElapsedMs }) => {
              this.sendMessage(socket, createServerMessage<SessionTimerData>('session_timer', sid, {
                elapsedMs: getElapsedMs(),
                running: true,
              }));
            });
          } catch { /* ignore */ }
        }

        // Check if production completed (final video stitched) and send timer update
        if (toolName === 'assemble_from_timeline') {
          try {
            import('../tasks/video/workflow/ProjectManager.js').then(({ getElapsedMs, loadProject }) => {
              const project = loadProject();
              if (project?.productionCompletedAt) {
                this.sendMessage(socket, createServerMessage<SessionTimerData>('session_timer', sid, {
                  elapsedMs: getElapsedMs(),
                  running: false,
                  completed: true,
                }));
              }
            });
          } catch { /* ignore */ }
        }
      },

      onStreamingText: (sid, chunk, done) => {
        this.sendMessage(socket, createServerMessage<StreamChunkData>('stream_chunk', sid, {
          content: chunk,
          done,
        }));
      },

      onToolStreaming: (sid, toolCallId, chunk, done, agentName, toolName, reset) => {
        this.sendMessage(socket, createServerMessage<StreamChunkData>('stream_chunk', sid, {
          content: chunk,
          done,
          agentName,
          toolCallId,
          toolName,
          reset,
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
        this.sendMessage(socket, createServerMessage<StreamChunkData>('stream_chunk', sid, {
          content: text,
          done: isFinal ?? false,
        }));
      },

      onQuestion: (sid, question, isConfirmation, options, autoApproveTimeoutMs) => {
        this.sendMessage(socket, createServerMessage<AgentQuestionData>('agent_question', sid, {
          question,
          toolCallId: isConfirmation ? 'confirmation' : '',
          options,
          isConfirmation,
          autoApproveTimeoutMs,
        }));
      },

      onContextUsage: (sid, data) => {
        this.sendMessage(socket, createServerMessage<ContextUsageData>('context_usage', sid, data));
      },

      onUsageFact: (sid, data) => {
        this.sendMessage(socket, createServerMessage<UsageFactData>('usage_fact', sid, data));
      },

      onPhaseTransition: (sid, data) => {
        this.sendMessage(socket, createServerMessage<PhaseTransitionData>('phase_transition', sid, data));
        // Check if production completed (final video stitched) and send timer update
        try {
          import('../tasks/video/workflow/ProjectManager.js').then(({ getElapsedMs, loadProject }) => {
            const project = loadProject();
            if (project?.productionCompletedAt) {
              this.sendMessage(socket, createServerMessage<SessionTimerData>('session_timer', sid, {
                elapsedMs: getElapsedMs(),
                running: false,
                completed: true,
              }));
            }
          });
        } catch { /* ignore */ }
      },

      onNotification: (sid, data) => {
        this.sendMessage(socket, createServerMessage<NotificationData>('notification', sid, data));
      },
    };
  }

  /**
   * Send a timer update to the client.
   * Reads current elapsedMs from the project and sends the new-format timer message.
   */
  private sendTimerUpdate(socket: WebSocket, sessionId: string, running: boolean): void {
    try {
      // Dynamic import to avoid circular deps — synchronous require fallback for speed
      import('../tasks/video/workflow/ProjectManager.js').then(({ getElapsedMs, loadProject }) => {
        const project = loadProject();
        const elapsedMs = getElapsedMs();
        this.sendMessage(socket, createServerMessage<SessionTimerData>('session_timer', sessionId, {
          elapsedMs,
          running,
          completed: !running && !!project?.productionCompletedAt,
        }));
      });
    } catch { /* ignore */ }
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
        this.handleDisconnection(sessionId, state.socket, 'heartbeat_timeout');
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
      this.handleDisconnection(sessionId, state.socket, 'server_shutdown');
    }
  }
}
