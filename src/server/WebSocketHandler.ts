/**
 * WebSocket handler for real-time agent communication.
 */
import type { WebSocket } from '@fastify/websocket';
import { v4 as uuidv4 } from 'uuid';
import { ConversationManager, type ConversationEvents } from './ConversationManager.js';
import type { ExpandableTodoItem } from '../core/todo/index.js';
import type { GenericAgentResult } from '../core/agent/index.js';
import {
  type ClientMessage,
  type ServerMessage,
  type ServerMessageType,
  type StatusData,
  type ProgressData,
  type AgentResponseData,
  type AgentQuestionData,
  type ToolCallData,
  type TodoUpdateData,
  type StreamChunkData,
  type AssetAddedData,
  type BackgroundGenerationData,
  type ErrorData,
  type StartTaskData,
  type CancelData,
  type UserResponseData,
  type FileSyncRequestData,
  type FileSyncInitData,
  createServerMessage,
  isStartTaskMessage,
  isUserResponseMessage,
  isCancelMessage,
  isPingMessage,
  isFileSyncInitMessage,
} from './types.js';
import { getProjectFileOps } from './ProjectFileOps.js';
import {
  assetEventEmitter,
  type AssetAddedEvent,
  type BackgroundGenerationEvent,
} from './assetEventEmitter.js';

interface ConnectionState {
  socket: WebSocket;
  sessionId: string;
  isAlive: boolean;
  channel: 'chat' | 'assets';
  projectDir?: string;
  fileSyncDone: boolean;
  fileSyncPromise: Promise<void>;
  resolveFileSync: () => void;
  sessionReady: Promise<void>;
  resolveSessionReady: () => void;
}

interface DetachedSessionState {
  sessionId: string;
  channel: 'chat' | 'assets';
  projectDir?: string;
  detachedAt: number;
  expiresAt: number;
  ttlTimer: ReturnType<typeof setTimeout>;
  queuedEvents: Array<ServerMessage<unknown>>;
}

/**
 * Map GenericAgentResult to the response status type.
 */
function mapAgentResultStatus(result: Pick<GenericAgentResult, 'status' | 'error'>): AgentResponseData['status'] {
  if (result.status === 'interrupted' && result.error === 'max_iterations_reached') {
    return 'max_iterations';
  }

  switch (result.status) {
    case 'completed':
      return 'completed';
    case 'waiting_for_user':
      return 'awaiting_input';
    case 'interrupted':
      return 'cancelled';
    case 'error':
      return 'error';
    default:
      return 'error';
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const FILE_PATH_PROTOCOL_VERSION = 3;
const FILE_PATH_TRANSPORT: NonNullable<
  StatusData['capabilities']
>['filePathTransport'] = 'relative_posix';

export class WebSocketHandler {
  private conversationManager: ConversationManager;
  private connections = new Map<string, ConnectionState>();
  private detachedSessions = new Map<string, DetachedSessionState>();
  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private static readonly FILE_SYNC_TIMEOUT_MS = 15000;
  private static readonly RECONNECT_GRACE_MS = parsePositiveInt(
    process.env['KSHANA_WS_RECONNECT_GRACE_MS'],
    30 * 60 * 1000,
  );
  private static readonly DETACHED_EVENT_BUFFER_CAP = 1000;
  private readonly assetAddedListener: (event: AssetAddedEvent) => void;
  private readonly backgroundGenerationListener: (event: BackgroundGenerationEvent) => void;

  constructor(conversationManager: ConversationManager) {
    this.conversationManager = conversationManager;

    // Start heartbeat interval
    this.heartbeatInterval = setInterval(() => this.checkHeartbeats(), 30000);

    // Global asset listener: broadcast to all project-matching live connections.
    this.assetAddedListener = (event: AssetAddedEvent) => {
      const projectDir = event.projectDirectory;
      if (!projectDir) return;

      const message = createServerMessage<AssetAddedData>('asset_added', event.sessionId ?? '', {
        assetId: event.assetId,
        assetType: event.assetType as AssetAddedData['assetType'],
        placementNumber: event.placementNumber,
        sceneNumber: event.sceneNumber,
        path: event.path,
        version: event.version,
      });

      for (const [, state] of this.connections) {
        if (state.projectDir === projectDir && state.socket.readyState === 1) {
          this.sendMessage(state.socket, message);
          console.log('[WebSocketHandler] Broadcast asset_added to connection', state.sessionId, 'for project', projectDir);
        }
      }
    };
    assetEventEmitter.onAssetAdded(this.assetAddedListener);

    // Global background generation listener: broadcast to project-matching live connections.
    this.backgroundGenerationListener = (event: BackgroundGenerationEvent) => {
      const projectDir = event.projectDirectory;
      if (!projectDir) return;

      const message = createServerMessage<BackgroundGenerationData>('background_generation', event.sessionId ?? '', {
        batchId: event.batchId,
        kind: event.kind,
        status: event.status,
        phase: event.phase,
        totalItems: event.totalItems,
        completedItems: event.completedItems,
        failedItems: event.failedItems,
        projectDirectory: event.projectDirectory,
      });

      for (const [, state] of this.connections) {
        if (state.projectDir === projectDir && state.socket.readyState === 1) {
          this.sendMessage(state.socket, message);
          console.log(
            '[WebSocketHandler] Broadcast background_generation to connection',
            state.sessionId,
            'for project',
            projectDir,
          );
        }
      }
    };
    assetEventEmitter.onBackgroundGeneration(this.backgroundGenerationListener);
  }

  private isTransientNetworkErrorMessage(message: string): boolean {
    return (
      /ECONNRESET/i.test(message) ||
      /ETIMEDOUT/i.test(message) ||
      /EAI_AGAIN/i.test(message) ||
      /ENOTFOUND/i.test(message) ||
      /socket hang up/i.test(message) ||
      /connection reset/i.test(message) ||
      /network error/i.test(message) ||
      /fetch failed/i.test(message)
    );
  }

  /**
   * Handle a new WebSocket connection.
   * @param socket - The WebSocket connection
   * @param request - The Fastify request object (for accessing query parameters)
   */
  async handleConnection(
    socket: WebSocket,
    request?: { query?: { project_dir?: string; channel?: string; session_id?: string } },
  ): Promise<void> {
    const projectDir = request?.query?.project_dir;
    const channel = request?.query?.channel === 'assets' ? 'assets' : 'chat';
    const requestedSessionId = request?.query?.session_id?.trim();
    const requiresFileSync = channel === 'chat' && !!projectDir;

    console.log('[WebSocketHandler] New connection:', {
      hasRequest: !!request,
      hasQuery: !!request?.query,
      channel,
      projectDir,
      requestedSessionId,
      queryKeys: request?.query ? Object.keys(request.query) : [],
    });

    if (requestedSessionId && this.connections.has(requestedSessionId)) {
      this.sendError(
        socket,
        requestedSessionId,
        'session_in_use',
        `Session ${requestedSessionId} is already connected`,
      );
      socket.close(4409, 'session_in_use');
      return;
    }

    let sessionId = requestedSessionId && requestedSessionId.length > 0
      ? requestedSessionId
      : uuidv4();
    let shouldResumeSession = false;
    let queuedEventsToFlush: Array<ServerMessage<unknown>> = [];

    if (channel === 'chat' && requestedSessionId) {
      const hasSession = this.conversationManager.hasSession(requestedSessionId);
      const sessionProjectDir =
        this.conversationManager.getSessionProjectDir(requestedSessionId);
      const projectMatches =
        (sessionProjectDir ?? undefined) === (projectDir ?? undefined);

      if (hasSession && projectMatches) {
        shouldResumeSession = true;
        const detached = this.detachedSessions.get(requestedSessionId);
        if (detached) {
          clearTimeout(detached.ttlTimer);
          queuedEventsToFlush = detached.queuedEvents;
          this.detachedSessions.delete(requestedSessionId);
        }
      } else {
        sessionId = uuidv4();
      }
    }

    let resolveFileSync = () => { };
    const fileSyncPromise = new Promise<void>((resolve) => {
      resolveFileSync = resolve;
    });

    let resolveSessionReady = () => { };
    const sessionReady = new Promise<void>((resolve) => {
      resolveSessionReady = resolve;
    });

    const connectionState: ConnectionState = {
      socket,
      sessionId,
      isAlive: true,
      channel,
      projectDir: projectDir ?? undefined,
      fileSyncDone: !requiresFileSync,
      fileSyncPromise,
      resolveFileSync,
      sessionReady,
      resolveSessionReady,
    };

    if (!requiresFileSync) {
      resolveFileSync();
    }

    this.connections.set(sessionId, connectionState);

    if (requiresFileSync) {
      const fileOps = getProjectFileOps();
      fileOps.setRemoteMode(
        this.createSender(connectionState),
        sessionId,
        undefined,
        {
          preserveCache: shouldResumeSession,
          projectRoot: projectDir ?? undefined,
        },
      );

      this.sendMessage(socket, createServerMessage<FileSyncRequestData>('file_sync_request', sessionId, {
        projectDir,
      }));
      console.log(`[WebSocketHandler] Sent file_sync_request for project: ${projectDir}`);
    }

    // Register socket handlers BEFORE createSession so that the
    // file_sync_init response from the desktop can be processed while
    // we await the file sync promise below.
    socket.on('message', async (data) => {
      connectionState.isAlive = true;
      await this.handleMessage(connectionState.sessionId, socket, data.toString());
    });

    socket.on('close', () => {
      this.handleDisconnection(connectionState.sessionId);
    });

    socket.on('error', (error) => {
      console.error(`WebSocket error for session ${connectionState.sessionId}:`, error);
      this.sendError(socket, connectionState.sessionId, 'websocket_error', error.message);
    });

    socket.on('pong', () => {
      connectionState.isAlive = true;
    });

    // Wait for the desktop to send back its project files so the cache
    // is populated with the real manifest before createSession runs.
    if (requiresFileSync) {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error('file_sync_timeout'));
        }, WebSocketHandler.FILE_SYNC_TIMEOUT_MS);
      });

      try {
        await Promise.race([connectionState.fileSyncPromise, timeoutPromise]);
        console.log(`[WebSocketHandler] File sync completed for session ${sessionId}, proceeding with session creation`);
      } catch {
        console.warn(
          `[WebSocketHandler] File sync timed out for session ${sessionId} ` +
          `(${WebSocketHandler.FILE_SYNC_TIMEOUT_MS}ms), creating session with empty cache`,
        );
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    }

    // Create session AFTER file sync so the cache has the real manifest.
    // createSession -> getOrCreateProject -> createProjectStructure will
    // now see the existing manifest and skip the empty-manifest write.
    const sessionBasePath = channel === 'chat' ? projectDir : undefined;
    if (!shouldResumeSession) {
      await this.conversationManager.createSession(sessionBasePath, sessionId);
    } else {
      console.log(`[WebSocketHandler] Resumed existing session: ${sessionId}`);
    }
    connectionState.resolveSessionReady();

    if (queuedEventsToFlush.length > 0) {
      for (const message of queuedEventsToFlush) {
        this.sendMessage(socket, message);
      }
    }

    this.sendMessage(
      socket,
      this.createStatusMessage(
        sessionId,
        'connected',
        shouldResumeSession
          ? 'Session resumed successfully'
          : 'Session created successfully',
      ),
    );
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
      this.sendMessage(socket, this.createStatusMessage(sessionId, 'ready', 'pong'));
      return;
    }

    if (isFileSyncInitMessage(message)) {
      this.handleFileSyncInit(sessionId, socket, message.data as FileSyncInitData);
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
      await this.handleCancel(
        sessionId,
        socket,
        (message.data as CancelData | undefined) ?? undefined,
      );
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
    const conn = await this.requireChatConnection(sessionId, socket, 'start_task');
    if (!conn) return;

    const fileSyncReady = await this.waitForFileSyncIfNeeded(sessionId, socket, conn);
    if (!fileSyncReady) return;

    // Send busy status
    this.emitToSession(
      sessionId,
      this.createStatusMessage(sessionId, 'busy', 'Processing task...'),
    );

    // Create event handlers
    const events = this.createEventHandlers(sessionId);

    try {
      const result = await this.conversationManager.runTask(
        sessionId,
        data.task,
        events,
        { maxIterations: data.options?.maxIterations },
      );

      // Send final response
      this.emitToSession(sessionId, createServerMessage<AgentResponseData>('agent_response', sessionId, {
        output: result.output,
        status: mapAgentResultStatus(result),
      }));

      this.emitTerminalStatusForResult(sessionId, result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isTransient = this.isTransientNetworkErrorMessage(errorMessage);
      if (isTransient) {
        this.emitToSession(
          sessionId,
          this.createStatusMessage(
            sessionId,
            'ready',
            'Transient network issue while contacting LLM. Ready to retry.',
          ),
        );
      }
      this.sendErrorToSession(
        sessionId,
        isTransient ? 'transient_network_error' : 'task_error',
        errorMessage,
      );
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
    const conn = await this.requireChatConnection(sessionId, socket, 'user_response');
    if (!conn) return;

    const fileSyncReady = await this.waitForFileSyncIfNeeded(sessionId, socket, conn);
    if (!fileSyncReady) return;

    // Send busy status
    this.emitToSession(
      sessionId,
      this.createStatusMessage(sessionId, 'busy', 'Processing response...'),
    );

    // Create event handlers
    const events = this.createEventHandlers(sessionId);

    try {
      const result = await this.conversationManager.sendResponse(sessionId, data.response, events);

      // Send final response
      this.emitToSession(sessionId, createServerMessage<AgentResponseData>('agent_response', sessionId, {
        output: result.output,
        status: mapAgentResultStatus(result),
      }));

      this.emitTerminalStatusForResult(sessionId, result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isTransient = this.isTransientNetworkErrorMessage(errorMessage);
      if (isTransient) {
        this.emitToSession(
          sessionId,
          this.createStatusMessage(
            sessionId,
            'ready',
            'Transient network issue while contacting LLM. Ready to retry.',
          ),
        );
      }
      this.sendErrorToSession(
        sessionId,
        isTransient ? 'transient_network_error' : 'response_error',
        errorMessage,
      );
    }
  }

  /**
   * Handle cancel message.
   */
  private async handleCancel(
    sessionId: string,
    socket: WebSocket,
    data?: CancelData,
  ): Promise<void> {
    const reason = data?.reason === 'project_switch' ? 'project_switch' : 'user_stop';
    const cancelled = await this.conversationManager.cancelTask(sessionId, reason);

    if (cancelled) {
      this.emitToSession(
        sessionId,
        this.createStatusMessage(sessionId, 'ready', 'Task cancelled'),
      );
    } else {
      this.sendError(socket, sessionId, 'cancel_failed', 'No running task to cancel');
    }
  }

  private emitTerminalStatusForResult(
    sessionId: string,
    result: Pick<GenericAgentResult, 'status' | 'error'>,
  ): void {
    const { status: resultStatus, error: resultError } = result;
    if (resultStatus === 'waiting_for_user') {
      return;
    }

    if (resultStatus === 'interrupted') {
      if (resultError === 'max_iterations_reached') {
        this.emitToSession(
          sessionId,
          this.createStatusMessage(
            sessionId,
            'error',
            'Agent reached maximum iterations.',
          ),
        );
        return;
      }
      this.emitToSession(
        sessionId,
        this.createStatusMessage(sessionId, 'ready', 'Task cancelled'),
      );
      return;
    }

    if (resultStatus === 'completed') {
      this.emitToSession(
        sessionId,
        this.createStatusMessage(sessionId, 'completed', 'Task completed'),
      );
      return;
    }

    this.emitToSession(
      sessionId,
      this.createStatusMessage(sessionId, 'error', 'Error occurred'),
    );
  }

  /**
   * Handle file_sync_init message from the desktop app.
   * Populates the in-memory cache with existing project files.
   */
  private handleFileSyncInit(sessionId: string, _socket: WebSocket, data: FileSyncInitData): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    if (conn.channel !== 'chat') {
      console.warn(`[WebSocketHandler] Ignoring file_sync_init from non-chat channel: ${sessionId}`);
      return;
    }

    const fileOps = getProjectFileOps();
    if (!fileOps.isOwnedBy(sessionId)) {
      console.warn(
        `[WebSocketHandler] Ignoring file_sync_init from non-owner session ${sessionId}. ` +
        `Current owner: ${fileOps.getRemoteOwnerSessionId() ?? 'none'}`,
      );
      return;
    }

    fileOps.populateCache(data.files);
    conn.fileSyncDone = true;
    conn.resolveFileSync();

    console.log(`[WebSocketHandler] File sync completed for session ${sessionId}: ${data.files.length} files cached`);
  }

  /**
   * Handle disconnection.
   */
  private handleDisconnection(sessionId: string): void {
    const disconnected = this.connections.get(sessionId);
    if (!disconnected) return;

    // Resolve pending gates so nothing hangs after disconnect
    disconnected.resolveFileSync();
    disconnected.resolveSessionReady();

    this.connections.delete(sessionId);

    const fileOps = getProjectFileOps();
    const isChatSession = disconnected.channel === 'chat';
    const isDetachable = isChatSession && this.conversationManager.hasSession(sessionId);

    // If owner disconnected, try rebinding to another live chat connection for same project.
    if (fileOps.isOwnedBy(sessionId)) {
      const replacement = [...this.connections.values()].find(
        (state) =>
          state.channel === 'chat' &&
          state.projectDir === disconnected.projectDir &&
          state.socket.readyState === 1,
      );

      if (replacement) {
        fileOps.setRemoteMode(
          this.createSender(replacement),
          replacement.sessionId,
          undefined,
          {
            preserveCache: true,
            projectRoot: replacement.projectDir,
          },
        );
        console.log(
          `[WebSocketHandler] Rebound ProjectFileOps owner from ${sessionId} to ${replacement.sessionId}`,
        );
      } else if (!isDetachable) {
        fileOps.setLocalMode();
        console.log(
          `[WebSocketHandler] No replacement chat connection found for owner ${sessionId}; switched to local mode`,
        );
      } else {
        console.log(
          `[WebSocketHandler] Owner ${sessionId} disconnected but session is detachable; ` +
          `keeping remote mode (cache: ${fileOps.isRemote()})`,
        );
      }
    }

    if (isDetachable) {
      this.markSessionDetached(disconnected);
      return;
    }

    this.conversationManager.deleteSession(sessionId);

    // If no more live connections, switch back to local mode
    if (this.connections.size === 0 && fileOps.isRemote()) {
      fileOps.setLocalMode();
    }
  }

  private markSessionDetached(connection: ConnectionState): void {
    const existing = this.detachedSessions.get(connection.sessionId);
    if (existing) {
      clearTimeout(existing.ttlTimer);
    }

    const queuedEvents = existing?.queuedEvents ?? [];
    this.scheduleDetachedExpiry(
      connection.sessionId,
      connection.channel,
      connection.projectDir,
      queuedEvents,
    );

    console.log(
      `[WebSocketHandler] Session ${connection.sessionId} detached. ` +
      `Will expire in ${WebSocketHandler.RECONNECT_GRACE_MS}ms`,
    );
  }

  private scheduleDetachedExpiry(
    sessionId: string,
    channel: 'chat' | 'assets',
    projectDir: string | undefined,
    queuedEvents: Array<ServerMessage<unknown>>,
  ): void {
    const detachedAt = Date.now();
    const ttlTimer = setTimeout(() => {
      this.expireDetachedSession(sessionId);
    }, WebSocketHandler.RECONNECT_GRACE_MS);

    this.detachedSessions.set(sessionId, {
      sessionId,
      channel,
      projectDir,
      detachedAt,
      expiresAt: detachedAt + WebSocketHandler.RECONNECT_GRACE_MS,
      ttlTimer,
      queuedEvents,
    });
  }

  private expireDetachedSession(sessionId: string): void {
    const detached = this.detachedSessions.get(sessionId);
    if (!detached) {
      return;
    }

    if (this.isSessionRunning(sessionId)) {
      this.scheduleDetachedExpiry(
        detached.sessionId,
        detached.channel,
        detached.projectDir,
        detached.queuedEvents,
      );
      console.log(
        `[WebSocketHandler] Detached session still running, extending grace window: ${sessionId}`,
      );
      return;
    }

    this.detachedSessions.delete(sessionId);
    this.conversationManager.deleteSession(sessionId);

    const fileOps = getProjectFileOps();
    if (fileOps.isOwnedBy(sessionId)) {
      fileOps.setLocalMode();
      console.log(`[WebSocketHandler] Detached session expired; switched to local mode`);
    }

    console.log(
      `[WebSocketHandler] Detached session expired and was removed: ${sessionId}`,
    );
  }

  private emitToSession<T>(sessionId: string, message: ServerMessage<T>): void {
    const conn = this.connections.get(sessionId);
    if (conn && conn.socket.readyState === 1) {
      this.sendMessage(conn.socket, message);
      return;
    }

    const detached = this.detachedSessions.get(sessionId);
    if (!detached) {
      return;
    }

    detached.queuedEvents.push(message as ServerMessage<unknown>);
    if (
      detached.queuedEvents.length >
      WebSocketHandler.DETACHED_EVENT_BUFFER_CAP
    ) {
      detached.queuedEvents = detached.queuedEvents.slice(
        detached.queuedEvents.length -
        WebSocketHandler.DETACHED_EVENT_BUFFER_CAP,
      );
    }
  }

  private sendErrorToSession(
    sessionId: string,
    code: string,
    message: string,
    details?: unknown,
  ): void {
    this.emitToSession(
      sessionId,
      createServerMessage<ErrorData>('error', sessionId, {
        code,
        message,
        details,
      }),
    );
  }

  private createStatusData(
    status: StatusData['status'],
    message?: string,
    agentName?: string,
  ): StatusData {
    const data: StatusData = {
      status,
      capabilities: {
        filePathProtocolVersion: FILE_PATH_PROTOCOL_VERSION,
        filePathTransport: FILE_PATH_TRANSPORT,
      },
    };
    if (message !== undefined) {
      data.message = message;
    }
    if (agentName !== undefined) {
      data.agentName = agentName;
    }
    return data;
  }

  private createStatusMessage(
    sessionId: string,
    status: StatusData['status'],
    message?: string,
    agentName?: string,
  ): ServerMessage<StatusData> {
    return createServerMessage<StatusData>(
      'status',
      sessionId,
      this.createStatusData(status, message, agentName),
    );
  }

  private createSender(connectionState: ConnectionState): (type: string, msgData: Record<string, unknown>) => void {
    const sessionId = connectionState.sessionId;
    return (type: string, msgData: Record<string, unknown>) => {
      this.emitToSession(sessionId, {
        type: type as ServerMessageType,
        sessionId,
        timestamp: Date.now(),
        data: msgData,
      });
    };
  }

  private async requireChatConnection(
    sessionId: string,
    socket: WebSocket,
    operation: 'start_task' | 'user_response',
  ): Promise<ConnectionState | null> {
    const conn = this.connections.get(sessionId);
    if (!conn) {
      this.sendError(socket, sessionId, 'session_not_found', 'Session not found');
      return null;
    }

    // Wait for session creation to finish before processing task messages.
    // Socket handlers are registered before createSession so that file_sync_init
    // can be received, but start_task/user_response must wait for the session.
    await conn.sessionReady;

    if (conn.channel !== 'chat') {
      this.sendError(
        socket,
        sessionId,
        'invalid_channel',
        `${operation} is only allowed on chat channel`,
      );
      return null;
    }

    const fileOps = getProjectFileOps();
    if (conn.projectDir && fileOps.isRemote() && !fileOps.isOwnedBy(sessionId)) {
      this.sendError(
        socket,
        sessionId,
        'file_proxy_not_owner',
        `Session ${sessionId} is not the active file proxy owner`,
      );
      return null;
    }
    if (conn.projectDir && !fileOps.isRemote()) {
      this.sendError(
        socket,
        sessionId,
        'file_proxy_unavailable',
        'File proxy is not active for this remote project session. Reconnect and retry.',
      );
      return null;
    }

    return conn;
  }

  private async waitForFileSyncIfNeeded(
    sessionId: string,
    socket: WebSocket,
    conn: ConnectionState,
  ): Promise<boolean> {
    if (!conn.projectDir || conn.fileSyncDone) return true;

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error('file_sync_timeout'));
      }, WebSocketHandler.FILE_SYNC_TIMEOUT_MS);
    });

    try {
      await Promise.race([conn.fileSyncPromise, timeoutPromise]);
      return true;
    } catch {
      this.sendError(
        socket,
        sessionId,
        'file_sync_timeout',
        `Initial file sync did not complete within ${WebSocketHandler.FILE_SYNC_TIMEOUT_MS}ms`,
      );
      return false;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Create event handlers for agent events.
   */
  private createEventHandlers(sessionId: string): ConversationEvents {
    return {
      onProgress: (sid, progress) => {
        const iteration = progress.iteration ?? Math.round(progress.percentage);
        const maxIterations =
          progress.maxIterations ??
          this.getSessionMaxIterations(sid);

        this.emitToSession(sid, createServerMessage<ProgressData>('progress', sid, {
          iteration,
          maxIterations,
          status: progress.message,
        }));
      },

      onToolCall: (sid, toolName, args) => {
        this.emitToSession(sid, createServerMessage<ToolCallData>('tool_call', sid, {
          toolName,
          toolCallId: '',
          arguments: args,
          status: 'started',
        }));
      },

      onToolResult: (sid, toolName, result) => {
        this.emitToSession(sid, createServerMessage<ToolCallData>('tool_call', sid, {
          toolName,
          toolCallId: '',
          arguments: {},
          status: 'completed',
          result,
        }));
      },

      onTodoUpdate: (sid, todos: ExpandableTodoItem[]) => {
        this.emitToSession(sid, createServerMessage<TodoUpdateData>('todo_update', sid, {
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
        this.emitToSession(sid, createServerMessage<StreamChunkData>('stream_chunk', sid, {
          content: text,
          done: isFinal ?? false,
        }));
      },

      onQuestion: (sid, question, isConfirmation) => {
        this.emitToSession(sid, createServerMessage<AgentQuestionData>('agent_question', sid, {
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
          case 'interrupted':
            statusType = 'ready';
            message = 'Task cancelled';
            break;
          case 'error':
            statusType = 'error';
            message = 'Error occurred';
            break;
          default:
            statusType = 'busy';
            message = 'Processing...';
        }

        this.emitToSession(
          sid,
          this.createStatusMessage(sid, statusType, message, agentName),
        );
      },

      onAssetAdded: (sid, assetId, assetType, path, version, placementNumber, sceneNumber) => {
        this.emitToSession(sid, createServerMessage<AssetAddedData>('asset_added', sid, {
          assetId,
          assetType: assetType as AssetAddedData['assetType'],
          placementNumber,
          sceneNumber,
          path,
          version,
        }));
      },
    };
  }

  private getSessionMaxIterations(sessionId: string): number {
    const manager = this.conversationManager as unknown as {
      getSessionMaxIterations?: (id: string) => number;
    };
    if (typeof manager.getSessionMaxIterations === 'function') {
      return manager.getSessionMaxIterations(sessionId);
    }
    return 100;
  }

  private isSessionRunning(sessionId: string): boolean {
    const manager = this.conversationManager as unknown as {
      isSessionRunning?: (id: string) => boolean;
      getSession?: (id: string) => { status?: string } | undefined;
    };

    if (typeof manager.isSessionRunning === 'function') {
      return manager.isSessionRunning(sessionId);
    }

    if (typeof manager.getSession === 'function') {
      const state = manager.getSession(sessionId);
      return state?.status === 'running';
    }

    return false;
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

    assetEventEmitter.offAssetAdded(this.assetAddedListener);
    assetEventEmitter.offBackgroundGeneration(this.backgroundGenerationListener);

    // Close all connections
    for (const [sessionId, state] of this.connections) {
      state.socket.close(1001, 'Server shutting down');
      this.handleDisconnection(sessionId);
    }

    for (const [sessionId, detached] of this.detachedSessions) {
      clearTimeout(detached.ttlTimer);
      this.detachedSessions.delete(sessionId);
      this.conversationManager.deleteSession(sessionId);
    }
  }
}
